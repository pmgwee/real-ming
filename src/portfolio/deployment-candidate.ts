import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { providerStalenessThresholdMs } from "../providers/adapter-contract.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";

export const previewDataModes = ["mock", "synthetic", "staging", "redacted"] as const;
export type PreviewDataMode = (typeof previewDataModes)[number];

export const deploymentCandidateCheckNames = [
  "typecheck",
  "tests",
  "build",
  "secret-scan",
  "dependency-audit",
] as const;
export type DeploymentCandidateCheckName = (typeof deploymentCandidateCheckNames)[number];

export const deploymentCandidateAdditionalChangeScopes = [
  "database-migration",
  "production-data-change",
] as const;
export type DeploymentCandidateAdditionalChangeScope =
  (typeof deploymentCandidateAdditionalChangeScopes)[number];

export interface DeploymentCandidateCheck {
  readonly name: DeploymentCandidateCheckName;
  readonly status: "passed" | "failed";
  readonly commitSha: string;
  readonly evidenceReference: string;
  readonly completedAt: string;
}

export interface DeploymentCandidateTaskBranch {
  readonly name: string;
  readonly baseBranch: string;
  readonly baseCommitSha: string;
  readonly headSha: string;
  readonly sourceReference: string;
  readonly synchronizedAt: string;
}

export interface DeploymentCandidatePullRequest {
  readonly number: number;
  readonly draft: boolean;
  readonly sourceReference: string;
  readonly baseBranch: string;
  readonly baseCommitSha: string;
  readonly headSha: string;
  readonly asOf: string;
}

export interface DeploymentCandidatePreview {
  readonly deploymentId: string;
  readonly environment: "preview";
  readonly status: "ready" | "failed" | "building" | "cancelled";
  readonly domain: string;
  readonly commitSha: string;
  readonly sourceReference: string;
  readonly asOf: string;
}

export interface DeploymentCandidatePreviewVerification {
  readonly status: "verified" | "failed";
  readonly dataMode: PreviewDataMode;
  readonly evidenceReference: string;
  readonly asOf: string;
  readonly assertions: readonly string[];
  readonly productionFinanceAdjacentMetadata: "absent" | "present";
  readonly logs: "clean" | "contains-production-finance-metadata";
  readonly projectEvidence: "clean" | "contains-production-finance-metadata";
}

export interface DeploymentCandidateRollbackInformation {
  readonly deploymentId: string;
  readonly commitSha: string;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly reason: string;
}

export interface DeploymentCandidateBuildInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly workItemId: string;
  readonly requestedIntent: string;
  readonly productionBranch: string;
  readonly productionHeadSha: string;
  readonly taskBranch: DeploymentCandidateTaskBranch;
  readonly pullRequest: DeploymentCandidatePullRequest;
  readonly checks: readonly DeploymentCandidateCheck[];
  readonly preview: DeploymentCandidatePreview;
  readonly previewVerification: DeploymentCandidatePreviewVerification;
  readonly rollback: DeploymentCandidateRollbackInformation;
  /** Change classes that must be separately planned and approved at promotion. */
  readonly additionalChangeScopes?: readonly DeploymentCandidateAdditionalChangeScope[];
  readonly remainingRisks: readonly string[];
  readonly now: string;
}

export interface DeploymentCandidateOutcomeReport {
  readonly id: string;
  readonly workItemId: string;
  readonly requestedIntent: string;
  readonly completedEffect: {
    readonly kind: "verified-preview";
    readonly value: string;
  };
  readonly evidence: readonly {
    readonly kind: "check" | "pull-request" | "preview-deployment" | "preview-verification" | "rollback";
    readonly reference: string;
    readonly asOf: string;
  }[];
  readonly verification: {
    readonly status: "verified";
    readonly evidenceReference: string;
    readonly dataMode: PreviewDataMode;
    readonly asOf: string;
  };
  readonly remainingRisks: readonly string[];
  readonly requiredDecisions: readonly ["CEO Approval of exact commit before merge or production promotion."];
  readonly createdAt: string;
}

