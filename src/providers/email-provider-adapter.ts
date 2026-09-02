import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderFailureClass,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const gmailProvider = "gmail";

export interface EmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly mailbox: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly snippet: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly labels: readonly string[];
  readonly sourceReference: string;
}

export interface EmailDraft {
  readonly id: string;
  readonly messageId: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly sourceReference: string;
}

export interface EmailDraftLedger {
  receipt(idempotencyKey: string): { readonly payloadDigest: string; readonly effectReference: string; readonly draft?: EmailDraft } | undefined;
  record(idempotencyKey: string, receipt: { readonly payloadDigest: string; readonly effectReference: string }): void;
  close?(): void;
}

export function createEphemeralEmailDraftLedger(): EmailDraftLedger {
  const receipts = new Map<string, { readonly payloadDigest: string; readonly effectReference: string }>();
  return {
    receipt: (key) => receipts.get(key),
    record: (key, receipt) => receipts.set(key, receipt),
  };
}

export class SqliteEmailDraftLedger implements EmailDraftLedger {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS email_draft_receipts (
        idempotency_key TEXT PRIMARY KEY,
        payload_digest TEXT NOT NULL,
        effect_reference TEXT NOT NULL
      );
    `);
  }

  receipt(idempotencyKey: string) {
    const row = this.#database.prepare("SELECT payload_digest, effect_reference FROM email_draft_receipts WHERE idempotency_key = ?").get(idempotencyKey) as unknown as { payload_digest: string; effect_reference: string } | undefined;
    return row === undefined ? undefined : { payloadDigest: row.payload_digest, effectReference: row.effect_reference };
  }

  record(idempotencyKey: string, receipt: { readonly payloadDigest: string; readonly effectReference: string }): void {
    this.#database.prepare("INSERT INTO email_draft_receipts (idempotency_key, payload_digest, effect_reference) VALUES (?, ?, ?)").run(idempotencyKey, receipt.payloadDigest, receipt.effectReference);
  }

  close(): void {
    this.#database.close();
  }
}

export interface GmailEmailAdapter extends ProviderAdapter<readonly EmailMessage[]> {
  listMessages(request: {
    readonly mailbox: string;
    readonly query?: string;
    readonly maxResults?: number;
  }): Promise<ProviderReadResult<readonly EmailMessage[]>>;
  createDraft(request: {
    readonly mailbox: string;
    readonly to: readonly string[];
    readonly cc?: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<ProviderWriteResult & { readonly draft?: EmailDraft }>;
}

interface GmailAdapterOptions {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly draftLedger?: EmailDraftLedger;
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

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function header(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return "";
  const match = headers.find((item) => isRecord(item) && typeof item["name"] === "string" && item["name"].toLowerCase() === name.toLowerCase());
  return isRecord(match) && typeof match["value"] === "string" ? match["value"] : "";
}

function addresses(value: string): readonly string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function bodyFromPayload(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload["body"] === "string") return decodeBase64Url(payload["body"]);
  const data = isRecord(payload["body"]) ? payload["body"]["data"] : undefined;
  if (typeof data === "string") return decodeBase64Url(data);
  const parts = payload["parts"];
  if (!Array.isArray(parts)) return "";
  for (const part of parts) {
    const nested = bodyFromPayload(part);
    if (nested.length > 0) return nested;
  }
  return "";
}

function normalizeMessage(mailbox: string, value: unknown): EmailMessage {
  if (!isRecord(value) || typeof value["id"] !== "string") throw new Error("Gmail returned an unreadable message.");
  const payload = value["payload"];
  const headers = isRecord(payload) ? payload["headers"] : undefined;
  const receivedAt = typeof value["internalDate"] === "string" && Number.isFinite(Number(value["internalDate"]))
    ? new Date(Number(value["internalDate"])).toISOString()
    : header(headers, "Date");
  const raw = {
    id: value["id"],
    threadId: typeof value["threadId"] === "string" ? value["threadId"] : value["id"],
    mailbox,
    from: header(headers, "From"),
    to: addresses(header(headers, "To")),
    subject: header(headers, "Subject"),
    snippet: typeof value["snippet"] === "string" ? value["snippet"] : "",
    body: bodyFromPayload(payload),
    receivedAt,
    labels: Array.isArray(value["labelIds"]) ? value["labelIds"].filter((label): label is string => typeof label === "string") : [],
    sourceReference: `${gmailProvider}:${mailbox}:message:${value["id"]}`,
  };
  const sensitive = detectSensitiveFields({ from: raw.from, to: raw.to.join(","), subject: raw.subject, snippet: raw.snippet, body: raw.body });
  return sensitive.length === 0
    ? raw
    : { ...raw, from: "[redacted]", to: ["[redacted]"], subject: "[redacted]", snippet: "[redacted]", body: "[redacted]" };
}

export function createGmailEmailAdapter(options: GmailAdapterOptions): GmailEmailAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.draftLedger ?? createEphemeralEmailDraftLedger();
  const identity: ProviderIdentity = {
    provider: gmailProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const headers = { Authorization: `Bearer ${options.accessToken}`, "Content-Type": "application/json" };
  const provenanceFor = (reference: string, asOf: string, retrievedAt: string): ProviderProvenance => ({
    sourceIdentity: gmailProvider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness: Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs ? "stale" : "current",
  });
  const fail = (status: number, action: string): ProviderReadResult<readonly EmailMessage[]> => ({
    kind: "failed",
    failure: providerFailure(failureClassForStatus(status), `Gmail ${action} failed with HTTP ${status}.`, [options.accessToken]),
  });

  const listMessages: GmailEmailAdapter["listMessages"] = async ({ mailbox, query, maxResults = 25 }) => {
    if (mailbox.trim().length === 0 || maxResults < 1 || maxResults > 100) return { kind: "failed", failure: providerFailure("invalid-input", "Gmail mailbox and maxResults are invalid.", [options.accessToken]) };
    const retrievedAt = now();
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages`);
    url.searchParams.set("maxResults", String(maxResults));
    if (query?.trim()) url.searchParams.set("q", query.trim());
    try {
      const response = await request(url, { headers });
      if (!response.ok) return fail(response.status, "message list");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body["messages"])) return { kind: "failed", failure: providerFailure("provider-error", "Gmail returned an unreadable message list.", [options.accessToken]) };
      const messages: EmailMessage[] = [];
      for (const item of body["messages"]) {
        if (!isRecord(item) || typeof item["id"] !== "string") continue;
        const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(item["id"])}?format=full`;
        const detail = await request(detailUrl, { headers });
        if (!detail.ok) return fail(detail.status, "message read");
        messages.push(normalizeMessage(mailbox, await detail.json()));
      }
      const asOf = messages.map((message) => message.receivedAt).filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) ?? retrievedAt;
      return { kind: "ok", identity, provenance: provenanceFor(`gmail:${mailbox}`, asOf, retrievedAt), value: messages };
    } catch (error) {
      return { kind: "failed", failure: providerFailure("unavailable", `Gmail message list failed: ${error instanceof Error ? error.message : "provider unavailable"}.`, [options.accessToken]) };
    }
  };

  const createDraft: GmailEmailAdapter["createDraft"] = async ({ mailbox, to, cc = [], subject, body, idempotencyKey }) => {
    if (mailbox.trim().length === 0 || to.length === 0 || subject.trim().length === 0 || body.trim().length === 0 || detectSensitiveFields({ subject, body }).length > 0) {
      return { kind: "failed", failure: providerFailure("invalid-input", "Gmail draft fields are invalid or contain a Sensitive Secret.", [options.accessToken]) };
    }
    const payloadDigest = createHash("sha256").update(JSON.stringify({ mailbox, to, cc, subject, body }), "utf8").digest("hex");
    const prior = ledger.receipt(idempotencyKey);
    if (prior !== undefined) {
      if (prior.payloadDigest !== payloadDigest) return { kind: "failed", failure: providerFailure("invalid-input", "Gmail draft idempotency key was reused with different content.", [options.accessToken]) };
      const draftId = prior.effectReference.split(":").at(-1) ?? "unknown";
      return { kind: "ok", identity, provenance: provenanceFor(prior.effectReference, now(), now()), effectReference: prior.effectReference, deduplicated: true, draft: { id: draftId, messageId: `draft-message:${draftId}`, to, cc, subject, body, sourceReference: prior.effectReference } };
    }
    const raw = [
      `To: ${to.join(", ")}`,
      ...(cc.length === 0 ? [] : [`Cc: ${cc.join(", ")}`]),
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ].join("\\r\\n");
    try {
      const response = await request(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/drafts`, { method: "POST", headers, body: JSON.stringify({ message: { raw: base64Url(raw) } }) });
      if (!response.ok) return { kind: "failed", failure: providerFailure(failureClassForStatus(response.status), `Gmail draft creation failed with HTTP ${response.status}.`, [options.accessToken]) };
      const value: unknown = await response.json();
      if (!isRecord(value) || typeof value["id"] !== "string" || !isRecord(value["message"]) || typeof value["message"]["id"] !== "string") return { kind: "failed", failure: providerFailure("provider-error", "Gmail returned an unreadable draft.", [options.accessToken]) };
      const effectReference = `${gmailProvider}:${mailbox}:draft:${value["id"]}`;
      const draft: EmailDraft = { id: value["id"], messageId: value["message"]["id"], to, cc, subject, body, sourceReference: effectReference };
      ledger.record(idempotencyKey, { payloadDigest, effectReference });
      return { kind: "ok", identity, provenance: provenanceFor(effectReference, now(), now()), effectReference, deduplicated: false, draft };
    } catch (error) {
      return { kind: "failed", failure: providerFailure("unavailable", `Gmail draft creation failed: ${error instanceof Error ? error.message : "provider unavailable"}.`, [options.accessToken]) };
    }
  };

  return {
    identity: () => identity,
    capabilities: () => ["read", "write"],
    read: ({ reference }: ProviderReadRequest) => listMessages({ mailbox: reference }),
    write: async (): Promise<ProviderWriteResult> => ({ kind: "failed", failure: providerFailure("unsupported-capability", "Gmail adapter exposes draft writes only; sending is unavailable.", [options.accessToken]) }),
    listMessages,
    createDraft,
  };
}
