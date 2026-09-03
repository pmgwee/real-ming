import { createHash } from "node:crypto";

import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import { isCeoActor } from "../operations/actor-identity.js";
import type { ExecutiveRole, TrustDomain } from "../operations/contracts.js";
import type { OperationsState } from "../operations/operations-state.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";

export interface AgentBrainEvidenceReadRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly evidenceIdentity: string;
  readonly purpose: string;
}

export type AgentBrainEvidenceReadResult =
  | {
      readonly kind: "ok" | "stale";
      readonly sourceIdentity: string;
      readonly canonicalEvidenceId: string;
      readonly sourceReference: string;
      readonly content: string;
      readonly citations: readonly string[];
      readonly asOf: string;
      readonly retrievedAt: string;
      readonly freshness: "current" | "stale";
    }
  | {
      readonly kind: "failed";
      readonly reason:
        | "provider-unavailable"
        | "authentication-failed"
        | "permission-denied"
        | "invalid-input";
    };

/**
 * The only capability Real-Ming receives from Agent Brain: a read operation.
 * There is deliberately no write method, so generated Markdown and the Agent
 * Brain SQLite ledger remain read-only to this system.
 */
export interface AgentBrainEvidenceProvider {
  read(request: AgentBrainEvidenceReadRequest): Promise<AgentBrainEvidenceReadResult>;
}

export interface ProjectEvidenceRequest {
  readonly workspaceId: string;
  readonly executive: ExecutiveRole;
  readonly workItemId: string;
  readonly purpose: string;
  readonly portfolioProjectId: string;
}

export interface ProjectEvidenceBindingRequest {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly workItemId: string;
  readonly portfolioProjectId: string;
}

export interface CitedProjectEvidence {
  readonly sourceIdentity: string;
  readonly canonicalEvidenceId: string;
  readonly sourceReference: string;
  readonly content: string;
  readonly citations: readonly string[];
  readonly asOf: string;
  readonly retrievedAt: string;
  readonly freshness: "current" | "stale";
}

/**
 * A broker-produced input to the Knowledge Compiler.  This is deliberately
 * not Compiled Knowledge: the bounded snapshot remains attributed to Agent
 * Brain and can only be promoted by the normal compiler policy.
 */
export interface CandidateEnvelope {
  readonly id: string;
  readonly sourceSystem: "agent-brain";
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly canonicalEvidenceId: string;
  readonly capturedAt: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly trustDomain: TrustDomain;
  readonly sensitivity: "public" | "internal" | "sensitive";
  readonly allowedRoles: readonly ExecutiveRole[];
  readonly retentionClass: "project-evidence-30d";
  readonly mode: "snapshot";
  readonly content: string;
  readonly citations: readonly string[];
  readonly freshness: "current" | "stale";
}

export type ProjectEvidenceCandidateResult =
  | { readonly kind: "candidate-envelope"; readonly candidate: CandidateEnvelope }
  | { readonly kind: "stale"; readonly candidate: CandidateEnvelope }
  | Exclude<ProjectEvidenceResult, { readonly kind: "served" } | { readonly kind: "stale" }>;

export type ProjectEvidenceResult =
  | { readonly kind: "served"; readonly evidence: CitedProjectEvidence }
  | { readonly kind: "stale"; readonly evidence: CitedProjectEvidence }
  | { readonly kind: "unavailable"; readonly reason: "provider-unavailable" }
  | { readonly kind: "rejected"; readonly reason: "uncited" | "invalid-evidence" }
  | { readonly kind: "denied"; readonly reason: "not-authorized" };

function denied(): ProjectEvidenceResult {
  return { kind: "denied", reason: "not-authorized" };
}

function hasPurpose(value: string): boolean {
  return value.trim().length > 0 && detectSensitiveFields({ purpose: value }).length === 0;
}

