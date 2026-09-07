import type { Approval, AuditEvent, WorkItem } from "./contracts.js";
import {
  dailyReadyOptions,
  digestBlocker,
  digestSection,
  readyOptionLabel,
} from "./daily-digest.js";
import type { OperationsState } from "./operations-state.js";
import {
  blockersFor,
  pendingApprovalsFor,
} from "../dashboard/dashboard-read-model.js";
import {
  dailyOccurrence,
  operatingDayOf,
  operatingDayWindow,
  operatingTimeZone,
  type DailyOccurrence,
} from "./daily-schedule.js";
import type { TelegramNotificationResult } from "../telegram/contracts.js";
import type {
  ExceptionNotice,
  ExceptionNoticeAdmission,
} from "./exception-notice-rhythm.js";
import { createHash } from "node:crypto";

import type {
  CalendarEvent,
  CalendarWindow,
} from "../providers/google-calendar-adapter.js";
import type { ProviderReadResult } from "../providers/adapter-contract.js";

/**
 * The brief runs at 07:30 in Ming's own timezone, which has no daylight saving.
 * The occurrence is named by the Kuala Lumpur calendar day so a retry, a late
 * run, or a run from a differently-configured host all resolve to one brief.
 */
export const morningBriefJob = "morning-brief";
const morningBriefHour = 7;
const morningBriefMinute = 30;

/** Kept as the name RM-13 published; the schedule itself is shared. */
export const morningBriefTimeZone = operatingTimeZone;

export type MorningBriefOccurrence = DailyOccurrence;

export function morningBriefOccurrence(now: string): MorningBriefOccurrence {
  return dailyOccurrence({
    now,
    hour: morningBriefHour,
    minute: morningBriefMinute,
    job: morningBriefJob,
  });
}

/** The Kuala Lumpur day, as an instant range the calendar can be asked for. */
export function morningBriefWindow(occurrenceDate: string): CalendarWindow {
  return operatingDayWindow(occurrenceDate);
}

function occurrenceDateOf(value: string): string | undefined {
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? undefined : operatingDayOf(instant);
}

export type BriefSourceName = "google-calendar" | "work-items";
/**
 * `empty` means the source answered and had nothing. It is deliberately a
 * different answer from `unavailable`, which means the source could not be
 * asked at all. Collapsing the two is how a broken calendar reads as a free day.
 */
export type BriefSourceHealth = "current" | "stale" | "unavailable" | "empty";

export interface BriefSourceStatus {
  readonly source: BriefSourceName;
  readonly health: BriefSourceHealth;
  readonly asOf: string | null;
  readonly detail: string;
}

export interface BriefEntry {
  readonly workItemId: string | null;
  readonly label: string;
  readonly evidence: string;
}

export interface MorningBrief {
  readonly occurrenceDate: string;
  readonly scheduledAt: string;
  readonly idempotencyKey: string;
  readonly sources: readonly BriefSourceStatus[];
  readonly scheduledCommitments: readonly BriefEntry[];
  readonly overdueOrBlocked: readonly BriefEntry[];
  readonly pendingApprovals: readonly BriefEntry[];
  readonly incidents: readonly BriefEntry[];
  readonly conflicts: readonly BriefEntry[];
  readonly proposedCommitments: readonly BriefEntry[];
  readonly readyOptions: readonly BriefEntry[];
  readonly workItemCount: number;
  readonly text: string;
}

const incidentEventTypes: readonly AuditEvent["type"][] = [
  "worker.effect-failed",
  "worker.effect-verification-failed",
  "work-item.transition-rejected",
  "work-item.commitment-rejected",
  "policy.denied",
];

const closedStates: readonly WorkItem["state"][] = ["Completed", "Cancelled"];

/** Only a calendar-backed Work Item may be joined to a calendar event. */
const calendarCommitmentEffect = "calendar-commitment";

export interface CalendarObservation {
  readonly health: BriefSourceHealth;
  readonly asOf: string | null;
  readonly events: readonly CalendarEvent[];
  readonly detail: string;
}

