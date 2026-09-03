import { createHash } from "node:crypto";

import type { OperationsGateway } from "./operations-gateway.js";
import type { OperationsState } from "./operations-state.js";
import type { WorkItem } from "./contracts.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import { detectSensitiveFields } from "./sensitive-secret.js";
import type {
  CanvasAdapter,
  CanvasCourseEvidence,
} from "../providers/canvas-adapter.js";
import type {
  AcademicDraft,
  Microsoft365Adapter,
} from "../providers/microsoft365-adapter.js";
import type {
  CalendarChange,
  CalendarReconciler,
} from "../calendar/calendar-reconciliation.js";

export const academicCoordinationEffectKind = "academic-coordination";

/**
 * Canvas and Microsoft 365 are read-only and read-and-draft respectively, so the
 * only thing this coordination ever completes is coordination. The effect value
 * says so in words, because the Outcome Report is where the CEO checks.
 */
export const noSubmissionProof =
  "Coordinated only: no assignment or examination was submitted.";

export interface AcademicCitedEvidence {
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly asOf: string;
}

/**
 * What the COO is allowed to see for portfolio coordination: that an academic
 * commitment exists and when. Never the mail body, the Teams message, or the
 * announcement text, which stay in the Academic Trust Domain.
 */
export interface AcademicCooProjection {
  readonly kind: "approved-projection";
  readonly executive: "COO";
  readonly workItemId: string;
  readonly workstream: "Academic";
  readonly commitment: string | null;
  readonly evidenceCount: number;
  readonly asOf: string;
}

export interface AcademicCoordinationRequest {
  readonly courseId: string;
  readonly intent: string;
  readonly commitment?: string;
  readonly draftReply?: {
    readonly to: readonly string[];
    readonly body: string;
  };
  readonly calendarEvent?: {
    readonly eventId: string;
    readonly start: string;
    readonly end: string;
  };
}

export type AcademicCoordinationResult =
  | {
      readonly kind: "coordinated";
      readonly workItem: WorkItem;
      readonly citedEvidence: readonly AcademicCitedEvidence[];
      readonly cooProjection: AcademicCooProjection;
      readonly draft: AcademicDraft | undefined;
      readonly calendar: CalendarChange | undefined;
      readonly calendarCommitment: string | null;
      readonly sentMail: false;
      readonly submittedAssignment: false;
    }
  | { readonly kind: "failed"; readonly failure: ProviderFailure }
  | {
      readonly kind: "stale-evidence";
      readonly sourceIdentity: string;
      readonly asOf: string;
    }
  | {
      readonly kind: "denied";
      readonly reason:
        | "submission-excluded"
        | "course-not-authorized"
        | "unbounded-academic-intent";
    };

export type AcademicSubmissionResult = {
  readonly kind: "denied";
  readonly reason: "submission-excluded";
};

export interface AcademicCoordinator {
  coordinate(
    request: AcademicCoordinationRequest,
  ): Promise<AcademicCoordinationResult>;
  attemptSubmission(request: {
    readonly courseId: string;
    readonly assignmentId: string;
  }): Promise<AcademicSubmissionResult>;
}

function citations(
  evidence: CanvasCourseEvidence,
  asOf: string,
): readonly AcademicCitedEvidence[] {
  return [
    ...evidence.files.map((file) => ({
      sourceIdentity: "canvas",
      sourceReference: file.sourceReference,
      asOf,
    })),
    ...evidence.announcements.map((announcement) => ({
      sourceIdentity: "canvas",
      sourceReference: announcement.sourceReference,
      asOf,
    })),
  ];
}

