import type {
  MailMessageBody,
  MailReadResult,
  CalendarAgendaClient,
  CalendarAgendaEntry,
  CalendarAgendaResult,
  MailSearchResult,
  MailSummary,
  MailboxClient,
  ProviderWriteOutcome,
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
  const { id, from, subject, snippet, receivedAt, unread } = value;
  if (
    typeof id !== "string" ||
    typeof from !== "string" ||
    typeof subject !== "string" ||
    typeof snippet !== "string" ||
    typeof receivedAt !== "string" ||
    typeof unread !== "boolean"
  ) {
    return undefined;
  }
  return { id, from, subject, snippet, receivedAt, unread };
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

/** Reads a write result the control plane returned, or says why it cannot. */
async function postWrite(
  options: BridgeOptions,
  body: Record<string, unknown>,
): Promise<ProviderWriteOutcome> {
  const result = await post(options, body);
  if (!result.ok) return { kind: "unavailable", reason: result.reason };
  if (!isRecord(result.body) || result.body["kind"] !== "ok") {
    return {
      kind: "unavailable",
      reason:
        isRecord(result.body) && typeof result.body["reason"] === "string"
          ? result.body["reason"]
          : "the control plane returned an unreadable result",
    };
  }
  const reference = result.body["reference"];
  if (typeof reference !== "string") {
    // Without a reference there is nothing to point at later, and reporting
    // success would claim an effect nobody can find.
    return {
      kind: "unavailable",
      reason: "the control plane reported success without a reference",
    };
  }
  return {
    kind: "ok",
    reference,
    deduplicated: result.body["deduplicated"] === true,
  };
}

export function createBridgedCalendarClient(
  options: BridgeOptions & { readonly createEndpoint?: string },
): CalendarAgendaClient {
  return {
    ...(options.createEndpoint === undefined
      ? {}
      : {
          createEvent: (request) =>
            postWrite(
              { ...options, endpoint: options.createEndpoint as string },
              { ...request },
            ),
        }),
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
      const retrievedAt = isRecord(result.body)
        ? result.body["retrievedAt"]
        : undefined;
      return {
        kind: "ok",
        events: raw
          .map(calendarEntry)
          .filter((entry): entry is CalendarAgendaEntry => entry !== undefined),
        ...(typeof retrievedAt === "string" ? { retrievedAt } : {}),
      };
    },
  };
}

export function createBridgedMailboxClient(
  options: BridgeOptions & {
    readonly mailboxes: readonly string[];
    readonly draftEndpoint?: string;
    readonly readEndpoint?: string;
  },
): MailboxClient {
  return {
    mailboxes: options.mailboxes,
    ...(options.readEndpoint === undefined
      ? {}
      : {
          read: async (request): Promise<MailReadResult> => {
            const result = await post(
              { ...options, endpoint: options.readEndpoint as string },
              { ...request },
            );
            if (!result.ok) {
              return { kind: "unavailable", reason: result.reason };
            }
            if (!isRecord(result.body) || result.body["kind"] !== "ok") {
              return {
                kind: "unavailable",
                reason:
                  isRecord(result.body) && typeof result.body["reason"] === "string"
                    ? result.body["reason"]
                    : "the control plane returned an unreadable message",
              };
            }
            const m = result.body["message"];
            if (!isRecord(m) || typeof m["body"] !== "string") {
              return {
                kind: "unavailable",
                reason: "the control plane returned a message with no body",
              };
            }
            const message: MailMessageBody = {
              from: typeof m["from"] === "string" ? m["from"] : "",
              to: typeof m["to"] === "string" ? m["to"] : "",
              subject: typeof m["subject"] === "string" ? m["subject"] : "",
              receivedAt:
                typeof m["receivedAt"] === "string" ? m["receivedAt"] : "",
              body: m["body"],
              convertedFromHtml: m["convertedFromHtml"] === true,
              truncated: m["truncated"] === true,
            };
            return { kind: "ok", message };
          },
        }),
    ...(options.draftEndpoint === undefined
      ? {}
      : {
          draft: (request) =>
            postWrite(
              { ...options, endpoint: options.draftEndpoint as string },
              { ...request },
            ),
        }),
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
      const retrievedAt = isRecord(result.body)
        ? result.body["retrievedAt"]
        : undefined;
      return {
        kind: "ok",
        messages: raw
          .map(mailSummary)
          .filter((entry): entry is MailSummary => entry !== undefined),
        ...(typeof retrievedAt === "string" ? { retrievedAt } : {}),
      };
    },
  };
}