function observeCalendar(
  result: ProviderReadResult<readonly CalendarEvent[]>,
  occurrenceDate: string,
): CalendarObservation {
  if (result.kind === "failed") {
    return {
      health: "unavailable",
      asOf: null,
      events: [],
      detail: `Google Calendar is unavailable (${result.failure.class}). Today's schedule could not be read.`,
    };
  }
  if (result.kind === "stale") {
    return {
      health: "stale",
      asOf: result.provenance.asOf,
      events: result.value,
      detail: `Google Calendar data is stale as of ${result.provenance.asOf}. Treat the schedule below as possibly out of date.`,
    };
  }
  return result.value.length === 0
    ? {
        health: "empty",
        asOf: result.provenance.asOf,
        events: [],
        detail: `Google Calendar answered as of ${result.provenance.asOf} and holds no events for ${occurrenceDate}.`,
      }
    : {
        health: "current",
        asOf: result.provenance.asOf,
        events: result.value,
        detail: `Google Calendar is current as of ${result.provenance.asOf} for ${occurrenceDate}.`,
      };
}

/** Two timestamps for the same moment are agreement, whatever their format. */
function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isNaN(a) || Number.isNaN(b) ? left === right : a === b;
}

function entry(
  workItem: WorkItem,
  label: string,
  evidence: string,
): BriefEntry {
  return { workItemId: workItem.id, label, evidence };
}

export function buildMorningBrief(input: {
  readonly now: string;
  readonly workItems: readonly WorkItem[];
  readonly calendar: CalendarObservation;
  readonly approvals: (workItemId: string) => readonly Approval[];
  readonly auditTrail: (workItemId: string) => readonly AuditEvent[];
}): MorningBrief {
  const occurrence = morningBriefOccurrence(input.now);
  const eventsByReference = new Map(
    input.calendar.events.map((event) => [event.sourceReference, event]),
  );
  const claimedReferences = new Set<string>();

  const scheduledCommitments: BriefEntry[] = [];
  const overdueOrBlocked: BriefEntry[] = [];
  const pendingApprovals: BriefEntry[] = [];
  const incidents: BriefEntry[] = [];
  const conflicts: BriefEntry[] = [];
  const proposedCommitments: BriefEntry[] = [];

  for (const workItem of input.workItems) {
    const reference = workItem.expectedEffect.value;
    const event =
      workItem.expectedEffect.kind === calendarCommitmentEffect
        ? eventsByReference.get(reference)
        : undefined;
    const confirmed = workItem.confirmedCommitment;
    const trail = input.auditTrail(workItem.id);
    const approvals = input.approvals(workItem.id);
    let overdue: string | undefined;

    // Any Work Item naming the event claims it, confirmed or not. Otherwise a
    // proposal-only item makes the brief report its own event as unclaimed.
    if (event !== undefined) claimedReferences.add(reference);

    if (confirmed !== null) {
      const commitmentDate = occurrenceDateOf(confirmed.value);
      if (commitmentDate === undefined) {
        // Silently dropping the row would under-report in the one artifact
        // whose whole job is not to.
        incidents.push(
          entry(
            workItem,
            `Commitment date is unreadable ("${confirmed.value}") — ${workItem.intent}`,
            reference,
          ),
        );
      }
      // Any confirmed date that disagrees with its calendar event is a
      // conflict. A CEO-set one only you can resolve; an externally sourced one
      // means the calendar moved underneath it.
      if (event !== undefined && !sameInstant(confirmed.value, event.start)) {
        conflicts.push(
          entry(
            workItem,
            confirmed.kind === "CEO-set"
              ? `${workItem.intent}: you set ${confirmed.value}, the calendar says ${event.start}`
              : `${workItem.intent}: recorded as ${confirmed.value}, the calendar now says ${event.start}`,
            reference,
          ),
        );
      } else if (commitmentDate === occurrence.occurrenceDate) {
        scheduledCommitments.push(
          entry(
            workItem,
            `${confirmed.value} — ${workItem.intent} (${confirmed.kind})`,
            reference,
          ),
        );
      }
      if (
        commitmentDate !== undefined &&
        commitmentDate < occurrence.occurrenceDate &&
        !closedStates.includes(workItem.state)
      ) {
        overdue = `Overdue since ${confirmed.value}`;
      }
    }

    if (workItem.proposedCommitment !== null) {
      proposedCommitments.push(
        entry(
          workItem,
          `Proposed ${workItem.proposedCommitment.value} by ${workItem.proposedCommitment.provenance.proposedBy} — ${workItem.intent} (not confirmed)`,
          reference,
        ),
      );
    }

    const blockers = blockersFor(workItem, approvals, trail);
    if (overdue !== undefined || blockers.length > 0) {
      overdueOrBlocked.push(
        entry(
          workItem,
          `${workItem.intent} — ${[overdue, ...blockers.map(digestBlocker)]
            .filter(Boolean)
            .join("; ")}`,
          reference,
        ),
      );
    }

    for (const approval of pendingApprovalsFor(approvals)) {
      pendingApprovals.push(
        entry(
          workItem,
          `Awaiting your ${approval.scope} Approval — ${workItem.intent}`,
          approval.id,
        ),
      );
    }

    for (const auditEvent of trail) {
      // Today's exceptions only. Replaying the whole audit trail every morning
      // would grow this Telegram message without bound.
      if (
        incidentEventTypes.includes(auditEvent.type) &&
        occurrenceDateOf(auditEvent.occurredAt) === occurrence.occurrenceDate
      ) {
        incidents.push(
          entry(
            workItem,
            `${auditEvent.type} at ${auditEvent.occurredAt} — ${workItem.intent}`,
            `audit:${workItem.id}:${auditEvent.sequence}`,
          ),
        );
      }
    }
  }

  // A calendar event nobody committed to is a missing commitment, not silence.
  for (const event of input.calendar.events) {
    if (claimedReferences.has(event.sourceReference)) continue;
    if (occurrenceDateOf(event.start) !== occurrence.occurrenceDate) continue;
    scheduledCommitments.push({
      workItemId: null,
      label: `${event.start} — ${event.title} (no Work Item)`,
      evidence: event.sourceReference,
    });
  }

  // Work Items are read from the canonical local record, so this is always
  // answerable. The health of the Notion Master Tasks projection is integration
  // monitoring, not something this brief can honestly claim.
  const workItems: BriefSourceStatus = {
    source: "work-items",
    health: input.workItems.length === 0 ? "empty" : "current",
    asOf: input.now,
    detail:
      input.workItems.length === 0
        ? "The canonical Work Item record answered and holds none."
        : `The canonical Work Item record is current as of ${input.now}.`,
  };
  const sources: readonly BriefSourceStatus[] = [
    {
      source: "google-calendar",
      health: input.calendar.health,
      asOf: input.calendar.asOf,
      detail: input.calendar.detail,
    },
    workItems,
  ];

  const brief: Omit<MorningBrief, "text"> = {
    ...occurrence,
    sources,
    scheduledCommitments,
    overdueOrBlocked,
    pendingApprovals,
    incidents,
    conflicts,
    proposedCommitments,
    readyOptions: dailyReadyOptions(input.workItems).map((item) =>
      entry(item, readyOptionLabel(item), item.id),
    ),
    workItemCount: input.workItems.length,
  };
  return { ...brief, text: renderMorningBrief(brief) };
}

