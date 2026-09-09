import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRealMingMcpComposition } from "./real-ming-mcp-cli.js";
import { sha256ContentHash } from "../knowledge/native-consolidation/evidence.js";
import { createNativeKnowledgeRegistry } from "../knowledge/native-consolidation/registry.js";
import { runConsolidation, type SourceReadResult } from "../knowledge/native-consolidation/runner.js";
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

function ensureCommonEnvironment(): void {
  if (process.argv.includes("--controlled") !== true) failure("live launch is not enabled by this entry point");
  if (env("REAL_MING_NETWORK_DISABLED") !== "1" || env("REAL_MING_NO_CREDENTIALS") !== "1") failure("offline no-credentials environment is required");
  if (env("HERMES_SKIP_MEMORY") !== "1") failure("HERMES_SKIP_MEMORY must be 1");
  if (env("HERMES_KNOWLEDGE_AUTH_PROFILE") === undefined) failure("named knowledge auth profile is required");
  // The explicitly named offline adapter is not an isolation proof.  The
  // native-Hermes path must receive the attestation produced by the real
  // pinned-runtime preflight; offline tests may proceed without it.
  if (env("REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE") !== "1" && env("REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE") !== "true") failure("pinned Hermes isolation is not eligible");
  if (env("HERMES_REQUIRED_COMMIT") !== REQUIRED_COMMIT) failure("pinned Hermes commit does not match the approved commit");
}

function readRecords(path: string, label: string): unknown[] {
  if (!existsSync(path)) failure(`${label} is unavailable`);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { failure(`${label} is invalid JSON`); }
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    const values = record[label] ?? (label === "candidates" ? record["items"] : undefined);
    if (Array.isArray(values)) return values;
  }
  failure(`${label} must be an array`);
}

function parseCandidate(value: unknown): NativeKnowledgeCandidate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failure("candidate route contains an invalid record");
  const candidate = value as Partial<NativeKnowledgeCandidate>;
  const required = ["candidateId", "kind", "claimClass", "claim", "sourceIdentity", "sourceReference", "sourceVersion", "excerpt", "contentHash", "capturedAt", "asOf", "trustDomain", "sensitivity", "retentionClass"] as const;
  if (!required.every((key) => typeof candidate[key] === "string" && candidate[key]!.trim().length > 0)) failure("candidate route contains missing fields");
  if (!Array.isArray(candidate.dependencies) || !candidate.dependencies.every((item) => typeof item === "string" && item.trim().length > 0)) failure("candidate dependencies are invalid");
  return candidate as NativeKnowledgeCandidate;
}

function parsePage(value: unknown): StagedPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failure("Hermes synthesis contains an invalid page");
  const page = value as Partial<StagedPage>;
  if (typeof page.pageId !== "string" || typeof page.path !== "string" || typeof page.content !== "string" || !Array.isArray(page.sourceCandidateIds) || page.sourceCandidateIds.length === 0 || !page.sourceCandidateIds.every((item) => typeof item === "string" && item.trim().length > 0) || typeof page.claimClass !== "string" || typeof page.sourceReference !== "string" || typeof page.capturedAt !== "string" || typeof page.asOf !== "string" || typeof page.disposition !== "string" || typeof page.uncertainty !== "string") failure("Hermes synthesis page is missing required lineage metadata");
  if (page.dependencies !== undefined && (!Array.isArray(page.dependencies) || !page.dependencies.every((item) => typeof item === "string" && item.trim().length > 0))) failure("Hermes synthesis page dependencies are invalid");
  return page as StagedPage;
}

function parseSynthesis(path: string): StagedPage[] {
  return readRecords(path, "pages").map(parsePage);
}

/** Explicit offline fixture adapter. It is never labelled native-Hermes. */
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
  return { candidate, source: { sourceIdentity: candidate.sourceIdentity, sourceReference: candidate.sourceReference, sourceVersion: candidate.sourceVersion, content, contentHash, asOf: now, retrievedAt: now } };
}

function pageFor(candidate: NativeKnowledgeCandidate): StagedPage {
  return { pageId: CANDIDATE_ID, path: "pages/controlled.md", content: `# Controlled native knowledge\n\n${candidate.claim}\n`, sourceCandidateIds: [candidate.candidateId], dependencies: candidate.dependencies, claimClass: candidate.claimClass, sourceReference: candidate.sourceReference, capturedAt: candidate.capturedAt, asOf: candidate.asOf, disposition: "supported", uncertainty: "none" };
}

function assessSourceSupport(candidate: NativeKnowledgeCandidate, source: SourceSnapshot): "supported" | "unsupported" {
  // Support is derived from the admitted candidate's exact source identity,
  // not asserted as a fixed success value.  verifyEvidence performs the same
  // checks before publication; keeping this callback data-dependent prevents
  // a production adapter from silently promoting every loaded record.
  return source.content.includes(candidate.excerpt) && sha256ContentHash(source.content) === candidate.contentHash
    ? "supported"
    : "unsupported";
}