export interface DeploymentCandidate {
  readonly id: string;
  readonly state: "review-ready";
  readonly projectId: string;
  readonly projectName: string;
  readonly workItemId: string;
  readonly exactCommitSha: string;
  readonly productionBranch: string;
  readonly taskBranch: DeploymentCandidateTaskBranch;
  readonly pullRequest: DeploymentCandidatePullRequest;
  readonly checks: readonly DeploymentCandidateCheck[];
  readonly preview: DeploymentCandidatePreview;
  readonly previewVerification: DeploymentCandidatePreviewVerification;
  readonly rollback: DeploymentCandidateRollbackInformation;
  readonly additionalChangeScopes: readonly DeploymentCandidateAdditionalChangeScope[];
  readonly outcomeReport: DeploymentCandidateOutcomeReport;
  readonly createdAt: string;
}

export type DeploymentCandidateBuildResult =
  | { readonly kind: "candidate"; readonly candidate: DeploymentCandidate }
  | { readonly kind: "rejected"; readonly reasons: readonly string[] };

export interface DeploymentCandidateStore {
  save(candidate: DeploymentCandidate): DeploymentCandidate;
  candidate(id: string): DeploymentCandidate | undefined;
  candidates(workItemId?: string): readonly DeploymentCandidate[];
  close(): void;
}

/** Derive the sidecar path without turning SQLite's in-memory sentinel into a filename. */
export function deploymentCandidateStatePath(statePath: string): string {
  return statePath === ":memory:"
    ? ":memory:"
    : `${statePath}.deployment-candidates.sqlite`;
}

function immutableCandidateJson(candidate: DeploymentCandidate): string {
  const { createdAt: _candidateCreatedAt, outcomeReport, ...candidateArtifact } = candidate;
  const { createdAt: _reportCreatedAt, ...outcomeReportArtifact } = outcomeReport;
  return JSON.stringify({
    ...candidateArtifact,
    outcomeReport: outcomeReportArtifact,
  });
}

function parseDeploymentCandidate(serialized: string): DeploymentCandidate {
  const candidate = JSON.parse(serialized) as DeploymentCandidate;
  // Candidates persisted by RM-27 do not carry RM-28's optional scope list.
  return { ...candidate, additionalChangeScopes: candidate.additionalChangeScopes ?? [] };
}

