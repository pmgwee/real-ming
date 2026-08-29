import type { OperationsState } from "./operations-state.js";
import { dailyOccurrence } from "./daily-schedule.js";
import { doNotDisturbEndHour } from "./daily-schedule.js";

/**
 * The three things that must happen on their own each day for Real-Ming to run
 * while the Lenovo is asleep. Each is named by its operating-day occurrence, so
 * a restart, a duplicated host, or a rapid tick cannot run one twice.
 */
export const morningBriefJobName = "morning-brief";
export const executiveRollUpJobName = "executive-roll-up";
export const releaseHeldJobName = "release-held-exception-notices";

interface ScheduledJob {
  readonly job: string;
  readonly hour: number;
  readonly minute: number;
}

const scheduledJobs: readonly ScheduledJob[] = [
  // The held-notice sweep runs as do-not-disturb ends, before the brief, so a
  // notice deferred overnight arrives before the morning's own account.
  { job: releaseHeldJobName, hour: doNotDisturbEndHour, minute: 0 },
  { job: morningBriefJobName, hour: 7, minute: 30 },
  { job: executiveRollUpJobName, hour: 21, minute: 30 },
];

export interface DailyOperationsTick {
  readonly now: string;
  readonly ran: readonly string[];
  readonly failed: readonly string[];
  readonly notYetDue: readonly string[];
  readonly alreadyRun: readonly string[];
}

export interface DailyOperationsScheduler {
  tick(): Promise<DailyOperationsTick>;
}

export function createDailyOperationsScheduler(options: {
  readonly state: OperationsState;
  readonly runners: Readonly<Record<string, () => Promise<unknown>>>;
  readonly now: () => string;
}): DailyOperationsScheduler {
  return {
    async tick(): Promise<DailyOperationsTick> {
      const now = options.now();
      const instant = Date.parse(now);
      if (Number.isNaN(instant)) {
        throw new Error("Daily Operations requires a canonical clock.");
      }
      const ran: string[] = [];
      const failed: string[] = [];
      const notYetDue: string[] = [];
      const alreadyRun: string[] = [];

      for (const scheduled of scheduledJobs) {
        const runner = options.runners[scheduled.job];
        if (runner === undefined) continue;
        const occurrence = dailyOccurrence({
          now,
          hour: scheduled.hour,
          minute: scheduled.minute,
          job: scheduled.job,
        });
        if (instant < Date.parse(occurrence.scheduledAt)) {
          notYetDue.push(scheduled.job);
          continue;
        }
        const claim = options.state.claimSchedulerRun({
          job: scheduled.job,
          occurrenceDate: occurrence.occurrenceDate,
          scheduledAt: occurrence.scheduledAt,
          startedAt: now,
        });
        if (claim.kind === "already-succeeded") {
          alreadyRun.push(scheduled.job);
          continue;
        }
        try {
          await runner();
          options.state.completeSchedulerRun(
            scheduled.job,
            occurrence.occurrenceDate,
            options.now(),
            "succeeded",
          );
          ran.push(scheduled.job);
        } catch {
          // One failing job must not strand the rest of the day. The failure is
          // recorded so it stays visible and retryable on the next tick.
          options.state.completeSchedulerRun(
            scheduled.job,
            occurrence.occurrenceDate,
            options.now(),
            "failed",
          );
          failed.push(scheduled.job);
        }
      }

      return { now, ran, failed, notYetDue, alreadyRun };
    },
  };
}

export interface SchedulerJobHealth {
  readonly job: string;
  readonly lastOccurrenceDate: string | null;
  readonly lastOutcome: "succeeded" | "failed" | "running" | null;
  readonly lastCompletedAt: string | null;
  readonly nextScheduledAt: string;
}

/**
 * Scheduler health for the dashboard. It reports identity, timing and outcome
 * only — never a payload, so opening the dashboard cannot expose a credential
 * or a Work Item's content through this section.
 */
export function schedulerHealth(
  state: OperationsState,
  now: string,
): readonly SchedulerJobHealth[] {
  const runs = state.schedulerRuns();
  return scheduledJobs.map((scheduled) => {
    const forJob = runs.filter((run) => run.job === scheduled.job);
    const last = forJob.at(-1);
    const today = dailyOccurrence({
      now,
      hour: scheduled.hour,
      minute: scheduled.minute,
      job: scheduled.job,
    });
    const dueToday = Date.parse(today.scheduledAt) > Date.parse(now);
    const nextScheduledAt = dueToday
      ? today.scheduledAt
      : dailyOccurrence({
          now: new Date(Date.parse(now) + 86_400_000).toISOString(),
          hour: scheduled.hour,
          minute: scheduled.minute,
          job: scheduled.job,
        }).scheduledAt;
    return {
      job: scheduled.job,
      lastOccurrenceDate: last?.occurrenceDate ?? null,
      lastOutcome:
        last === undefined
          ? null
          : last.outcome === "succeeded"
            ? "succeeded"
            : last.outcome === "failed"
              ? "failed"
              : "running",
      lastCompletedAt: last?.completedAt ?? null,
      nextScheduledAt,
    };
  });
}
