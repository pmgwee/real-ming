import { createHash } from "node:crypto";

import { isCeoActor } from "../operations/actor-identity.js";
import type { AuditEvent, ExecutiveRole } from "../operations/contracts.js";
import {
  detectPersonalContextSensitiveContent,
  type PersonalContextCandidate,
  type PersonalContextIngestion,
  type PersonalContextRead,
} from "./personal-context-ingestion.js";

export const maxPersonalContextProjectionChars = 2_000;

export interface PersonalContextProjectionRequest {
  readonly candidateId: string;
  readonly workItemId: string;
  readonly executive: ExecutiveRole;
  readonly purpose: string;
}

export interface PersonalContextProjection {
  readonly kind: "approved-projection";
  readonly id: string;
  readonly candidateId: string;
  readonly workItemId: string;
  readonly executive: ExecutiveRole;
  readonly purpose: string;
  readonly trustDomain: PersonalContextCandidate["trustDomain"];
  readonly sourceSystem: PersonalContextCandidate["sourceSystem"];
  readonly sourceReference: string;
  readonly contentHash: string;
  readonly asOf: string;
  readonly freshness: PersonalContextCandidate["freshness"];
  readonly staleLabel: string | null;
  readonly text: string;
  readonly createdAt: string;
}

export interface PersonalContextDrillDownRequest {
  readonly candidateId: string;
  readonly workItemId: string;
  readonly actorId: string;
  readonly purpose: string;
}

export interface PersonalContextProjectionBroker {
  serve(request: PersonalContextProjectionRequest): PersonalContextProjection;
  drillDown(request: PersonalContextDrillDownRequest): string;
}

function projectionId(request: PersonalContextProjectionRequest, candidate: PersonalContextCandidate): string {
  return `projection:${createHash("sha256")
    .update(
      `${candidate.id}:${request.workItemId}:${request.executive}:${request.purpose}`,
      "utf8",
    )
    .digest("hex")}`;
}

function assertScopedRequest(
  request: Pick<PersonalContextProjectionRequest, "candidateId" | "workItemId" | "purpose">,
): void {
  if (request.candidateId.trim().length === 0) {
    throw new Error("A Personal Context projection requires a Candidate Envelope.");
  }
  if (request.workItemId.trim().length === 0) {
    throw new Error("A Personal Context projection requires a Work Item scope.");
  }
  if (request.purpose.trim().length === 0) {
    throw new Error("A Personal Context projection requires a purpose.");
  }
  if (detectPersonalContextSensitiveContent(request.purpose).length > 0) {
    throw new Error("Personal Context projection purpose contains a Sensitive Secret.");
  }
}

function boundedProjectionText(content: string): string {
  const normalized = content.trim();
  return normalized.length <= maxPersonalContextProjectionChars
    ? normalized
    : `${normalized.slice(0, maxPersonalContextProjectionChars - 1)}…`;
}

function auditDetails(
  candidate: PersonalContextCandidate,
  request: Pick<PersonalContextProjectionRequest, "candidateId" | "workItemId" | "executive" | "purpose">,
): Record<string, unknown> {
  return {
    candidateId: request.candidateId,
    workItemId: request.workItemId,
    executive: request.executive,
    purpose: request.purpose.trim().slice(0, 200),
    trustDomain: candidate.trustDomain,
    sourceSystem: candidate.sourceSystem,
    sourceReference: candidate.sourceReference,
    contentHash: candidate.contentHash,
    asOf: candidate.asOf,
    freshness: candidate.freshness,
    staleLabel: candidate.staleLabel,
  };
}

export function createPersonalContextProjectionBroker(options: {
  readonly ingestion: PersonalContextIngestion;
  readonly now?: () => string;
  readonly recordAudit: (
    workItemId: string,
    type: AuditEvent["type"],
    occurredAt: string,
    details: Readonly<Record<string, unknown>>,
  ) => void;
}): PersonalContextProjectionBroker {
  const now = options.now ?? (() => new Date().toISOString());

  const readCandidate = (
    candidateId: string,
    executive: ExecutiveRole,
  ): PersonalContextRead => options.ingestion.read(candidateId, executive);

  return {
    serve(request): PersonalContextProjection {
      assertScopedRequest(request);
      const read = readCandidate(request.candidateId, request.executive);
      const projection: PersonalContextProjection = {
        kind: "approved-projection",
        id: projectionId(request, read.candidate),
        candidateId: read.candidate.id,
        workItemId: request.workItemId,
        executive: request.executive,
        purpose: request.purpose.trim(),
        trustDomain: read.candidate.trustDomain,
        sourceSystem: read.candidate.sourceSystem,
        sourceReference: read.candidate.sourceReference,
        contentHash: read.candidate.contentHash,
        asOf: read.candidate.asOf,
        freshness: read.candidate.freshness,
        staleLabel: read.candidate.staleLabel,
        text: boundedProjectionText(read.content),
        createdAt: now(),
      };
      options.recordAudit(
        request.workItemId,
        "personal-context.projection-served",
        projection.createdAt,
        auditDetails(read.candidate, request),
      );
      return projection;
    },

    drillDown(request): string {
      assertScopedRequest(request);
      if (!isCeoActor(request.actorId)) {
        throw new Error("Only the CEO may request a Personal Context drill-down.");
      }
      const candidate = options.ingestion
        .candidates()
        .find((item) => item.id === request.candidateId);
      if (candidate === undefined) {
        throw new Error(`Personal Context Candidate ${request.candidateId} was not found.`);
      }
      const executive = candidate.allowedRoles[0];
      if (executive === undefined) {
        throw new Error("The Personal Context Candidate has no readable role.");
      }
      const read = readCandidate(candidate.id, executive);
      const occurredAt = now();
      options.recordAudit(
        request.workItemId,
        "personal-context.raw-drilldown",
        occurredAt,
        {
          ...auditDetails(candidate, {
            candidateId: candidate.id,
            workItemId: request.workItemId,
            executive,
            purpose: request.purpose,
          }),
          actorId: request.actorId,
        },
      );
      return read.content;
    },
  };
}
