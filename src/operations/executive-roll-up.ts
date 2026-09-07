import { createHash } from "node:crypto";
import {
  dailyReadyOptions,
  digestBlocker,
  digestSection,
  readyOptionLabel,
} from "./daily-digest.js";

import type {
  Approval,
  AuditEvent,
  ExecutiveRole,
  WorkItem,
} from "./contracts.js";
import type { OperationsState } from "./operations-state.js";
import {
  schedulerHealth,
  type SchedulerJobHealth,
} from "./daily-operations-scheduler.js";
import type { TelegramNotificationResult } from "../telegram/contracts.js";
import {
  blockersFor,
  pendingApprovalsFor,
} from "../dashboard/dashboard-read-model.js";
import {
  dailyOccurrence,
  isWeekend,
  operatingDayOf,
  operatingTimeZone,
} from "./daily-schedule.js";
import type {
  ExceptionNotice,
  ExceptionNoticeAdmission,
} from "./exception-notice-rhythm.js";

export const executiveRollUpJob = "executive-roll-up";
const executiveRollUpHour = 21;
const executiveRollUpMinute = 30;

/**
 * The COO consolidates the evening account across every Workstream. That is
 * reporting, not authority: consolidation never carries the power to approve a
 * peer's work, and it carries summaries rather than raw cross-domain material.
 */
export const rollUpConsolidatingExecutive: ExecutiveRole = "COO";

/**
 * An Approved Projection: a deliberately limited summary that may cross a Trust
 * Domain boundary without granting access to the underlying raw context. The
 * builder only ever emits identifiers and composed labels, never a payload.
 */
export interface RollUpEntry {
  readonly workItemId: string;
  readonly label: string;
  readonly evidence: string;
}

export interface SchedulerRollUpEntry {
  readonly job: string;
  readonly label: string;
  readonly evidence: string;
}

export interface ExecutiveRollUp {
  readonly occurrenceDate: string;
  readonly scheduledAt: string;
  readonly idempotencyKey: string;
  readonly consolidatedBy: ExecutiveRole;
  readonly grantsApprovalAuthority: false;
  readonly weekend: boolean;
  readonly verifiedOutcomes: readonly RollUpEntry[];
  readonly outstandingRisks: readonly RollUpEntry[];
  readonly changesRequested: readonly RollUpEntry[];
  readonly pendingApprovals: readonly RollUpEntry[];
  /** Backwards-compatible structured next-priority projection for dashboards. */
  readonly nextPriorities: readonly RollUpEntry[];
  /** Bounded, ready-to-start subset used by the Telegram presentation. */
  readonly readyOptions: readonly RollUpEntry[];
  readonly readyForReview: readonly RollUpEntry[];
  readonly backlogCount: number;
  readonly unroutedCount: number;
  readonly schedulerExceptions: readonly SchedulerRollUpEntry[];
  readonly text: string;
}

/**
 * A blocker reason is written by a worker or an adapter, not by the CEO. It is
 * projected into the account rather than pasted, so an unbounded or noisy
 * string cannot ride across the Trust Domain boundary into Telegram.
 */
const projectedReasonLimit = 160;

function projectReason(reason: string): string {
  const collapsed = reason.replace(/\s+/gu, " ").trim();
  return collapsed.length <= projectedReasonLimit
    ? collapsed
    : `${collapsed.slice(0, projectedReasonLimit)}…`;
}

const openStates: readonly WorkItem["state"][] = [
  "Captured",
  "Triaged",
  "Planned",
  "Awaiting Approval",
  "Waiting/Blocked",
  "Changes Requested",
];

function entry(
  workItem: WorkItem,
  label: string,
  evidence: string,
): RollUpEntry {
  return { workItemId: workItem.id, label, evidence };
}

