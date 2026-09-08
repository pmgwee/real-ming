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

/**
 * A read scoped to the days the caller actually cares about. Without it Google
 * returns its default 250 events ordered from the beginning of time, so a
 * calendar with recurring history answers with its OLDEST events and omits
 * today while still looking healthy.
 */
export interface CalendarWindow {
  readonly timeMin?: string;
  readonly timeMax?: string;
}

/** Google caps a page at 2500; ask explicitly rather than inherit its default of 250. */
const calendarPageSize = 2500;
const calendarPageLimit = 20;

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

export interface CreateCalendarEventRequest {
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly description?: string;
  readonly location?: string;
  /** Stable key so a retried call does not double-book the day. */
  readonly idempotencyKey: string;
}

export interface GoogleCalendarAdapter
  extends ProviderAdapter<readonly CalendarEvent[]> {
  listEvents(
    calendarId: string,
    window?: CalendarWindow,
  ): Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  changeEventTime(
    request: ChangeCalendarEventRequest,
  ): Promise<ProviderWriteResult>;
  createEvent(
    request: CreateCalendarEventRequest,
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
    window,
  ) => {
    const retrievedAt = now();
    const pageOf = (pageToken?: string): string => {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          calendarId,
        )}/events`,
      );
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", String(calendarPageSize));
      if (window?.timeMin !== undefined) {
        url.searchParams.set("timeMin", window.timeMin);
      }
      if (window?.timeMax !== undefined) {
        url.searchParams.set("timeMax", window.timeMax);
      }
      if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
      return url.toString();
    };
    try {
      const collected: CalendarEvent[] = [];
      let latestUpdated: string | undefined;
      let pageToken: string | undefined;
      let pages = 0;
      let response = await request(pageOf(), { headers });
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
      let body: unknown = await response.json();
      for (;;) {
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
        for (const item of body["items"]) {
          collected.push(normalizeCalendarEvent(calendarId, item));
        }
        if (typeof body["updated"] === "string") latestUpdated = body["updated"];
        const next = body["nextPageToken"];
        pageToken = typeof next === "string" && next !== "" ? next : undefined;
        pages += 1;
        // A page cap that silently truncated would be the same defect as the
        // unpaged read: a partial calendar reported as the whole one.
        if (pageToken === undefined) break;
        if (pages >= calendarPageLimit) {
          return {
            kind: "failed",
            failure: providerFailure(
              "provider-error",
              `Google Calendar returned more than ${calendarPageLimit} pages; the window is too wide to read honestly.`,
              [options.accessToken],
            ),
          };
        }
        response = await request(pageOf(pageToken), { headers });
        if (!response.ok) {
          return {
            kind: "failed",
            failure: providerFailure(
              failureClassForStatus(response.status),
              `Google Calendar read failed with HTTP ${response.status}.`,
              [options.accessToken],
            ),
          };
        }
        body = await response.json();
      }
      const value: readonly CalendarEvent[] = collected;
      // A read has to be datable. Dating it by the retrieval time instead
      // would let a stale or unknown calendar be reported as a healthy empty
      // one, which is the one thing calendar reads must never do.
      const asOf =
        latestUpdated !== undefined
          ? latestUpdated
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

  const createEvent: GoogleCalendarAdapter["createEvent"] = async (event) => {
    const retrievedAt = now();
    const reference = `${event.calendarId}:new`;
    const payloadDigest = `${event.title}|${event.start}|${event.end}`;
    if (
      event.idempotencyKey.trim() === "" ||
      event.calendarId.trim() === "" ||
      event.title.trim() === "" ||
      event.start.trim() === "" ||
      event.end.trim() === ""
    ) {
      return {
        kind: "failed",
        failure: providerFailure(
          "invalid-input",
          "Creating an event needs a calendar, a title, a start, an end and an idempotency key.",
        ),
      };
    }
    const replayed = ledger.receipt(event.idempotencyKey);
    if (replayed !== undefined) {
      if (replayed.payloadDigest !== payloadDigest) {
        // Reusing a key for different details would silently overwrite the
        // meaning of the first booking in the record.
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A calendar idempotency key was reused for a different event.",
          ),
        };
      }
      // A retry must not put a second copy of the meeting on the day.
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
          event.calendarId,
        )}/events`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            summary: event.title,
            start: { dateTime: event.start },
            end: { dateTime: event.end },
            ...(event.description === undefined
              ? {}
              : { description: event.description }),
            ...(event.location === undefined
              ? {}
              : { location: event.location }),
          }),
        },
      );
      if (!response.ok) {
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `Google Calendar returned HTTP ${response.status} creating an event.`,
          ),
        };
      }
      const body: unknown = await response.json();
      const id = isRecord(body) && typeof body["id"] === "string" ? body["id"] : "";
      if (id === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Google Calendar accepted the event but returned no identifier.",
          ),
        };
      }
      const effectReference = calendarSourceReference(event.calendarId, id);
      ledger.record(event.idempotencyKey, {
        reference,
        payloadDigest,
        effectReference,
      });
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(reference, retrievedAt, retrievedAt),
        effectReference,
        deduplicated: false,
      };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          error instanceof Error
            ? `Google Calendar is unreachable: ${error.message}`
            : "Google Calendar is unreachable.",
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
    createEvent,
  };
}