/**
 * A section backed by a source that could not be read is `unknown`, never
 * `none`. "Scheduled today: none" is indistinguishable from a genuinely clear
 * day, which is exactly the mistake this brief exists to avoid.
 */
function section(
  title: string,
  entries: readonly BriefEntry[],
  unknownBecause?: string,
): string {
  if (entries.length === 0) {
    return unknownBecause === undefined
      ? `${title}: none.`
      : `${title}: unknown — ${unknownBecause}`;
  }
  const heading =
    unknownBecause === undefined
      ? `${title}:`
      : `${title} (incomplete — ${unknownBecause}):`;
  return digestSection(heading.replace(/:$/u, ""), entries);
}

function renderMorningBrief(brief: Omit<MorningBrief, "text">): string {
  const degraded = brief.sources.filter(
    (source) => source.health === "stale" || source.health === "unavailable",
  );
  const calendar = brief.sources.find(
    (source) => source.source === "google-calendar",
  );
  // Scheduled commitments and conflicts both need the calendar. Without it,
  // neither may be reported as empty.
  const calendarUnread =
    calendar === undefined || calendar.health === "unavailable"
      ? "Google Calendar could not be read."
      : calendar.health === "stale"
        ? "Google Calendar data is stale."
        : undefined;
  return [
    `Morning Brief — ${brief.occurrenceDate} (07:30 ${morningBriefTimeZone})`,
    `**Focus for today**\n${calendarUnread !== undefined
      ? "Check Google Calendar directly before committing your day; the schedule and conflicts are not verified."
      : brief.pendingApprovals.length > 0
        ? `Review ${brief.pendingApprovals.length} pending approval(s) to unblock the affected work.`
        : brief.overdueOrBlocked.length > 0
          ? `Clarify the next action for ${brief.overdueOrBlocked.length} overdue or blocked item(s).`
          : "Start with confirmed commitments, then choose a ready option if time allows."}`,
    // Degraded sources lead. A brief that buries them reads like a clear day.
    ...(degraded.length === 0
      ? []
      : [
          digestSection(
            "Source health:",
            degraded.map((source) => ({ label: source.detail })),
          ),
        ]),
    section("Scheduled today", brief.scheduledCommitments, calendarUnread),
    digestSection("Decisions needed", brief.pendingApprovals),
    digestSection("Overdue or blocked — next action", brief.overdueOrBlocked),
    digestSection("Incidents to check", brief.incidents),
    brief.conflicts.length > 0 || calendarUnread !== undefined
      ? section("Conflicts", brief.conflicts, calendarUnread)
      : "",
    brief.readyOptions.length === 0
      ? ""
      : `${digestSection("Possible next steps", brief.readyOptions)}\nOptions, not new commitments. Ordered by confirmed date, recorded priority, then work in progress; ties are not a preference.`,
    digestSection("Proposed commitments — not confirmed", brief.proposedCommitments),
    `${brief.workItemCount} Work Items checked in the local record; this does not verify a fresh Notion sync.${calendar?.health === "empty" ? ` Google Calendar holds no events for ${brief.occurrenceDate}.` : ""}`,
  ].filter(Boolean).join("\n\n");
}

