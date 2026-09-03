/**
 * Every scheduled Real-Ming job runs on Ming's own clock, so the day boundary,
 * the do-not-disturb window and the weekend all resolve against one named zone
 * rather than each job restating the offset.
 */
export const operatingTimeZone = "Asia/Kuala_Lumpur";

/** The operating-day calendar date of an instant, read from the named zone. */
export function operatingDayOf(instant: number): string {
  return new Date(instant).toLocaleDateString("en-CA", {
    timeZone: operatingTimeZone,
  });
}

/** Minutes the named zone is ahead of UTC at that instant. */
function zoneOffsetMinutes(instant: number): number {
  const local = new Date(instant).toLocaleString("sv-SE", {
    timeZone: operatingTimeZone,
  });
  return (Date.parse(`${local.replace(" ", "T")}Z`) - instant) / 60_000;
}

/**
 * Minutes past midnight in the operating zone. This guards the night, so an
 * unreadable clock throws rather than returning a number that quietly reports
 * the do-not-disturb window as closed.
 */
export function minutesIntoDay(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: operatingTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("The operating clock could not be read.");
  }
  // Some ICU builds report midnight as hour 24.
  return (hour % 24) * 60 + minute;
}

/**
 * The instant at a wall-clock time on an operating-day date. One statement of
 * the naive-local-to-UTC conversion, so no job restates it.
 */
export function instantAtLocalTime(
  occurrenceDate: string,
  hour: number,
  minute: number,
): string {
  const naive = Date.parse(
    `${occurrenceDate}T${String(hour).padStart(2, "0")}:${String(
      minute,
    ).padStart(2, "0")}:00.000Z`,
  );
  return new Date(naive - zoneOffsetMinutes(naive) * 60_000).toISOString();
}

export interface DailyOccurrence {
  readonly occurrenceDate: string;
  readonly scheduledAt: string;
  readonly idempotencyKey: string;
}

/**
 * Names the run by its operating-day date, so a retry, a late run, or a run
 * from a differently-configured host all resolve to the same occurrence.
 */
export function dailyOccurrence(options: {
  readonly now: string;
  readonly hour: number;
  readonly minute: number;
  readonly job: string;
}): DailyOccurrence {
  const instant = Date.parse(options.now);
  if (Number.isNaN(instant)) {
    throw new Error(`${options.job} requires a canonical clock.`);
  }
  const occurrenceDate = operatingDayOf(instant);
  return {
    occurrenceDate,
    scheduledAt: instantAtLocalTime(occurrenceDate, options.hour, options.minute),
    idempotencyKey: `${options.job}:${occurrenceDate}`,
  };
}

export interface OperatingDayWindow {
  readonly timeMin: string;
  readonly timeMax: string;
}

/** One operating day, as an instant range a provider can be asked for. */
export function operatingDayWindow(
  occurrenceDate: string,
): OperatingDayWindow {
  const timeMin = instantAtLocalTime(occurrenceDate, 0, 0);
  return {
    timeMin,
    timeMax: new Date(Date.parse(timeMin) + 86_400_000).toISOString(),
  };
}

export function isWeekend(occurrenceDate: string): boolean {
  const day = new Date(`${occurrenceDate}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

export const doNotDisturbStartHour = 23;
export const doNotDisturbEndHour = 7;
export const doNotDisturbStartMinute = doNotDisturbStartHour * 60;
const doNotDisturbEndMinute = doNotDisturbEndHour * 60;

/** 23:00 to 07:00 in the operating zone, wrapping over midnight. */
export function isDoNotDisturb(now: string): boolean {
  const instant = Date.parse(now);
  if (Number.isNaN(instant)) {
    throw new Error("Do-not-disturb requires a canonical clock.");
  }
  const minute = minutesIntoDay(instant);
  return minute >= doNotDisturbStartMinute || minute < doNotDisturbEndMinute;
}
