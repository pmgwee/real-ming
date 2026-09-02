import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  Approval,
  ApprovalScope,
  PolicyDecision,
  RequestedAction,
} from "../operations/contracts.js";
import { isCeoActor } from "../operations/actor-identity.js";
import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type { TelegramNotificationResult } from "../telegram/contracts.js";
import type {
  DeploymentCandidate,
  DeploymentCandidateAdditionalChangeScope,
  DeploymentCandidateStore,
} from "./deployment-candidate.js";

export const promotionChangeScopes = [
  "database-migration",
  "production-data-change",
] as const;
export type PromotionChangeScope = (typeof promotionChangeScopes)[number];

export interface PromotionChangePlan {
  readonly scope: PromotionChangeScope;
  readonly planReference: string;
  readonly evidenceReference: string;
  readonly backupReference: string;
  readonly rollbackReference: string;
}

export interface PromotionApprovalRequest {
  readonly candidateId: string;
  readonly additionalPlans?: readonly PromotionChangePlan[];
}
export type DeploymentPromotionApprovalRequest = PromotionApprovalRequest;

export interface PromotionApproval {
  readonly scope: ApprovalScope;
  readonly approvalId: string;
  readonly targetType: string;
  readonly targetIdentity: string;
  readonly targetVersion: string;
  readonly state: "requested" | "granted";
}

export type DeploymentPromotionApprovalResult =
  | {
      readonly kind: "approval-requested" | "already-approved";
      readonly candidate: DeploymentCandidate;
      readonly approvals: readonly PromotionApproval[];
    }
  | { readonly kind: "rejected"; readonly reasons: readonly string[] };

export type PromotionMergeResult =
  | {
      readonly kind: "merged";
      readonly commitSha: string;
      readonly effectReference: string;
    }
  | {
      readonly kind: "failed";
      readonly reason:
        | "provider-unavailable"
        | "permission-denied"
        | "candidate-rejected"
        | "provider-error";
    };

export interface ProductionVerificationResult {
  readonly kind: "verified" | "failed";
  readonly commitSha?: string;
  readonly evidenceReference?: string;
  readonly asOf?: string;
  readonly assertions?: readonly string[];
  readonly reason?: "unavailable" | "candidate-drift" | "verification-failed";
}

export interface PromotionRollbackResult {
  readonly kind: "rolled-back" | "failed";
  readonly commitSha?: string;
  readonly effectReference?: string;
  readonly reason?: "provider-unavailable" | "permission-denied" | "rollback-failed";
}

export interface PromotionCandidateFreshnessResult {
  readonly kind: "current" | "drifted";
  readonly commitSha: string;
  readonly reason?: "candidate-drift" | "unavailable";
}

/**
 * The only production write capability RM-28 accepts is merging the reviewed
 * pull request. There is intentionally no deploy-latest or production-branch
 * push method. Vercel promotion follows the reviewed merge in the project's
 * normal deployment workflow.
 */
export interface DeploymentPromotionExecutor {
  /** Read-only source-of-truth check. No merge/deploy effect may run first. */
  verifyCandidateBeforeMerge(input: {
    readonly candidate: DeploymentCandidate;
  }): Promise<PromotionCandidateFreshnessResult>;
  mergeDraftPullRequest(input: {
    readonly candidate: DeploymentCandidate;
    /** The SHA returned by the pre-merge freshness check. */
    readonly expectedCommitSha: string;
    readonly idempotencyKey: string;
  }): Promise<PromotionMergeResult>;
  verifyProduction(input: {
    readonly candidate: DeploymentCandidate;
    readonly merge: Extract<PromotionMergeResult, { readonly kind: "merged" }>;
  }): Promise<ProductionVerificationResult>;
  rollback(input: {
    readonly candidate: DeploymentCandidate;
    readonly idempotencyKey: string;
  }): Promise<PromotionRollbackResult>;
}

export interface DeploymentPromotionOutcomeReport {
  readonly id: string;
  readonly candidateId: string;
  readonly workItemId: string;
  readonly requestedIntent: string;
  readonly exactCommitSha: string;
  readonly completedEffect: {
    readonly kind: "production-promotion";
    readonly mergeReference: string;
    readonly commitSha: string;
  } | {
    readonly kind: "production-rollback";
    readonly rollbackReference: string;
    readonly commitSha: string;
  };
  readonly verification: {
    readonly status: "verified" | "failed";
    readonly evidenceReference: string;
    readonly asOf: string;
    readonly assertions: readonly string[];
  };
  readonly remainingRisks: readonly string[];
  readonly requiredDecisions: readonly string[];
  readonly createdAt: string;
}

