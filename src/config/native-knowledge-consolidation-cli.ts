import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRealMingMcpComposition } from "./real-ming-mcp-cli.js";
import {
  sha256ContentHash,
} from "../knowledge/native-consolidation/evidence.js";
import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../knowledge/native-consolidation/registry.js";
import {
  runConsolidation,
  type SourceReadResult,
} from "../knowledge/native-consolidation/runner.js";
import type {
  NativeKnowledgeCandidate,
  SourceSnapshot,
  StagedPage,
  TombstoneHead,
  TombstoneHeadStore,
} from "../knowledge/native-consolidation/contracts.js";

const REQUIRED_COMMIT = "561b053f794a1781868bb032029d589c67708119";
const CONTROLLED_NOW = "2026-09-09T02:00:00.000Z";
const CANDIDATE_ID = "native-knowledge-controlled-candidate";

type FixtureFailure = "job" | "publication" | "timeout" | "no-op" | undefined;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function failure(value: string): never {
  throw new Error(value);
}

function requireDirectory(name: string): string {
  const value = env(name);
  if (value === undefined) failure(`${name} is required`);
  mkdirSync(value, { recursive: true });
  return resolve(value);
}

function controlledCandidate(now: string): { candidate: NativeKnowledgeCandidate; source: SourceSnapshot } {
  const content = "Controlled native knowledge exact source bytes.\n";
  const contentHash = sha256ContentHash(content);
  const candidate: NativeKnowledgeCandidate = {
    candidateId: CANDIDATE_ID,
    kind: "project-artifact",
    claimClass: "project",
    claim: "The controlled native knowledge path is operational.",
    sourceIdentity: "fixture:native-knowledge",
    sourceReference: "fixture:native-knowledge/source.txt",
    sourceVersion: "v1",
    excerpt: content,
    contentHash,
    capturedAt: now,
    asOf: now,
    trustDomain: "Ming Creatives",
    sensitivity: "normal",
    retentionClass: "project-90d",
    dependencies: [CANDIDATE_ID, "pages/controlled.md"],
  };
  const source: SourceSnapshot = {
    sourceIdentity: candidate.sourceIdentity,
    sourceReference: candidate.sourceReference,
    sourceVersion: candidate.sourceVersion,
    content,
    contentHash,
    asOf: now,
    retrievedAt: now,
  };
  return { candidate, source };
}

function pageFor(candidate: NativeKnowledgeCandidate): StagedPage {
  return {
    pageId: CANDIDATE_ID,
    path: "pages/controlled.md",
    content: `# Controlled native knowledge\n\n${candidate.claim}\n`,
    sourceCandidateIds: [candidate.candidateId],
    claimClass: candidate.claimClass,
    sourceReference: candidate.sourceReference,
    capturedAt: candidate.capturedAt,
    asOf: candidate.asOf,
    disposition: "supported",
    uncertainty: "none",
  };
}

function localHeadStore(): TombstoneHeadStore {
  let head: TombstoneHead = {
    epoch: 0,
    entries: [],
    complete: true,
    version: "v0",
  };
  return {
    async readHead() {
      return { kind: "ok", head };
    },
    async appendIfVersion(input) {
      if (input.expectedVersion !== head.version) {
        return { kind: "conflict", head };
      }
      head = {
        epoch: head.epoch + 1,
        entries: [
          ...head.entries,
          {
            tombstoneId: input.tombstone.tombstoneId,
            subject: input.tombstone.subject,
            localEpoch: input.tombstone.localEpoch,
          },
        ],
        complete: true,
        version: `v${head.epoch + 1}`,
      };
      return { kind: "appended", head };
    },
  };
}

function sourceFromTool(value: unknown): SourceReadResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "unavailable", reason: "source tool returned an invalid value" };
  }
  return value as SourceSnapshot;
}

function parseFailure(): FixtureFailure {
  const value = env("REAL_MING_KNOWLEDGE_FIXTURE_FAILURE");
  if (value === undefined) return undefined;
  if (value === "job" || value === "publication" || value === "timeout" || value === "no-op") return value;
  failure("REAL_MING_KNOWLEDGE_FIXTURE_FAILURE is invalid");
}

function ensureControlledEnvironment(): void {
  if (process.argv.includes("--controlled") !== true) {
    failure("live launch is not enabled by this entry point");
  }
  if (env("REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE") !== "1") {
    failure("controlled synthetic fixture is required");
  }
  if (env("REAL_MING_NETWORK_DISABLED") !== "1" || env("REAL_MING_NO_CREDENTIALS") !== "1") {
    failure("offline no-credentials environment is required");
  }
  if (env("HERMES_SKIP_MEMORY") !== "1") failure("HERMES_SKIP_MEMORY must be 1");
  if (env("HERMES_KNOWLEDGE_AUTH_PROFILE") === undefined) failure("named knowledge auth profile is required");
  if (env("REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE") !== "true") {
    failure("pinned Hermes isolation is not eligible");
  }
  const configuredCommit = env("HERMES_REQUIRED_COMMIT");
  if (configuredCommit !== undefined && configuredCommit !== REQUIRED_COMMIT) {
    failure("pinned Hermes commit does not match the approved commit");
  }
}

