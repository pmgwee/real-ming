import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NATIVE_KNOWLEDGE_LIMITS,
  type ConsolidationRunRequest,
  type GenerationManifest,
  type NativeKnowledgeConsistencyFence,
  type NativeKnowledgeCandidate,
  type SourceSnapshot,
  type StagedPage,
} from "./contracts.js";
import { verifyEvidence } from "./evidence.js";
import { activateGeneration, readManifest, stageGeneration } from "./publication.js";
import { wikiRetrieve } from "./retrieval.js";
import { isSuppressedByTombstone } from "./tombstones.js";
import type { NativeKnowledgeRegistry } from "./registry.js";

export type SourceReadResult = SourceSnapshot | { readonly kind: "unavailable"; readonly reason: string };
export type SupportAssessment = "supported" | "unsupported" | "uncertain";

export interface NativeKnowledgeRunnerRequest extends ConsolidationRunRequest {
  readonly registry: NativeKnowledgeRegistry;
  readonly isolationEligible: boolean;
  readonly loadCandidate: (candidateId: string) => Promise<NativeKnowledgeCandidate | undefined>;
  readonly readSource: (candidate: NativeKnowledgeCandidate) => Promise<SourceReadResult>;
  readonly assessSupport?: (candidate: NativeKnowledgeCandidate, source: SourceSnapshot) => Promise<SupportAssessment>;
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function isRetryableFailure(reason: string): boolean {
  // The first slice retries only an explicitly classified transient source
  // outage. Publication, activation, isolation and model failures are not
  // replayed under the same lease because doing so could duplicate a side
  // effect or hide a fencing defect.
  return reason.startsWith("source-unavailable:");
}

function sameWorkFence(left: NativeKnowledgeConsistencyFence, right: NativeKnowledgeConsistencyFence): boolean {
  return left.activeGenerationId === right.activeGenerationId &&
    left.publicationEpoch === right.publicationEpoch &&
    left.sourceEpoch === right.sourceEpoch &&
    left.tombstoneEpoch === right.tombstoneEpoch &&
    left.tombstoneHeadEpoch === right.tombstoneHeadEpoch &&
    left.repairState === right.repairState;
}

function previousPages(
  manifest: GenerationManifest,
  generationPath: string,
  registry: NativeKnowledgeRegistry,
): StagedPage[] {
  return manifest.pages
    .map((page) => ({
    pageId: page.pageId,
    path: page.path,
    content: readFileSync(join(generationPath, page.path), "utf8"),
    sourceCandidateIds: page.sourceCandidateIds,
    claimClass: page.claimClass,
    sourceReference: page.sourceReference,
    capturedAt: page.capturedAt,
    asOf: page.asOf,
    disposition: page.disposition,
    uncertainty: page.uncertainty,
    }))
    .filter((page) => !isSuppressedByTombstone(page, registry.tombstones()));
}

function mergePages(previous: readonly StagedPage[], next: readonly StagedPage[]): readonly StagedPage[] {
  const merged = new Map(previous.map((page) => [page.pageId, page]));
  for (const page of next) merged.set(page.pageId, page);
  return [...merged.values()];
}

/** Run one bounded native-Hermes consolidation job; no provider or native-memory writes. */
export async function runConsolidation(input: NativeKnowledgeRunnerRequest): Promise<import("./contracts.js").ConsolidationRunResult> {
  if (!input.isolationEligible) return { kind: "ineligible", reason: "pinned Hermes isolation preflight is not eligible", retryCount: 0 };
  const maxWallClockMs = input.maxWallClockMs ?? NATIVE_KNOWLEDGE_LIMITS.maxWallClockMs;
  if (!Number.isSafeInteger(maxWallClockMs) || maxWallClockMs < 1 || maxWallClockMs > NATIVE_KNOWLEDGE_LIMITS.maxWallClockMs) {
    return { kind: "ineligible", reason: "invalid wall-clock limit", retryCount: 0 };
  }
  const claimed = input.registry.claimRun({ operatingDate: input.operatingDate, limit: NATIVE_KNOWLEDGE_LIMITS.maxCandidatesPerRun });
  if (claimed.kind === "busy") return { kind: "busy", reason: `run ${claimed.runId} is active`, retryCount: 0 };
  if (claimed.kind !== "claimed") return { kind: "failed", reason: claimed.reason, retryCount: 0 };
  const startedAt = Date.now();
  let retryCount = 0;
  let toolCalls = 0;
  let sourceBytes = 0;
  let modelCalls = 0;
  const runStartFence = input.registry.consistencyFence();

  const recordFailure = (reason: string): import("./contracts.js").ConsolidationRunResult => {
    try {
      input.registry.recordRunFailure(claimed.runId, claimed.leaseToken, claimed.leaseEpoch, reason.slice(0, 160));
    } catch {
      // The lease may have expired while the bounded job was failing. The
      // return remains non-success; no stale worker may claim it completed.
    }
    return { kind: "failed", runId: claimed.runId, reason, retryCount };
  };

  while (true) {
  try {
    if (elapsedMs(startedAt) > maxWallClockMs) throw new Error("wall-clock budget exceeded");
    const metadata = input.registry.listCandidates("staged");
    if (metadata.length > NATIVE_KNOWLEDGE_LIMITS.maxCandidatesPerRun) throw new Error("candidate backlog exceeds per-run limit");
    const candidates: NativeKnowledgeCandidate[] = [];
    for (const item of metadata) {
      if (elapsedMs(startedAt) > maxWallClockMs) throw new Error("wall-clock budget exceeded");
      const candidate = await input.loadCandidate(item.candidateId);
      toolCalls += 1;
      if (toolCalls > NATIVE_KNOWLEDGE_LIMITS.maxToolCalls) throw new Error("tool-call limit exceeded");
      if (candidate === undefined) throw new Error(`candidate ${item.candidateId} payload unavailable`);
      candidates.push(candidate);
      const source = await input.readSource(candidate);
      toolCalls += 1;
      if (toolCalls > NATIVE_KNOWLEDGE_LIMITS.maxToolCalls) throw new Error("tool-call limit exceeded");
      if ("kind" in source) throw new Error(`source-unavailable:${source.reason}`);
      const size = Buffer.byteLength(source.content, "utf8");
      if (size > NATIVE_KNOWLEDGE_LIMITS.maxSourceBytes) throw new Error(`source ${candidate.candidateId} exceeds byte limit`);
      sourceBytes += size;
      if (sourceBytes > NATIVE_KNOWLEDGE_LIMITS.maxRunSourceBytes) throw new Error("run source-byte limit exceeded");
      const support = await verifyEvidence({
        candidate,
        source,
        now: input.now,
        semanticSupport: input.assessSupport === undefined ? "uncertain" : await input.assessSupport(candidate, source),
      });
      if (support.disposition !== "supported") throw new Error(`candidate ${candidate.candidateId} evidence:${support.disposition}`);
    }
    let previous: GenerationManifest | undefined;
    let previousPath: string | undefined;
    const active = input.registry.activeGeneration();
    if (active !== undefined) {
      previous = readManifest(join(active.path, "manifest.json"));
      previousPath = active.path;
    }
    if (candidates.length === 0) {
      if (!sameWorkFence(runStartFence, input.registry.consistencyFence())) throw new Error("publication fence changed during consolidation");
      input.registry.recordRunSuccess(claimed.runId, claimed.leaseToken, claimed.leaseEpoch, input.clock?.() ?? input.now);
      return { kind: "succeeded", runId: claimed.runId, retryCount };
    }
    if (elapsedMs(startedAt) > maxWallClockMs) throw new Error("wall-clock budget exceeded before synthesis");
    if (modelCalls >= NATIVE_KNOWLEDGE_LIMITS.maxModelCalls) throw new Error("model-call limit exceeded");
    modelCalls += 1;
    const pages = await input.synthesize({ candidates, previous });
    if (elapsedMs(startedAt) > maxWallClockMs) throw new Error("wall-clock budget exceeded after synthesis");
    if (pages.length > NATIVE_KNOWLEDGE_LIMITS.maxPagesPerGeneration) throw new Error("generation page limit exceeded");
    const carried = previous === undefined || previousPath === undefined
      ? []
      : previousPages(previous, previousPath, input.registry);
    const complete = mergePages(carried, pages);
    if (complete.length > NATIVE_KNOWLEDGE_LIMITS.maxPagesPerGeneration) throw new Error("complete generation page limit exceeded");
    const beforePublication = input.registry.consistencyFence();
    if (!sameWorkFence(runStartFence, beforePublication)) throw new Error("publication fence changed during consolidation");
    const publicationNow = input.clock?.() ?? input.now;
    if (!Number.isFinite(Date.parse(publicationNow))) throw new Error("publication timestamp is invalid");
    const generated = await stageGeneration({
      run: claimed,
      generatedRoot: input.generatedRoot,
      stagingRoot: input.stagingRoot,
      pages: complete,
      ...(previous === undefined ? {} : { previous }),
      sourceEpoch: beforePublication.sourceEpoch,
      tombstoneEpoch: beforePublication.tombstoneEpoch,
      now: publicationNow,
    });
    if (!sameWorkFence(beforePublication, input.registry.consistencyFence())) {
      throw new Error("publication fence changed after filesystem preparation");
    }
    input.registry.recordStagedGeneration(generated);
    const activationNow = input.clock?.() ?? publicationNow;
    const activation = activateGeneration({
      registry: input.registry,
      generation: generated,
      lease: claimed,
      activePath: input.generatedRoot,
      now: activationNow,
      expectedActiveGenerationId: beforePublication.activeGenerationId,
      expectedSourceEpoch: beforePublication.sourceEpoch,
      expectedTombstoneEpoch: beforePublication.tombstoneEpoch,
    });
    if (activation.kind !== "activated") throw new Error(`activation:${activation.reason}`);
    const readBack = wikiRetrieve({
      registry: input.registry,
      generatedRoot: input.generatedRoot,
      query: complete[0]?.pageId ?? "generated knowledge",
      now: activationNow,
    });
    if (readBack.kind !== "ok") throw new Error(`retrieval-readback:${readBack.reason}`);
    input.registry.recordRunSuccess(claimed.runId, claimed.leaseToken, claimed.leaseEpoch, input.clock?.() ?? activationNow);
    return { kind: "succeeded", runId: claimed.runId, generationId: generated.generationId, retryCount };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "native knowledge run failed";
    if (
      isRetryableFailure(reason) &&
      retryCount < NATIVE_KNOWLEDGE_LIMITS.maxRetries &&
      elapsedMs(startedAt) < maxWallClockMs
    ) {
      retryCount += 1;
      try {
        input.registry.recordRunRetry(claimed.runId, claimed.leaseToken, claimed.leaseEpoch, reason.slice(0, 160));
      } catch (retryError) {
        return recordFailure(retryError instanceof Error ? retryError.message : "retry lease update failed");
      }
      continue;
    }
    return recordFailure(reason);
  }
  }
}
