import type {
  ConfirmedCommitment,
  RequestedAction,
  WorkItem,
} from "../operations/contracts.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import {
  calendarSourceReference,
  googleCalendarProvider,
  type CalendarEvent,
  type GoogleCalendarAdapter,
} from "../providers/google-calendar-adapter.js";
import { routeTrustDomain } from "../operations/executive-role-router.js";

export interface ReconcileCalendarCommitmentRequest {
  readonly workItemId: string;
  readonly calendarId: string;
  readonly eventId: string;
}

/**
 * Every outcome is named. An unavailable calendar, a calendar that simply has
 * no such event, and stale data are three different facts and must never be
 * collapsed into one healthy-looking empty result.
 */
export type CalendarReconciliation =
  | {
      readonly kind: "reconciled";
      readonly workItem: WorkItem;
      readonly event: CalendarEvent;
      readonly commitment: ConfirmedCommitment;
      /** False when the calendar already agreed and nothing was rewritten. */
      readonly changed: boolean;
    }
  | {
      readonly kind: "conflict";
      readonly event: CalendarEvent;
      readonly committedValue: string;
      readonly calendarValue: string;
      readonly reason: string;
    }
  | {
      readonly kind: "stale";
      readonly asOf: string;
      readonly retrievedAt: string;
      readonly reason: string;
    }
  | { readonly kind: "unavailable"; readonly failure: ProviderFailure }
  | { readonly kind: "event-missing"; readonly sourceReference: string };

export type CalendarChange =
  | {
      readonly kind: "written";
      readonly effectReference: string;
      readonly deduplicated: boolean;
    }
  | { readonly kind: "approval-required"; readonly approvalId: string }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface ChangeCalendarCommitmentRequest {
  readonly workItemId: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly start: string;
  readonly end: string;
}

export interface CalendarReconciler {
  reconcile(
    request: ReconcileCalendarCommitmentRequest,
  ): Promise<CalendarReconciliation>;
  change(request: ChangeCalendarCommitmentRequest): Promise<CalendarChange>;
}

function retrievedAtFor(result: { readonly provenance: { readonly asOf: string } }): string {
  return result.provenance.asOf;
}

export function createCalendarReconciler(options: {
  readonly adapter: GoogleCalendarAdapter;
  readonly state: OperationsState;
  readonly gateway: OperationsGateway;
}): CalendarReconciler {
  const requireWorkItem = (workItemId: string): WorkItem => {
    const workItem = options.state.workItem(workItemId);
    if (workItem === undefined) {
      throw new Error("The Work Item does not exist.");
    }
    return workItem;
  };

  return {
    async reconcile(request): Promise<CalendarReconciliation> {
      const workItem = requireWorkItem(request.workItemId);
      const sourceReference = calendarSourceReference(
        request.calendarId,
        request.eventId,
      );
      const read = await options.adapter.listEvents(request.calendarId);
      if (read.kind === "failed") {
        return { kind: "unavailable", failure: read.failure };
      }
      if (read.kind === "stale") {
        return {
          kind: "stale",
          asOf: read.provenance.asOf,
          retrievedAt: read.provenance.retrievedAt,
          reason:
            "The calendar answered with data older than the freshness threshold; it was not committed to.",
        };
      }
      const event = read.value.find((candidate) => candidate.id === request.eventId);
      if (event === undefined) {
        return { kind: "event-missing", sourceReference };
      }

      // A CEO-set date outranks the calendar. A disagreement is reported rather
      // than resolved in either direction; agreement is simply nothing to do,
      // and must not be pushed through as an External Source write, which the
      // Operations Gateway rejects for any CEO-set commitment.
      const confirmed = workItem.confirmedCommitment;
      if (confirmed !== null && confirmed.kind === "CEO-set") {
        return confirmed.value === event.start
          ? {
              kind: "reconciled",
              workItem,
              event,
              commitment: confirmed,
              changed: false,
            }
          : {
              kind: "conflict",
              event,
              committedValue: confirmed.value,
              calendarValue: event.start,
              reason:
                "The CEO set this date. The calendar disagrees and only the CEO may resolve it.",
            };
      }

      const updated = await options.gateway.recordWorkItemCommitment({
        workItemId: workItem.id,
        value: event.start,
        actor: {
          kind: "External Source",
          sourceIdentity: googleCalendarProvider,
          sourceReference,
          asOf: event.updatedAt,
        },
      });
      const commitment = updated.confirmedCommitment;
      if (commitment === null || commitment.kind !== "Externally Sourced") {
        throw new Error(
          "A reconciled calendar commitment must be Externally Sourced.",
        );
      }
      return {
        kind: "reconciled",
        workItem: updated,
        event,
        commitment,
        changed: true,
      };
    },

    async change(request): Promise<CalendarChange> {
      const workItem = requireWorkItem(request.workItemId);
      const sourceReference = calendarSourceReference(
        request.calendarId,
        request.eventId,
      );
      const action: RequestedAction = {
        workItemId: workItem.id,
        executive: workItem.accountableExecutive,
        trustDomain: routeTrustDomain(
          workItem.workstream,
          workItem.accountableExecutive,
        ),
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "external-communication",
        target: {
          type: "calendar-event",
          identity: sourceReference,
          version: `${request.start}/${request.end}`,
        },
      };
      const decision = await options.gateway.requestAction(action);
      if (decision.kind === "approval-required") {
        return { kind: "approval-required", approvalId: decision.approvalId };
      }
      if (decision.kind !== "permitted") {
        return { kind: "denied", reason: decision.kind };
      }

      // Keyed by the authorization, not only by the resulting time. A retry of
      // one approved change repeats the key and deduplicates; a separately
      // approved change back to a previously used time does not, so it is
      // performed instead of being silently swallowed as a replay.
      const occurrence =
        decision.basis === "approval" ? decision.approvalId : decision.basis;
      const result = await options.adapter.changeEventTime({
        calendarId: request.calendarId,
        eventId: request.eventId,
        start: request.start,
        end: request.end,
        idempotencyKey: `${sourceReference}:${occurrence}:${request.start}:${request.end}`,
      });
      if (result.kind === "failed") {
        return { kind: "failed", failure: result.failure };
      }

      // The Work Item must move with the change the CEO authorized. Leaving it
      // on the old time would make the next reconciliation report a conflict
      // against the CEO's own change.
      const approver =
        decision.basis === "approval"
          ? options.state.approval(decision.approvalId)?.actorId
          : undefined;
      await options.gateway.recordWorkItemCommitment({
        workItemId: workItem.id,
        value: request.start,
        actor:
          approver === undefined || approver === null
            ? {
                kind: "External Source",
                sourceIdentity: googleCalendarProvider,
                sourceReference,
                asOf: retrievedAtFor(result),
              }
            : { kind: "CEO", actorId: approver },
      });
      return {
        kind: "written",
        effectReference: result.effectReference,
        deduplicated: result.deduplicated,
      };
    },
  };
}
