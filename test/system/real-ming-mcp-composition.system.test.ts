import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { TombstoneHead, TombstoneHeadStore, StagedPage } from "../../src/knowledge/native-consolidation/contracts.js";
import { createNativeKnowledgeRegistry } from "../../src/knowledge/native-consolidation/registry.js";
import { activateGeneration, readManifest } from "../../src/knowledge/native-consolidation/publication.js";
import { createRealMingMcpComposition, restrictRealMingTools } from "../../src/config/real-ming-mcp-cli.js";
import { sha256ContentHash } from "../../src/knowledge/native-consolidation/evidence.js";

function headStore(): TombstoneHeadStore {
  let head: TombstoneHead = { epoch: 0, entries: [], complete: true, version: "v0" };
  return {
    async readHead() { return { kind: "ok", head } as const; },
    async appendIfVersion(input) {
      if (input.expectedVersion !== head.version) return { kind: "conflict", head } as const;
      head = {
        epoch: head.epoch + 1,
        entries: [...head.entries, { tombstoneId: input.tombstone.tombstoneId, subject: input.tombstone.subject, localEpoch: input.tombstone.localEpoch }],
        complete: true,
        version: `v${head.epoch + 1}`,
      };
      return { kind: "appended", head } as const;
    },
  };
}

describe("production Real-Ming MCP composition", () => {
  it("enforces the reviewed job allowlist at the callable server boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-mcp-allowlist-"));
    const registry = createNativeKnowledgeRegistry({ statePath: join(directory, "knowledge.sqlite") });
    const composition = createRealMingMcpComposition({
      statePath: join(directory, "operations.sqlite"),
      knowledgeStatePath: join(directory, "knowledge.sqlite"),
      knowledgeGeneratedRoot: join(directory, "generated"),
      knowledgeStagingRoot: join(directory, "staging"),
      knowledgeRegistry: registry,
    });
    try {
      const restricted = restrictRealMingTools(composition.tools, ["real_ming_knowledge_list_candidates"]);
      expect(restricted.list().map((tool) => tool.name)).toEqual(["real_ming_knowledge_list_candidates"]);
      expect(restricted.call("real_ming_list_work_items", {})).toMatchObject({ kind: "failed" });
      await expect(restricted.callAsync?.("real_ming_forget_wiki_knowledge", {}) ?? Promise.resolve(undefined))
        .resolves.toMatchObject({ kind: "failed" });
    } finally {
      composition.close();
      registry.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exposes production knowledge staging, retrieval and supported forgetting", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-mcp-composition-"));
    const generatedRoot = join(directory, "vault", ".real-ming", "generated");
    const stagingRoot = join(directory, "vault", ".real-ming", "staging");
    const registry = createNativeKnowledgeRegistry({ statePath: join(directory, "knowledge.sqlite"), now: () => "2026-09-09T02:00:00.000Z" });
    const lease = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
    if (lease.kind !== "claimed") throw new Error("fixture lease was not claimed");
    const composition = createRealMingMcpComposition({
      statePath: join(directory, "operations.sqlite"),
      knowledgeStatePath: join(directory, "knowledge.sqlite"),
      knowledgeGeneratedRoot: generatedRoot,
      knowledgeStagingRoot: stagingRoot,
      knowledgeRegistry: registry,
      knowledgeHeadStore: headStore(),
      knowledgeIsolationEligible: () => true,
      now: () => "2026-09-09T02:00:00.000Z",
    });
    try {
      const names = composition.tools.list().map((tool) => tool.name);
      expect(names).toContain("real_ming_wiki_retrieve");
      expect(names).toContain("real_ming_forget_wiki_knowledge");
      const captured = await composition.tools.callAsync!("real_ming_capture_knowledge_candidate", {
        candidate: {
          candidateId: "composition-candidate",
          kind: "project-artifact",
          claimClass: "project",
          claim: "A cited composition fixture.",
          sourceIdentity: "fixture:composition",
          sourceReference: "fixture:composition",
          sourceVersion: "v1",
          excerpt: "A cited composition fixture.",
          contentHash: sha256ContentHash("A cited composition fixture."),
          capturedAt: "2026-09-09T01:00:00.000Z",
          asOf: "2026-09-09T01:00:00.000Z",
          trustDomain: "Ming Creatives",
          sensitivity: "normal",
          retentionClass: "project-90d",
          dependencies: ["composition-candidate"],
        },
        explicit: true,
        marked: true,
      });
      expect(captured).toMatchObject({ kind: "ok", value: { kind: "accepted" } });
      const staged = await composition.tools.callAsync!("real_ming_stage_knowledge_generation", {
        run: lease,
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
        pages: [{
          pageId: "composition-page",
          path: "pages/composition-page.md",
          content: "# Composition page\n\nA cited composition fixture.",
          sourceCandidateIds: ["composition-candidate"],
          claimClass: "project",
          sourceReference: "fixture:composition",
          capturedAt: "2026-09-09T01:00:00.000Z",
          asOf: "2026-09-09T01:00:00.000Z",
          disposition: "supported",
          uncertainty: "none",
        } satisfies StagedPage],
      });
      expect(staged.kind).toBe("ok");
      if (staged.kind !== "ok") return;
      const stagedValue = staged.value as { readonly generationId: string };
      const generation = registry.generation(stagedValue.generationId);
      if (generation === undefined) throw new Error("production stage did not record generation");
      const manifest = readManifest(join(generation.path, "manifest.json"));
      const activation = activateGeneration({
        registry,
        generation: { generationId: generation.generationId, runId: generation.runId, immutablePath: generation.path, manifest, manifestHash: generation.manifestHash },
        lease,
        activePath: generatedRoot,
        now: "2026-09-09T02:00:01.000Z",
      });
      expect(activation.kind).toBe("activated");
      const retrieved = composition.tools.call("real_ming_wiki_retrieve", { query: "cited composition", now: "2026-09-09T02:00:02.000Z" });
      expect(retrieved.kind).toBe("ok");
      const forgotten = await composition.tools.callAsync!("real_ming_forget_wiki_knowledge", {
        subject: "composition-candidate",
        reason: "controlled acceptance cleanup",
        requestedAt: "2026-09-09T02:00:03.000Z",
      });
      expect(forgotten).toMatchObject({ kind: "ok", value: { status: "restore-safe" } });
      const suppressed = composition.tools.call("real_ming_wiki_retrieve", { query: "cited composition", now: "2026-09-09T02:00:04.000Z" });
      expect(suppressed.kind).toBe("failed");
      expect(registry.tombstoneOutbox()).toMatchObject([{ status: "synced" }]);
    } finally {
      composition.close();
      registry.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