function evidenceShapeIsValid(
  result: Extract<AgentBrainEvidenceReadResult, { readonly kind: "ok" | "stale" }>,
): boolean {
  return (
    result.sourceIdentity.trim().length > 0 &&
    result.canonicalEvidenceId.trim().length > 0 &&
    result.sourceReference.trim().length > 0 &&
    result.content.trim().length > 0 &&
    result.content.length <= 64_000 &&
    result.citations.length > 0 &&
    result.citations.every((citation) => citation.trim().length > 0) &&
    result.citations.some(
      (citation) =>
        citation === result.sourceReference ||
        citation.includes(result.canonicalEvidenceId),
    ) &&
    ((result.kind === "stale") === (result.freshness === "stale")) &&
    Number.isFinite(Date.parse(result.asOf)) &&
    Number.isFinite(Date.parse(result.retrievedAt)) &&
    detectSensitiveFields({
      content: result.content,
      sourceIdentity: result.sourceIdentity,
      canonicalEvidenceId: result.canonicalEvidenceId,
      sourceReference: result.sourceReference,
      citations: JSON.stringify(result.citations),
    }).length === 0
  );
}

export interface ProjectEvidenceBroker {
  /** Bind a Work Item to one explicit Portfolio Project under CEO authority. */
  bind(request: ProjectEvidenceBindingRequest): void;
  serve(request: ProjectEvidenceRequest): Promise<ProjectEvidenceResult>;
  /** Read once and wrap the cited result as a compiler-ready Candidate Envelope. */
  captureCandidate(request: ProjectEvidenceRequest): Promise<ProjectEvidenceCandidateResult>;
}

/**
 * Role-, Work Item-, purpose-, and Portfolio Project-scoped read boundary for
 * Agent Brain. It never writes Agent Brain, direct project sources, or
 * generated Markdown, and it never includes raw provider failures in a
 * result or audit event.
 */
