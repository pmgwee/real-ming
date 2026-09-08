import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../../src/knowledge/native-consolidation/registry.js";
import type { NativeKnowledgeCandidate } from "../../src/knowledge/native-consolidation/contracts.js";

function withRegistry(
  run: (registry: NativeKnowledgeRegistry, path: string) => void,
  now: () => string = () => "2026-09-09T02:00:00.000Z",
): void {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-native-registry-"));
  const path = join(directory, "state.sqlite");
  const registry = createNativeKnowledgeRegistry({ statePath: path, now });
  try {
    run(registry, path);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function candidateFixture(overrides: Partial<NativeKnowledgeCandidate> = {}): NativeKnowledgeCandidate {
  return {
    candidateId: "candidate-blue-lantern",
    kind: "decision",
    claimClass: "decision",
    claim: "Ming decided to use a bounded generated wiki for project decisions.",
    sourceIdentity: "telegram:ceo:ming",
    sourceReference: "telegram:turn:controlled-1",
    sourceVersion: "turn-1",
    excerpt: "Ming decided to use a bounded generated wiki for project decisions.",
    contentHash: "sha256:controlled-candidate",
    capturedAt: "2026-09-09T01:59:00.000Z",
    asOf: "2026-09-09T01:59:00.000Z",
    trustDomain: "Personal",
    sensitivity: "normal",
    retentionClass: "decision",
    dependencies: ["telegram:turn:controlled-1"],
    ...overrides,
  };
}

describe("native knowledge registry", () => {
  it("admits one bounded candidate idempotently and keeps prose out of SQLite", () => {
    withRegistry((registry, path) => {
      const first = registry.admitCandidate(candidateFixture());
      const replay = registry.admitCandidate(candidateFixture());

      expect(first).toMatchObject({ kind: "accepted", candidateId: "candidate-blue-lantern" });
      expect(replay).toEqual({ kind: "duplicate", candidateId: "candidate-blue-lantern" });

      const sqliteBytes = readFileSync(path, "utf8");
      expect(sqliteBytes).not.toContain("Ming decided to use a bounded generated wiki");
      expect(registry.listCandidates()).toEqual([
        expect.objectContaining({
          candidateId: "candidate-blue-lantern",
          sourceReference: "telegram:turn:controlled-1",
          contentHash: "sha256:controlled-candidate",
          status: "staged",
        }),
      ]);
    });
  });

  it.each([
    ["empty claim", { claim: "" }],
    ["oversized envelope", { claim: "x".repeat(70_000) }],
    ["secret-bearing envelope", { claim: "use token=sk-test-value-that-must-not-enter" }],
  ])("rejects a %s", (_label, overrides) => {
    withRegistry((registry) => {
      const result = registry.admitCandidate(candidateFixture(overrides));
      expect(result.kind).toBe("denied");
    });
  });

  it("allows one live lease, fences an expired worker, and records append-only transitions", () => {
    let now = "2026-09-09T02:00:00.000Z";
    withRegistry((registry) => {
      const first = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
      expect(first.kind).toBe("claimed");
      if (first.kind !== "claimed") throw new Error("expected a lease");

      expect(registry.claimRun({ operatingDate: "2026-09-09", limit: 12 }).kind).toBe("busy");
      now = "2026-09-09T02:11:00.000Z";
      const second = registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
      expect(second.kind).toBe("claimed");
      expect(registry.assertLease(first.runId, first.leaseToken, first.leaseEpoch)).toEqual({ kind: "fenced" });
      if (second.kind !== "claimed") throw new Error("expected takeover lease");
      expect(registry.assertLease(second.runId, second.leaseToken, second.leaseEpoch)).toEqual({ kind: "valid" });
      registry.recordRunFailure(second.runId, second.leaseToken, second.leaseEpoch, "controlled-failure");
      expect(registry.runHealth().lastFailureCode).toBe("controlled-failure");
    }, () => now);
  });

});
