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

export interface DraftRequest {
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly cc?: readonly string[];
  /** Stable key so a retried call does not leave two drafts behind. */
  readonly idempotencyKey: string;
}

export interface DraftLedger {
  reference(idempotencyKey: string): string | undefined;
  record(idempotencyKey: string, reference: string): void;
}

export function createEphemeralDraftLedger(): DraftLedger {
  const references = new Map<string, string>();
  return {
    reference: (key) => references.get(key),
    record: (key, reference) => {
      references.set(key, reference);
    },
  };
}

/** One message opened deliberately, body included. */
export interface MailBody {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly body: string;
  /** True when only an HTML part existed and it was reduced to text. */
  readonly convertedFromHtml: boolean;
  readonly truncated: boolean;
  readonly sourceReference: string;
}

/** A body long enough to bury the point is long enough to bury a transcript. */
const maxBodyCharacters = 20000;

function decodeBase64Url(value: string): string {
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

/**
 * Reduces HTML to something readable rather than rendering it.
 *
 * Marketing mail is often HTML-only, and handing the agent raw markup wastes
 * the context it was opened to save and reads as noise to Ming.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Walks Gmail's MIME tree for the part a person would actually read.
 *
 * `text/plain` is preferred; HTML is the fallback because an HTML-only message
 * is common and returning nothing for it would look like an empty email.
 */
export function extractMessageBody(payload: unknown): {
  readonly body: string;
  readonly convertedFromHtml: boolean;
} {
  const plain: string[] = [];
  const html: string[] = [];

  const walk = (node: unknown): void => {
    if (!isRecord(node)) return;
    const mimeType = typeof node["mimeType"] === "string" ? node["mimeType"] : "";
    const body = isRecord(node["body"]) ? node["body"] : undefined;
    const data = body !== undefined && typeof body["data"] === "string" ? body["data"] : undefined;
    if (data !== undefined) {
      if (mimeType.startsWith("text/plain")) plain.push(decodeBase64Url(data));
      else if (mimeType.startsWith("text/html")) html.push(decodeBase64Url(data));
    }
    const parts = node["parts"];
    if (Array.isArray(parts)) for (const part of parts) walk(part);
  };
  walk(payload);

  if (plain.length > 0) {
    return { body: plain.join("\n").trim(), convertedFromHtml: false };
  }
  if (html.length > 0) {
    return { body: htmlToText(html.join("\n")), convertedFromHtml: true };
  }
  return { body: "", convertedFromHtml: false };
}

export interface GmailAdapter extends ProviderAdapter<readonly MailMessage[]> {
  listMessages(query?: MailQuery): Promise<ProviderReadResult<readonly MailMessage[]>>;
  /**
   * Writes a draft into the mailbox and stops there.
   *
   * Sending is deliberately absent, not merely unused: the review surface is
   * Ming's own Gmail client, where he reads the message and presses send
   * himself. An agent that could send would be trusted to have reviewed on his
   * behalf, and no approval relayed through the agent can prove he did.
   */
  createDraft(request: DraftRequest): Promise<ProviderWriteResult>;
  /**
   * Opens one message, body included.
   *
   * Separate from listMessages on purpose: scanning stays headers-only so a
   * sweep of the inbox never puts other people's mail into a transcript, while
   * a message Ming actually asked about can be read in full.
   */
  readMessage(messageId: string): Promise<ProviderReadResult<MailBody>>;
}

/** RFC 2822 for the Gmail drafts endpoint, base64url as the API requires. */
export function encodeDraftMessage(request: DraftRequest): string {
  const headers = [
    `To: ${request.to.join(", ")}`,
    ...(request.cc === undefined || request.cc.length === 0
      ? []
      : [`Cc: ${request.cc.join(", ")}`]),
    `Subject: ${request.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
  ];
  const crlf = "\r\n";
  const raw = `${headers.join(crlf)}${crlf}${crlf}${request.body}`;
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
  readonly draftLedger?: DraftLedger;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
}

export function createGmailAdapter(options: GmailAdapterOptions): GmailAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.draftLedger ?? createEphemeralDraftLedger();
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

  const createDraft: GmailAdapter["createDraft"] = async (draft) => {
    if (draft.idempotencyKey.trim() === "" || draft.to.length === 0) {
      return {
        kind: "failed",
        failure: providerFailure(
          "invalid-input",
          "A draft requires at least one recipient and an idempotency key.",
        ),
      };
    }
    const replayed = ledger.reference(draft.idempotencyKey);
    if (replayed !== undefined) {
      // A retried call returns the draft it already made rather than leaving a
      // second copy in the mailbox for Ming to notice and delete.
      const at = now();
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(replayed, at, at),
        effectReference: replayed,
        deduplicated: true,
      };
    }
    try {
      const response = await request(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ message: { raw: encodeDraftMessage(draft) } }),
        },
      );
      if (!response.ok) {
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `Gmail returned HTTP ${response.status} drafting in ${options.mailbox}.`,
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
            "Gmail accepted the draft but returned no identifier.",
          ),
        };
      }
      const reference = `${gmailProvider}:${options.mailbox}:draft:${id}`;
      ledger.record(draft.idempotencyKey, reference);
      const at = now();
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(reference, at, at),
        effectReference: reference,
        deduplicated: false,
      };
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

  const readMessage: GmailAdapter["readMessage"] = async (messageId) => {
    const retrievedAt = now();
    if (messageId.trim() === "") {
      return {
        kind: "failed",
        failure: providerFailure("invalid-input", "A message id is required."),
      };
    }
    try {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
      );
      url.searchParams.set("format", "full");
      const response = await request(url.toString(), { headers });
      if (!response.ok) {
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `Gmail returned HTTP ${response.status} reading a message in ${options.mailbox}.`,
          ),
        };
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || typeof payload["id"] !== "string") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Gmail returned a message without an identifier.",
          ),
        };
      }
      const rawHeaders = isRecord(payload["payload"])
        ? payload["payload"]["headers"]
        : undefined;
      const messageHeaders = Array.isArray(rawHeaders) ? rawHeaders : [];
      const extracted = extractMessageBody(payload["payload"]);
      const truncated = extracted.body.length > maxBodyCharacters;
      const internalDate = payload["internalDate"];
      const receivedAtMs =
        typeof internalDate === "string" ? Number(internalDate) : Number.NaN;
      const reference = mailSourceReference(options.mailbox, payload["id"]);
      const asOf = Number.isFinite(receivedAtMs)
        ? new Date(receivedAtMs).toISOString()
        : retrievedAt;
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(reference, asOf, retrievedAt),
        value: {
          id: payload["id"],
          threadId:
            typeof payload["threadId"] === "string"
              ? payload["threadId"]
              : payload["id"],
          from: headerValue(messageHeaders, "from"),
          to: headerValue(messageHeaders, "to"),
          subject: headerValue(messageHeaders, "subject"),
          receivedAt: Number.isFinite(receivedAtMs)
            ? new Date(receivedAtMs).toISOString()
            : "",
          // Truncation is reported rather than hidden: an answer drawn from
          // half a message must not read as an answer drawn from all of it.
          body: truncated
            ? extracted.body.slice(0, maxBodyCharacters)
            : extracted.body,
          convertedFromHtml: extracted.convertedFromHtml,
          truncated,
          sourceReference: reference,
        },
      };
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
    capabilities: (): readonly ProviderCapability[] => ["read", "write"],
    read: async (
      readRequest: ProviderReadRequest,
    ): Promise<ProviderReadResult<readonly MailMessage[]>> =>
      listMessages({ query: readRequest.reference }),
    write: async (
      writeRequest: ProviderWriteRequest,
    ): Promise<ProviderWriteResult> => {
      const { to, subject, body, cc } = writeRequest.payload;
      if (!Array.isArray(to) || typeof subject !== "string" || typeof body !== "string") {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A mail write is a draft and needs to, subject and body.",
          ),
        };
      }
      return createDraft({
        to: to.filter((entry): entry is string => typeof entry === "string"),
        subject,
        body,
        ...(Array.isArray(cc)
          ? { cc: cc.filter((entry): entry is string => typeof entry === "string") }
          : {}),
        idempotencyKey: writeRequest.idempotencyKey,
      });
    },
    listMessages,
    createDraft,
    readMessage,
  };
}
