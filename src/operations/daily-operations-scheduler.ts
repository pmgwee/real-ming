import type { OperationsState } from "./operations-state.js";
import { dailyOccurrence } from "./daily-schedule.js";
import { doNotDisturbEndHour } from "./daily-schedule.js";
import type { ExecutiveRole } from "./contracts.js";
import type {
  ExceptionNotice,
  ExceptionNoticeAdmission,
} from "./exception-notice-rhythm.js";

/**
 * The three things that must happen on their own each day for Real-Ming to run
 * while the Lenovo is asleep. Each is named by its operating-day occurrence, so
 * a restart, a duplicated host, or a rapid tick cannot run one twice.
 */
export const morningBriefJobName = "morning-brief";
export const executiveRollUpJobName = "executive-roll-up";
export const releaseHeldJobName = "release-held-exception-notices";

/**
 * A claimed occurrence is given one hour to finish before a late heartbeat is
 * declared missed. This avoids raising an incident while a due job is still
 * within its normal execution window, while ensuring a cold start or a crash
 * cannot leave a critical occurrence silent forever.
 */
const missedHeartbeatGraceMs = 60 * 60 * 1000;
const defaultRunnerTimeoutMs = 5 * 60 * 1000;

export type SchedulerCriticality = "critical" | "routine";

export interface SchedulerJobDefinition {
  readonly job: string;
  readonly hour: number;
  readonly minute: number;
  readonly provider: string;
  readonly expectedCadence: string;
  readonly criticality: SchedulerCriticality;
  readonly accountableExecutive: ExecutiveRole;
  readonly evidenceLink: string;
}

/** The active Real-Ming inventory; later providers can register definitions. */
export const schedulerJobInventory: readonly SchedulerJobDefinition[] = [
  // The held-notice sweep runs as do-not-disturb ends, before the brief, so a
  // notice deferred overnight arrives before the morning's own account.
  {
    job: releaseHeldJobName,
    hour: doNotDisturbEndHour,
    minute: 0,
    provider: "internal",
    expectedCadence: "daily",
    criticality: "critical",
    accountableExecutive: "COO",
    evidenceLink: `scheduler-definition:${releaseHeldJobName}`,
  },
  {
    job: morningBriefJobName,
    hour: 7,
    minute: 30,
    provider: "internal",
    expectedCadence: "daily",
    criticality: "critical",
    accountableExecutive: "COO",
    evidenceLink: `scheduler-definition:${morningBriefJobName}`,
  },
  {
    job: executiveRollUpJobName,
    hour: 21,
    minute: 30,
    provider: "internal",
    expectedCadence: "daily",
    criticality: "routine",
    accountableExecutive: "COO",
    evidenceLink: `scheduler-definition:${executiveRollUpJobName}`,
  },
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

export interface SchedulerFailureRecord {
  readonly occurrenceDate: string;
  readonly completedAt: string | null;
  readonly evidenceLink: string;
}

function failureStreak(
  runs: readonly { readonly outcome: string | null }[],
): number {
  let streak = 0;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index]?.outcome !== "failed") break;
    streak += 1;
  }
  return streak;
}