export async function runControlledNativeKnowledgeConsolidation(): Promise<Record<string, unknown>> {
  ensureControlledEnvironment();
  const statePath = env("REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH");
  if (statePath === undefined) failure("REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH is required");
  const generatedRoot = requireDirectory("REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT");
  const stagingRoot = requireDirectory("REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT");
  const operationsStatePath = env("REAL_MING_STATE_PATH") ?? join(dirname(resolve(statePath)), "operations.sqlite");
  mkdirSync(dirname(resolve(operationsStatePath)), { recursive: true });
  const now = env("REAL_MING_KNOWLEDGE_NOW") ?? CONTROLLED_NOW;
  const failureMode = parseFailure();
  const fixture = controlledCandidate(now);
  const registry = createNativeKnowledgeRegistry({ statePath: resolve(statePath), now: () => now });
  const headStore = localHeadStore();
  const composition = createRealMingMcpComposition({
    statePath: resolve(operationsStatePath),
    knowledgeStatePath: resolve(statePath),
    knowledgeGeneratedRoot: generatedRoot,
    knowledgeStagingRoot: stagingRoot,
    knowledgeRegistry: registry,
    knowledgeHeadStore: headStore,
    knowledgeIsolationEligible: () => true,
    knowledgeReadSource: async () => fixture.source,
    now: () => now,
  });
  try {
    if (failureMode !== "no-op") {
      const admitted = registry.admitCandidate(fixture.candidate);
      if (admitted.kind !== "accepted" && admitted.kind !== "duplicate") {
        failure(`controlled candidate admission failed: ${admitted.reason}`);
      }
    }
    const listed = composition.tools.call("real_ming_knowledge_list_candidates", { status: "staged" });
    if (listed.kind !== "ok") failure(`candidate listing failed: ${listed.reason}`);
    const listValue = listed.value as { readonly candidates?: readonly { readonly candidateId: string }[] };
    const selectedIds = new Set((listValue.candidates ?? []).map((item) => item.candidateId));
    const result = await runConsolidation({
      registry,
      isolationEligible: true,
      operatingDate: now.slice(0, 10),
      now,
      generatedRoot,
      stagingRoot,
      ...(failureMode === "timeout" ? { maxWallClockMs: 1 } : {}),
      loadCandidate: async (candidateId) => selectedIds.has(candidateId) ? fixture.candidate : undefined,
      readSource: async (candidate): Promise<SourceReadResult> => {
        if (failureMode === "job") return { kind: "unavailable", reason: "controlled job failure" };
        const read = await composition.tools.callAsync!("real_ming_read_knowledge_source", {
          sourceIdentity: candidate.sourceIdentity,
          sourceReference: candidate.sourceReference,
        });
        return read.kind === "ok" ? sourceFromTool(read.value) : { kind: "unavailable", reason: read.reason };
      },
      assessSupport: async () => "supported",
      synthesize: async ({ candidates }) => {
        if (failureMode === "timeout") await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        if (failureMode === "publication") registry.setRepairState("needs-repair");
        return candidates.map(pageFor);
      },
      clock: () => now,
    });
    if (result.kind === "failed" || result.kind === "ineligible" || result.kind === "busy") {
      return {
        eligible: true,
        executed: true,
        activated: false,
        result: result.kind,
        reason: result.reason ?? "controlled consolidation did not activate",
      };
    }
    if (failureMode === "publication") {
      // The fixture requests a publication failure before reporting success;
      // a real run cannot claim activation if its active pointer is absent.
      failure("controlled publication failure was not exercised");
    }
    const active = registry.activeGeneration();
    if (active === undefined) {
      return {
        eligible: true,
        executed: true,
        activated: false,
        result: "succeeded",
        reason: "no candidates selected",
      };
    }
    const retrieved = composition.tools.call("real_ming_wiki_retrieve", {
      query: fixture.candidate.candidateId,
      now,
    });
    if (retrieved.kind !== "ok") failure(`production retrieval read-back failed: ${retrieved.reason}`);
    const manifestPath = join(active.path, "manifest.json");
    if (!existsSync(manifestPath)) failure("activated generation manifest is missing");
    return {
      eligible: true,
      executed: true,
      activated: true,
      result: "succeeded",
      generationId: active.generationId,
      manifestPath,
      retrieved: true,
      runtime: "native-hermes",
      pinnedCommit: REQUIRED_COMMIT,
    };
  } finally {
    composition.close();
    registry.close();
  }
}

async function main(): Promise<void> {
  try {
    const payload = await runControlledNativeKnowledgeConsolidation();
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = payload.activated === true || payload.reason === "no candidates selected" ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      eligible: false,
      executed: false,
      activated: false,
      reason: error instanceof Error ? error.message.slice(0, 240) : "native knowledge consolidation failed",
    })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