function parseFailure(): FixtureFailure {
  const value = env("REAL_MING_KNOWLEDGE_FIXTURE_FAILURE");
  if (value === undefined) return undefined;
  if (value === "job" || value === "publication" || value === "timeout" || value === "no-op") return value;
  failure("REAL_MING_KNOWLEDGE_FIXTURE_FAILURE is invalid");
}

function localHeadStore() {
  let head: TombstoneHead = { epoch: 0, entries: [], complete: true, version: "v0" };
  const store: TombstoneHeadStore = {
    async readHead() { return { kind: "ok" as const, head }; },
    async appendIfVersion(input) {
      if (input.expectedVersion !== head.version) return { kind: "conflict" as const, head };
      head = { epoch: head.epoch + 1, entries: [...head.entries, { tombstoneId: input.tombstone.tombstoneId, subject: input.tombstone.subject, aliases: [...input.tombstone.aliases], localEpoch: input.tombstone.localEpoch }], complete: true, version: `v${head.epoch + 1}` };
      return { kind: "appended" as const, head };
    },
  };
  return store;
}

async function runOfflineFixture(): Promise<Record<string, unknown>> {
  ensureCommonEnvironment();
  if (env("REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE") !== "1") failure("offline fixture flag is required");
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
  // This composition is deliberately the named offline adapter.  It does not
  // self-attest native isolation; the native wrapper has a separate runtime
  // preflight and is never labelled by this path.
  const composition = createRealMingMcpComposition({ statePath: resolve(operationsStatePath), knowledgeStatePath: resolve(statePath), knowledgeGeneratedRoot: generatedRoot, knowledgeStagingRoot: stagingRoot, knowledgeCandidates: failureMode === "no-op" ? [] : [fixture.candidate], knowledgeRegistry: registry, knowledgeHeadStore: headStore, knowledgeReadSource: async () => fixture.source, now: () => now });
  try {
    // The four-operation consolidation allowlist deliberately excludes the
    // interactive capture mutation. The offline adapter therefore admits its
    // synthetic candidate through the same configured-route composition root;
    // it does not call a fifth MCP operation to make the fixture work.
    const listed = composition.tools.call("real_ming_knowledge_list_candidates", { status: "staged" });
    if (listed.kind !== "ok") failure("offline candidate listing failed");
    const value = listed.value as { readonly candidates?: readonly { readonly candidateId: string }[] };
    const selectedIds = new Set((value.candidates ?? []).map((item) => item.candidateId));
    const result = await runConsolidation({
      registry,
      isolationEligible: true,
      operatingDate: now.slice(0, 10),
      now,
      generatedRoot,
      stagingRoot,
      ...(failureMode === "timeout" ? { maxWallClockMs: 1 } : {}),
      loadCandidate: async (candidateId) => selectedIds.has(candidateId) ? fixture.candidate : undefined,
      // Keep source access on the public production MCP seam even in the
      // offline adapter. The fixture supplies only a local reader behind that
      // seam; the runner never receives fixed source bytes directly.
      readSource: async (candidate): Promise<SourceReadResult> => {
        if (failureMode === "job") return { kind: "unavailable", reason: "controlled job failure" };
        const read = await composition.tools.callAsync!("real_ming_read_knowledge_source", {
          sourceIdentity: candidate.sourceIdentity,
          sourceReference: candidate.sourceReference,
          sourceVersion: candidate.sourceVersion,
        });
        if (read.kind !== "ok") return { kind: "unavailable", reason: read.reason };
        const source = read.value;
        if (typeof source !== "object" || source === null || Array.isArray(source)) return { kind: "unavailable", reason: "offline source tool returned an invalid value" };
        return source as SourceSnapshot;
      },
      assessSupport: async (candidate, source) => assessSourceSupport(candidate, source),
      synthesize: async ({ candidates }) => {
        if (failureMode === "timeout") await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        if (failureMode === "publication") registry.setRepairState("needs-repair");
        return candidates.map(pageFor);
      },
      clock: () => now,
    });
    if (result.kind !== "succeeded") return { eligible: true, executed: true, activated: false, result: result.kind, reason: result.reason ?? "offline consolidation did not activate", runtime: "offline-fixture" };
    const active = registry.activeGeneration();
    if (active === undefined) return { eligible: true, executed: true, activated: false, result: "succeeded", reason: "no candidates selected", runtime: "offline-fixture" };
    if (composition.tools.call("real_ming_wiki_retrieve", { query: fixture.candidate.candidateId, now }).kind !== "ok") failure("offline retrieval read-back failed");
    const manifestPath = join(active.path, "manifest.json");
    if (!existsSync(manifestPath)) failure("offline activated manifest is missing");
    return { eligible: true, executed: true, activated: true, result: "succeeded", generationId: active.generationId, manifestPath, retrieved: true, runtime: "offline-fixture", pinnedCommit: REQUIRED_COMMIT };
  } finally { composition.close(); registry.close(); }
}

