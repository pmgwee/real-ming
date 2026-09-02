import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import {
  deploymentCandidateCheckNames,
  type DeploymentCandidateBuildInput,
} from "../../src/portfolio/deployment-candidate.js";
import type {
  DeploymentPromotionApprovalRequest,
  DeploymentPromotionRequest,
} from "../../src/portfolio/deployment-promotion.js";

const now = "2026-09-02T10:00:00.000Z";

describe("RM-28 exact Deployment Candidate promotion", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  async function start(
    promotion?: { readonly merge?: "ok" | "failed"; readonly verification?: "verified" | "failed"; readonly verificationEvidence?: "present" | "missing"; readonly rollback?: "rolled-back" | "failed"; readonly freshness?: "current" | "drifted" },
  ): Promise<{ readonly harness: RealMingSystemHarness; readonly directory: string; readonly setNow: (value: string) => void }> {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm28-"));
    directories.push(directory);
    const clock = { value: now };
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => clock.value,
      ...(promotion === undefined ? {} : { deploymentPromotion: promotion }),
    });
    harnesses.push(harness);
    return { harness, directory, setNow: (value) => { clock.value = value; } };
  }

  async function buildCandidate(
    harness: RealMingSystemHarness,
    extra: Partial<DeploymentCandidateBuildInput> = {},
  ) {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `rm28:${Math.random()}`,
      intent: "Add OpenCode and CommandCode as provider presets in the Add Subscription modal.",
      expectedEffect: { kind: "duitsini-provider-presets", value: "opencode-commandcode" },
      accountableExecutive: "CTO",
      workstream: "MicroSaaS",
    });
    const workItemId = acknowledgement.workItem.id;
    const input: DeploymentCandidateBuildInput = {
      projectId: "project:duitsini",
      projectName: "DuitSini",
      workItemId,
      requestedIntent: acknowledgement.workItem.intent,
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
        assertions: ["OpenCode and CommandCode appear without changing existing records."],
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
      remainingRisks: ["Production promotion remains CEO-approved."],
      now,
      ...extra,
    };
    const result = harness.buildDeploymentCandidate(input);
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") throw new Error(result.reasons.join(", "));
    return { candidate: result.candidate, workItemId };
  }

  async function requestAndGrant(harness: RealMingSystemHarness, candidateId: string, additionalPlans?: DeploymentPromotionApprovalRequest["additionalPlans"]) {
    const requested = await harness.requestDeploymentPromotionApproval({
      candidateId,
      ...(additionalPlans === undefined ? {} : { additionalPlans }),
    });
    expect(requested.kind).toBe("approval-requested");
    if (requested.kind === "rejected") throw new Error(requested.reasons.join(", "));
    const approvals = [];
    for (const approval of requested.approvals) {
      approvals.push(await harness.grantApproval({
        approvalId: approval.approvalId,
        actorId: "ceo:ming",
        expiresAt: "2026-09-02T11:00:00.000Z",
      }));
    }
    return approvals;
  }

  it("presents one exact candidate in dashboard and Telegram, and Telegram grants the same Approval", async () => {
    const { harness } = await start();
    const { candidate } = await buildCandidate(harness);
    const requested = await harness.requestDeploymentPromotionApproval({ candidateId: candidate.id });
    expect(requested.kind).toBe("approval-requested");
    if (requested.kind !== "approval-requested") return;
    expect(requested.approvals).toMatchObject([{ scope: "code-promotion", targetType: "deployment-candidate", targetIdentity: candidate.id, targetVersion: "sha-candidate", state: "requested" }]);
    expect(harness.telegramMessages().at(-1)?.text).toContain(`commit=sha-candidate`);
    expect(harness.telegramMessages().at(-1)?.text).toContain(candidate.id);
    expect(harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).deploymentCandidates).toMatchObject([{ id: candidate.id, exactCommitSha: "sha-candidate", repositorySourceReference: candidate.taskBranch.sourceReference, pullRequestSourceReference: candidate.pullRequest.sourceReference, pullRequestNumber: 123, approvals: [{ id: requested.approvals[0]!.approvalId, scope: "code-promotion", targetIdentity: candidate.id, targetVersion: "sha-candidate", state: "requested" }] }]);

    await expect(harness.receiveTelegramUpdate({
      updateId: 9001,
      message: { messageId: 9001, senderId: "100000001", chatId: "100000001", chatType: "private", text: `/approve-promotion ${requested.approvals[0]!.approvalId}` },
    })).resolves.toMatchObject({ kind: "approval-applied", approval: { state: "granted", targetVersion: "sha-candidate" } });
  });

  it("refuses changed candidates and separately requires declared migration approvals", async () => {
    const { harness } = await start({});
    const first = await buildCandidate(harness, { additionalChangeScopes: ["database-migration"] });
    const noPlan = await harness.requestDeploymentPromotionApproval({ candidateId: first.candidate.id });
    expect(noPlan).toMatchObject({ kind: "rejected", reasons: ["candidate requires a separate database-migration plan and Approval"] });
    const plan = {
      scope: "database-migration" as const,
      planReference: "plan:duitsini:migration:1",
      evidenceReference: "evidence:duitsini:migration:1",
      backupReference: "backup:duitsini:before-migration",
      rollbackReference: "rollback:duitsini:migration:1",
    };
    const approvals = await requestAndGrant(harness, first.candidate.id, [plan]);
    const code = approvals.find((approval) => approval.scope === "code-promotion")!;
    const missingMigration = await harness.promoteDeploymentCandidate({ candidateId: first.candidate.id, codeApprovalId: code.id });
    expect(missingMigration).toMatchObject({ kind: "rejected", reasons: ["candidate requires a separate database-migration Approval."] });
    const migration = approvals.find((approval) => approval.scope === "database-migration")!;
    for (const field of ["planReference", "evidenceReference", "backupReference", "rollbackReference"] as const) {
      const changedPlan = { ...plan, [field]: `${plan[field]}:changed` };
      const changedPlanAttempt = await harness.promoteDeploymentCandidate({ candidateId: first.candidate.id, codeApprovalId: code.id, additionalApprovals: { "database-migration": { approvalId: migration.id, plan: changedPlan } } });
      expect(changedPlanAttempt).toMatchObject({ kind: "rejected", reasons: ["database-migration Approval is not bound to the exact plan."] });
    }
    const changed = await buildCandidate(harness, { taskBranch: { ...first.candidate.taskBranch, headSha: "sha-changed" }, pullRequest: { ...first.candidate.pullRequest, headSha: "sha-changed" }, preview: { ...first.candidate.preview, commitSha: "sha-changed" }, checks: first.candidate.checks.map((check) => ({ ...check, commitSha: "sha-changed" })) });
    const drift = await harness.promoteDeploymentCandidate({ candidateId: changed.candidate.id, codeApprovalId: code.id, additionalApprovals: { "database-migration": { approvalId: migration.id, plan } } });
    expect(drift).toMatchObject({ kind: "rejected" });
  });

  it("blocks without an executor, and promotes only the approved commit with live verification", async () => {
    const noExecutor = await start();
    const blockedCandidate = await buildCandidate(noExecutor.harness);
    const blockedApproval = await requestAndGrant(noExecutor.harness, blockedCandidate.candidate.id);
    const blocked = await noExecutor.harness.promoteDeploymentCandidate({ candidateId: blockedCandidate.candidate.id, codeApprovalId: blockedApproval[0]!.id });
    expect(blocked).toMatchObject({ kind: "blocked", reasons: ["Production promotion executor is not configured; CEO activation remains required."] });

    const live = await start({});
    const liveCandidate = await buildCandidate(live.harness);
    const liveApproval = await requestAndGrant(live.harness, liveCandidate.candidate.id);
    const promoted = await live.harness.promoteDeploymentCandidate({ candidateId: liveCandidate.candidate.id, codeApprovalId: liveApproval[0]!.id } satisfies DeploymentPromotionRequest);
    expect(promoted.kind).toBe("promoted");
    if (promoted.kind !== "promoted") return;
    expect(promoted.record.state).toBe("verified");
    expect(promoted.record.outcomeReport).toMatchObject({ exactCommitSha: "sha-candidate", completedEffect: { kind: "production-promotion", commitSha: "sha-candidate" }, verification: { status: "verified" } });
    expect(live.harness.auditTrail(liveCandidate.workItemId).some((event) => event.type === "policy.permitted" && event.details["candidateId"] === liveCandidate.candidate.id)).toBe(true);

    live.setNow("2026-09-02T12:00:00.000Z");
    const renewed = await live.harness.requestDeploymentPromotionApproval({ candidateId: liveCandidate.candidate.id });
    expect(renewed.kind).toBe("approval-requested");
    if (renewed.kind !== "approval-requested") return;
    const renewedApproval = await live.harness.grantApproval({ approvalId: renewed.approvals[0]!.approvalId, actorId: "ceo:ming", expiresAt: "2026-09-02T13:00:00.000Z" });
    const replay = await live.harness.promoteDeploymentCandidate({ candidateId: liveCandidate.candidate.id, codeApprovalId: renewedApproval.id });
    expect(replay).toMatchObject({ kind: "replayed", record: { state: "verified", candidateId: liveCandidate.candidate.id } });
  });

  it("rejects a candidate that drifted before merge, without invoking the merge effect", async () => {
    const { harness } = await start({ freshness: "drifted" });
    const selected = await buildCandidate(harness);
    const approvals = await requestAndGrant(harness, selected.candidate.id);
    const result = await harness.promoteDeploymentCandidate({ candidateId: selected.candidate.id, codeApprovalId: approvals[0]!.id });
    expect(result).toMatchObject({ kind: "failed", record: { state: "merge-failed", failureReason: "candidate-drift" } });
  });

  it("rolls back the known production deployment when verification fails", async () => {
    const { harness } = await start({ verification: "failed", verificationEvidence: "missing" });
    const selected = await buildCandidate(harness);
    const approvals = await requestAndGrant(harness, selected.candidate.id);
    const result = await harness.promoteDeploymentCandidate({ candidateId: selected.candidate.id, codeApprovalId: approvals[0]!.id });
    expect(result.kind).toBe("rolled-back");
    if (result.kind !== "rolled-back") return;
    expect(result.record).toMatchObject({ state: "rollback-completed", rollbackReference: "vercel:deployment:vercel-production-current", outcomeReport: { completedEffect: { kind: "production-rollback", commitSha: "sha-production" }, verification: { status: "failed" } } });
  });
});