export function createAcademicCoordinator(options: {
  readonly canvas: CanvasAdapter;
  readonly microsoft365: Microsoft365Adapter;
  readonly gateway: OperationsGateway;
  readonly state: OperationsState;
  readonly courseId: string;
  readonly mailbox: string;
  readonly teamsChannel: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly calendar?: CalendarReconciler;
  readonly calendarId?: string;
}): AcademicCoordinator {
  return {
    async attemptSubmission(): Promise<AcademicSubmissionResult> {
      // Refused before the adapter is touched. Canvas never learns that a
      // submission was contemplated, which is the point of excluding it.
      return { kind: "denied", reason: "submission-excluded" };
    },

    async coordinate(request): Promise<AcademicCoordinationResult> {
      if (request.courseId !== options.courseId) {
        return { kind: "denied", reason: "course-not-authorized" };
      }
      // Caller text reaches the Work Item intent, the commitment, and the COO
      // projection. Bounding it here is what keeps a pasted mail body or a
      // credential out of all three.
      const intent = request.intent.replace(/\s+/gu, " ").trim();
      if (
        intent.length === 0 ||
        intent.length > 240 ||
        detectSensitiveFields({ intent }).length > 0
      ) {
        return { kind: "denied", reason: "unbounded-academic-intent" };
      }
      if (
        request.commitment !== undefined &&
        (request.commitment.length > 64 ||
          detectSensitiveFields({ commitment: request.commitment }).length > 0)
      ) {
        return { kind: "denied", reason: "unbounded-academic-intent" };
      }
      if (
        request.draftReply !== undefined &&
        detectSensitiveFields({ body: request.draftReply.body }).length > 0
      ) {
        return { kind: "denied", reason: "unbounded-academic-intent" };
      }

      const course = await options.canvas.readCourse({
        courseId: request.courseId,
      });
      if (course.kind === "failed") {
        return { kind: "failed", failure: course.failure };
      }
      // Stale course evidence is its own answer. Coordinating a deadline from
      // a course read that may be a day old is worse than saying so.
      if (course.kind === "stale") {
        return {
          kind: "stale-evidence",
          sourceIdentity: course.provenance.sourceIdentity,
          asOf: course.provenance.asOf,
        };
      }
      const mail = await options.microsoft365.readAcademicMail({
        mailbox: options.mailbox,
      });
      if (mail.kind === "failed") {
        return { kind: "failed", failure: mail.failure };
      }
      if (mail.kind === "stale") {
        return {
          kind: "stale-evidence",
          sourceIdentity: mail.provenance.sourceIdentity,
          asOf: mail.provenance.asOf,
        };
      }
      const teams = await options.microsoft365.readTeamsMessages({
        channel: options.teamsChannel,
      });
      if (teams.kind === "failed") {
        return { kind: "failed", failure: teams.failure };
      }
      if (teams.kind === "stale") {
        return {
          kind: "stale-evidence",
          sourceIdentity: teams.provenance.sourceIdentity,
          asOf: teams.provenance.asOf,
        };
      }

      const citedEvidence = citations(course.value, course.provenance.asOf);

      // The Work Item's identity carries the Canvas evidence it acted on, so
      // the Outcome Report's effect reference cites the source without the
      // coordinator having to thread it separately. It is also what makes a
      // replay land on the same Work Item.
      const commitmentDigest = createHash("sha256")
        .update(`${request.intent}|${request.commitment ?? ""}`)
        .digest("hex")
        .slice(0, 16);
      const idempotencyKey = `academic-coordination:canvas:${request.courseId}:${commitmentDigest}`;

      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey,
        intent,
        expectedEffect: {
          kind: academicCoordinationEffectKind,
          value: `${noSubmissionProof} Evidence: ${citedEvidence
            .map((cited) => cited.sourceReference)
            .join(", ")}.`,
        },
        workstream: "Academic",
      });
      let workItem = acknowledgement.workItem;

      let draft: AcademicDraft | undefined;
      if (request.draftReply !== undefined) {
        const drafted = await options.microsoft365.createDraft({
          mailbox: options.mailbox,
          to: request.draftReply.to,
          subject: request.intent,
          body: request.draftReply.body,
          idempotencyKey: `${idempotencyKey}:draft`,
        });
        if (drafted.kind === "failed") {
          return { kind: "failed", failure: drafted.failure };
        }
        draft = drafted.draft;
      }

      // The date came from the university, not from Ming, so it is recorded as
      // Externally Sourced and stays a proposal until he confirms it.
      let calendarCommitment: string | null = null;
      if (request.commitment !== undefined) {
        workItem = await options.gateway.recordWorkItemCommitment({
          workItemId: workItem.id,
          value: request.commitment,
          actor: {
            kind: "External Source",
            sourceIdentity: "canvas",
            sourceReference: course.provenance.sourceReference,
            asOf: course.provenance.asOf,
          },
        });
        calendarCommitment = request.commitment;
      }

      // The university moved the deadline, but moving Ming's calendar is a
      // write. It clears the Approval branch like any other, reusing the
      // reconciler rather than a second calendar path.
      let calendar: CalendarChange | undefined;
      if (
        request.calendarEvent !== undefined &&
        options.calendar !== undefined &&
        options.calendarId !== undefined
      ) {
        calendar = await options.calendar.change({
          workItemId: workItem.id,
          calendarId: options.calendarId,
          eventId: request.calendarEvent.eventId,
          start: request.calendarEvent.start,
          end: request.calendarEvent.end,
        });
        if (calendar.kind === "failed") {
          return { kind: "failed", failure: calendar.failure };
        }
      }

      // A pending calendar Approval holds the whole coordination. Executing now
      // would produce an Outcome Report for work the CEO has not authorized.
      if (calendar?.kind !== "approval-required") {
        const executed = await options.gateway.executeWorkItem(workItem.id);
        workItem = executed.workItem;
      }

      return {
        kind: "coordinated",
        workItem,
        citedEvidence,
        cooProjection: {
          kind: "approved-projection",
          executive: "COO",
          workItemId: workItem.id,
          workstream: "Academic",
          commitment: calendarCommitment,
          evidenceCount: citedEvidence.length,
          asOf: course.provenance.asOf,
        },
        draft,
        calendar,
        calendarCommitment,
        sentMail: false,
        submittedAssignment: false,
      };
    },
  };
}
