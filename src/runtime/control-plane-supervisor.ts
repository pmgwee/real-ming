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
 */
export function createControlPlaneSupervisor(options: {
  readonly pollTelegram: () => Promise<unknown>;
  readonly tickSchedule: () => Promise<unknown>;
  readonly now: () => string;
}): ControlPlaneSupervisor {
  let stopped = false;

  async function attempt(work: () => Promise<unknown>): Promise<CycleOutcome> {
    if (stopped) return { kind: "stopped" };
    try {
      await work();
      return { kind: "ran" };
    } catch {
      return { kind: "failed" };
    }
  }

  return {
    async runCycle(): Promise<ControlPlaneCycle> {
      const telegram = await attempt(options.pollTelegram);
      const schedule = await attempt(options.tickSchedule);
      return { at: options.now(), telegram, schedule };
    },
    running: () => !stopped,
    stop: () => {
      stopped = true;
    },
  };
}
