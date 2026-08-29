import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderFailureClass,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteRequest,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const googleCalendarProvider = "google-calendar";

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";

export interface CalendarEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly status: CalendarEventStatus;
  readonly updatedAt: string;
  readonly sourceReference: string;
}

export function calendarSourceReference(
  calendarId: string,
  eventId: string,
): string {
  return `${googleCalendarProvider}:${calendarId}:${eventId}`;
}

export interface CalendarWriteReceipt {
  readonly reference: string;
  readonly payloadDigest: string;
  readonly effectReference: string;
}

export interface CalendarWriteLedger {
  receipt(idempotencyKey: string): CalendarWriteReceipt | undefined;
  record(idempotencyKey: string, receipt: CalendarWriteReceipt): void;
}

export function createEphemeralCalendarWriteLedger(): CalendarWriteLedger {
  const receipts = new Map<string, CalendarWriteReceipt>();
  return {
    receipt: (idempotencyKey) => receipts.get(idempotencyKey),
    record: (idempotencyKey, receipt) => {
      receipts.set(idempotencyKey, receipt);
    },
  };
}

export interface ChangeCalendarEventRequest {
  readonly calendarId: string;
  readonly eventId: string;
  readonly start: string;
  readonly end: string;
  readonly idempotencyKey: string;
}

