import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import { createProductionControlPlane } from "../../src/runtime/production-control-plane.js";
import { tracerCredentials } from "../../src/config/tracer-secrets.js";
import {
  deploymentCandidateCheckNames,
  type DeploymentCandidateBuildInput,
} from "../../src/portfolio/deployment-candidate.js";

const now = "2026-09-02T10:00:00.000Z";

describe("RM-27 DuitSini Deployment Candidate", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function start(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm27-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({ statePath: join(directory, "state.sqlite"), now: () => now });
    harnesses.push(harness);
    return harness;
  }

  function input(overrides: Partial<DeploymentCandidateBuildInput> = {}): DeploymentCandidateBuildInput {
    return {
      projectId: "project:duitsini",
      projectName: "DuitSini",
      workItemId: "work-item:duitsini-open-code-command-code",
      requestedIntent: "Add OpenCode and CommandCode as provider presets in the Add Subscription modal.",
      productionBranch: "main",
      productionHeadSha: "sha-production",
      taskBranch: {
        name: "feat/duitsini-open-code-command-code",
        baseBranch: "main",
        baseCommitSha: "sha-production",
        headSha: "sha-candidate",
        sourceReference: "git:pmgwee/subscription-agent:feat/duitsini-open-code-command-code",
        synchronizedAt: now,
      },
      pullRequest: {
        number: 123,
        draft: true,
        sourceReference: "github:pmgwee/subscription-agent/pull/123",
        baseBranch: "main",
        baseCommitSha: "sha-production",
        headSha: "sha-candidate",
        asOf: now,
      },
      checks: deploymentCandidateCheckNames.map((name) => ({
        name,
        status: "passed" as const,
        commitSha: "sha-candidate",
        evidenceReference: `github:check:123:${name}`,
        completedAt: now,
      })),
      preview: {
        deploymentId: "vercel-preview-candidate",
        environment: "preview",
        status: "ready",
        domain: "https://candidate.duitsini.test",
        commitSha: "sha-candidate",
        sourceReference: "vercel:deployment:vercel-preview-candidate",
        asOf: now,
      },
      previewVerification: {
        status: "verified",
        dataMode: "synthetic",
        evidenceReference: "verification:duitsini:preview:123",
        asOf: now,
        assertions: [
          "OpenCode appears in the provider preset list.",
          "CommandCode appears with its own icon.",
          "Existing providers and records are unchanged.",
        ],
        productionFinanceAdjacentMetadata: "absent",
        logs: "clean",
        projectEvidence: "clean",
      },
      rollback: {
        deploymentId: "vercel-production-current",
        commitSha: "sha-production",
        sourceReference: "vercel:deployment:vercel-production-current",
        asOf: "2026-09-02T09:00:00.000Z",
        reason: "Restore the currently serving production commit if promotion verification fails.",
      },
      remainingRisks: ["Production promotion and any database migration still require separate CEO Approvals."],
      now,
      ...overrides,
    };
  }

  it("creates a review-ready candidate only for the synchronized exact commit", () => {
    const harness = start();
    const result = harness.buildDeploymentCandidate(input());

    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.candidate).toMatchObject({
      state: "review-ready",
      projectId: "project:duitsini",
      workItemId: "work-item:duitsini-open-code-command-code",
      exactCommitSha: "sha-candidate",
      taskBranch: { name: "feat/duitsini-open-code-command-code", baseCommitSha: "sha-production" },
      pullRequest: { number: 123, draft: true, headSha: "sha-candidate" },
      preview: { environment: "preview", status: "ready", commitSha: "sha-candidate" },
      previewVerification: { status: "verified", dataMode: "synthetic", productionFinanceAdjacentMetadata: "absent" },
      rollback: { commitSha: "sha-production" },
      outcomeReport: {
        requestedIntent: "Add OpenCode and CommandCode as provider presets in the Add Subscription modal.",
        verification: { status: "verified", evidenceReference: "verification:duitsini:preview:123" },
        requiredDecisions: ["CEO Approval of exact commit before merge or production promotion."],
      },
    });
    expect(result.candidate.outcomeReport.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pull-request", reference: "github:pmgwee/subscription-agent/pull/123" }),
      expect.objectContaining({ kind: "preview-deployment", reference: "vercel:deployment:vercel-preview-candidate" }),
      expect.objectContaining({ kind: "rollback", reference: "vercel:deployment:vercel-production-current" }),
    ]));
    expect(harness.workItems()).toEqual([]);
    expect(harness.deploymentCandidate(result.candidate.id)).toEqual(result.candidate);
  });

  it("is callable through the production composition root and survives a restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm27-production-"));
    directories.push(directory);
    const environment = Object.fromEntries(
      tracerCredentials.map((credential) => [credential.name, `controlled-${credential.name.toLowerCase()}`]),
    );
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion-ledger.sqlite");
    const create = () => createProductionControlPlane({
      environment,
      statePath,
      notionLedgerPath,
      fetch: async () => { throw new Error("unexpected provider call"); },
      dashboardPort: 0,
      now: () => now,
    });
    const controlPlane = await create();
    const result = controlPlane.prepareDeploymentCandidate(input());
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(controlPlane.deploymentCandidate(result.candidate.id)).toEqual(result.candidate);
    await controlPlane.close();

    const restarted = await create();
    try {
      expect(restarted.deploymentCandidate(result.candidate.id)).toEqual(result.candidate);
    } finally {
      await restarted.close();
    }
  });

  it("refuses branch, PR, preview, check, or rollback drift", () => {
    const harness = start();
    const result = harness.buildDeploymentCandidate(input({
      taskBranch: { ...input().taskBranch, baseCommitSha: "sha-old" },
      pullRequest: { ...input().pullRequest, headSha: "sha-other" },
      preview: { ...input().preview, commitSha: "sha-other" },
      checks: input().checks.map((check, index) => index === 0 ? { ...check, status: "failed" as const } : check),
      rollback: { ...input().rollback, commitSha: "sha-candidate" },
    }));

    expect(result).toMatchObject({ kind: "rejected" });
    if (result.kind !== "rejected") return;
    expect(result.reasons).toEqual(expect.arrayContaining([
      "production branch was not synchronized before task work",
      "pull request head does not match the task branch",
      "preview commit does not match the task branch and pull request",
      "required check did not pass: typecheck",
      "rollback target must be a different exact commit",
    ]));
  });

  it("refuses stale or finance-leaking preview evidence", () => {
    const harness = start();
    const result = harness.buildDeploymentCandidate(input({
      preview: { ...input().preview, asOf: "2026-09-01T00:00:00.000Z" },
      previewVerification: {
        ...input().previewVerification,
        productionFinanceAdjacentMetadata: "present",
        logs: "contains-production-finance-metadata",
        projectEvidence: "contains-production-finance-metadata",
      },
    }));

    expect(result).toMatchObject({ kind: "rejected" });
    if (result.kind !== "rejected") return;
    expect(result.reasons).toEqual(expect.arrayContaining([
      "preview deployment is stale",
      "preview contains production finance-adjacent metadata",
      "preview logs contain production finance-adjacent metadata",
      "Project Evidence contains production finance-adjacent metadata",
    ]));
  });

  it("changes the immutable candidate identity when approval evidence changes", () => {
    const harness = start();
    const first = harness.buildDeploymentCandidate(input());
    const second = harness.buildDeploymentCandidate(input({
      previewVerification: {
        ...input().previewVerification,
        evidenceReference: "verification:duitsini:preview:124",
      },
    }));

    expect(first.kind).toBe("candidate");
    expect(second.kind).toBe("candidate");
    if (first.kind !== "candidate" || second.kind !== "candidate") return;
    expect(second.candidate.id).not.toBe(first.candidate.id);
    expect(second.candidate.outcomeReport.id).not.toBe(first.candidate.outcomeReport.id);
  });

  it("reuses the durable candidate when the same artifact is prepared later", () => {
    const harness = start();
    const first = harness.buildDeploymentCandidate(input());
    const later = harness.buildDeploymentCandidate(input({ now: "2026-09-02T10:00:01.000Z" }));

    expect(first.kind).toBe("candidate");
    expect(later.kind).toBe("candidate");
    if (first.kind !== "candidate" || later.kind !== "candidate") return;
    expect(later.candidate.id).toBe(first.candidate.id);
    expect(later.candidate).toEqual(first.candidate);
    expect(harness.deploymentCandidate(first.candidate.id)).toEqual(first.candidate);
  });
});