export function createDailyOperationsScheduler(options: {
  readonly state: OperationsState;
  readonly runners: Readonly<Record<string, () => Promise<unknown>>>;
  readonly now: () => string;
  readonly jobs?: readonly SchedulerJobDefinition[];
  readonly runnerTimeoutMs?: number;
  readonly admitExceptionNotice?: (
    notice: ExceptionNotice,
  ) => Promise<ExceptionNoticeAdmission>;
  readonly recordExceptionNoticeRecovery?: (
    signature: string,
    details?: { readonly text?: string; readonly idempotencyKey?: string },
  ) => Promise<ExceptionNoticeAdmission>;
}): DailyOperationsScheduler {
  const jobs = options.jobs ?? schedulerJobInventory;
  const runnerTimeoutMs = options.runnerTimeoutMs ?? defaultRunnerTimeoutMs;
  if (!Number.isFinite(runnerTimeoutMs) || runnerTimeoutMs <= 0) {
    throw new Error("A scheduler runner timeout must be a positive number.");
  }
  const activeJobs = new Set<string>();

  const runWithTimeout = async (
    job: string,
    runner: () => Promise<unknown>,
  ): Promise<void> => {
    // Promise.race cannot cancel a provider or worker. Keep the job fenced in
    // activeJobs until the underlying promise settles, so a late side effect
    // cannot race a retry after a timeout. A permanently hung runner remains
    // fenced until process reconciliation/restart rather than being duplicated.
    const runnerPromise = Promise.resolve().then(() => runner());
    void runnerPromise.then(
      () => activeJobs.delete(job),
      () => activeJobs.delete(job),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runnerPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("The scheduler runner timed out.")),
            runnerTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const admitFailure = async (
    job: SchedulerJobDefinition,
    occurrenceDate: string,
    streak: number,
    kind: "failed" | "missed" = "failed",
  ): Promise<void> => {
    const threshold = job.criticality === "critical" ? 1 : 2;
    if (streak < threshold || options.admitExceptionNotice === undefined) return;
    await options.admitExceptionNotice({
      kind: job.criticality === "critical" ? "critical-incident" : "material-blocker",
      text: `Scheduler heartbeat ${kind}: ${job.job}.`,
      idempotencyKey: `scheduler-${kind}:${job.job}:${occurrenceDate}`,
      signature: `scheduler-failure:${job.job}`,
    });
  };

  const recordRecovery = async (
    job: SchedulerJobDefinition,
    occurrenceDate: string,
    hadFailures: boolean,
  ): Promise<void> => {
    if (!hadFailures || options.recordExceptionNoticeRecovery === undefined) return;
    await options.recordExceptionNoticeRecovery(
      `scheduler-failure:${job.job}`,
      {
        text: `Scheduler recovered: ${job.job}.`,
        idempotencyKey: `scheduler-recovery:${job.job}:${occurrenceDate}`,
      },
    );
  };

  const reportMissedPreviousOccurrence = async (
    job: SchedulerJobDefinition,
    currentOccurrenceDate: string,
    now: string,
  ): Promise<void> => {
    const runs = options.state.schedulerRuns().filter((run) => run.job === job.job);
    const previous = dailyOccurrence({
      now: new Date(Date.parse(now) - 86_400_000).toISOString(),
      hour: job.hour,
      minute: job.minute,
      job: job.job,
    });
    if (previous.occurrenceDate === currentOccurrenceDate) return;

    const previousRun = runs.find(
      (run) => run.occurrenceDate === previous.occurrenceDate,
    );
    if (
      previousRun?.outcome === "succeeded" ||
      previousRun?.outcome === "failed"
    ) {
      return;
    }
    // A routine job's first-ever absence is inventory history, not yet an
    // incident. Its two-consecutive-failure threshold applies once an actual
    // run has been observed; critical jobs have no such grace.
    if (previousRun === undefined && job.criticality !== "critical") return;
    if (Date.parse(now) - Date.parse(previous.scheduledAt) < missedHeartbeatGraceMs) {
      return;
    }

    if (previousRun === undefined) {
      const claim = options.state.claimSchedulerRun({
        job: job.job,
        occurrenceDate: previous.occurrenceDate,
        scheduledAt: previous.scheduledAt,
        startedAt: previous.scheduledAt,
        staleAfterMs: runnerTimeoutMs,
      });
      if (claim.kind !== "claimed") return;
    }
    options.state.completeSchedulerRun(
      job.job,
      previous.occurrenceDate,
      now,
      "failed",
    );
    const streak = failureStreak(
      options.state.schedulerRuns().filter((run) => run.job === job.job),
    );
    // A typed Telegram/provider failure is returned by admitFailure's adapter.
    // State persistence failures must escape: swallowing them would report a
    // heartbeat as handled while losing the durable Exception Notice.
    await admitFailure(job, previous.occurrenceDate, streak, "missed");
  };

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

      for (const scheduled of jobs) {
        const runner = options.runners[scheduled.job];
        if (runner === undefined) continue;
        if (activeJobs.has(scheduled.job)) {
          alreadyRun.push(scheduled.job);
          continue;
        }
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
        await reportMissedPreviousOccurrence(
          scheduled,
          occurrence.occurrenceDate,
          now,
        );
        let priorFailureStreak = failureStreak(
          options.state.schedulerRuns().filter((run) => run.job === scheduled.job),
        );
        let claim = options.state.claimSchedulerRun({
          job: scheduled.job,
          occurrenceDate: occurrence.occurrenceDate,
          scheduledAt: occurrence.scheduledAt,
          startedAt: now,
          staleAfterMs: runnerTimeoutMs,
        });
        if (claim.kind === "stale-reclaimed") {
          // A restarted process has found an unfinished current occurrence.
          // Preserve that abandoned attempt and notify before retrying it; the
          // retry must never erase evidence of the stale heartbeat.
          options.state.completeSchedulerRun(
            scheduled.job,
            occurrence.occurrenceDate,
            now,
            "failed",
          );
          const staleFailureStreak = failureStreak(
            options.state.schedulerRuns().filter((run) => run.job === scheduled.job),
          );
          await admitFailure(
            scheduled,
            occurrence.occurrenceDate,
            staleFailureStreak,
          );
          claim = options.state.claimSchedulerRun({
            job: scheduled.job,
            occurrenceDate: occurrence.occurrenceDate,
            scheduledAt: occurrence.scheduledAt,
            startedAt: now,
            staleAfterMs: runnerTimeoutMs,
          });
          priorFailureStreak = failureStreak(
            options.state.schedulerRuns().filter((run) => run.job === scheduled.job),
          );
        }
        if (claim.kind === "already-succeeded" || claim.kind === "already-running") {
          alreadyRun.push(scheduled.job);
          continue;
        }
        activeJobs.add(scheduled.job);
        let runnerFailed = false;
        try {
          await runWithTimeout(scheduled.job, runner);
        } catch {
          runnerFailed = true;
        }

        if (runnerFailed) {
          // One failing job must not strand the rest of the day. The failure is
          // recorded so it stays visible and retryable on the next tick.
          options.state.completeSchedulerRun(
            scheduled.job,
            occurrence.occurrenceDate,
            options.now(),
            "failed",
          );
          const streak = failureStreak(
            options.state.schedulerRuns().filter((run) => run.job === scheduled.job),
          );
          // A typed Telegram/provider failure is returned by the adapter. A
          // persistence failure must surface instead of silently dropping the
          // Exception Notice that proves this heartbeat was handled.
          await admitFailure(scheduled, occurrence.occurrenceDate, streak);
          failed.push(scheduled.job);
          continue;
        }

        // Keep scheduler bookkeeping and notice persistence outside the runner
        // catch. A persistence failure must surface without rewriting a job
        // that actually succeeded as a runner failure.
        options.state.completeSchedulerRun(
          scheduled.job,
          occurrence.occurrenceDate,
          options.now(),
          "succeeded",
        );
        await recordRecovery(
          scheduled,
          occurrence.occurrenceDate,
          priorFailureStreak > 0,
        );
        ran.push(scheduled.job);
      }

      return { now, ran, failed, notYetDue, alreadyRun };
    },
  };
}