export interface GoogleCalendarAdapter
  extends ProviderAdapter<readonly CalendarEvent[]> {
  listEvents(
    calendarId: string,
  ): Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  changeEventTime(
    request: ChangeCalendarEventRequest,
  ): Promise<ProviderWriteResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureClassForStatus(status: number): ProviderFailureClass {
  if (status === 401) return "authentication-failed";
  if (status === 403) return "permission-denied";
  if (status === 404) return "invalid-input";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "unavailable";
  return "provider-error";
}

function eventTime(value: unknown): {
  readonly value: string;
  readonly allDay: boolean;
} {
  if (!isRecord(value)) return { value: "", allDay: false };
  if (typeof value["dateTime"] === "string") {
    return { value: value["dateTime"], allDay: false };
  }
  return typeof value["date"] === "string"
    ? { value: value["date"], allDay: true }
    : { value: "", allDay: false };
}

export function normalizeCalendarEvent(
  calendarId: string,
  value: unknown,
): CalendarEvent {
  if (!isRecord(value) || typeof value["id"] !== "string") {
    throw new Error("Google Calendar returned an unreadable event.");
  }
  const start = eventTime(value["start"]);
  const end = eventTime(value["end"]);
  const status = value["status"];
  return {
    id: value["id"],
    calendarId,
    title: typeof value["summary"] === "string" ? value["summary"] : "",
    start: start.value,
    end: end.value,
    allDay: start.allDay || end.allDay,
    status:
      status === "tentative" || status === "cancelled" ? status : "confirmed",
    updatedAt: typeof value["updated"] === "string" ? value["updated"] : "",
    sourceReference: calendarSourceReference(calendarId, value["id"]),
  };
}

export interface GoogleCalendarAdapterOptions {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly writeLedger?: CalendarWriteLedger;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

export function createGoogleCalendarAdapter(
  options: GoogleCalendarAdapterOptions,
): GoogleCalendarAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.writeLedger ?? createEphemeralCalendarWriteLedger();
  const identity: ProviderIdentity = {
    provider: googleCalendarProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
  };

  const provenanceFor = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: googleCalendarProvider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const listEvents: GoogleCalendarAdapter["listEvents"] = async (
    calendarId,
  ) => {
    const retrievedAt = now();
    try {
      const response = await request(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calendarId,
        )}/events?singleEvents=true&orderBy=startTime`,
        { headers },
      );
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "");
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `Google Calendar read failed with HTTP ${response.status}.`,
            [options.accessToken],
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : undefined,
          ),
        };
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body["items"])) {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Google Calendar returned an unreadable event list.",
            [options.accessToken],
          ),
        };
      }
      const value = body["items"].map((item) =>
        normalizeCalendarEvent(calendarId, item),
      );
      // A read has to be datable. Dating it by the retrieval time instead
      // would let a stale or unknown calendar be reported as a healthy empty
      // one, which is the one thing calendar reads must never do.
      const asOf =
        typeof body["updated"] === "string"
          ? body["updated"]
          : value.reduce(
              (latest, event) =>
                event.updatedAt > latest ? event.updatedAt : latest,
              "",
            );
      if (asOf === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Google Calendar returned no as-of time, so the calendar state cannot be dated.",
            [options.accessToken],
          ),
        };
      }
      const provenance = provenanceFor(calendarId, asOf, retrievedAt);
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "provider-error",
          error instanceof Error
            ? error.message
            : "Google Calendar read could not be read.",
          [options.accessToken],
        ),
      };
    }
  };

  const changeEventTime: GoogleCalendarAdapter["changeEventTime"] = async (
    change,
  ) => {
    const reference = calendarSourceReference(
      change.calendarId,
      change.eventId,
    );
    const retrievedAt = now();
    const payloadDigest = `${change.start}/${change.end}`;
    const replayed = ledger.receipt(change.idempotencyKey);
    if (replayed !== undefined) {
      // A key that was used for a different change is a caller error, not a
      // replay. Reporting it as deduplicated would silently drop the change.
      if (
        replayed.reference !== reference ||
        replayed.payloadDigest !== payloadDigest
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A calendar idempotency key was reused for a different effect.",
          ),
        };
      }
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(reference, retrievedAt, retrievedAt),
        effectReference: replayed.effectReference,
        deduplicated: true,
      };
    }

    try {
      const response = await request(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          change.calendarId,
        )}/events/${encodeURIComponent(change.eventId)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            start: { dateTime: change.start },
            end: { dateTime: change.end },
          }),
        },
      );
      if (!response.ok) {
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `Google Calendar write failed with HTTP ${response.status}.`,
            [options.accessToken],
          ),
        };
      }
      const body: unknown = await response.json();
      const effectReference =
        isRecord(body) && typeof body["etag"] === "string"
          ? body["etag"]
          : change.idempotencyKey;
      ledger.record(change.idempotencyKey, {
        reference,
        payloadDigest,
        effectReference,
      });
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(
          reference,
          isRecord(body) && typeof body["updated"] === "string"
            ? body["updated"]
            : retrievedAt,
          retrievedAt,
        ),
        effectReference,
        deduplicated: false,
      };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          error instanceof Error
            ? error.message
            : "Google Calendar write failed.",
          [options.accessToken],
        ),
      };
    }
  };

  const capabilities: readonly ProviderCapability[] = ["read", "write"];

  return {
    identity: () => identity,
    capabilities: () => capabilities,
    read: (readRequest: ProviderReadRequest) =>
      readRequest.reference.trim() === ""
        ? Promise.resolve({
            kind: "failed" as const,
            failure: providerFailure(
              "invalid-input",
              "A calendar read requires a calendar reference.",
            ),
          })
        : listEvents(readRequest.reference),
    write: async (writeRequest: ProviderWriteRequest) => {
      const sensitiveFields = detectSensitiveFields(writeRequest.payload);
      if (sensitiveFields.length > 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            `A calendar write rejected Sensitive Secret fields: ${sensitiveFields.join(", ")}.`,
          ),
        };
      }
      const start = writeRequest.payload["start"];
      const end = writeRequest.payload["end"];
      const eventId = writeRequest.payload["eventId"];
      if (
        writeRequest.idempotencyKey.trim() === "" ||
        writeRequest.reference.trim() === "" ||
        start === undefined ||
        end === undefined ||
        eventId === undefined
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A calendar write requires an idempotency key, a calendar, an event, a start and an end.",
          ),
        };
      }
      return changeEventTime({
        calendarId: writeRequest.reference,
        eventId,
        start,
        end,
        idempotencyKey: writeRequest.idempotencyKey,
      });
    },
    listEvents,
    changeEventTime,
  };
}
