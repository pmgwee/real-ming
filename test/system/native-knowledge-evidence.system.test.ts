import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../../src/knowledge/native-consolidation/registry.js";
import type { NativeKnowledgeCandidate } from "../../src/knowledge/native-consolidation/contracts.js";
import { captureCandidate, verifyEvidence } from "../../src/knowledge/native-consolidation/evidence.js";

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

async function withRegistry(
  run: (registry: NativeKnowledgeRegistry) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-native-evidence-"));
  const registry = createNativeKnowledgeRegistry({
    statePath: join(directory, "state.sqlite"),
    now: () => "2026-09-09T02:00:00.000Z",
  });
  try {
    await run(registry);
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("native knowledge evidence boundary", () => {
  it("does not sweep ordinary turns, but admits an explicit durable signal", async () => {
    await withRegistry(async (registry) => {
      const ignored = await captureCandidate({
        candidate: candidateFixture(),
        explicit: false,
        marked: false,
        registry,
      });
      expect(ignored).toEqual({ kind: "ignored", reason: "not-explicit" });
      const accepted = await captureCandidate({
        candidate: candidateFixture({ candidateId: "candidate-explicit" }),
        explicit: true,
        marked: false,
        registry,
      });
      expect(accepted.kind).toBe("accepted");
      expect(registry.listCandidates()).toHaveLength(1);
    });
  });

  it("requires source support and freshness instead of treating a matching hash as truth", async () => {
    const candidate = candidateFixture({
      candidateId: "candidate-research",
      kind: "research-artifact",
      claimClass: "research",
      retentionClass: "research-30d",
      sourceIdentity: "research:controlled",
      sourceReference: "https://example.test/research/1",
      sourceVersion: "v1",
      contentHash: "sha256:source-content",
      excerpt: "The source excerpt.",
      asOf: "2026-08-01T00:00:00.000Z",
    });
    const source = {
      sourceIdentity: "research:controlled",
      sourceReference: "https://example.test/research/1",
      sourceVersion: "v1",
      content: "The source excerpt.",
      contentHash: "sha256:source-content",
      asOf: "2026-08-01T00:00:00.000Z",
      retrievedAt: "2026-09-01T00:00:00.000Z",
    } as const;
    await expect(verifyEvidence({ candidate, source, now: "2026-08-15T00:00:00.000Z", semanticSupport: "supported" })).resolves.toMatchObject({
      disposition: "supported",
      identityMatches: true,
      fresh: true,
    });
    await expect(verifyEvidence({ candidate, source, now: "2026-09-02T00:00:00.000Z", semanticSupport: "supported" })).resolves.toMatchObject({
      disposition: "stale",
      fresh: false,
    });
    await expect(verifyEvidence({ candidate, source, now: "2026-08-15T00:00:00.000Z", semanticSupport: "unsupported" })).resolves.toMatchObject({
      disposition: "quarantined",
      support: "unsupported",
    });
  });
});
