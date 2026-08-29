import { createHash } from "node:crypto";

import type {
  Approval,
  AuditEvent,
  ExecutiveRole,
  WorkItem,
} from "./contracts.js";
import type { OperationsState } from "./operations-state.js";
import type { TelegramNotificationResult } from "../telegram/contracts.js";
import {
  blockersFor,
  pendingApprovalsFor,
} from "../dashboard/dashboard-read-model.js";
import { dailyOccurrence, isWeekend } from "./daily-schedule.js";
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
  readonly nextPriorities: readonly RollUpEntry[];
  readonly text: string;
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
  readonly outcomeReportId: (workItemId: string) => string | undefined;
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
  const nextPriorities: RollUpEntry[] = [];

  for (const workItem of input.workItems) {
    const approvals = input.approvals(workItem.id);
    const trail = input.auditTrail(workItem.id);
    const outcome = input.outcomeReportId(workItem.id);
    const workstream = workItem.workstream ?? "unrouted";

    if (outcome !== undefined) {
      verifiedOutcomes.push(
        entry(
          workItem,
          `${workstream} — ${workItem.intent} (${workItem.state})`,
          outcome,
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
        entry(workItem, `${workstream} — ${blocker}`, workItem.id),
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

    if (openStates.includes(workItem.state)) {
      nextPriorities.push(
        entry(
          workItem,
          `${workstream} — ${workItem.intent} (${workItem.state})`,
          workItem.id,
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
  };
  return { ...rollUp, text: renderExecutiveRollUp(rollUp) };
}

function section(title: string, entries: readonly RollUpEntry[]): string {
  return entries.length === 0
    ? `${title}: none.`
    : [`${title}:`, ...entries.map((item) => `  - ${item.label}`)].join("\n");
}

function renderExecutiveRollUp(rollUp: Omit<ExecutiveRollUp, "text">): string {
  return [
    `Executive Roll-Up — ${rollUp.occurrenceDate} (21:30 Asia/Kuala_Lumpur)`,
    `Consolidated by the ${rollUp.consolidatedBy}${
      rollUp.weekend ? " · weekend rhythm" : ""
    }`,
    "",
    section("Verified outcomes", rollUp.verifiedOutcomes),
    section("Outstanding risks", rollUp.outstandingRisks),
    section("Changes requested", rollUp.changesRequested),
    section("Pending Approvals", rollUp.pendingApprovals),
    section("Next priorities", rollUp.nextPriorities),
  ].join("\n");
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

export function createExecutiveRollUpRunner(options: {
  readonly state: OperationsState;
  readonly admit: (
    notice: ExceptionNotice,
  ) => Promise<ExceptionNoticeAdmission>;
  readonly now?: () => string;
}): ExecutiveRollUpRunner {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async run(): Promise<ExecutiveRollUpResult> {
      const rollUp = buildExecutiveRollUp({
        now: now(),
        workItems: options.state.workItems(),
        approvals: (workItemId) => options.state.approvals(workItemId),
        auditTrail: (workItemId) => options.state.auditTrail(workItemId),
        outcomeReportId: (workItemId) =>
          options.state.outcomeReport(workItemId)?.id,
      });
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
