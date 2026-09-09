import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type {
  NativeKnowledgeCandidate,
  SourceSnapshot,
  StagedPage,
} from "../../src/knowledge/native-consolidation/contracts.js";
import { createNativeKnowledgeRegistry } from "../../src/knowledge/native-consolidation/registry.js";
import { runConsolidation } from "../../src/knowledge/native-consolidation/runner.js";
import { sha256ContentHash } from "../../src/knowledge/native-consolidation/evidence.js";
import { wikiRetrieve } from "../../src/knowledge/native-consolidation/retrieval.js";
import { nativeKnowledgeCronManifest } from "../../src/config/native-knowledge-cron-manifest.js";

function candidate(id: string, asOf = "2026-09-09T01:00:00.000Z"): NativeKnowledgeCandidate {
  const claim = `Project claim ${id} is source-backed.`;
  return {
    candidateId: id,
    kind: "project-artifact",
    claimClass: "project",
    claim,
    sourceIdentity: `project:${id}`,
    sourceReference: `fixture:${id}`,
    sourceVersion: "v1",
    excerpt: `Project claim ${id} is source-backed.`,
    contentHash: sha256ContentHash(claim),
    capturedAt: "2026-09-09T01:00:00.000Z",
    asOf,
    trustDomain: "Ming Creatives",
    sensitivity: "normal",
    retentionClass: "project-90d",
    dependencies: [id],
  };
}

function sourceFor(value: NativeKnowledgeCandidate): SourceSnapshot {
  return {
    sourceIdentity: value.sourceIdentity,
    sourceReference: value.sourceReference,
    sourceVersion: value.sourceVersion,
    content: value.excerpt,
    contentHash: value.contentHash,
    asOf: value.asOf,
    retrievedAt: "2026-09-09T01:59:00.000Z",
  };
}

async function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-runner-"));
  const registry = createNativeKnowledgeRegistry({
    statePath: join(directory, "state.sqlite"),
    now: () => new Date().toISOString(),
  });
  return {
    directory,
    registry,
    generatedRoot: join(directory, "vault", ".real-ming", "generated"),
    stagingRoot: join(directory, "vault", ".real-ming", "staging"),
  };
}