export type DeploymentPromotionState =
  | "approved"
  | "merge-failed"
  | "merged"
  | "verified"
  | "rollback-completed"
  | "rollback-failed"
  | "executor-unavailable";

export interface DeploymentPromotionRecord {
  readonly id: string;
  readonly runId: string;
  readonly candidateId: string;
  readonly workItemId: string;
  readonly exactCommitSha: string;
  readonly codeApprovalId: string;
  readonly additionalApprovalIds: readonly string[];
  readonly state: DeploymentPromotionState;
  readonly mergeReference: string | null;
  readonly verificationReference: string | null;
  readonly rollbackReference: string | null;
  readonly outcomeReport: DeploymentPromotionOutcomeReport | null;
  readonly failureReason: string | null;
  readonly occurredAt: string;
}

export interface DeploymentPromotionStore {
  append(record: DeploymentPromotionRecord): DeploymentPromotionRecord;
  latest(runId: string): DeploymentPromotionRecord | undefined;
  latestForCandidate(candidateId: string): DeploymentPromotionRecord | undefined;
  close(): void;
}

export function deploymentPromotionStatePath(statePath: string): string {
  return statePath === ":memory:"
    ? ":memory:"
    : `${statePath}.deployment-promotions.sqlite`;
}

/** Durable append-only promotion event store. */
export class SqliteDeploymentPromotionStore implements DeploymentPromotionStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS deployment_promotion_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      );
      CREATE TRIGGER IF NOT EXISTS deployment_promotion_events_reject_update
      BEFORE UPDATE ON deployment_promotion_events BEGIN
        SELECT RAISE(ABORT, 'deployment_promotion_events are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS deployment_promotion_events_reject_delete
      BEFORE DELETE ON deployment_promotion_events BEGIN
        SELECT RAISE(ABORT, 'deployment_promotion_events are append-only');
      END;
    `);
  }

  append(record: DeploymentPromotionRecord): DeploymentPromotionRecord {
    const serialized = JSON.stringify(record);
    const existing = this.#database
      .prepare("SELECT record_json FROM deployment_promotion_events WHERE id = ?")
      .get(record.id) as unknown as { record_json: string } | undefined;
    if (existing !== undefined) {
      if (existing.record_json !== serialized) throw new Error("Deployment Promotion event identity collision.");
      return JSON.parse(existing.record_json) as DeploymentPromotionRecord;
    }
    this.#database
      .prepare(`INSERT INTO deployment_promotion_events
        (id, run_id, candidate_id, sequence, record_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.runId, record.candidateId, this.nextSequence(record.runId), serialized, record.occurredAt);
    return record;
  }

  private nextSequence(runId: string): number {
    const row = this.#database
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS highest FROM deployment_promotion_events WHERE run_id = ?")
      .get(runId) as unknown as { highest: number };
    return row.highest + 1;
  }

  latest(runId: string): DeploymentPromotionRecord | undefined {
    const row = this.#database
      .prepare("SELECT record_json FROM deployment_promotion_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1")
      .get(runId) as unknown as { record_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.record_json) as DeploymentPromotionRecord;
  }

  latestForCandidate(candidateId: string): DeploymentPromotionRecord | undefined {
    const row = this.#database
      .prepare("SELECT record_json FROM deployment_promotion_events WHERE candidate_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(candidateId) as unknown as { record_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.record_json) as DeploymentPromotionRecord;
  }

  close(): void {
    this.#database.close();
  }
}

function targetFor(candidate: DeploymentCandidate, scope: ApprovalScope, plan?: PromotionChangePlan) {
  return plan === undefined
    ? {
        type: "deployment-candidate",
        identity: candidate.id,
        version: candidate.exactCommitSha,
      }
    : {
        type: `deployment-candidate-${plan.scope}`,
        identity: candidate.id,
        version: `${candidate.exactCommitSha}:${planDigest(plan)}`,
      };
}