export interface MorningBriefResult {
  readonly brief: MorningBrief;
  /** What happened to the notice: delivered, held by the rhythm, or stood down. */
  readonly admission: ExceptionNoticeAdmission;
  /** Kept whole: when a brief fails to reach the CEO, the reason is the point. */
  readonly delivery: TelegramNotificationResult | undefined;
}

export interface MorningBriefRunner {
  run(): Promise<MorningBriefResult>;
}

export interface MorningBriefComposer {
  /** Compose only; delivery and scheduler ownership live outside this seam. */
  compose(): Promise<MorningBrief>;
}

export function createMorningBriefComposer(options: {
  readonly state: OperationsState;
  readonly listEvents: (
    window: CalendarWindow,
  ) => Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  readonly now?: () => string;
}): MorningBriefComposer {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async compose(): Promise<MorningBrief> {
      const currentNow = now();
      const occurrence = morningBriefOccurrence(currentNow);
      const calendar = observeCalendar(
        await options.listEvents(morningBriefWindow(occurrence.occurrenceDate)),
        occurrence.occurrenceDate,
      );
      return buildMorningBrief({
        now: currentNow,
        workItems: options.state.workItems(),
        calendar,
        approvals: (workItemId) => options.state.approvals(workItemId),
        auditTrail: (workItemId) => options.state.auditTrail(workItemId),
      });
    },
  };
}

export function createMorningBriefRunner(options: {
  readonly state: OperationsState;
  readonly listEvents: (
    window: CalendarWindow,
  ) => Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  readonly admit: (notice: ExceptionNotice) => Promise<ExceptionNoticeAdmission>;
  readonly now?: () => string;
}): MorningBriefRunner {
  const now = options.now ?? (() => new Date().toISOString());
  const composer = createMorningBriefComposer({
    state: options.state,
    listEvents: options.listEvents,
    now,
  });
  return {
    async run(): Promise<MorningBriefResult> {
      const brief = await composer.compose();
      // An identical retry deduplicates; a retry whose picture has changed is
      // a correction, not a duplicate, and must still reach the CEO. Keying on
      // the occurrence plus the rendered text gives both.
      const admission = await options.admit({
        kind: "brief",
        text: brief.text,
        idempotencyKey: `${brief.idempotencyKey}:${createHash("sha256")
          .update(brief.text)
          .digest("hex")
          .slice(0, 16)}`,
      });
      return {
        brief,
        admission,
        delivery:
          admission.kind === "delivered" ? admission.delivery : undefined,
      };
    },
  };
}
