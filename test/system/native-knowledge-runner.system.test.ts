import { mkdtempSync, rmSync } from "node:fs";
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
import { wikiRetrieve } from "../../src/knowledge/native-consolidation/retrieval.js";
import { nativeKnowledgeCronManifest } from "../../src/config/native-knowledge-cron-manifest.js";

function candidate(id: string, asOf = "2026-09-09T01:00:00.000Z"): NativeKnowledgeCandidate {
  return {
    candidateId: id,
    kind: "project-artifact",
    claimClass: "project",
    claim: `Project claim ${id} is source-backed.`,
    sourceIdentity: `project:${id}`,
    sourceReference: `fixture:${id}`,
    sourceVersion: "v1",
    excerpt: `Project claim ${id} is source-backed.`,
    contentHash: `sha256:${id}`,
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
    now: () => "2026-09-09T02:00:00.000Z",
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
      });
      expect(result.kind).toBe("succeeded");
      expect(calls).toBe(1);
      expect(fixture.registry.runHealth().lastSuccess).toBe("2026-09-09T02:00:00.000Z");
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
});