/** Durable, append-only local record of review-ready candidates. */
export class SqliteDeploymentCandidateStore implements DeploymentCandidateStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS deployment_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        exact_commit_sha TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS deployment_candidates_reject_update
      BEFORE UPDATE ON deployment_candidates BEGIN
        SELECT RAISE(ABORT, 'deployment_candidates are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS deployment_candidates_reject_delete
      BEFORE DELETE ON deployment_candidates BEGIN
        SELECT RAISE(ABORT, 'deployment_candidates are append-only');
      END;
    `);
  }

  save(candidate: DeploymentCandidate): DeploymentCandidate {
    const serialized = JSON.stringify(candidate);
    const existing = this.#database
      .prepare("SELECT candidate_json FROM deployment_candidates WHERE id = ?")
      .get(candidate.id) as unknown as { candidate_json: string } | undefined;
    if (existing !== undefined) {
      const existingCandidate = parseDeploymentCandidate(existing.candidate_json);
      if (immutableCandidateJson(existingCandidate) !== immutableCandidateJson(candidate)) {
        throw new Error("Deployment Candidate identity collision.");
      }
      return parseDeploymentCandidate(existing.candidate_json);
    }
    this.#database
      .prepare(`INSERT INTO deployment_candidates (id, project_id, work_item_id, exact_commit_sha, candidate_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(candidate.id, candidate.projectId, candidate.workItemId, candidate.exactCommitSha, serialized, candidate.createdAt);
    return candidate;
  }

  candidate(id: string): DeploymentCandidate | undefined {
    const row = this.#database
      .prepare("SELECT candidate_json FROM deployment_candidates WHERE id = ?")
      .get(id) as unknown as { candidate_json: string } | undefined;
    return row === undefined ? undefined : parseDeploymentCandidate(row.candidate_json);
  }

  candidates(workItemId?: string): readonly DeploymentCandidate[] {
    const rows = workItemId === undefined
      ? this.#database.prepare("SELECT candidate_json FROM deployment_candidates ORDER BY created_at, id").all()
      : this.#database.prepare("SELECT candidate_json FROM deployment_candidates WHERE work_item_id = ? ORDER BY created_at, id").all(workItemId);
    return (rows as unknown as { candidate_json: string }[]).map((row) => parseDeploymentCandidate(row.candidate_json));
  }

  close(): void {
    this.#database.close();
  }
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function rejected(reasons: string[]): DeploymentCandidateBuildResult {
  return { kind: "rejected", reasons: [...new Set(reasons)] };
}

/**
 * Builds the review artifact for the DuitSini tracer. This is deliberately a
 * pure gate: it creates no branch, PR, preview, merge, deployment, or
 * production-data effect. A later ticket may consume the exact candidate id
 * for an artifact-bound CEO Approval.
 */
export function buildDeploymentCandidate(
  input: DeploymentCandidateBuildInput,
): DeploymentCandidateBuildResult {
  const reasons: string[] = [];
  const requiredNames = new Set<DeploymentCandidateCheckName>(deploymentCandidateCheckNames);
  const suppliedNames = new Set(input.checks.map((check) => check.name));

  for (const field of [
    input.projectId,
    input.projectName,
    input.workItemId,
    input.requestedIntent,
    input.productionBranch,
    input.productionHeadSha,
    input.taskBranch.name,
    input.taskBranch.baseBranch,
    input.taskBranch.baseCommitSha,
    input.taskBranch.headSha,
    input.taskBranch.sourceReference,
    input.pullRequest.sourceReference,
    input.preview.deploymentId,
    input.preview.domain,
    input.preview.commitSha,
    input.preview.sourceReference,
    input.previewVerification.evidenceReference,
    input.rollback.deploymentId,
    input.rollback.commitSha,
    input.rollback.sourceReference,
    input.rollback.reason,
  ]) {
    if (!nonEmpty(field)) reasons.push("required deployment candidate identity is missing");
  }
  if (!validTimestamp(input.now)) reasons.push("candidate evaluation time is invalid");
  if (!validTimestamp(input.taskBranch.synchronizedAt)) reasons.push("task branch synchronization time is invalid");
  if (!validTimestamp(input.pullRequest.asOf)) reasons.push("pull request as-of time is invalid");
  if (!validTimestamp(input.preview.asOf)) reasons.push("preview as-of time is invalid");
  if (!validTimestamp(input.previewVerification.asOf)) reasons.push("preview verification as-of time is invalid");
  if (!validTimestamp(input.rollback.asOf)) reasons.push("rollback as-of time is invalid");

  const evidenceTimes = [
    ["task branch synchronization", input.taskBranch.synchronizedAt],
    ["pull request", input.pullRequest.asOf],
    ["preview deployment", input.preview.asOf],
    ["preview verification", input.previewVerification.asOf],
    ...input.checks.map((check) => [`check ${check.name}`, check.completedAt] as const),
  ] as const;
  for (const [label, timestamp] of evidenceTimes) {
    const age = Date.parse(input.now) - Date.parse(timestamp);
    if (age < 0) reasons.push(`${label} evidence cannot be from the future`);
    if (label.startsWith("check ") && age > providerStalenessThresholdMs) reasons.push(`${label} evidence is stale`);
  }

  if (input.taskBranch.name === input.productionBranch) reasons.push("task branch must differ from the production branch");
  if (input.taskBranch.baseBranch !== input.productionBranch) reasons.push("task branch is not based on the production branch");
  if (input.taskBranch.baseCommitSha !== input.productionHeadSha) reasons.push("production branch was not synchronized before task work");
  if (input.pullRequest.draft !== true) reasons.push("pull request must remain a draft before CEO review");
  if (input.pullRequest.baseBranch !== input.productionBranch) reasons.push("pull request targets a different base branch");
  if (input.pullRequest.baseCommitSha !== input.productionHeadSha) reasons.push("pull request base commit is not the synchronized production head");
  if (input.pullRequest.headSha !== input.taskBranch.headSha) reasons.push("pull request head does not match the task branch");
  if (input.preview.environment !== "preview") reasons.push("candidate preview must use the preview environment");
  if (input.preview.status !== "ready") reasons.push("candidate preview is not ready");
  if (input.preview.commitSha !== input.taskBranch.headSha) reasons.push("preview commit does not match the task branch and pull request");
  if (Date.parse(input.now) - Date.parse(input.preview.asOf) > providerStalenessThresholdMs) reasons.push("preview deployment is stale");

  for (const name of requiredNames) {
    if (!suppliedNames.has(name)) reasons.push(`required check is missing: ${name}`);
  }
  if (suppliedNames.size !== input.checks.length) reasons.push("deployment candidate checks must have unique names");
  for (const check of input.checks) {
    if (check.status !== "passed") reasons.push(`required check did not pass: ${check.name}`);
    if (check.commitSha !== input.taskBranch.headSha) reasons.push(`check commit does not match the candidate: ${check.name}`);
    if (!nonEmpty(check.evidenceReference) || !validTimestamp(check.completedAt)) reasons.push(`check evidence is incomplete: ${check.name}`);
  }

  if (input.previewVerification.status !== "verified") reasons.push("preview verification did not pass");
  if (input.previewVerification.assertions.length === 0) reasons.push("preview verification has no acceptance assertions");
  if (input.previewVerification.productionFinanceAdjacentMetadata !== "absent") reasons.push("preview contains production finance-adjacent metadata");
  if (input.previewVerification.logs !== "clean") reasons.push("preview logs contain production finance-adjacent metadata");
  if (input.previewVerification.projectEvidence !== "clean") reasons.push("Project Evidence contains production finance-adjacent metadata");
  if (Date.parse(input.now) - Date.parse(input.previewVerification.asOf) > providerStalenessThresholdMs) reasons.push("preview verification evidence is stale");
  if (input.rollback.commitSha === input.taskBranch.headSha) reasons.push("rollback target must be a different exact commit");
  if (Date.parse(input.now) - Date.parse(input.rollback.asOf) < 0) reasons.push("rollback evidence cannot be from the future");
  const additionalChangeScopes = input.additionalChangeScopes ?? [];
  if (new Set(additionalChangeScopes).size !== additionalChangeScopes.length) reasons.push("deployment candidate additional change scopes must be unique");

  const serializedInput = JSON.stringify(input);
  if (detectSensitiveFields({ candidateEvidence: serializedInput }).length > 0) reasons.push("candidate evidence contains a Sensitive Secret");
  if (reasons.length > 0) return rejected(reasons);

  const { now: _now, ...artifact } = input;
  const candidateDigest = createHash("sha256").update(JSON.stringify(artifact), "utf8").digest("hex");
  const candidateId = `deployment-candidate:${candidateDigest}`;
  const evidence = [
    ...input.checks.map((check) => ({ kind: "check" as const, reference: check.evidenceReference, asOf: check.completedAt })),
    { kind: "pull-request" as const, reference: input.pullRequest.sourceReference, asOf: input.pullRequest.asOf },
    { kind: "preview-deployment" as const, reference: input.preview.sourceReference, asOf: input.preview.asOf },
    { kind: "preview-verification" as const, reference: input.previewVerification.evidenceReference, asOf: input.previewVerification.asOf },
    { kind: "rollback" as const, reference: input.rollback.sourceReference, asOf: input.rollback.asOf },
  ];
  const outcomeReport: DeploymentCandidateOutcomeReport = {
    id: `outcome-report:${candidateDigest}`,
    workItemId: input.workItemId,
    requestedIntent: input.requestedIntent,
    completedEffect: { kind: "verified-preview", value: `preview:${input.preview.deploymentId}@${input.preview.commitSha}` },
    evidence,
    verification: {
      status: "verified",
      evidenceReference: input.previewVerification.evidenceReference,
      dataMode: input.previewVerification.dataMode,
      asOf: input.previewVerification.asOf,
    },
    remainingRisks: [...input.remainingRisks],
    requiredDecisions: ["CEO Approval of exact commit before merge or production promotion."],
    createdAt: input.now,
  };
  return {
    kind: "candidate",
    candidate: {
      id: candidateId,
      state: "review-ready",
      projectId: input.projectId,
      projectName: input.projectName,
      workItemId: input.workItemId,
      exactCommitSha: input.taskBranch.headSha,
      productionBranch: input.productionBranch,
      taskBranch: input.taskBranch,
      pullRequest: input.pullRequest,
      checks: [...input.checks],
      preview: input.preview,
      previewVerification: input.previewVerification,
      rollback: input.rollback,
      additionalChangeScopes,
      outcomeReport,
      createdAt: input.now,
    },
  };
}
