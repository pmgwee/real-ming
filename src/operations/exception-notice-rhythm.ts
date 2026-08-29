import type { OperationsState } from "./operations-state.js";
import type {
  TelegramNotification,
  TelegramNotificationKind,
  TelegramNotificationResult,
} from "../telegram/contracts.js";
import {
  doNotDisturbEndHour,
  doNotDisturbStartMinute,
  instantAtLocalTime,
  isDoNotDisturb,
  isWeekend,
  minutesIntoDay,
  operatingDayOf,
} from "./daily-schedule.js";

/**
 * An Exception Notice is a direct CEO interruption: a required Approval, a
 * material blocker, a critical incident, or a completed Outcome Report.
 * Telegram is Ming's front door, not a feed, so a notice reaches him only if it
 * is one of those and only at an hour he agreed to be interrupted.
 */
export interface ExceptionNotice extends TelegramNotification {
  /** Marks an Approval whose deadline genuinely cannot wait for 07:00. */
  readonly urgentDeadline?: boolean;
  /** Groups repeated identical errors into one notice until they recover. */
  readonly signature?: string;
}

export type ExceptionNoticeAdmission =
  | { readonly kind: "delivered"; readonly delivery: TelegramNotificationResult }
  | { readonly kind: "held"; readonly releaseAt: string; readonly reason: string }
  | { readonly kind: "suppressed"; readonly reason: string }
  | { readonly kind: "grouped"; readonly occurrences: number }
  | { readonly kind: "already-recovered" };

/**
 * Only these may wake Ming between 23:00 and 07:00: an incident that cannot
 * wait, or an Approval whose deadline expires inside the window.
 */
const doNotDisturbBypass: readonly TelegramNotificationKind[] = [
  "critical-incident",
];

/**
 * A lighter weekend stands down reporting that costs him nothing to read on
 * Monday. Everything that could cost him something — an Approval, a material
 * blocker, a critical incident, and the Roll-Up itself — still runs.
 */
const weekendSuppressed: readonly TelegramNotificationKind[] = [
  "routine-progress",
  "completed-outcome-report",
];

const telegramNotificationKinds: readonly TelegramNotificationKind[] = [
  "brief",
  "approval",
  "material-blocker",
  "critical-incident",
  "completed-outcome-report",
  "recovery-notice",
  "routine-progress",
];

function narrowNotificationKind(value: string): TelegramNotificationKind {
  const found = telegramNotificationKinds.find((kind) => kind === value);
  if (found === undefined) {
    throw new Error(`A held Exception Notice carries an unknown kind: ${value}.`);
  }
  return found;
}

/**
 * A held notice is released when the window ENDS, at the next 07:00 in the
 * operating zone. Held before midnight that is tomorrow morning; held after
 * midnight it is this morning.
 */
function releaseAtFor(now: string): string {
  const instant = Date.parse(now);
  const heldBeforeMidnight = minutesIntoDay(instant) >= doNotDisturbStartMinute;
  const releaseDay = operatingDayOf(
    heldBeforeMidnight ? instant + 86_400_000 : instant,
  );
  return instantAtLocalTime(releaseDay, doNotDisturbEndHour, 0);
}

export interface HeldRelease {
  readonly released: number;
  readonly failed: number;
}

export interface ExceptionNoticeRhythm {
  admit(notice: ExceptionNotice): Promise<ExceptionNoticeAdmission>;
  recordRecovery(signature: string): Promise<ExceptionNoticeAdmission>;
  releaseHeld(): Promise<HeldRelease>;
}

/** A single sweep never floods the front door after a long outage. */
const releaseBatchLimit = 50;

export function createExceptionNoticeRhythm(options: {
  readonly state: OperationsState;
  readonly notify: (
    notification: TelegramNotification,
  ) => Promise<TelegramNotificationResult>;
  readonly now: () => string;
}): ExceptionNoticeRhythm {
  const deliver = async (
    notice: ExceptionNotice,
  ): Promise<ExceptionNoticeAdmission> => {
    const { urgentDeadline: _urgent, signature: _signature, ...outbound } =
      notice;
    const delivery = await options.notify(outbound);
    // The front door may still stand a kind down. Reporting "delivered" for a
    // notice it suppressed would misstate what reached Ming.
    return delivery.kind === "suppressed"
      ? { kind: "suppressed", reason: "front-door-policy" }
      : { kind: "delivered", delivery };
  };

  return {
    async admit(notice): Promise<ExceptionNoticeAdmission> {
      const now = options.now();

      // The weekend stand-down is checked first: reporting is not worth holding
      // until Monday, it is worth not sending.
      if (
        isWeekend(operatingDayOf(Date.parse(now))) &&
        weekendSuppressed.includes(notice.kind)
      ) {
        return { kind: "suppressed", reason: "weekend-rhythm" };
      }

      if (isDoNotDisturb(now)) {
        const bypasses =
          doNotDisturbBypass.includes(notice.kind) ||
          (notice.kind === "approval" && notice.urgentDeadline === true);
        if (!bypasses) {
          // Held, never dropped: stored durably and delivered when the window
          // ends. Returning "held" without storing it would be a silent drop.
          const releaseAt = releaseAtFor(now);
          options.state.holdExceptionNotice({
            idempotencyKey: notice.idempotencyKey,
            kind: notice.kind,
            text: notice.text,
            heldAt: now,
            releaseAt,
          });
          return { kind: "held", releaseAt, reason: "do-not-disturb" };
        }
      }

      if (notice.signature !== undefined) {
        const group = options.state.claimExceptionNoticeGroup(
          notice.signature,
          now,
        );
        if (group.kind === "grouped") {
          return { kind: "grouped", occurrences: group.occurrences };
        }
      }

      return deliver(notice);
    },

    async releaseHeld(): Promise<HeldRelease> {
      const now = options.now();
      let released = 0;
      let failed = 0;
      for (const held of options.state
        .dueHeldExceptionNotices(now)
        .slice(0, releaseBatchLimit)) {
        try {
          // The original idempotency key is preserved, so a crash between the
          // send and the mark is deduplicated by the delivery ledger rather
          // than delivered twice.
          await options.notify({
            kind: narrowNotificationKind(held.kind),
            text: held.text,
            idempotencyKey: held.idempotencyKey,
          });
          options.state.markHeldExceptionNoticeReleased(held.idempotencyKey, now);
          released += 1;
        } catch {
          // One unreachable notice must not strand the rest of the sweep.
          failed += 1;
        }
      }
      return { released, failed };
    },

    async recordRecovery(signature): Promise<ExceptionNoticeAdmission> {
      const now = options.now();
      const recovery = options.state.recordExceptionNoticeRecovery(
        signature,
        now,
      );
      if (recovery.kind === "already-recovered") {
        return { kind: "already-recovered" };
      }
      // Recovery is one notice, whatever the failure count was.
      return deliver({
        kind: "recovery-notice",
        text: `Recovered: ${signature} after ${recovery.occurrences} occurrence${
          recovery.occurrences === 1 ? "" : "s"
        }.`,
        idempotencyKey: `recovery:${signature}:${now}`,
      });
    },
  };
}
