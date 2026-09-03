import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { AgentBrainEvidenceReadResult } from "../../src/evidence/evidence-broker.js";
import type { EvidenceEnablementCandidate } from "../../src/operations/evidence-enablement.js";

const now = "2026-09-03T08:00:00.000Z";

describe("RM-39 sequential evidence enablement", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const candidates: readonly EvidenceEnablementCandidate[] = [
    {
      projectId: "project:agent-brain-dashboard",
      name: "Agent Brain dashboard",
      directSourceOwner: "CTO",
      responsibleRoles: ["CTO"],
      sensitivity: "internal",
      evidenceIdentity: "agent-brain:dashboard",
      allowedEvidencePolicy: "cited-read-only",
    },
    {
      projectId: "project:personal-portfolio",
      name: "Personal portfolio",
      directSourceOwner: "CMO",
      responsibleRoles: ["CMO"],
      sensitivity: "public",
      evidenceIdentity: "agent-brain:portfolio",
      allowedEvidencePolicy: "cited-read-only",
    },
    {
      projectId: "project:real-ming",
      name: "Real-Ming",
      directSourceOwner: "CTO",
      responsibleRoles: ["CTO"],
      sensitivity: "sensitive",
      evidenceIdentity: "agent-brain:real-ming",
      allowedEvidencePolicy: "cited-read-only",
    },
  ];

  function start(
    options: {
      readonly failCitedQueryFor?: string;
      readonly failHealthFor?: string;
    } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm39-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      evidence: {
        provider: {
          read: async (request): Promise<AgentBrainEvidenceReadResult> =>
            request.evidenceIdentity === options.failCitedQueryFor
              ? { kind: "failed", reason: "provider-unavailable" }
              : {
                  kind: "ok",
                  sourceIdentity: request.evidenceIdentity,
                  canonicalEvidenceId: `${request.evidenceIdentity}:evidence:1`,
                  sourceReference: `${request.evidenceIdentity}/evidence/1`,
                  content: "Cited evidence for the enablement check.",
                  citations: [`${request.evidenceIdentity}/evidence/1`],
                  asOf: "2026-09-03T07:30:00.000Z",
                  retrievedAt: now,
                  freshness: "current",
                },
        },
      },
      evidenceEnablement: {
        candidates,
        ...(options.failHealthFor === undefined
          ? {}
          : { healthFailureFor: options.failHealthFor }),
      },
    });
    harnesses.push(harness);
    return harness;
  }

  it("enables the three projects in order, each fully verified", async () => {
    const harness = start();

    const result = await harness.enableProjectEvidence();

    expect(result.kind).toBe("enabled");
    if (result.kind !== "enabled") return;
    expect(result.enabled.map((entry) => entry.projectId)).toEqual([
      "project:agent-brain-dashboard",
      "project:personal-portfolio",
      "project:real-ming",
    ]);
    for (const entry of result.enabled) {
      expect(entry.verification).toEqual({
        serviceRestarted: true,
        healthy: true,
        storageInspected: true,
        citedQueryPassed: true,
      });
    }
  });

  it("reconciles each candidate before registering it", async () => {
    const harness = start();

    const result = await harness.enableProjectEvidence();

    expect(result.kind).toBe("enabled");
    if (result.kind !== "enabled") return;
    const project = harness.portfolioProject("project:agent-brain-dashboard");
    expect(project?.responsibleRoles).toEqual(["CTO"]);
    expect(project?.evidenceIdentity).toBe("agent-brain:dashboard");
    expect(project?.sensitivity).toBe("internal");
  });

  it("stops the sequence when a service is unhealthy", async () => {
    const harness = start({ failHealthFor: "agent-brain:portfolio" });

    const result = await harness.enableProjectEvidence();

    expect(result).toMatchObject({
      kind: "stopped",
      failedAt: "project:personal-portfolio",
      reason: "unhealthy",
    });
  });

  it("stops the sequence when the cited query fails even though the service is healthy", async () => {
    // Answering is not the same as answering with citable evidence. A healthy
    // service that cannot produce a cited result must still stop the sequence.
    const harness = start({ failCitedQueryFor: "agent-brain:portfolio" });

    const result = await harness.enableProjectEvidence();

    expect(result).toMatchObject({
      kind: "stopped",
      failedAt: "project:personal-portfolio",
      reason: "cited-query-failed",
    });
  });

  it("leaves earlier projects enabled and later ones untouched when it stops", async () => {
    const harness = start({ failHealthFor: "agent-brain:portfolio" });

    const result = await harness.enableProjectEvidence();

    expect(result).toMatchObject({
      kind: "stopped",
      failedAt: "project:personal-portfolio",
    });
    if (result.kind !== "stopped") return;
    // The one before it stands; the one after it was never attempted.
    expect(result.enabled.map((entry) => entry.projectId)).toEqual([
      "project:agent-brain-dashboard",
    ]);
    expect(harness.portfolioProject("project:real-ming")).toBeUndefined();
  });

  it("grants no Executive access that the Evidence Broker has not authorized", async () => {
    const harness = start();
    const result = await harness.enableProjectEvidence();
    expect(result.kind).toBe("enabled");
    if (result.kind !== "enabled") return;

    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm39:probe",
      text: "Review the Agent Brain dashboard",
      workstream: "MicroSaaS",
      expectedEffect: { kind: "record-note", value: "Review" },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("expected acknowledgement");
    }
    harness.bindPortfolioProject(
      acknowledgement.workItem.id,
      "project:agent-brain-dashboard",
    );

    // Registration made the project known; it did not make the CMO a reader of
    // a CTO project.
    const unauthorized = await harness.serveProjectEvidence({
      workspaceId: "workspace:real-ming",
      executive: "CMO",
      workItemId: acknowledgement.workItem.id,
      purpose: "unrelated review",
      portfolioProjectId: "project:agent-brain-dashboard",
    });

    expect(unauthorized).toMatchObject({
      kind: "denied",
      reason: "not-authorized",
    });
  });

  it("is idempotent: a second run re-verifies without duplicating registration", async () => {
    const harness = start();

    const first = await harness.enableProjectEvidence();
    const second = await harness.enableProjectEvidence();

    expect(first.kind).toBe("enabled");
    expect(second.kind).toBe("enabled");
    expect(harness.portfolioProjects()).toHaveLength(3);
  });
});
