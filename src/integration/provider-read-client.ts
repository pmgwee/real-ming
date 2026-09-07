import type {
  CalendarAgendaClient,
  CalendarAgendaEntry,
  CalendarAgendaResult,
  MailSearchResult,
  MailSummary,
  MailboxClient,
} from "./real-ming-tools.js";

/**
 * The MCP process reaching provider reads over the loopback bridge.
 *
 * Hermes gives an MCP child only its own declared environment, so this process
 * has no Key Vault access and no Google credential. Asking the control plane
 * keeps every Google secret in the one process that already holds them.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function calendarEntry(value: unknown): CalendarAgendaEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { title, start, end, allDay, status } = value;
  if (
    typeof title !== "string" ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    typeof allDay !== "boolean" ||
    typeof status !== "string"
  ) {
    return undefined;
  }
  return { title, start, end, allDay, status };
}

function mailSummary(value: unknown): MailSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { from, subject, snippet, receivedAt, unread } = value;
  if (
    typeof from !== "string" ||
    typeof subject !== "string" ||
    typeof snippet !== "string" ||
    typeof receivedAt !== "string" ||
    typeof unread !== "boolean"
  ) {
    return undefined;
  }
  return { from, subject, snippet, receivedAt, unread };
}

interface BridgeOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

async function post(
  options: BridgeOptions,
  body: Record<string, unknown>,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly reason: string }> {
  const request = options.fetch ?? fetch;
  try {
    const response = await request(options.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        ok: false,
        reason: `the control plane returned HTTP ${response.status} without JSON`,
      };
    }
    if (!response.ok) {
      const reason =
        isRecord(parsed) && typeof parsed["error"] === "string"
          ? parsed["error"]
          : `the control plane returned HTTP ${response.status}`;
      return { ok: false, reason };
    }
    return { ok: true, body: parsed };
  } catch {
    // The transport error deliberately carries no URL or credential detail
    // into an agent response. The control plane owns the diagnostic record.
    return { ok: false, reason: "the control plane is unreachable" };
  }
}

export function createBridgedCalendarClient(
  options: BridgeOptions,
): CalendarAgendaClient {
  return {
    async listEvents(request): Promise<CalendarAgendaResult> {
      const result = await post(options, { ...request });
      if (!result.ok) return { kind: "unavailable", reason: result.reason };
      if (isRecord(result.body) && result.body["kind"] === "unavailable") {
        return {
          kind: "unavailable",
          reason:
            typeof result.body["reason"] === "string"
              ? result.body["reason"]
              : "the calendar reported no reason",
        };
      }
      const raw = isRecord(result.body) ? result.body["events"] : undefined;
      if (!Array.isArray(raw)) {
        return {
          kind: "unavailable",
          reason: "the control plane returned an unreadable agenda",
        };
      }
      // A malformed entry is dropped rather than passed through half-empty,
      // which would render as an event with no title at a time of "".
      return {
        kind: "ok",
        events: raw
          .map(calendarEntry)
          .filter((entry): entry is CalendarAgendaEntry => entry !== undefined),
      };
    },
  };
}

export function createBridgedMailboxClient(
  options: BridgeOptions & { readonly mailboxes: readonly string[] },
): MailboxClient {
  return {
    mailboxes: options.mailboxes,
    async search(request): Promise<MailSearchResult> {
      const result = await post(options, { ...request });
      if (!result.ok) return { kind: "unavailable", reason: result.reason };
      if (isRecord(result.body) && result.body["kind"] === "unavailable") {
        return {
          kind: "unavailable",
          reason:
            typeof result.body["reason"] === "string"
              ? result.body["reason"]
              : "the mailbox reported no reason",
        };
      }
      const raw = isRecord(result.body) ? result.body["messages"] : undefined;
      if (!Array.isArray(raw)) {
        return {
          kind: "unavailable",
          reason: "the control plane returned an unreadable mailbox",
        };
      }
      return {
        kind: "ok",
        messages: raw
          .map(mailSummary)
          .filter((entry): entry is MailSummary => entry !== undefined),
      };
    },
  };
}
