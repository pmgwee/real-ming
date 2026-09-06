export type CycleOutcome =
  | { readonly kind: "ran" }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" };

export interface ControlPlaneCycle {
  readonly at: string;
  readonly telegram: CycleOutcome;
  readonly schedule: CycleOutcome;
}

export interface ControlPlaneSupervisor {
  runCycle(): Promise<ControlPlaneCycle>;
  run(): Promise<void>;
  running(): boolean;
  stop(): void;
}

/**
 * Runs the two long-lived loops of the control plane in one process: Telegram
 * ingress, so the CEO is answered while his laptop is shut, and the daily
 * schedule, so the brief and the roll-up fire on their own.
 *
 * They share a process but must not share a fate. A Telegram outage that took
 * the scheduler down would silently cancel the day's brief and roll-up, and
 * the CEO would notice only by their absence. So each loop is isolated: one
 * failing is recorded and the other still runs.
 *
 * Nothing about the cause of a failure enters the cycle record. These records
 * go to the service journal on every pass, and a provider's exception message
 * routinely carries the request URL, which for Telegram contains the bot token.
 *
 * Under Architecture Revision 6 the native Hermes gateway owns the Telegram
 * consumer, so `pollTelegram` is omitted and the ingress loop reports
 * `stopped`. That is deliberately distinct from `failed`: a health record
 * claiming a failed ingress would page the CEO about a migration that worked.
 */
export function createControlPlaneSupervisor(options: {
  /** Omitted when another process owns the single Telegram consumer. */
  readonly pollTelegram?: () => Promise<unknown>;
  readonly tickSchedule: () => Promise<unknown>;
  readonly now: () => string;
  readonly wait?: () => Promise<void>;
  readonly onCycle?: (cycle: ControlPlaneCycle) => void;
}): ControlPlaneSupervisor {
  let stopped = false;
  const wait = options.wait ?? (() => new Promise<void>((resolve) => {
    setTimeout(resolve, 1_000);
  }));

  async function attempt(work: () => Promise<unknown>): Promise<CycleOutcome> {
    if (stopped) return { kind: "stopped" };
    try {
      await work();
      return { kind: "ran" };
    } catch {
      return { kind: "failed" };
    }
  }

  const supervisor: ControlPlaneSupervisor = {
    async runCycle(): Promise<ControlPlaneCycle> {
      const poll = options.pollTelegram;
      const telegram: CycleOutcome =
        poll === undefined ? { kind: "stopped" } : await attempt(poll);
      const schedule = await attempt(options.tickSchedule);
      const cycle = { at: options.now(), telegram, schedule };
      // Bookkeeping about the loops must not be able to kill the loops. This
      // call was outside the isolation above, so a throw from the health write
      // -- a full disk, SQLITE_BUSY, a corrupt page -- propagated out of run()
      // and exited the process, even though both loops had just succeeded.
      // systemd restarts, so the cost was a crash loop rather than an outage,
      // but it contradicted the guarantee this comment makes.
      try {
        options.onCycle?.(cycle);
      } catch {
        // Nothing to escalate to: the recorder is what failed.
      }
      return cycle;
    },
    async run(): Promise<void> {
      while (!stopped) {
        await supervisor.runCycle();
        if (!stopped) await wait();
      }
    },
    running: () => !stopped,
    stop: () => {
      stopped = true;
    },
  };
  return supervisor;
}
