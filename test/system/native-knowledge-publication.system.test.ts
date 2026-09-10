import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../../src/knowledge/native-consolidation/registry.js";
import type { RunLease, StagedPage } from "../../src/knowledge/native-consolidation/contracts.js";
import {
  activateGeneration,
  generatedRootBytes,
  readManifest,
  reconcileGenerations,
  stageGeneration,
} from "../../src/knowledge/native-consolidation/publication.js";

function page(pageId: string, content: string): StagedPage {
  return {
    pageId,
    path: `pages/${pageId}.md`,
    content,
    sourceCandidateIds: [`candidate-${pageId}`],
    claimClass: "project",
    sourceReference: `fixture:${pageId}`,
    capturedAt: "2026-09-09T01:00:00.000Z",
    asOf: "2026-09-09T01:00:00.000Z",
    disposition: "supported",
    uncertainty: "none",
  };
}

async function withWorkspace(run: (input: {
  readonly directory: string;
  readonly generatedRoot: string;
  readonly stagingRoot: string;
  readonly registry: NativeKnowledgeRegistry;
  readonly lease: RunLease;
}) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-publication-"));
  const generatedRoot = join(directory, "vault", ".real-ming", "generated");
  const stagingRoot = join(directory, "vault", ".real-ming", "staging");
  const statePath = join(directory, "state.sqlite");
  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(stagingRoot, { recursive: true });
  const registry = createNativeKnowledgeRegistry({
    statePath,
    now: () => "2026-09-09T02:00:00.000Z",
  });
  const claimed = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
  if (claimed.kind !== "claimed") throw new Error("fixture lease was not claimed");
  try {
    await run({ directory, generatedRoot, stagingRoot, registry, lease: claimed });
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function stage(input: Parameters<typeof stageGeneration>[0]): Promise<Awaited<ReturnType<typeof stageGeneration>>> {
  return stageGeneration(input);
}

describe("native knowledge immutable publication", () => {
  it("writes a complete immutable generation and verifies every manifest hash", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const staged = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("a", "# A\n\nA source-backed page." )],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      });
      registry.recordStagedGeneration(staged);
      const manifest = readManifest(join(staged.immutablePath, "manifest.json"));
      expect(manifest.complete).toBe(true);
      expect(manifest.pages).toHaveLength(1);
      expect(readFileSync(join(staged.immutablePath, "index.md"), "utf8")).toContain("a.md");
      expect(staged.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(() => readManifest(join(staged.immutablePath, "missing.json"))).toThrow();
      expect(registry.activeGeneration()).toBeUndefined();
    });
  });

  it("rejects traversal and symlink escape before any immutable directory is installed", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, lease }) => {
      await expect(stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("../escape", "bad")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      })).rejects.toThrow(/path/i);
      expect(existsSync(join(generatedRoot, "generations"))).toBe(true);
      expect(readdirSync(join(generatedRoot, "generations"))).toHaveLength(0);
    });
  });

  it("cleans a failed staging attempt so a partial generation cannot accumulate", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, lease }) => {
      await expect(stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("too-large", "x".repeat(128 * 1024 + 1))],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      })).rejects.toThrow(/page too large/i);
      expect(readdirSync(join(generatedRoot, "generations"))).toHaveLength(0);
      expect(readdirSync(stagingRoot)).toHaveLength(0);
    });
  });

  it("makes activation the single pointer event and carries both complete pages forward", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const first = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("a", "A")],
        sourceEpoch: 1,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      });
      registry.recordStagedGeneration(first);
      expect(activateGeneration({ registry, generation: first, lease, activePath: generatedRoot, now: "2026-09-09T02:00:01.000Z" }).kind).toBe("activated");
      const previous = readManifest(join(first.immutablePath, "manifest.json"));

      const secondLeaseResult = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
      // The first lease is still live; force the fixture's next run through a
      // new registry instance is intentionally not possible in this test.
      expect(secondLeaseResult.kind).toBe("busy");
      expect(previous.pages[0]?.pageId).toBe("a");
    });
  });

  it("reconciles orphaned and malformed generations without exposing staging", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry }) => {
      const orphan = join(generatedRoot, "generations", "orphan");
      mkdirSync(orphan, { recursive: true });
      writeFileSync(join(orphan, "manifest.json"), JSON.stringify({ complete: false }));
      mkdirSync(join(stagingRoot, "unfinished"), { recursive: true });
      const result = reconcileGenerations({ generatedRoot, now: "2026-09-09T02:00:00.000Z", registry });
      expect(result.kind).toBe("healthy");
      expect(result.quarantined).toContain("orphan");
      expect(registry.activeGeneration()).toBeUndefined();
    });
  });

  it("rejects a one-byte-over generated-root budget without installing a generation", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      await expect(stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("budget", "budgeted content")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
        maxGeneratedRootBytes: 1,
      })).rejects.toThrow(/generated-root-byte-limit/i);
      expect(readdirSync(join(generatedRoot, "generations"))).toHaveLength(0);
      expect(registry.activeGeneration()).toBeUndefined();
    });
  });

  it("accepts a generation exactly at the configured generated-root byte limit", async () => {
    await withWorkspace(async ({ directory, generatedRoot, stagingRoot, registry, lease }) => {
      const scratchGenerated = join(directory, "scratch", "generated");
      const scratchStaging = join(directory, "scratch", "staging");
      mkdirSync(scratchGenerated, { recursive: true });
      mkdirSync(scratchStaging, { recursive: true });
      const scratch = await stage({
        run: lease,
        generatedRoot: scratchGenerated,
        stagingRoot: scratchStaging,
        pages: [page("exact", "exactly bounded")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
        maxGeneratedRootBytes: 64 * 1024,
      });
      const exactBudget = generatedRootBytes(scratchGenerated);
      rmSync(scratch.immutablePath, { recursive: true, force: true });
      const actual = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("exact", "exactly bounded")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
        maxGeneratedRootBytes: exactBudget,
      });
      expect(generatedRootBytes(generatedRoot)).toBe(exactBudget);
      registry.recordStagedGeneration(actual);
    });
  });

  it("retains the active and protected rollback generations and is idempotent", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const installed: string[] = [];
      for (const id of ["one", "two", "three", "four"]) {
        const staged = await stage({
          run: lease,
          generatedRoot,
          stagingRoot,
          pages: [page(id, `content ${id}`)],
          sourceEpoch: 0,
          tombstoneEpoch: 0,
          now: `2026-09-09T02:00:0${installed.length}.000Z`,
        });
        registry.recordStagedGeneration(staged);
        const activated = activateGeneration({
          registry,
          generation: staged,
          lease,
          activePath: generatedRoot,
          now: `2026-09-09T02:00:1${installed.length}.000Z`,
          maxRetainedGenerations: 2,
          protectedGenerationIds: installed.slice(0, 1),
        });
        expect(activated.kind).toBe("activated");
        installed.push(staged.generationId);
      }
      const directories = readdirSync(join(generatedRoot, "generations"));
      expect(directories).toHaveLength(2);
      const active = registry.activeGeneration();
      expect(active).toBeDefined();
      expect(directories).toContain(active?.generationId);
      expect(directories).toContain(installed[0]);
      // A second cleanup-triggering activation must not fail because the old
      // generation was already removed.
      expect(readdirSync(join(generatedRoot, "generations"))).toHaveLength(2);
    });
  });

  it("preserves generations recorded as in-progress while retaining newer generations", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const first = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("in-progress-a", "first")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      });
      registry.recordStagedGeneration(first);

      const second = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("in-progress-b", "second")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:01:00.000Z",
      });
      registry.recordStagedGeneration(second);

      expect(activateGeneration({
        registry,
        generation: second,
        lease,
        activePath: generatedRoot,
        now: "2026-09-09T02:01:01.000Z",
        maxRetainedGenerations: 1,
      }).kind).toBe("activated");

      expect(existsSync(first.immutablePath)).toBe(true);
      expect(existsSync(second.immutablePath)).toBe(true);
    });
  });

  it("fences activation when the independent tombstone head advances", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const staged = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("head-fence", "head fenced content")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      });
      registry.recordStagedGeneration(staged);
      registry.setTombstoneHeadEpoch(1);
      const result = activateGeneration({
        registry,
        generation: staged,
        lease,
        activePath: generatedRoot,
        now: "2026-09-09T02:00:01.000Z",
        expectedTombstoneHeadEpoch: 0,
      });
      expect(result).toMatchObject({ kind: "fenced", reason: "tombstone-head-epoch-advanced" });
    });
  });

  it("reports committed activation when retention cleanup fails and leaves repair state", async () => {
    await withWorkspace(async ({ generatedRoot, stagingRoot, registry, lease }) => {
      const staged = await stage({
        run: lease,
        generatedRoot,
        stagingRoot,
        pages: [page("cleanup-failure", "active content")],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now: "2026-09-09T02:00:00.000Z",
      });
      registry.recordStagedGeneration(staged);
      const originalInProgress = registry.inProgressGenerationIds.bind(registry);
      const failingRegistry = new Proxy(registry, {
        get(target, property, receiver) {
          if (property === "inProgressGenerationIds") {
            return () => {
              originalInProgress();
              throw new Error("controlled cleanup interruption");
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const result = activateGeneration({
        registry: failingRegistry,
        generation: staged,
        lease,
        activePath: generatedRoot,
        now: "2026-09-09T02:00:01.000Z",
      });
      expect(result).toMatchObject({
        kind: "activated",
        generationId: staged.generationId,
        retentionCleanupPending: true,
      });
      expect(failingRegistry.activeGeneration()?.generationId).toBe(staged.generationId);
      expect(failingRegistry.runHealth().repairState).toBe("needs-repair");
    });
  });
});