export function buildExecutiveRollUp(input: {
  readonly now: string;
  readonly workItems: readonly WorkItem[];
  readonly approvals: (workItemId: string) => readonly Approval[];
  readonly auditTrail: (workItemId: string) => readonly AuditEvent[];
  readonly outcomeReport: (
    workItemId: string,
  ) => { readonly id: string; readonly createdAt: string } | undefined;
  readonly scheduler?: readonly SchedulerJobHealth[];
}): ExecutiveRollUp {
  const occurrence = dailyOccurrence({
    now: input.now,
    hour: executiveRollUpHour,
    minute: executiveRollUpMinute,
    job: executiveRollUpJob,
  });

  const verifiedOutcomes: RollUpEntry[] = [];
  const outstandingRisks: RollUpEntry[] = [];
  const changesRequested: RollUpEntry[] = [];
  const pendingApprovals: RollUpEntry[] = [];
  const readyOptions = dailyReadyOptions(input.workItems).map((item) =>
    entry(item, readyOptionLabel(item), item.id),
  );
  // Keep the complete structured projection in source order for dashboard and
  // API consumers. The presentation-only `readyOptions` list has its own
  // bounded, date/priority ordering.
  const nextPriorities = input.workItems
    .filter((item) => openStates.includes(item.state))
    .map((item) =>
      entry(
        item,
        `${item.workstream ?? "unrouted"} — ${item.intent} (${item.state})`,
        item.id,
      ),
    );
  const readyForReview: RollUpEntry[] = [];
  const schedulerExceptions: SchedulerRollUpEntry[] = (input.scheduler ?? [])
    .filter(
      (job) =>
        job.failureStreak > 0 ||
        job.lastOutcome === "failed" ||
        (job.criticality === "routine" && job.failureHistory.length > 0),
    )
    .map((job) => ({
      job: job.job,
      label:
        job.lastOutcome === "succeeded" && job.failureHistory.length > 0
          ? `${job.job} (recovered; ${job.failureHistory.length} historical failure${job.failureHistory.length === 1 ? "" : "s"})`
          : `${job.job} (${job.lastOutcome ?? "failed"}; ${job.failureStreak} consecutive failure${job.failureStreak === 1 ? "" : "s"})`,
      evidence:
        job.failureHistory.at(-1)?.evidenceLink ?? job.evidenceLink,
    }));

  for (const workItem of input.workItems) {
    const approvals = input.approvals(workItem.id);
    const trail = input.auditTrail(workItem.id);
    const outcome = input.outcomeReport(workItem.id);
    const workstream = workItem.workstream ?? "unrouted";

    if (workItem.state === "Ready for CEO Review") {
      readyForReview.push(
        entry(
          workItem,
          `${workItem.intent} — review the evidence; not completed until you accept`,
          outcome?.id ?? workItem.id,
        ),
      );
    }

    // Tonight's account, not every outcome the system has ever produced.
    if (
      outcome !== undefined &&
      operatingDayOf(Date.parse(outcome.createdAt)) ===
        occurrence.occurrenceDate
    ) {
      verifiedOutcomes.push(
        entry(
          workItem,
          `${workstream} — ${workItem.intent} (${workItem.state})`,
          outcome.id,
        ),
      );
    }

    if (workItem.state === "Changes Requested") {
      changesRequested.push(
        entry(workItem, `${workstream} — ${workItem.intent}`, workItem.id),
      );
    }

    for (const blocker of blockersFor(workItem, approvals, trail)) {
      outstandingRisks.push(
        entry(
          workItem,
          `${workstream} · ${workItem.intent} — ${projectReason(digestBlocker(blocker))}`,
          workItem.id,
        ),
      );
    }

    for (const approval of pendingApprovalsFor(approvals)) {
      pendingApprovals.push(
        entry(
          workItem,
          `${workstream} — awaiting your ${approval.scope} Approval for ${workItem.intent}`,
          approval.id,
        ),
      );
    }

  }

  const weekend = isWeekend(occurrence.occurrenceDate);
  const rollUp: Omit<ExecutiveRollUp, "text"> = {
    ...occurrence,
    consolidatedBy: rollUpConsolidatingExecutive,
    grantsApprovalAuthority: false,
    weekend,
    verifiedOutcomes,
    outstandingRisks,
    changesRequested,
    pendingApprovals,
    nextPriorities,
    readyOptions,
    readyForReview,
    backlogCount: input.workItems.filter(
      (item) => item.state === "Captured" || item.state === "Triaged",
    ).length,
    unroutedCount: input.workItems.filter(
      (item) =>
        item.workstream === null &&
        item.state !== "Completed" &&
        item.state !== "Cancelled",
    ).length,
    schedulerExceptions,
  };
  return { ...rollUp, text: renderExecutiveRollUp(rollUp) };
}