async function runNativeHermesComposition(): Promise<Record<string, unknown>> {
  ensureCommonEnvironment();
  if (env("REAL_MING_HERMES_EXECUTED") !== "1") failure("native-hermes execution attestation is missing");
  const statePath = env("REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH");
  const candidatesPath = env("REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE");
  const synthesisPath = env("REAL_MING_HERMES_SYNTHESIS_PATH");
  if (statePath === undefined || candidatesPath === undefined || synthesisPath === undefined) failure("native Hermes knowledge routes are incomplete");
  const generatedRoot = requireDirectory("REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT");
  const stagingRoot = requireDirectory("REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT");
  const operationsStatePath = env("REAL_MING_STATE_PATH") ?? join(dirname(resolve(statePath)), "operations.sqlite");
  mkdirSync(dirname(resolve(operationsStatePath)), { recursive: true });
  const now = env("REAL_MING_KNOWLEDGE_NOW") ?? new Date().toISOString();
  const candidates = readRecords(candidatesPath, "candidates").map(parseCandidate);
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const pages = parseSynthesis(synthesisPath);
  const registry = createNativeKnowledgeRegistry({ statePath: resolve(statePath), now: () => now });
  const composition = createRealMingMcpComposition({ statePath: resolve(operationsStatePath), knowledgeStatePath: resolve(statePath), knowledgeGeneratedRoot: generatedRoot, knowledgeStagingRoot: stagingRoot, knowledgeCandidates: candidates, knowledgeRegistry: registry, knowledgeIsolationEligible: () => true, now: () => now });
  try {
    const listed = composition.tools.call("real_ming_knowledge_list_candidates", { status: "staged" });
    if (listed.kind !== "ok") failure(`candidate listing failed: ${listed.reason}`);
    const listedValue = listed.value as { readonly candidates?: readonly { readonly candidateId: string }[] };
    const selectedIds = new Set((listedValue.candidates ?? []).map((item) => item.candidateId));
    if ([...selectedIds].some((id) => !candidateById.has(id))) failure("candidate route omitted an admitted candidate");
    const result = await runConsolidation({ registry, isolationEligible: true, operatingDate: now.slice(0, 10), now, generatedRoot, stagingRoot, loadCandidate: async (candidateId) => candidateById.get(candidateId), readSource: async (candidate): Promise<SourceReadResult> => { const read = await composition.tools.callAsync!("real_ming_read_knowledge_source", { sourceIdentity: candidate.sourceIdentity, sourceReference: candidate.sourceReference, sourceVersion: candidate.sourceVersion }); return read.kind === "ok" ? read.value as SourceSnapshot : { kind: "unavailable", reason: read.reason }; }, assessSupport: async (candidate, source) => assessSourceSupport(candidate, source), synthesize: async () => pages, clock: () => new Date().toISOString() });
    if (result.kind !== "succeeded") return { eligible: true, executed: true, activated: false, result: result.kind, reason: result.reason ?? "native Hermes consolidation did not activate", runtime: "native-hermes", pinnedCommit: REQUIRED_COMMIT, hermesExecuted: true };
    const active = registry.activeGeneration();
    if (active === undefined) return { eligible: true, executed: true, activated: false, result: "succeeded", reason: "no candidates selected", runtime: "native-hermes", pinnedCommit: REQUIRED_COMMIT, hermesExecuted: true };
    const retrievalQuery = pages[0]?.pageId ?? pages[0]?.path ?? active.generationId;
    if (composition.tools.call("real_ming_wiki_retrieve", { query: retrievalQuery, now }).kind !== "ok") failure("native retrieval read-back failed");
    const manifestPath = join(active.path, "manifest.json");
    if (!existsSync(manifestPath)) failure("native activated manifest is missing");
    return { eligible: true, executed: true, activated: true, result: "succeeded", generationId: active.generationId, manifestPath, retrieved: true, runtime: "native-hermes", pinnedCommit: REQUIRED_COMMIT, hermesExecuted: true };
  } finally { composition.close(); registry.close(); }
}

export async function runControlledNativeKnowledgeConsolidation(): Promise<Record<string, unknown>> {
  return env("REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE") === "1" ? runOfflineFixture() : runNativeHermesComposition();
}

async function main(): Promise<void> {
  try {
    const payload = await runControlledNativeKnowledgeConsolidation();
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = payload.activated === true || payload.reason === "no candidates selected" ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ eligible: false, executed: false, activated: false, reason: error instanceof Error ? error.message.slice(0, 240) : "native knowledge consolidation failed" })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
