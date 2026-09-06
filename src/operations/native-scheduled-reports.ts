import { createHash } from "node:crypto";

import {
  dailyOccurrence,
  operatingDayOf,
  operatingTimeZone,
} from "./daily-schedule.js";
import {
  executiveRollUpJobName,
  morningBriefJobName,
  schedulerJobInventory,
} from "./daily-operations-scheduler.js";
import type { OperationsState } from "./operations-state.js";
import type { MorningBriefComposer } from "./morning-brief.js";
import type { ExecutiveRollUpComposer } from "./executive-roll-up.js";

/** Jobs whose trigger and delivery are owned by Hermes's native cron. */
export type NativeScheduledReportJob =
  | typeof morningBriefJobName
  | typeof executiveRollUpJobName;

export const nativeScheduledReportOwner = "native-hermes-cron" as const;

export interface NativeScheduledReportRequest {
  readonly job: NativeScheduledReportJob;
  /** Native cron's execution/session id. A deterministic id is used if absent. */
  readonly runId?: string;
  /** Optional operating date, accepted only for today's Kuala Lumpur date. */
  readonly occurrenceDate?: string;
}
export type NativeScheduledReportResult =
  | {
      readonly kind: "composed";
      readonly job: NativeScheduledReportJob;
      readonly occurrenceDate: string;
      readonly scheduledAt: string;
      readonly runId: string;
      readonly payloadDigest: string;
      readonly text: string;
      readonly replayed: boolean;
    }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export interface NativeScheduledReportService {
  run(request: NativeScheduledReportRequest): Promise<NativeScheduledReportResult>;
}

const staleAfterMs = 5 * 60 * 1000;

function runIdFor(
  job: NativeScheduledReportJob,
  occurrenceDate: string,
  requested?: string,
): string {
  const trimmed = requested?.trim();
  return trimmed === undefined || trimmed.length === 0
    ? `${nativeScheduledReportOwner}:${job}:${occurrenceDate}`
    : trimmed;
}

function definitionFor(job: NativeScheduledReportJob) {
  const definition = schedulerJobInventory.find((candidate) => candidate.job === job);
  if (definition === undefined || definition.owner !== nativeScheduledReportOwner) {
    throw new Error(`No native Hermes cron definition exists for ${job}.`);
  }
  return definition;
}

/**
 * The native cron adapter is deliberately a composition boundary, not a
 * Telegram client. It claims the same durable occurrence ledger as the old
 * scheduler, composes through the existing domain builders, and returns the
 * exact text for Hermes to deliver through its own gateway.
 */
export function createNativeScheduledReportService(options: {
  readonly state: OperationsState;
  readonly morningBrief: MorningBriefComposer;
  readonly executiveRollUp: ExecutiveRollUpComposer;
  readonly now?: () => string;
}): NativeScheduledReportService {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async run(request): Promise<NativeScheduledReportResult> {
      let definition;
      try {
        definition = definitionFor(request.job);
      } catch (error) {
        return {
          kind: "failed",
          reason: error instanceof Error ? error.message : "Unknown schedule.",
        };
      }

      const currentNow = now();
      const currentInstant = Date.parse(currentNow);
      if (Number.isNaN(currentInstant)) {
        return { kind: "failed", reason: "The operating clock is invalid." };
      }
      const today = operatingDayOf(currentInstant);
      const occurrenceDate = request.occurrenceDate?.trim() || today;
      if (occurrenceDate !== today) {
        return {
          kind: "failed",
          reason: `The requested occurrence ${occurrenceDate} is not today's ${operatingTimeZone} date ${today}.`,
        };
      }
      const occurrence = dailyOccurrence({
        now: currentNow,
        hour: definition.hour,
        minute: definition.minute,
        job: definition.job,
      });
      const runId = runIdFor(request.job, occurrenceDate, request.runId);
      const claim = options.state.claimSchedulerRun({
        job: request.job,
        occurrenceDate,
        scheduledAt: occurrence.scheduledAt,
        startedAt: currentNow,
        staleAfterMs,
        owner: nativeScheduledReportOwner,
        runId,
      });

      if (claim.kind === "already-succeeded") {
        const previous = options.state.schedulerRunOutput(
          request.job,
          occurrenceDate,
        );
        if (previous === undefined) {
          // This is the expected migration case when the old Real-Ming
          // scheduler already delivered today's report. Do not duplicate it.
          return {
            kind: "skipped",
            reason: `The ${request.job} occurrence was already completed by the previous scheduler owner.`,
          };
        }
        return {
          kind: "composed",
          job: request.job,
          occurrenceDate,
          scheduledAt: occurrence.scheduledAt,
          runId: previous.runId,
          payloadDigest: previous.payloadDigest,
          text: previous.payloadText,
          replayed: true,
        };
      }
      if (claim.kind === "already-running") {
        return {
          kind: "failed",
          reason: `The ${request.job} occurrence is already running; retry after its heartbeat expires.`,
        };
      }
      if (claim.kind === "terminal-failure") {
        return {
          kind: "failed",
          reason: `The ${request.job} occurrence reached its retry limit.`,
        };
      }
      if (claim.kind === "stale-reclaimed") {
        // Preserve the abandoned native attempt before claiming a fresh one.
        options.state.completeSchedulerRun(
          request.job,
          occurrenceDate,
          currentNow,
          "failed",
        );
        const retry = options.state.claimSchedulerRun({
          job: request.job,
          occurrenceDate,
          scheduledAt: occurrence.scheduledAt,
          startedAt: currentNow,
          staleAfterMs,
          owner: nativeScheduledReportOwner,
          runId,
        });
        if (retry.kind !== "claimed") {
          return {
            kind: "failed",
            reason: `The ${request.job} occurrence could not be reclaimed safely (${retry.kind}).`,
          };
        }
      }

      try {
        const report =
          request.job === morningBriefJobName
            ? await options.morningBrief.compose()
            : await options.executiveRollUp.compose();
        const payloadDigest = createHash("sha256")
          .update(report.text)
          .digest("hex");
        options.state.completeSchedulerRun(
          request.job,
          occurrenceDate,
          now(),
          "succeeded",
          {
            owner: nativeScheduledReportOwner,
            runId,
            payloadText: report.text,
          },
        );
        return {
          kind: "composed",
          job: request.job,
          occurrenceDate,
          scheduledAt: report.scheduledAt,
          runId,
          payloadDigest,
          text: report.text,
          replayed: false,
        };
      } catch (error) {
        options.state.completeSchedulerRun(
          request.job,
          occurrenceDate,
          now(),
          "failed",
        );
        return {
          kind: "failed",
          reason:
            error instanceof Error
              ? `Report composition failed: ${error.message}`
              : "Report composition failed.",
        };
      }
    },
  };
}