function renderExecutiveRollUp(rollUp: Omit<ExecutiveRollUp, "text">): string {
  const focus =
    rollUp.pendingApprovals.length > 0
      ? `Review ${rollUp.pendingApprovals.length} pending approval(s) before the affected work can proceed.`
      : rollUp.readyForReview.length > 0
        ? `${rollUp.readyForReview.length} item(s) need your outcome review.`
        : rollUp.outstandingRisks.length > 0
          ? `${rollUp.outstandingRisks.length} blocker(s) need clarification before the affected work can proceed.`
          : "No approval or blocker is recorded; choose a ready option only if it fits your plans.";
  return [
    `Executive Roll-Up — ${rollUp.occurrenceDate} (${String(
      executiveRollUpHour,
    ).padStart(2, "0")}:${String(executiveRollUpMinute).padStart(
      2,
      "0",
    )} ${operatingTimeZone})`,
    `**Focus for tonight**\n${focus}${rollUp.weekend ? " Keep the weekend light." : ""}`,
    rollUp.verifiedOutcomes.length === 0
      ? "No verified outcomes recorded today. This does not mean you did no work."
      : digestSection("Today's verified outcomes", rollUp.verifiedOutcomes),
    digestSection("Decisions needed", rollUp.pendingApprovals),
    digestSection("Ready for your review", rollUp.readyForReview),
    digestSection("Blocked — clarify the next action", rollUp.outstandingRisks),
    digestSection("Changes requested", rollUp.changesRequested),
    rollUp.readyOptions.length === 0 ? "No ready, routed next steps are recorded."
      : `${digestSection("Possible next steps", rollUp.readyOptions)}\nOptions, not new commitments. Ordered by confirmed date, recorded priority, then work in progress; ties are not a preference.`,
    digestSection(
      "Automation needs attention",
      rollUp.schedulerExceptions.map((entry) => ({
        workItemId: entry.job,
        label: entry.label,
        evidence: entry.evidence,
      })),
    ),
    `${rollUp.backlogCount} backlog items held for later; ${rollUp.unroutedCount} open items need routing. Ask for details when useful.`,
    "Based on recorded Work Items and outcomes; other activity may be missing.",
  ].filter(Boolean).join("\n\n");
}

export interface ExecutiveRollUpResult {
  readonly rollUp: ExecutiveRollUp;
  /** What actually happened to the notice: delivered, held, or stood down. */
  readonly admission: ExceptionNoticeAdmission;
  readonly delivery: TelegramNotificationResult | undefined;
}

export interface ExecutiveRollUpRunner {
  run(): Promise<ExecutiveRollUpResult>;
}

export interface ExecutiveRollUpComposer {
  /** Compose only; native Hermes owns scheduling and Telegram delivery. */
  compose(): Promise<ExecutiveRollUp>;
}

export function createExecutiveRollUpComposer(options: {
  readonly state: OperationsState;
  readonly workspaceId: string;
  readonly now?: () => string;
}): ExecutiveRollUpComposer {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async compose(): Promise<ExecutiveRollUp> {
      const currentNow = now();
      return buildExecutiveRollUp({
        now: currentNow,
        workItems: options.state
          .workItems()
          .filter((workItem) => workItem.workspaceId === options.workspaceId),
        approvals: (workItemId) => options.state.approvals(workItemId),
        auditTrail: (workItemId) => options.state.auditTrail(workItemId),
        outcomeReport: (workItemId) => options.state.outcomeReport(workItemId),
        scheduler: schedulerHealth(options.state, currentNow, undefined, {
          excludeInProgressJob: executiveRollUpJob,
        }),
      });
    },
  };
}

export function createExecutiveRollUpRunner(options: {
  readonly state: OperationsState;
  readonly workspaceId: string;
  readonly admit: (
    notice: ExceptionNotice,
  ) => Promise<ExceptionNoticeAdmission>;
  readonly now?: () => string;
}): ExecutiveRollUpRunner {
  const now = options.now ?? (() => new Date().toISOString());
  const composer = createExecutiveRollUpComposer({
    state: options.state,
    workspaceId: options.workspaceId,
    now,
  });
  return {
    async run(): Promise<ExecutiveRollUpResult> {
      const rollUp = await composer.compose();
      // An identical retry deduplicates; an evening whose picture has changed
      // is a correction, not a duplicate.
      const admission = await options.admit({
        kind: "brief",
        text: rollUp.text,
        idempotencyKey: `${rollUp.idempotencyKey}:${createHash("sha256")
          .update(rollUp.text)
          .digest("hex")
          .slice(0, 16)}`,
      });
      // A held Roll-Up is pending, not suppressed. Collapsing the two would
      // let a heartbeat record a stand-down for a notice still due at 07:00.
      return {
        rollUp,
        admission,
        delivery:
          admission.kind === "delivered" ? admission.delivery : undefined,
      };
    },
  };
}