describe("native knowledge bounded runner", () => {
  it("publishes a secret-free inactive 02:00 Kuala Lumpur manifest with the exact MCP set", () => {
    expect(nativeKnowledgeCronManifest.active).toBe(false);
    expect(nativeKnowledgeCronManifest.schedule).toBe("0 2 * * *");
    expect(nativeKnowledgeCronManifest.timeZone).toBe("Asia/Kuala_Lumpur");
    expect(nativeKnowledgeCronManifest.delivery).toBe("local");
    expect(nativeKnowledgeCronManifest.skipMemory).toBe(true);
    expect(nativeKnowledgeCronManifest.mcpTools).toEqual([
      "real_ming_knowledge_list_candidates",
      "real_ming_read_knowledge_source",
      "real_ming_stage_knowledge_generation",
      "real_ming_wiki_retrieve",
    ]);
    expect(JSON.stringify(nativeKnowledgeCronManifest)).not.toMatch(/(token|secret|password|key)=/i);
  });

  it("claims one run, verifies evidence, activates and reads back a cited page", async () => {
    const fixture = await workspace();
    const item = candidate("candidate-a");
    fixture.registry.admitCandidate(item);
    try {
      let calls = 0;
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => item,
        readSource: async () => sourceFor(item),
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => {
          calls += 1;
          return candidates.map<StagedPage>((value) => ({
            pageId: value.candidateId,
            path: `pages/${value.candidateId}.md`,
            content: `# ${value.candidateId}\n\n${value.claim}`,
            sourceCandidateIds: [value.candidateId],
            claimClass: value.claimClass,
            sourceReference: value.sourceReference,
            capturedAt: value.capturedAt,
            asOf: value.asOf,
            disposition: "supported",
            uncertainty: "none",
          }));
        },
        clock: () => "2026-09-09T02:00:02.000Z",
      });
      expect(result.kind).toBe("succeeded");
      expect(calls).toBe(1);
      expect(fixture.registry.runHealth().lastSuccess).toBe("2026-09-09T02:00:02.000Z");
      const read = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "candidate-a",
        now: "2026-09-09T02:01:00.000Z",
      });
      expect(read.kind).toBe("ok");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("takes the publication timestamp at the final boundary when the request timestamp is stale", async () => {
    const fixture = await workspace();
    const item = candidate("fresh-publication-clock");
    fixture.registry.admitCandidate(item);
    try {
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        // Deliberately stale request metadata must not become the publication time.
        now: "2020-01-01T00:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => item,
        readSource: async () => sourceFor(item),
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => candidates.map<StagedPage>((value) => ({
          pageId: value.candidateId,
          path: `pages/${value.candidateId}.md`,
          content: value.claim,
          sourceCandidateIds: [value.candidateId],
          claimClass: value.claimClass,
          sourceReference: value.sourceReference,
          capturedAt: value.capturedAt,
          asOf: value.asOf,
          disposition: "supported",
          uncertainty: "none",
        })),
      });
      expect(result.kind).toBe("succeeded");
      const active = fixture.registry.activeGeneration();
      expect(active).toBeDefined();
      if (active === undefined) return;
      expect(Date.parse(active.createdAt)).toBeGreaterThan(Date.parse("2026-01-01T00:00:00.000Z"));
      expect(active.createdAt).not.toBe("2020-01-01T00:00:00.000Z");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("refuses an ineligible runtime and never falls back to the broad toolset", async () => {
    const fixture = await workspace();
    try {
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: false,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => undefined,
        readSource: async () => ({ kind: "unavailable", reason: "not called" }),
        synthesize: async () => [],
      });
      expect(result.kind).toBe("ineligible");
      expect(fixture.registry.activeGeneration()).toBeUndefined();
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("retries a transient source outage within the bounded run budget", async () => {
    const fixture = await workspace();
    const item = candidate("transient-source");
    fixture.registry.admitCandidate(item);
    let reads = 0;
    try {
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => item,
        readSource: async () => {
          reads += 1;
          return reads === 1
            ? { kind: "unavailable" as const, reason: "transient-source-outage" }
            : sourceFor(item);
        },
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => candidates.map<StagedPage>((value) => ({
          pageId: value.candidateId,
          path: `pages/${value.candidateId}.md`,
          content: `# ${value.candidateId}\n\n${value.claim}`,
          sourceCandidateIds: [value.candidateId],
          claimClass: value.claimClass,
          sourceReference: value.sourceReference,
          capturedAt: value.capturedAt,
          asOf: value.asOf,
          disposition: "supported",
          uncertainty: "none",
        })),
      });
      expect(result.kind).toBe("succeeded");
      expect(result.retryCount).toBe(1);
      expect(reads).toBe(2);
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("enforces the twelve-candidate limit and records a bounded failure", async () => {
    const fixture = await workspace();
    const values = Array.from({ length: 13 }, (_, index) => candidate(`candidate-${index}`));
    for (const value of values) fixture.registry.admitCandidate(value);
    try {
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async (id) => values.find((value) => value.candidateId === id),
        readSource: async (value) => sourceFor(value),
        assessSupport: async () => "supported",
        synthesize: async () => [],
      });
      expect(result.kind).toBe("failed");
      expect(result.reason).toContain("candidate");
      expect(fixture.registry.runHealth().lastFailureCode).toContain("candidate");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fences publication when source state changes during synthesis", async () => {
    const fixture = await workspace();
    const item = candidate("source-mutation");
    const competing = candidate("source-mutation-competing");
    fixture.registry.admitCandidate(item);
    try {
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => item,
        readSource: async () => sourceFor(item),
        assessSupport: async () => "supported",
        synthesize: async () => {
          fixture.registry.admitCandidate(competing);
          return [{
            pageId: item.candidateId,
            path: `pages/${item.candidateId}.md`,
            content: item.claim,
            sourceCandidateIds: [item.candidateId],
            claimClass: item.claimClass,
            sourceReference: item.sourceReference,
            capturedAt: item.capturedAt,
            asOf: item.asOf,
            disposition: "supported" as const,
            uncertainty: "none" as const,
          }];
        },
      });
      expect(result.kind).toBe("failed");
      expect(result.reason).toContain("publication fence changed");
      expect(fixture.registry.activeGeneration()).toBeUndefined();
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("quarantines and removes a generation when the activation fence changes after staging", async () => {
    const fixture = await workspace();
    const item = candidate("post-stage-fence");
    const competing = candidate("post-stage-fence-competing");
    fixture.registry.admitCandidate(item);
    try {
      const originalRecord = fixture.registry.recordStagedGeneration.bind(fixture.registry);
      const fencedRegistry = new Proxy(fixture.registry, {
        get(target, property, receiver) {
          if (property !== "recordStagedGeneration") return Reflect.get(target, property, receiver);
          return (generation: Parameters<typeof target.recordStagedGeneration>[0]) => {
            originalRecord(generation);
            // Advance the authoritative source epoch after the immutable files
            // and staged row exist, but before activation validates its fence.
            target.admitCandidate(competing);
          };
        },
      });
      const result = await runConsolidation({
        registry: fencedRegistry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => item,
        readSource: async (value) => sourceFor(value),
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => candidates.map<StagedPage>((value) => ({
          pageId: value.candidateId,
          path: `pages/${value.candidateId}.md`,
          content: value.claim,
          sourceCandidateIds: [value.candidateId],
          claimClass: value.claimClass,
          sourceReference: value.sourceReference,
          capturedAt: value.capturedAt,
          asOf: value.asOf,
          disposition: "supported",
          uncertainty: "none",
        })),
      });
      expect(result.kind).toBe("failed");
      expect(result.reason).toContain("source-epoch-advanced");
      expect(fencedRegistry.inProgressGenerationIds()).toEqual([]);
      expect(readdirSync(join(fixture.generatedRoot, "generations"))).toHaveLength(0);
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("keeps valid pages across successive generations and preserves admitted dependency lineage", async () => {
    const fixture = await workspace();
    const first = candidate("candidate-a");
    const second = {
      ...candidate("candidate-b"),
      dependencies: ["candidate-b", "secondary-alias"],
    };
    fixture.registry.admitCandidate(first);
    try {
      const pageFor = (value: NativeKnowledgeCandidate): StagedPage => ({
        pageId: value.candidateId,
        path: `pages/${value.candidateId}.md`,
        content: `# ${value.candidateId}\n\n${value.claim}`,
        sourceCandidateIds: [value.candidateId],
        // Deliberately omit dependencies: the runner must carry every
        // dependency from the admitted registry metadata into the manifest.
        claimClass: value.claimClass,
        sourceReference: value.sourceReference,
        capturedAt: value.capturedAt,
        asOf: value.asOf,
        disposition: "supported",
        uncertainty: "none",
      });
      const firstRun = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async (id) => id === first.candidateId ? first : undefined,
        readSource: async (value) => sourceFor(value),
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => candidates.map(pageFor),
        clock: () => "2026-09-09T02:00:01.000Z",
      });
      expect(firstRun.kind).toBe("succeeded");

      fixture.registry.admitCandidate(second);
      const secondRun = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:01:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async (id) => id === second.candidateId ? second : undefined,
        readSource: async (value) => sourceFor(value),
        assessSupport: async () => "supported",
        synthesize: async ({ candidates }) => candidates.map(pageFor),
        clock: () => "2026-09-09T02:01:01.000Z",
      });
      expect(secondRun.kind).toBe("succeeded");
      const active = fixture.registry.activeGeneration();
      expect(active).toBeDefined();
      if (active === undefined) throw new Error("expected second generation");
      const manifest = JSON.parse(readFileSync(join(active.path, "manifest.json"), "utf8")) as { pages: readonly { pageId: string; dependencies?: readonly string[] }[] };
      expect(manifest.pages.map((page) => page.pageId)).toEqual([first.candidateId, second.candidateId]);
      expect(manifest.pages.find((page) => page.pageId === second.candidateId)?.dependencies).toEqual(["candidate-b", "secondary-alias"]);

      fixture.registry.appendLocalTombstone({
        subject: first.candidateId,
        aliases: [],
        reason: "remove first test page",
        requestedAt: "2026-09-09T02:02:00.000Z",
      });
      const read = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "Project claim",
        now: "2026-09-09T02:02:00.000Z",
        maxResults: 10,
      });
      expect(read.kind).toBe("ok");
      if (read.kind === "ok") expect(read.results.map((entry) => entry.pageId)).toEqual([second.candidateId]);
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a loader that substitutes admitted candidate identity or lineage", async () => {
    const fixture = await workspace();
    const admitted = candidate("lineage-bound");
    fixture.registry.admitCandidate(admitted);
    try {
      const substituted = {
        ...admitted,
        sourceVersion: "v2",
        dependencies: ["lineage-bound", "unadmitted-secondary"],
      };
      const result = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now: "2026-09-09T02:00:00.000Z",
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => substituted,
        readSource: async (value) => sourceFor(value),
        assessSupport: async () => "supported",
        synthesize: async () => [],
      });
      expect(result.kind).toBe("failed");
      expect(result.reason).toMatch(/candidate.*(metadata|lineage|identity).*mismatch/i);
      expect(fixture.registry.activeGeneration()).toBeUndefined();
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