export interface SchedulerJobHealth {
  readonly job: string;
  readonly provider: string;
  readonly expectedCadence: string;
  readonly criticality: SchedulerCriticality;
  readonly accountableExecutive: ExecutiveRole;
  readonly lastSchedulerHeartbeat: string | null;
  readonly lastSuccess: string | null;
  readonly nextExpectedRun: string;
  readonly durationMs: number | null;
  readonly failureStreak: number;
  readonly failureHistory: readonly SchedulerFailureRecord[];
  readonly evidenceLink: string;
  /** Backward-compatible names retained for existing dashboard clients. */
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
  jobs: readonly SchedulerJobDefinition[] = schedulerJobInventory,
  options?: { readonly excludeInProgressJob?: string },
): readonly SchedulerJobHealth[] {
  const runs = state.schedulerRuns();
  const failureHistoryByJob = new Map<string, SchedulerFailureRecord[]>();
  for (const failure of state.schedulerFailureHistory()) {
    const history = failureHistoryByJob.get(failure.job) ?? [];
    history.push({
      occurrenceDate: failure.occurrenceDate,
      completedAt: failure.completedAt,
      evidenceLink: `scheduler-run:${failure.job}:${failure.occurrenceDate}:attempt-${failure.attempt}`,
    });
    failureHistoryByJob.set(failure.job, history);
  }
  return jobs.map((scheduled) => {
    const today = dailyOccurrence({
      now,
      hour: scheduled.hour,
      minute: scheduled.minute,
      job: scheduled.job,
    });
    // The Executive Roll-Up is rendered from inside its own claimed
    // occurrence. Excluding that in-progress row keeps the prior failure
    // streak visible instead of making the roll-up hide its own incident.
    const forJob = runs.filter(
      (run) =>
        run.job === scheduled.job &&
        !(
          options?.excludeInProgressJob === scheduled.job &&
          run.occurrenceDate === today.occurrenceDate &&
          run.outcome === null
        ),
    );
    const last = forJob.at(-1);
    const lastSuccessRun = [...forJob]
      .reverse()
      .find((run) => run.outcome === "succeeded");
    const failureHistory = failureHistoryByJob.get(scheduled.job) ?? [];
    const dueToday = Date.parse(today.scheduledAt) > Date.parse(now);
    const nextScheduledAt = dueToday
      ? today.scheduledAt
      : dailyOccurrence({
          now: new Date(Date.parse(now) + 86_400_000).toISOString(),
          hour: scheduled.hour,
          minute: scheduled.minute,
          job: scheduled.job,
        }).scheduledAt;
    const durationMs =
      last?.completedAt === null || last?.completedAt === undefined
        ? null
        : Date.parse(last.completedAt) - Date.parse(last.startedAt);
    const evidenceLink =
      last === undefined
        ? scheduled.evidenceLink
        : `scheduler-run:${scheduled.job}:${last.occurrenceDate}`;
    return {
      job: scheduled.job,
      provider: scheduled.provider,
      expectedCadence: scheduled.expectedCadence,
      criticality: scheduled.criticality,
      accountableExecutive: scheduled.accountableExecutive,
      lastSchedulerHeartbeat: last?.startedAt ?? null,
      lastSuccess: lastSuccessRun?.completedAt ?? null,
      nextExpectedRun: nextScheduledAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      failureStreak: failureStreak(forJob),
      failureHistory,
      evidenceLink,
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
