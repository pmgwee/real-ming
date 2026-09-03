import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { CandidateEnvelope } from "../../src/evidence/evidence-broker.js";

const now = "2026-09-03T09:00:00.000Z";

describe("RM-42 Knowledge Compiler", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  const contentHash = (content: string): string =>
    `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const candidate: CandidateEnvelope = {
    id: "candidate:working-preferences",
    sourceSystem: "agent-brain",
    sourceIdentity: "agent-brain:personal",
    sourceReference: "personal-context/working-preferences.md",
    canonicalEvidenceId: "agent-brain:personal:evidence:7",
    capturedAt: "2026-09-03T08:30:00.000Z",
    asOf: "2026-09-03T08:00:00.000Z",
    contentHash: contentHash("Ming plans deep work before 11:00 and protects Friday afternoons."),
    trustDomain: "Personal",
    sensitivity: "internal",
    allowedRoles: ["COO"],
    retentionClass: "project-evidence-30d",
    mode: "snapshot",
    content: "Ming plans deep work before 11:00 and protects Friday afternoons.",
    citations: ["agent-brain://personal/evidence/7"],
    freshness: "current",
  };

  function start(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm42-"));
    directories.push(directory);
    return startInDirectory(directory);
  }

  function startInDirectory(directory: string): RealMingSystemHarness {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      knowledgeVault: {
        statePath: join(directory, "knowledge.sqlite"),
        encryptionKey: "rm42-compiler-key-not-a-real-secret",
      },
    });
    harnesses.push(harness);
    return harness;
  }

  it("compiles a cited page and publishes one atomic generation", () => {
    const harness = start();

    const result = harness.compileKnowledgeCandidate(candidate);

    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(result.generation.root).toBe("Personal");
    expect(result.generation.sequence).toBe(1);
    expect(result.pagePath).toBe("wiki/working-preferences.md");

    const page = harness.readVaultPage("Personal", result.pagePath);
    expect(page).toContain("agent-brain://personal/evidence/7");
    expect(page).toContain(candidate.contentHash);
    // A Wikilink back to the source keeps the page navigable in Obsidian.
    expect(page).toContain("[[working-preferences]]");
  });

  it("regenerates the index and appends to the log", () => {
    const harness = start();

    const result = harness.compileKnowledgeCandidate(candidate);
    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;

    expect(harness.readVaultPage("Personal", "index.md")).toContain(
      "[[working-preferences]]",
    );
    const log = harness.readVaultPage("Personal", "log.md");
    expect(log).toContain("generation 1");
    expect(log).toContain(candidate.canonicalEvidenceId);
  });

  it("rejects a candidate carrying a Sensitive Secret before publishing", () => {
    const harness = start();

    const refused = harness.compileKnowledgeCandidate({
      ...candidate,
      content: "The portal token is sk-live-abcdefghijklmnopqrstuv.",
    });

    expect(refused).toMatchObject({
      kind: "rejected",
      reason: "sensitive-secret",
    });
    // Nothing was published, not even a partial generation.
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
  });

  it("rejects a candidate whose content hash does not match its payload", () => {
    const harness = start();

    const refused = harness.compileKnowledgeCandidate({
      ...candidate,
      content: "A changed claim with the old provenance hash.",
    });

    expect(refused).toEqual({ kind: "rejected", reason: "invalid-provenance" });
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
  });

  it("labels a stale candidate rather than compiling it as current", () => {
    const harness = start();

    const result = harness.compileKnowledgeCandidate({
      ...candidate,
      freshness: "stale",
    });

    expect(result.kind).toBe("compiled");
    if (result.kind !== "compiled") return;
    expect(harness.readVaultPage("Personal", result.pagePath)).toContain(
      "STALE",
    );
  });

  it("quarantines a contradiction instead of silently resolving it", () => {
    const harness = start();
    harness.compileKnowledgeCandidate(candidate);

    const contradicting = harness.compileKnowledgeCandidate({
      ...candidate,
      id: "candidate:working-preferences-v2",
       contentHash: contentHash("Ming plans deep work after 15:00 and works Friday afternoons."),
      content: "Ming plans deep work after 15:00 and works Friday afternoons.",
    });

    expect(contradicting).toMatchObject({
      kind: "quarantined",
      reason: "contradicts-published-page",
    });
    // The published page is untouched; the contradiction is visible, not merged.
    expect(harness.readVaultPage("Personal", "wiki/working-preferences.md")).toContain(
      "before 11:00",
    );
    if (contradicting.kind !== "quarantined") return;
    expect(harness.readVaultPage("Personal", contradicting.quarantinePath)).toContain(
      "after 15:00",
    );
  });

  it("does not create duplicate quarantine generations after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm42-quarantine-replay-"));
    directories.push(directory);
    const first = startInDirectory(directory);
    first.compileKnowledgeCandidate(candidate);
    const conflictA = {
      ...candidate,
      id: "candidate:working-preferences-conflict-a",
      canonicalEvidenceId: "agent-brain:personal:evidence:8",
      content: "Ming starts deep work after 15:00.",
      contentHash: contentHash("Ming starts deep work after 15:00."),
      citations: ["agent-brain://personal/evidence/8"],
    };
    const conflictB = {
      ...candidate,
      id: "candidate:working-preferences-conflict-b",
      canonicalEvidenceId: "agent-brain:personal:evidence:9",
      content: "Ming starts deep work after 17:00.",
      contentHash: contentHash("Ming starts deep work after 17:00."),
      citations: ["agent-brain://personal/evidence/9"],
    };
    expect(first.compileKnowledgeCandidate(conflictA).kind).toBe("quarantined");
    expect(first.compileKnowledgeCandidate(conflictB).kind).toBe("quarantined");
    expect(first.vaultGenerations("Personal")).toHaveLength(3);
    first.close();
    harnesses.splice(harnesses.indexOf(first), 1);

    const restored = startInDirectory(directory);
    expect(restored.compileKnowledgeCandidate(conflictA)).toEqual({
      kind: "unchanged",
      pagePath: expect.stringContaining("quarantine/"),
    });
    expect(restored.vaultGenerations("Personal")).toHaveLength(3);
  });

  it("supersedes with a new generation and leaves the predecessor traceable", () => {
    const harness = start();
    const first = harness.compileKnowledgeCandidate(candidate);
    expect(first.kind).toBe("compiled");
    if (first.kind !== "compiled") return;

    const second = harness.compileKnowledgeCandidate({
      ...candidate,
      id: "candidate:working-preferences-extended",
       contentHash: contentHash("Ming plans deep work before 11:00 and protects Friday afternoons, and reviews on Monday."),
      content:
        "Ming plans deep work before 11:00 and protects Friday afternoons, and reviews on Monday.",
    });

    expect(second.kind).toBe("compiled");
    if (second.kind !== "compiled") return;
    expect(second.generation.sequence).toBe(2);
    const generations = harness.vaultGenerations("Personal");
    expect(generations.map((entry) => entry.state)).toEqual([
      "superseded",
      "verified",
    ]);
    // The earlier generation is still there with its own hash.
    expect(generations[0]?.contentHash).not.toBe(generations[1]?.contentHash);
  });

  it("is idempotent: recompiling the same candidate publishes nothing new", () => {
    const harness = start();
    harness.compileKnowledgeCandidate(candidate);

    const replay = harness.compileKnowledgeCandidate(candidate);

    expect(replay).toMatchObject({ kind: "unchanged" });
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
  });
});
