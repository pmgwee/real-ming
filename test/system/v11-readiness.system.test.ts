import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentBrainEvidenceContractHarness } from "../../src/testing/provider-adapter-contract-harness.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { CandidateEnvelope } from "../../src/evidence/evidence-broker.js";

const now = "2026-09-03T12:00:00.000Z";

describe("RM-40 Real-Ming v1.1 readiness", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function start(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      knowledgeVault: { encryptionKey: "rm40-readiness-key-not-a-real-secret" },
    });
    harnesses.push(harness);
    return harness;
  }

  const content = "Ming reviews the week on Friday afternoon.";

  const candidate: CandidateEnvelope = {
    id: "candidate:rm40",
    sourceSystem: "agent-brain",
    sourceIdentity: "agent-brain:personal",
    sourceReference: "personal-context/rm40.md",
    canonicalEvidenceId: "agent-brain:personal:evidence:rm40",
    capturedAt: "2026-09-03T11:30:00.000Z",
    asOf: "2026-09-03T11:00:00.000Z",
    contentHash: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
    trustDomain: "Personal",
    sensitivity: "internal",
    allowedRoles: ["COO"],
    retentionClass: "project-evidence-30d",
    mode: "snapshot",
    content,
    citations: ["agent-brain://personal/evidence/rm40"],
    freshness: "current",
  };

  it("gives Agent Brain no write surface to call in the first place", () => {
    const { provider } = createAgentBrainEvidenceContractHarness({
      kind: "failed",
      reason: "provider-unavailable",
    });

    // Structural, not a runtime guard. A refusal can be bypassed by a caller
    // that stops asking; an absent method cannot be called at all.
    expect(Object.keys(provider)).toEqual(["read"]);
    for (const mutator of [
      "write",
      "create",
      "update",
      "patch",
      "delete",
      "append",
      "publish",
    ]) {
      expect(mutator in provider).toBe(false);
    }
  });

  it("compiles into the vault without writing back to the Source of Record", () => {
    const harness = start();

    const compiled = harness.compileKnowledgeCandidate(candidate);

    expect(compiled.kind).toBe("compiled");
    if (compiled.kind !== "compiled") return;
    // The compiled page cites the source rather than replacing it, and the
    // vault is the only thing that gained a generation.
    expect(harness.readVaultPage("Personal", compiled.pagePath)).toContain(
      candidate.canonicalEvidenceId,
    );
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
  });

  it("keeps compiled corpus text out of the dashboard and the audit trail", async () => {
    const harness = start();
    harness.compileKnowledgeCandidate(candidate);
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm40:leak",
      text: "Plan the week",
      workstream: "Personal Life",
      expectedEffect: { kind: "record-note", value: "Plan" },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("expected acknowledgement");
    }

    // Hot Runtime Memory limits: the corpus stays in the vault. Neither the
    // CEO dashboard nor the audit trail may carry compiled text.
    const dashboard = JSON.stringify(
      harness.dashboardOverview({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
      }),
    );
    expect(dashboard).not.toContain(content);
    expect(
      JSON.stringify(harness.auditTrail(acknowledgement.workItem.id)),
    ).not.toContain(content);
  });
});
