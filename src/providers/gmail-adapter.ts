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

export const gmailProvider = "gmail";

/**
 * A mailbox read, reduced to what a briefing actually reads out.
 *
 * Deliberately no message body. The agent answers "what needs your reply" and
 * "did anyone respond about the job" from headers and Gmail's own snippet; a
 * full body would put the contents of Ming's mail into a Telegram transcript
 * and every session summary that follows it.
 */
export interface MailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly receivedAt: string;
  readonly unread: boolean;
  readonly sourceReference: string;
}

export function mailSourceReference(
  mailbox: string,
  messageId: string,
): string {
  return `${gmailProvider}:${mailbox}:${messageId}`;
}

export interface MailQuery {
  /** Gmail search syntax, e.g. `is:unread newer_than:7d`. */
  readonly query?: string;
  readonly limit?: number;
}

export interface GmailAdapter extends ProviderAdapter<readonly MailMessage[]> {
  listMessages(query?: MailQuery): Promise<ProviderReadResult<readonly MailMessage[]>>;
}

/** Gmail caps a page at 500; a briefing never needs more than a screenful. */
const defaultMessageLimit = 25;
const maxMessageLimit = 100;

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

function headerValue(
  headers: readonly unknown[],
  name: string,
): string {
  for (const header of headers) {
    if (!isRecord(header)) continue;
    if (
      typeof header["name"] === "string" &&
      header["name"].toLowerCase() === name &&
      typeof header["value"] === "string"
    ) {
      return header["value"];
    }
  }
  return "";
}

/**
 * Gmail reports receipt as epoch milliseconds in a string. Parsing it here
 * keeps every consumer on one ISO instant rather than each inventing its own
 * interpretation of the raw field.
 */
export function normalizeMailMessage(
  mailbox: string,
  payload: unknown,
): MailMessage | undefined {
  if (!isRecord(payload)) return undefined;
  const id = payload["id"];
  if (typeof id !== "string" || id.length === 0) return undefined;
  const rawHeaders = isRecord(payload["payload"])
    ? payload["payload"]["headers"]
    : undefined;
  const headers = Array.isArray(rawHeaders) ? rawHeaders : [];
  const labels = Array.isArray(payload["labelIds"]) ? payload["labelIds"] : [];
  const internalDate = payload["internalDate"];
  const receivedAtMs =
    typeof internalDate === "string" ? Number(internalDate) : Number.NaN;
  return {
    id,
    threadId: typeof payload["threadId"] === "string" ? payload["threadId"] : id,
    from: headerValue(headers, "from"),
    subject: headerValue(headers, "subject"),
    snippet: typeof payload["snippet"] === "string" ? payload["snippet"] : "",
    receivedAt: Number.isFinite(receivedAtMs)
      ? new Date(receivedAtMs).toISOString()
      : "",
    unread: labels.includes("UNREAD"),
    sourceReference: mailSourceReference(mailbox, id),
  };
}

export interface GmailAdapterOptions {
  readonly accessToken: string;
  readonly workspaceId: string;
  /** The mailbox this credential reads, e.g. `perminggwee@gmail.com`. */
  readonly mailbox: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

export function createGmailAdapter(options: GmailAdapterOptions): GmailAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: gmailProvider,
    workspaceId: options.workspaceId,
    accountReference: options.mailbox,
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
    sourceIdentity: gmailProvider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const listMessages: GmailAdapter["listMessages"] = async (query) => {
    const retrievedAt = now();
    const reference = mailSourceReference(options.mailbox, "search");
    const limit = Math.min(
      Math.max(query?.limit ?? defaultMessageLimit, 1),
      maxMessageLimit,
    );
    const listUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set("maxResults", String(limit));
    if (query?.query !== undefined && query.query.trim().length > 0) {
      listUrl.searchParams.set("q", query.query.trim());
    }

    try {
      const listed = await request(listUrl.toString(), { headers });
      if (!listed.ok) {
        const retryAfter = Number(listed.headers.get("retry-after") ?? "");
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(listed.status),
            `Gmail returned HTTP ${listed.status} listing ${options.mailbox}.`,
            [],
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : undefined,
          ),
        };
      }
      const body: unknown = await listed.json();
      const rawMessages = isRecord(body) ? body["messages"] : undefined;
      const ids = (Array.isArray(rawMessages) ? rawMessages : [])
        .map((entry) => (isRecord(entry) ? entry["id"] : undefined))
        .filter((id): id is string => typeof id === "string");

      // Gmail's list endpoint returns identifiers only. The metadata format
      // asks for the three headers a briefing reads and never the body, so a
      // wider scope than gmail.readonly is never needed and message contents
      // never enter a transcript.
      const messages: MailMessage[] = [];
      let latestReceived: string | undefined;
      for (const id of ids) {
        const detailUrl = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
        );
        detailUrl.searchParams.set("format", "metadata");
        for (const header of ["From", "Subject", "Date"]) {
          detailUrl.searchParams.append("metadataHeaders", header);
        }
        const detail = await request(detailUrl.toString(), { headers });
        if (!detail.ok) {
          return {
            kind: "failed",
            failure: providerFailure(
              failureClassForStatus(detail.status),
              `Gmail returned HTTP ${detail.status} reading a message in ${options.mailbox}.`,
            ),
          };
        }
        const message = normalizeMailMessage(
          options.mailbox,
          await detail.json(),
        );
        if (message === undefined) continue;
        messages.push(message);
        if (
          message.receivedAt !== "" &&
          (latestReceived === undefined || message.receivedAt > latestReceived)
        ) {
          latestReceived = message.receivedAt;
        }
      }

      // With no message there is no provider-side timestamp to trust, so the
      // read is dated by when it happened rather than being called stale.
      const asOf = latestReceived ?? retrievedAt;
      const provenance = provenanceFor(reference, asOf, retrievedAt);
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value: messages }
        : { kind: "ok", identity, provenance, value: messages };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          error instanceof Error
            ? `Gmail is unreachable: ${error.message}`
            : "Gmail is unreachable.",
        ),
      };
    }
  };

  return {
    identity: () => identity,
    capabilities: (): readonly ProviderCapability[] => ["read"],
    read: async (
      readRequest: ProviderReadRequest,
    ): Promise<ProviderReadResult<readonly MailMessage[]>> =>
      listMessages({ query: readRequest.reference }),
    write: async (_: ProviderWriteRequest): Promise<ProviderWriteResult> => ({
      kind: "failed",
      failure: providerFailure(
        "permission-denied",
        // The credential is minted with gmail.readonly on purpose. Refusing
        // here means a write attempt fails as a stated boundary rather than as
        // an opaque 403 from Google.
        "Real-Ming reads mail and never writes it.",
      ),
    }),
    listMessages,
  };
}