function planDigest(plan: PromotionChangePlan): string {
  return createHash("sha256")
    .update(JSON.stringify({
      scope: plan.scope,
      planReference: plan.planReference,
      evidenceReference: plan.evidenceReference,
      backupReference: plan.backupReference,
      rollbackReference: plan.rollbackReference,
    }), "utf8")
    .digest("hex");
}

function actionFor(candidate: DeploymentCandidate, scope: ApprovalScope, plan?: PromotionChangePlan): RequestedAction {
  return {
    workItemId: candidate.workItemId,
    executive: "CTO",
    trustDomain: "Ming Creatives",
    operation: "write",
    reversibility: "irreversible",
    riskClass: "high",
    scope,
    target: targetFor(candidate, scope, plan),
  };
}

function safeApproval(decision: PolicyDecision, expected: { readonly id: string; readonly target: ReturnType<typeof targetFor> }): PromotionApproval | undefined {
  if (decision.kind === "permitted" && decision.basis === "approval" && decision.approvalId === expected.id) {
    return {
      scope: expected.target.type === "deployment-candidate" ? "code-promotion" : expected.target.type.slice("deployment-candidate-".length) as PromotionChangeScope,
      approvalId: expected.id,
      targetType: expected.target.type,
      targetIdentity: expected.target.identity,
      targetVersion: expected.target.version,
      state: "granted",
    };
  }
  return undefined;
}

function approvalFromDecision(decision: PolicyDecision): PromotionApproval | undefined {
  if (decision.kind !== "approval-required") return undefined;
  return {
    scope: decision.scope,
    approvalId: decision.approvalId,
    targetType: decision.target.type,
    targetIdentity: decision.target.identity,
    targetVersion: decision.target.version,
    state: "requested",
  };
}

function approvalRecordMatches(
  approval: Approval | undefined,
  expected: { readonly scope: ApprovalScope; readonly target: ReturnType<typeof targetFor> },
): boolean {
  return approval !== undefined &&
    approval.scope === expected.scope &&
    approval.targetType === expected.target.type &&
    approval.targetIdentity === expected.target.identity &&
    approval.targetVersion === expected.target.version;
}

function runIdFor(candidate: DeploymentCandidate, input: DeploymentPromotionRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ candidateId: candidate.id, exactCommitSha: candidate.exactCommitSha, input }), "utf8")
    .digest("hex");
}

function terminal(state: DeploymentPromotionState): boolean {
  return ["verified", "rollback-completed", "rollback-failed", "merge-failed"].includes(state);
}

function requiredAdditionalScopes(candidate: DeploymentCandidate): readonly PromotionChangeScope[] {
  // RM-27 candidates predate the RM-28 field; absence means no declared
  // additional change scope, never an invalid candidate or a runtime error.
  return (candidate.additionalChangeScopes ?? []) as readonly DeploymentCandidateAdditionalChangeScope[] as readonly PromotionChangeScope[];
}

export interface DeploymentPromotionCoordinator {
  requestApproval(input: PromotionApprovalRequest): Promise<DeploymentPromotionApprovalResult>;
  promote(input: DeploymentPromotionRequest): Promise<DeploymentPromotionResult>;
}

export interface DeploymentPromotionRequest {
  readonly candidateId: string;
  readonly codeApprovalId: string;
  readonly additionalApprovals?: Readonly<Partial<Record<PromotionChangeScope, { readonly approvalId: string; readonly plan: PromotionChangePlan }>>>;
}

export type DeploymentPromotionResult =
  | { readonly kind: "promoted" | "rolled-back" | "replayed"; readonly record: DeploymentPromotionRecord }
  | { readonly kind: "blocked" | "failed" | "rejected"; readonly record?: DeploymentPromotionRecord; readonly reasons: readonly string[] };

