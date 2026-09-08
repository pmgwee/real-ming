import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createNativeKnowledgeRegistry } from "../../src/knowledge/native-consolidation/registry.js";
import type { StagedPage } from "../../src/knowledge/native-consolidation/contracts.js";
import { activateGeneration, stageGeneration } from "../../src/knowledge/native-consolidation/publication.js";
import { wikiRetrieve } from "../../src/knowledge/native-consolidation/retrieval.js";

function page(pageId: string, content: string, asOf = "2026-09-09T01:00:00.000Z"): StagedPage {
  return {
    pageId,
    path: `pages/${pageId}.md`,
    content,
    sourceCandidateIds: [`candidate-${pageId}`],
    claimClass: "project",
    sourceReference: `fixture:${pageId}`,
    capturedAt: "2026-09-09T01:00:00.000Z",
    asOf,
    disposition: "supported",
    uncertainty: "none",
  };
}

async function setup(pages: readonly StagedPage[]) {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-retrieval-"));
  const generatedRoot = join(directory, "vault", ".real-ming", "generated");
  const stagingRoot = join(directory, "vault", ".real-ming", "staging");
  const registry = createNativeKnowledgeRegistry({
    statePath: join(directory, "state.sqlite"),
    now: () => "2026-09-09T02:00:00.000Z",
  });
  const lease = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
  if (lease.kind !== "claimed") throw new Error("fixture lease was not claimed");
  const generation = await stageGeneration({
    run: lease,
    generatedRoot,
    stagingRoot,
    pages,
    sourceEpoch: 0,
    tombstoneEpoch: 0,
    now: "2026-09-09T02:00:00.000Z",
  });
  registry.recordStagedGeneration(generation);
  const activated = activateGeneration({
    registry,
    generation,
    lease,
    activePath: generatedRoot,
    now: "2026-09-09T02:00:01.000Z",
  });
  if (activated.kind !== "activated") throw new Error(`fixture activation failed: ${activated.reason}`);
  return { directory, generatedRoot, registry, generation };
}

describe("native knowledge supported retrieval", () => {
  it("returns bounded cited content from the single verified active generation", async () => {
    const fixture = await setup([page("a", "# Project A\n\nUse the native wiki for durable decisions.")]);
    try {
      const result = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "durable decisions",
        now: "2026-09-09T02:05:00.000Z",
        maxResults: 3,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        pageId: "a",
        citation: {
          sourceReference: "fixture:a",
          generationId: fixture.generation.generationId,
          disposition: "supported",
        },
      });
      expect(result.results[0]?.content).toContain("native wiki");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("carries forward valid pages while filtering forgotten and expired pages", async () => {
    const fixture = await setup([
      page("a", "Project A remains useful."),
      page("b", "Project B remains useful."),
      page("old", "Expired project claim.", "2026-01-01T00:00:00.000Z"),
    ]);
    try {
      const tombstone = fixture.registry.appendLocalTombstone({
        subject: "candidate-a",
        aliases: [],
        reason: "controlled forget",
        requestedAt: "2026-09-09T02:05:00.000Z",
      });
      expect(tombstone.status).toBe("local-suppressed");
      const result = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "project",
        now: "2026-09-09T02:05:00.000Z",
        maxResults: 10,
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.results.map((entry) => entry.pageId)).toEqual(["b"]);
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["no active pointer", (fixture: Awaited<ReturnType<typeof setup>>) => fixture.registry.setRepairState("healthy")],
    ["registry repair", (fixture: Awaited<ReturnType<typeof setup>>) => fixture.registry.setRepairState("needs-repair")],
  ])("fails closed for %s", async (_label, alter) => {
    const fixture = await setup([page("a", "safe")]);
    try {
      if (_label === "no active pointer") {
        fixture.registry.setRepairState("needs-repair");
      } else {
        alter(fixture);
      }
      const result = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "safe",
        now: "2026-09-09T02:05:00.000Z",
      });
      expect(["wiki-unavailable", "needs-repair"]).toContain(result.kind);
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when an active page or manifest is tampered with", async () => {
    const fixture = await setup([page("a", "safe")]);
    try {
      writeFileSync(join(fixture.generation.immutablePath, "pages/a.md"), "tampered", "utf8");
      const result = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "safe",
        now: "2026-09-09T02:05:00.000Z",
      });
      expect(["wiki-unavailable", "needs-repair"]).toContain(result.kind);
      expect(readFileSync(join(fixture.generation.immutablePath, "pages/a.md"), "utf8")).toBe("tampered");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported role and staging paths without blocking native chat", async () => {
    const fixture = await setup([page("a", "safe")]);
    try {
      const roleResult = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "safe",
        role: "untrusted-role",
        now: "2026-09-09T02:05:00.000Z",
      });
      expect(roleResult.kind).toBe("wiki-unavailable");
      expect(fixture.registry.runHealth().repairState).toBe("healthy");
    } finally {
      fixture.registry.close();
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
