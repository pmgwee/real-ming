import {
  executiveRollUpJobName,
  morningBriefJobName,
} from "../operations/daily-operations-scheduler.js";
import { operatingTimeZone } from "../operations/daily-schedule.js";
import type { NativeScheduledReportJob } from "../operations/native-scheduled-reports.js";

export interface NativeCronJobManifestEntry {
  readonly job: NativeScheduledReportJob;
  readonly name: string;
  /** Standard five-field cron expression interpreted in the host's zone. */
  readonly schedule: string;
  readonly timeZone: typeof operatingTimeZone;
  readonly delivery: "telegram";
  readonly prompt: string;
}

const promptFor = (job: NativeScheduledReportJob): string =>
  [
    `Call the real_ming_run_scheduled_report MCP tool exactly once with job "${job}".`,
    "Return the exact text field from a composed result as your final response so native Hermes delivers it to Telegram.",
    "Do not add a preamble, summary, JSON envelope, or Telegram send call.",
    "If the tool returns a skipped result, return [SILENT] exactly.",
    "If the tool returns a failure, report the failure reason briefly and do not invent a report.",
  ].join(" ");

/**
 * Safe-to-review manifest for the CEO cutover. It contains no chat id, token,
 * or provider credential; the delivery target is supplied to Hermes at
 * activation time from its protected configuration.
 */
export const nativeCronJobManifest: readonly NativeCronJobManifestEntry[] = [
  {
    job: morningBriefJobName,
    name: "Real-Ming Morning Brief",
    schedule: "30 7 * * *",
    timeZone: operatingTimeZone,
    delivery: "telegram",
    prompt: promptFor(morningBriefJobName),
  },
  {
    job: executiveRollUpJobName,
    name: "Real-Ming Executive Roll-Up",
    schedule: "30 21 * * *",
    timeZone: operatingTimeZone,
    delivery: "telegram",
    prompt: promptFor(executiveRollUpJobName),
  },
];
