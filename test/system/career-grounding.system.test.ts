import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentBrainEvidenceReadResult } from "../../src/evidence/evidence-broker.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const now = "2026-09-03T03:00:00.000Z";

describe("RM-33 COO career grounding", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function start(
    options: { readonly workerAvailable?: boolean } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm33-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      // Only the local-only cases need the laptop. Configuring it everywhere
      // would route every effect through it, including ones it cannot run.
      ...(options.workerAvailable === undefined
        ? {}
        : {
            privateWorker: {
              available: options.workerAvailable,
              capabilities: ["local-files"] as const,
            },
          }),
      evidence: {
        provider: {
          read: async (): Promise<AgentBrainEvidenceReadResult> => ({
            kind: "ok",
            sourceIdentity: "agent-brain:duitsini",
            canonicalEvidenceId: "agent-brain:evidence:career-1",
            sourceReference: "agent-brain://duitsini/evidence/career-1",
            content: "The DuitSini rebuild shipped under Ming's ownership.",
            citations: ["agent-brain://duitsini/evidence/career-1"],
            asOf: "2026-09-03T02:00:00.000Z",
            retrievedAt: now,
            freshness: "current",
          }),
        },
      },
      career: {
        files: {
          "career/cv.md": {
            reference: "career-file:career/cv.md",
            localOnly: false,
            claims: ["Led the DuitSini rebuild"],
          },
          "career/private-referees.md": {
            reference: "career-file:career/private-referees.md",
            localOnly: true,
            claims: ["Referee available on request"],
          },
        },
      },
    });
    harnesses.push(harness);
    harness.upsertPortfolioProject({
      id: "project:duitsini",
      name: "DuitSini",
      portfolioState: "owned active",
      repository: "pmgwee/duitsini",
      productionBranch: "main",
      deploymentIdentifiers: { github: "pmgwee/duitsini", vercel: "duitsini" },
      evidenceIdentity: "agent-brain:duitsini",
      responsibleRoles: ["COO", "CTO"],
      sensitivity: "internal",
      health: "healthy",
      operatingInstructions: "github:pmgwee/duitsini/README.md",
      sourceLinks: [
        {
          kind: "agent-brain",
          reference: "agent-brain:duitsini",
          asOf: "2026-09-03T02:00:00.000Z",
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    return harness;
  }

  it("grounds a claim in an authoritative career file", async () => {
    const harness = start();

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
      ],
    });

    expect(result.kind).toBe("grounded");
    if (result.kind !== "grounded") return;
    expect(result.workItem.accountableExecutive).toBe("COO");
    expect(result.workItem.workstream).toBe("Career Job");
    expect(result.claims[0]).toMatchObject({
      text: "Led the DuitSini rebuild",
      provenance: { kind: "career-file", reference: "career-file:career/cv.md" },
    });
  });

  it("refuses a claim that no career file or CEO confirmation supports", async () => {
    const harness = start();

    const invented = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Shipped a payments platform to ten million users",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
      ],
    });

    expect(invented).toMatchObject({
      kind: "refused",
      reason: "claim-not-in-source",
    });
    expect(harness.workItems()).toHaveLength(0);
  });

  it("will not let cited Project Evidence stand alone as a factual claim", async () => {
    const harness = start();

    const evidenceOnly = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: {
            kind: "project-evidence",
            reference: "agent-brain:evidence:career-1",
          },
        },
      ],
    });

    // Historical evidence can support a claim, never be its only basis.
    expect(evidenceOnly).toMatchObject({
      kind: "refused",
      reason: "evidence-is-not-a-claim",
    });
    expect(harness.workItems()).toHaveLength(0);
  });

  it("accepts a CEO-confirmed claim that no file carries", async () => {
    const harness = start();

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Available from October",
          provenance: { kind: "ceo-confirmed", reference: "ceo:ming" },
        },
      ],
    });

    expect(result.kind).toBe("grounded");
  });

  it("reads a local-only career file through the Lenovo private worker", async () => {
    const harness = start({ workerAvailable: true });

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Referee available on request",
          provenance: {
            kind: "career-file",
            reference: "career/private-referees.md",
          },
        },
      ],
    });

    expect(result.kind).toBe("grounded");
    if (result.kind !== "grounded") return;
    expect(result.localOnlyReads).toEqual([
      "career-file:career/private-referees.md",
    ]);
    // The read happened on the laptop, and the job records which file.
    expect(
      harness
        .privateWorkerJobs()
        .some(
          (job) =>
            job.requiredCapability === "local-files" &&
            job.action.value.includes("career-file:career/private-referees.md"),
        ),
    ).toBe(true);
  });

  it("waits rather than guessing when the private worker is unavailable", async () => {
    const harness = start({ workerAvailable: false });

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Referee available on request",
          provenance: {
            kind: "career-file",
            reference: "career/private-referees.md",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      kind: "waiting",
      reason: "private-worker-unavailable",
    });
  });

  it("cites historical Project Evidence as corroboration through the Evidence Broker", async () => {
    const harness = start();

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
          corroboration: { portfolioProjectId: "project:duitsini" },
        },
      ],
    });

    expect(result.kind).toBe("grounded");
    if (result.kind !== "grounded") return;
    // Cited, not authoritative: the claim still stands on the career file.
    expect(result.claims[0]?.corroboration?.canonicalEvidenceId).toBe(
      "agent-brain:evidence:career-1",
    );
    expect(result.claims[0]?.provenance.kind).toBe("career-file");
    const served = harness
      .auditTrail(result.workItem.id)
      .find((event) => event.type === "project-evidence.served");
    expect(served).toBeDefined();
  });

  it("makes a named collaborator a real contributor, not a returned object", async () => {
    const harness = start();

    const withCollaborator = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
      ],
      collaborator: { executive: "CTO", contribution: "Confirm the rebuild scope" },
    });

    expect(withCollaborator.kind).toBe("grounded");
    if (withCollaborator.kind !== "grounded") return;
    expect(
      withCollaborator.workItem.collaboratingExecutives.map((a) => a.executive),
    ).toEqual(["CTO"]);
    expect(withCollaborator.collaboratorProjection?.executive).toBe("CTO");
  });

  it("invents no collaborator when none was named", async () => {
    const harness = start();

    const alone = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
      ],
    });

    expect(alone.kind).toBe("grounded");
    if (alone.kind !== "grounded") return;
    expect(alone.workItem.collaboratingExecutives).toEqual([]);
    expect(alone.collaboratorProjection).toBeUndefined();
  });

  it("gives another Executive only an Approved Projection of the career work", async () => {
    const harness = start();
    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
      ],
      collaborator: { executive: "CTO", contribution: "Confirm the rebuild scope" },
    });
    expect(result.kind).toBe("grounded");
    if (result.kind !== "grounded") return;

    expect(result.collaboratorProjection).toMatchObject({
      kind: "approved-projection",
      workItemId: result.workItem.id,
    });
    const serialized = JSON.stringify(result.collaboratorProjection);
    // The claim actually made by THIS Work Item must not travel either. Only
    // checking an unrelated claim would let a real leak through.
    expect(serialized).not.toContain("Led the DuitSini rebuild");
    expect(serialized).not.toContain("career-file:career/cv.md");
    expect(serialized).not.toContain("Referee available on request");
    expect(serialized).not.toContain("private-referees");
    expect(result.collaboratorProjection?.claimCount).toBe(1);
  });

  it("records every user-facing claim and its provenance in the Outcome Report", async () => {
    const harness = start();

    const result = await harness.groundCareerWorkItem({
      intent: "Draft the application summary",
      claims: [
        {
          text: "Led the DuitSini rebuild",
          provenance: { kind: "career-file", reference: "career/cv.md" },
        },
        {
          text: "Available from October",
          provenance: { kind: "ceo-confirmed", reference: "ceo:ming" },
        },
      ],
    });

    expect(result.kind).toBe("grounded");
    if (result.kind !== "grounded") return;
    const report = harness.outcomeReport(result.workItem.id);
    expect(report?.completedEffect.kind).toBe("career-grounding");
    expect(report?.completedEffect.value).toContain("career-file:career/cv.md");
    expect(report?.completedEffect.value).toContain("ceo:ming");
    expect(report?.completedEffect.value).toContain("2 claims");
    // An audit trail that cannot reconstruct what was asserted is not one.
    expect(report?.completedEffect.value).toContain("Led the DuitSini rebuild");
    expect(report?.completedEffect.value).toContain("Available from October");
  });
});