export function createProjectEvidenceBroker(options: {
  readonly state: OperationsState;
  readonly portfolio: ProjectPortfolio;
  readonly provider: AgentBrainEvidenceProvider;
  readonly now?: () => string;
  readonly recordAudit?: (
    workItemId: string,
    type:
      | "project-evidence.bound"
      | "project-evidence.served"
      | "project-evidence.candidate-captured",
    occurredAt: string,
    details: Readonly<Record<string, unknown>>,
  ) => void;
}): ProjectEvidenceBroker {
  const now = options.now ?? (() => new Date().toISOString());
  const recordAudit = options.recordAudit ?? (() => undefined);

  const authorizeBinding = (request: ProjectEvidenceBindingRequest): void => {
    const workItem = options.state.workItem(request.workItemId);
    if (
      !isCeoActor(request.actorId) ||
      workItem === undefined ||
      workItem.workspaceId !== request.workspaceId
    ) {
      throw new Error("Project evidence binding is not authorized.");
    }
    if (options.portfolio.project(request.portfolioProjectId) === undefined) {
      throw new Error("Portfolio Project was not found.");
    }
    const existing = options.portfolio.projectForWorkItem(request.workItemId);
    if (existing !== undefined && existing !== request.portfolioProjectId) {
      throw new Error("The Work Item is already bound to another Portfolio Project.");
    }
    options.portfolio.bindWorkItem(request.workItemId, request.portfolioProjectId);
    recordAudit(request.workItemId, "project-evidence.bound", now(), {
      actorId: request.actorId,
      portfolioProjectId: request.portfolioProjectId,
    });
  };

  const authorizeRequest = (request: ProjectEvidenceRequest) => {
    if (!hasPurpose(request.purpose)) return undefined;
    const workItem = options.state.workItem(request.workItemId);
    const project = options.portfolio.project(request.portfolioProjectId);
    if (
      workItem === undefined ||
      workItem.workspaceId !== request.workspaceId ||
      project === undefined ||
      options.portfolio.projectForWorkItem(request.workItemId) !== project.id ||
      project.evidenceIdentity === null ||
      !project.responsibleRoles.includes(request.executive) ||
      (workItem.accountableExecutive !== request.executive &&
        !workItem.collaboratingExecutives.some(
          (assignment) => assignment.executive === request.executive,
        ))
    ) {
      return undefined;
    }
    return { workItem, project };
  };

  const readAuthorized = async (
    request: ProjectEvidenceRequest,
  ): Promise<ProjectEvidenceResult> => {
    const authorized = authorizeRequest(request);
    if (authorized === undefined) return denied();
    const { project } = authorized;

    let result: AgentBrainEvidenceReadResult;
    try {
      result = await options.provider.read({
        workspaceId: request.workspaceId,
        projectId: project.id,
        evidenceIdentity: project.evidenceIdentity!,
        purpose: request.purpose.trim(),
      });
    } catch {
      return { kind: "unavailable", reason: "provider-unavailable" };
    }
    if (result.kind === "failed") {
      return { kind: "unavailable", reason: "provider-unavailable" };
    }
    if (
      result.sourceIdentity !== project.evidenceIdentity ||
      !evidenceShapeIsValid(result)
    ) {
      return { kind: "rejected", reason: result.citations.length === 0 ? "uncited" : "invalid-evidence" };
    }

    const evidence: CitedProjectEvidence = {
      sourceIdentity: result.sourceIdentity,
      canonicalEvidenceId: result.canonicalEvidenceId,
      sourceReference: result.sourceReference,
      content: result.content,
      citations: result.citations,
      asOf: result.asOf,
      retrievedAt: result.retrievedAt,
      freshness: result.freshness,
    };
    recordAudit(request.workItemId, "project-evidence.served", now(), {
      executive: request.executive,
      portfolioProjectId: project.id,
      canonicalEvidenceId: evidence.canonicalEvidenceId,
      sourceIdentity: evidence.sourceIdentity,
      freshness: evidence.freshness,
      citationCount: evidence.citations.length,
    });
    return result.kind === "stale" || result.freshness === "stale"
      ? { kind: "stale", evidence }
      : { kind: "served", evidence };
  };

  const envelopeFrom = (
    request: ProjectEvidenceRequest,
    evidence: CitedProjectEvidence,
  ): CandidateEnvelope => {
    const project = options.portfolio.project(request.portfolioProjectId);
    if (project === undefined) throw new Error("Portfolio Project was not found.");
    const capturedAt = now();
    const contentHash = `sha256:${createHash("sha256").update(evidence.content, "utf8").digest("hex")}`;
    const id = `candidate:${createHash("sha256").update(
      JSON.stringify({
        sourceIdentity: evidence.sourceIdentity,
        canonicalEvidenceId: evidence.canonicalEvidenceId,
        sourceReference: evidence.sourceReference,
        contentHash,
        asOf: evidence.asOf,
      }),
      "utf8",
    ).digest("hex")}`;
    return {
      id,
      sourceSystem: "agent-brain",
      sourceIdentity: evidence.sourceIdentity,
      sourceReference: evidence.sourceReference,
      canonicalEvidenceId: evidence.canonicalEvidenceId,
      capturedAt,
      asOf: evidence.asOf,
      contentHash,
      trustDomain: "Ming Creatives",
      sensitivity: project.sensitivity,
      allowedRoles: [...project.responsibleRoles],
      retentionClass: "project-evidence-30d",
      mode: "snapshot",
      content: evidence.content,
      citations: [...evidence.citations],
      freshness: evidence.freshness,
    };
  };

  return {
    bind: authorizeBinding,
    serve: readAuthorized,
    async captureCandidate(request): Promise<ProjectEvidenceCandidateResult> {
      const result = await readAuthorized(request);
      if (result.kind === "served") {
        const candidate = envelopeFrom(request, result.evidence);
        recordAudit(request.workItemId, "project-evidence.candidate-captured", now(), {
          executive: request.executive,
          portfolioProjectId: request.portfolioProjectId,
          candidateId: candidate.id,
          canonicalEvidenceId: candidate.canonicalEvidenceId,
          contentHash: candidate.contentHash,
        });
        return { kind: "candidate-envelope", candidate };
      }
      if (result.kind === "stale") {
        const candidate = envelopeFrom(request, result.evidence);
        recordAudit(request.workItemId, "project-evidence.candidate-captured", now(), {
          executive: request.executive,
          portfolioProjectId: request.portfolioProjectId,
          candidateId: candidate.id,
          canonicalEvidenceId: candidate.canonicalEvidenceId,
          contentHash: candidate.contentHash,
        });
        return { kind: "stale", candidate };
      }
      return result;
    },
  };
}
