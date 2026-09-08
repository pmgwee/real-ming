import type {
  NativeScheduledReportRequest,
  NativeScheduledReportResult,
} from "../operations/native-scheduled-reports.js";
import type { RealMingToolResult } from "./real-ming-tools.js";

/** A narrow client used by the MCP process; it never sends Telegram itself. */
export interface NativeCronReportClient {
  run(request: NativeScheduledReportRequest): Promise<RealMingToolResult>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNativeReportResult(value: unknown): value is NativeScheduledReportResult {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  if (value["kind"] === "composed") {
    return (
      typeof value["job"] === "string" &&
      typeof value["occurrenceDate"] === "string" &&
      typeof value["scheduledAt"] === "string" &&
      typeof value["runId"] === "string" &&
      typeof value["payloadDigest"] === "string" &&
      typeof value["text"] === "string" &&
      typeof value["replayed"] === "boolean"
    );
  }
  return typeof value["reason"] === "string";
}

export function createNativeCronReportClient(options: {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}): NativeCronReportClient {
  const request = options.fetch ?? fetch;
  return {
    async run(input): Promise<RealMingToolResult> {
      try {
        const response = await request(options.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return {
            kind: "failed",
            reason: `Native cron endpoint returned HTTP ${response.status} without JSON.`,
          };
        }
        if (!response.ok) {
          const reason =
            isRecord(body) && typeof body["message"] === "string"
              ? body["message"]
              : `Native cron endpoint returned HTTP ${response.status}.`;
          return { kind: "failed", reason };
        }
        if (!isNativeReportResult(body)) {
          return {
            kind: "failed",
            reason: "Native cron endpoint returned an unreadable result.",
          };
        }
        return body.kind === "failed"
          ? { kind: "failed", reason: body.reason }
          : { kind: "ok", value: body };
      } catch {
        // The transport error deliberately carries no URL or provider detail
        // into the agent response. The dashboard owns the diagnostic record.
        return {
          kind: "failed",
          reason: "Native cron composition endpoint is unavailable.",
        };
      }
    },
  };
}