export function createDeploymentPromotionCoordinator(options: {
  readonly candidates: DeploymentCandidateStore;
  readonly promotions: DeploymentPromotionStore;
  readonly state: OperationsState;
  readonly gateway: OperationsGateway;
  readonly executor?: DeploymentPromotionExecutor;
  readonly notify?: (notification: {
    readonly kind: "approval";
    readonly text: string;
    readonly idempotencyKey: string;
  }) => Promise<TelegramNotificationResult>;
  readonly now?: () => string;
}): DeploymentPromotionCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const candidateOrReject = (candidateId: string): DeploymentCandidate | undefined => {
    const candidate = options.candidates.candidate(candidateId);
    return candidate?.state === "review-ready" && candidate.previewVerification.status === "verified"
      ? candidate
      : undefined;
  };

  const requestOne = async (
    candidate: DeploymentCandidate,
    scope: ApprovalScope,
    plan?: PromotionChangePlan,
  ): Promise<PromotionApproval | undefined> => {
    const target = targetFor(candidate, scope, plan);
    const decision = await options.gateway.requestAction(actionFor(candidate, scope, plan));
    const existing = safeApproval(decision, {
      id: decision.kind === "permitted" && decision.basis === "approval" ? decision.approvalId : "",
      target,
    });
    if (existing !== undefined) return existing;
    return approvalFromDecision(decision);
  };

  const requestApproval = async (input: PromotionApprovalRequest): Promise<DeploymentPromotionApprovalResult> => {
    const candidate = candidateOrReject(input.candidateId);
    if (candidate === undefined) return { kind: "rejected", reasons: ["Deployment Candidate is not review-ready or verified."] };
    const plans = input.additionalPlans ?? [];
    const reasons: string[] = [];
    const seenScopes = new Set<PromotionChangeScope>();
    const requiredScopes = new Set(requiredAdditionalScopes(candidate));
    for (const requiredScope of requiredScopes) {
      if (!plans.some((plan) => plan.scope === requiredScope)) {
        reasons.push(`candidate requires a separate ${requiredScope} plan and Approval`);
      }
    }
    for (const plan of plans) {
      if (seenScopes.has(plan.scope)) reasons.push(`duplicate additional approval scope: ${plan.scope}`);
      seenScopes.add(plan.scope);
      if ([plan.planReference, plan.evidenceReference, plan.backupReference, plan.rollbackReference].some((value) => value.trim() === "")) {
        reasons.push(`${plan.scope} requires plan, evidence, backup, and rollback references`);
      }
      if (detectSensitiveFields({ plan: JSON.stringify(plan) }).length > 0) reasons.push(`${plan.scope} plan contains a Sensitive Secret`);
    }
    if (reasons.length > 0) return { kind: "rejected", reasons };
    const approvals: PromotionApproval[] = [];
    const code = await requestOne(candidate, "code-promotion");
    if (code === undefined) return { kind: "rejected", reasons: ["Code promotion Approval could not be requested."] };
    approvals.push(code);
    for (const plan of plans) {
      const approval = await requestOne(candidate, plan.scope, plan);
      if (approval === undefined) return { kind: "rejected", reasons: [`${plan.scope} Approval could not be requested.`] };
      approvals.push(approval);
    }
    const kind = approvals.some((approval) => approval.state === "requested") ? "approval-requested" : "already-approved";
    await options.notify?.({
      kind: "approval",
      text: [
        `Approve Promotion · ${candidate.projectName}`,
        `candidate=${candidate.id}`,
        `repository=${candidate.taskBranch.sourceReference}`,
        `pull-request=${candidate.pullRequest.sourceReference} (#${candidate.pullRequest.number})`,
        `commit=${candidate.exactCommitSha}`,
        `code-approval=${code.approvalId}`,
        ...approvals.slice(1).map((approval) => `${approval.scope}-approval=${approval.approvalId}`),
        "Dashboard and Telegram refer to this exact candidate; no production action has run.",
      ].join(" · "),
      idempotencyKey: `deployment-promotion:approval:${candidate.id}:${candidate.exactCommitSha}`,
    });
    return { kind, candidate, approvals };
  };

  const promote = async (input: DeploymentPromotionRequest): Promise<DeploymentPromotionResult> => {
    const candidate = candidateOrReject(input.candidateId);
    if (candidate === undefined) return { kind: "rejected", reasons: ["Deployment Candidate is not review-ready or verified."] };
    const priorCandidate = options.promotions.latestForCandidate(candidate.id);
    if (priorCandidate !== undefined && terminal(priorCandidate.state)) {
      return { kind: "replayed", record: priorCandidate };
    }
    const codeApproval = options.state.approval(input.codeApprovalId);
    const codeTarget = targetFor(candidate, "code-promotion");
    if (!approvalRecordMatches(codeApproval, { scope: "code-promotion", target: codeTarget })) {
      return { kind: "rejected", reasons: ["Code promotion Approval is not bound to this exact candidate."] };
    }
    const codeDecision = await options.gateway.requestAction(actionFor(candidate, "code-promotion"));
    if (safeApproval(codeDecision, { id: input.codeApprovalId, target: codeTarget }) === undefined) {
      return { kind: "rejected", reasons: ["Code promotion Approval is not currently effective."] };
    }

    const additionalIds: string[] = [];
    for (const scope of promotionChangeScopes) {
      const additional = input.additionalApprovals?.[scope];
      if (requiredAdditionalScopes(candidate).includes(scope) && additional === undefined) {
        return { kind: "rejected", reasons: [`candidate requires a separate ${scope} Approval.`] };
      }
      if (additional === undefined) continue;
      if (additional.plan.scope !== scope) return { kind: "rejected", reasons: [`${scope} Approval plan scope does not match.`] };
      if ([additional.plan.planReference, additional.plan.evidenceReference, additional.plan.backupReference, additional.plan.rollbackReference].some((value) => value.trim() === "")) {
        return { kind: "rejected", reasons: [`${scope} requires plan, evidence, backup, and rollback references.`] };
      }
      if (detectSensitiveFields({ plan: JSON.stringify(additional.plan) }).length > 0) {
        return { kind: "rejected", reasons: [`${scope} plan contains a Sensitive Secret.`] };
      }
      const target = targetFor(candidate, scope, additional.plan);
      const approval = options.state.approval(additional.approvalId);
      if (!approvalRecordMatches(approval, { scope, target })) return { kind: "rejected", reasons: [`${scope} Approval is not bound to the exact plan.`] };
      const decision = await options.gateway.requestAction(actionFor(candidate, scope, additional.plan));
      if (safeApproval(decision, { id: additional.approvalId, target }) === undefined) return { kind: "rejected", reasons: [`${scope} Approval is not currently effective.`] };
      additionalIds.push(additional.approvalId);
    }

    const runId = runIdFor(candidate, input);
    const prior = options.promotions.latest(runId);
    if (prior !== undefined && terminal(prior.state)) return { kind: "replayed", record: prior };
    const at = now();
    const base = {
      runId,
      candidateId: candidate.id,
      workItemId: candidate.workItemId,
      exactCommitSha: candidate.exactCommitSha,
      codeApprovalId: input.codeApprovalId,
      additionalApprovalIds: additionalIds,
    } as const;
    const append = (record: Omit<DeploymentPromotionRecord, "id">): DeploymentPromotionRecord => {
      const priorState = options.promotions.latest(runId);
      if (priorState?.state === record.state) return priorState;
      return options.promotions.append({ ...record, id: `promotion:${runId}:${record.state}` });
    };
    if (options.promotions.latest(runId) === undefined) {
      append({ ...base, state: "approved", mergeReference: null, verificationReference: null, rollbackReference: null, outcomeReport: null, failureReason: null, occurredAt: at });
    }
    if (options.executor === undefined) {
      const record = append({ ...base, state: "executor-unavailable", mergeReference: null, verificationReference: null, rollbackReference: null, outcomeReport: null, failureReason: "No production promotion executor is configured.", occurredAt: at });
      return { kind: "blocked", record, reasons: ["Production promotion executor is not configured; CEO activation remains required."] };
    }

    const freshness = await options.executor.verifyCandidateBeforeMerge({ candidate });
    if (freshness.kind !== "current" || freshness.commitSha !== candidate.exactCommitSha) {
      const record = append({ ...base, state: "merge-failed", mergeReference: null, verificationReference: null, rollbackReference: null, outcomeReport: null, failureReason: freshness.reason ?? "candidate-drift", occurredAt: at });
      return { kind: "failed", record, reasons: [record.failureReason ?? "The approved candidate is stale."] };
    }
    const merged = await options.executor.mergeDraftPullRequest({ candidate, expectedCommitSha: freshness.commitSha, idempotencyKey: `promotion:${candidate.id}:${candidate.exactCommitSha}` });
    if (merged.kind !== "merged" || merged.commitSha !== candidate.exactCommitSha || merged.effectReference === undefined) {
      const record = append({ ...base, state: "merge-failed", mergeReference: null, verificationReference: null, rollbackReference: null, outcomeReport: null, failureReason: merged.kind === "merged" ? "Provider returned a commit different from the approved candidate." : merged.reason ?? "provider-error", occurredAt: at });
      return { kind: "failed", record, reasons: [record.failureReason ?? "Production merge failed."] };
    }
    append({ ...base, state: "merged", mergeReference: merged.effectReference, verificationReference: null, rollbackReference: null, outcomeReport: null, failureReason: null, occurredAt: at });
    const verification = await options.executor.verifyProduction({ candidate, merge: merged });
    if (verification.kind === "verified" && verification.commitSha === candidate.exactCommitSha && verification.evidenceReference !== undefined && verification.asOf !== undefined && (verification.assertions?.length ?? 0) > 0) {
      const report: DeploymentPromotionOutcomeReport = {
        id: `promotion-outcome:${runId}`,
        candidateId: candidate.id,
        workItemId: candidate.workItemId,
        requestedIntent: candidate.outcomeReport.requestedIntent,
        exactCommitSha: candidate.exactCommitSha,
        completedEffect: { kind: "production-promotion", mergeReference: merged.effectReference, commitSha: candidate.exactCommitSha },
        verification: { status: "verified", evidenceReference: verification.evidenceReference, asOf: verification.asOf, assertions: verification.assertions ?? [] },
        remainingRisks: [...candidate.outcomeReport.remainingRisks],
        requiredDecisions: [],
        createdAt: now(),
      };
      const record = append({ ...base, state: "verified", mergeReference: merged.effectReference, verificationReference: verification.evidenceReference, rollbackReference: null, outcomeReport: report, failureReason: null, occurredAt: now() });
      options.state.recordAuditEvent(candidate.workItemId, "policy.permitted", now(), { action: "production-promotion", candidateId: candidate.id, exactCommitSha: candidate.exactCommitSha, approvalId: input.codeApprovalId, outcomeReportId: report.id });
      return { kind: "promoted", record };
    }

    const rollback = await options.executor.rollback({ candidate, idempotencyKey: `promotion:${candidate.id}:${candidate.exactCommitSha}:rollback` });
    if (rollback.kind === "rolled-back" && rollback.commitSha === candidate.rollback.commitSha && rollback.effectReference !== undefined) {
      const report: DeploymentPromotionOutcomeReport = {
        id: `promotion-outcome:${runId}`,
        candidateId: candidate.id,
        workItemId: candidate.workItemId,
        requestedIntent: candidate.outcomeReport.requestedIntent,
        exactCommitSha: candidate.exactCommitSha,
        completedEffect: { kind: "production-rollback", rollbackReference: rollback.effectReference, commitSha: rollback.commitSha },
        verification: { status: "failed", evidenceReference: verification.evidenceReference ?? "verification:failed", asOf: verification.asOf ?? now(), assertions: verification.assertions ?? [] },
        remainingRisks: ["Production verification failed; rollback completed."],
        requiredDecisions: ["CEO review required for the failed promotion and recovery evidence."],
        createdAt: now(),
      };
      const record = append({ ...base, state: "rollback-completed", mergeReference: merged.effectReference, verificationReference: verification.evidenceReference ?? null, rollbackReference: rollback.effectReference, outcomeReport: report, failureReason: verification.reason ?? "verification-failed", occurredAt: now() });
      options.state.recordAuditEvent(candidate.workItemId, "policy.denied", now(), { action: "production-promotion", candidateId: candidate.id, exactCommitSha: candidate.exactCommitSha, reason: "verification-failed", rollbackReference: rollback.effectReference });
      return { kind: "rolled-back", record };
    }
    const record = append({ ...base, state: "rollback-failed", mergeReference: merged.effectReference, verificationReference: verification.evidenceReference ?? null, rollbackReference: rollback.effectReference ?? null, outcomeReport: null, failureReason: "Production verification failed and rollback did not complete.", occurredAt: now() });
    return { kind: "failed", record, reasons: [record.failureReason!] };
  };

  return { requestApproval, promote };
}

export function isDeploymentPromotionCeoActor(actorId: string): boolean {
  return isCeoActor(actorId);
}
