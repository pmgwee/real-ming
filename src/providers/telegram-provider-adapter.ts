import { createHash } from "node:crypto";

import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type {
  TelegramSendRequest,
  TelegramTransport,
  TelegramUpdate,
} from "../telegram/contracts.js";
import {
  providerFailure,
  type ProviderAdapter,
  type ProviderFailure,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteRequest,
  type ProviderWriteResult,
} from "./adapter-contract.js";

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface TelegramApiEnvelope {
  readonly ok?: unknown;
  readonly result?: unknown;
  readonly error_code?: unknown;
  readonly parameters?: { readonly retry_after?: unknown };
}

export interface TelegramProviderAdapter
  extends ProviderAdapter<readonly TelegramUpdate[]> {}

export interface TelegramProviderAdapterOptions {
  readonly botToken: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly deliveryLedger: TelegramDeliveryLedger;
  readonly fetch?: FetchImplementation;
  readonly now?: () => string;
}

export interface TelegramDeliveryLedgerReceipt {
  readonly reference: string;
  readonly payloadDigest: string;
}

export type TelegramDeliveryLedgerClaim =
  | "claimed"
  | "completed"
  | "in-flight"
  | "conflict";

export interface TelegramDeliveryLedger {
  claim(
    idempotencyKey: string,
    receipt: TelegramDeliveryLedgerReceipt,
  ): TelegramDeliveryLedgerClaim;
  complete(idempotencyKey: string): void;
  release(idempotencyKey: string): void;
}

export function createEphemeralTelegramDeliveryLedger(): TelegramDeliveryLedger {
  const receipts = new Map<
    string,
    TelegramDeliveryLedgerReceipt & { readonly state: "in-flight" | "completed" }
  >();
  return {
    claim: (idempotencyKey, receipt) => {
      const existing = receipts.get(idempotencyKey);
      if (existing === undefined) {
        receipts.set(idempotencyKey, { ...receipt, state: "in-flight" });
        return "claimed";
      }
      if (
        existing.reference !== receipt.reference ||
        existing.payloadDigest !== receipt.payloadDigest
      ) {
        return "conflict";
      }
      return existing.state;
    },
    complete: (idempotencyKey) => {
      const existing = receipts.get(idempotencyKey);
      if (existing === undefined || existing.state !== "in-flight") {
        throw new Error("Telegram delivery claim cannot be completed.");
      }
      receipts.set(idempotencyKey, { ...existing, state: "completed" });
    },
    release: (idempotencyKey) => {
      if (receipts.get(idempotencyKey)?.state === "in-flight") {
        receipts.delete(idempotencyKey);
      }
    },
  };
}

const staleAfterMs = 24 * 60 * 60 * 1000;

function failureForStatus(
  status: number,
  retryAfterSeconds?: number,
): ProviderFailure {
  if (status === 401) {
    return providerFailure(
      "authentication-failed",
      "Telegram rejected the configured bot identity.",
    );
  }
  if (status === 403) {
    return providerFailure(
      "permission-denied",
      "Telegram denied the requested bot operation.",
    );
  }
  if (status === 429) {
    return providerFailure(
      "rate-limited",
      "Telegram rate limited the bot operation.",
      [],
      (retryAfterSeconds ?? 1) * 1000,
    );
  }
  if (status >= 500) {
    return providerFailure(
      "unavailable",
      "Telegram is temporarily unavailable.",
    );
  }
  return providerFailure(
    "provider-error",
    "Telegram rejected the provider operation.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChatType(
  value: unknown,
): "private" | "group" | "supergroup" | "channel" | "unknown" {
  return value === "private" ||
    value === "group" ||
    value === "supergroup" ||
    value === "channel"
    ? value
    : "unknown";
}

function normalizeUpdate(value: unknown): TelegramUpdate | undefined {
  if (!isRecord(value) || typeof value["update_id"] !== "number") {
    return undefined;
  }

  const message = value["message"];
  if (isRecord(message)) {
    const from = message["from"];
    const chat = message["chat"];
    if (
      typeof message["message_id"] === "number" &&
      isRecord(from) &&
      (typeof from["id"] === "number" || typeof from["id"] === "string") &&
      isRecord(chat) &&
      (typeof chat["id"] === "number" || typeof chat["id"] === "string")
    ) {
      return typeof message["text"] === "string"
        ? {
            updateId: value["update_id"],
            message: {
              messageId: message["message_id"],
              senderId: String(from["id"]),
              chatId: String(chat["id"]),
              chatType: normalizeChatType(chat["type"]),
              text: message["text"],
            },
          }
        : {
            updateId: value["update_id"],
            unsupported: {
              senderId: String(from["id"]),
              chatId: String(chat["id"]),
              chatType: normalizeChatType(chat["type"]),
              kind: "unsupported-message",
            },
          };
    }
  }

  const callback = value["callback_query"];
  if (isRecord(callback)) {
    const from = callback["from"];
    const callbackMessage = callback["message"];
    const chat = isRecord(callbackMessage) ? callbackMessage["chat"] : undefined;
    if (
      typeof callback["id"] === "string" &&
      isRecord(from) &&
      (typeof from["id"] === "number" || typeof from["id"] === "string") &&
      isRecord(chat) &&
      (typeof chat["id"] === "number" || typeof chat["id"] === "string")
    ) {
      return typeof callback["data"] === "string"
        ? {
            updateId: value["update_id"],
            callbackQuery: {
              queryId: callback["id"],
              senderId: String(from["id"]),
              chatId: String(chat["id"]),
              chatType: normalizeChatType(chat["type"]),
              data: callback["data"],
            },
          }
        : {
            updateId: value["update_id"],
            unsupported: {
              senderId: String(from["id"]),
              chatId: String(chat["id"]),
              chatType: normalizeChatType(chat["type"]),
              kind: "unsupported-callback",
            },
          };
    }
  }

  const editedMessage = value["edited_message"];
  if (isRecord(editedMessage)) {
    const from = editedMessage["from"];
    const chat = editedMessage["chat"];
    if (
      isRecord(from) &&
      (typeof from["id"] === "number" || typeof from["id"] === "string") &&
      isRecord(chat) &&
      (typeof chat["id"] === "number" || typeof chat["id"] === "string")
    ) {
      return {
        updateId: value["update_id"],
        unsupported: {
          senderId: String(from["id"]),
          chatId: String(chat["id"]),
          chatType: normalizeChatType(chat["type"]),
          kind: "unsupported-message",
        },
      };
    }
  }

  return {
    updateId: value["update_id"],
    unattributed: { kind: "unsupported-update" },
  };
}

function asOfFor(rawUpdates: readonly unknown[], fallback: string): string {
  const timestamps = rawUpdates.flatMap((value) => {
    if (!isRecord(value) || !isRecord(value["message"])) {
      return [];
    }
    const seconds = value["message"]["date"];
    return typeof seconds === "number" ? [seconds * 1000] : [];
  });
  const latest = timestamps.length === 0 ? undefined : Math.max(...timestamps);
  return latest === undefined ? fallback : new Date(latest).toISOString();
}

function offsetFromReference(reference: string): number | undefined | null {
  if (!reference.startsWith("offset:")) {
    return undefined;
  }
  const value = reference.slice("offset:".length);
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return null;
  }
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function writePayloadDigest(request: ProviderWriteRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        reference: request.reference,
        payload: Object.fromEntries(
          Object.entries(request.payload).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      }),
    )
    .digest("hex");
}

interface TelegramInlineButton {
  readonly text: string;
  readonly callback_data: string;
}

const reviewControlLabels = new Set([
  "Approve",
  "Request changes",
  "Reject",
  "Cancel",
]);
const reviewControlCallbackPattern =
  /^rm-review:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function parseInlineControls(
  value: string | undefined,
): readonly TelegramInlineButton[] | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const controls = parsed.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry["label"] !== "string" ||
        entry["label"].trim().length === 0 ||
        !reviewControlLabels.has(entry["label"]) ||
        typeof entry["callbackData"] !== "string" ||
        !reviewControlCallbackPattern.test(entry["callbackData"]) ||
        Buffer.byteLength(entry["callbackData"], "utf8") === 0 ||
        Buffer.byteLength(entry["callbackData"], "utf8") > 64
      ) {
        return undefined;
      }
      return {
        text: entry["label"],
        callback_data: entry["callbackData"],
      };
    });
    return controls.some((control) => control === undefined)
      ? null
      : (controls as TelegramInlineButton[]);
  } catch {
    return null;
  }
}

async function parseEnvelope(response: Response): Promise<TelegramApiEnvelope> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? (value as TelegramApiEnvelope) : {};
  } catch {
    return {};
  }
}

export function createTelegramProviderAdapter(
  options: TelegramProviderAdapterOptions,
): TelegramProviderAdapter {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const identity: ProviderIdentity = {
    provider: "telegram",
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };

  const endpoint = (method: string): string =>
    `https://api.telegram.org/bot${encodeURIComponent(options.botToken)}/${method}`;

  const provenance = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: `telegram:${options.workspaceId}`,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > staleAfterMs
        ? "stale"
        : "current",
  });

  const perform = async (
    method: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<
    | { readonly kind: "ok"; readonly envelope: TelegramApiEnvelope }
    | {
        readonly kind: "failed";
        readonly failure: ProviderFailure;
        readonly effectUncertain: boolean;
      }
  > => {
    let response: Response;
    try {
      response = await fetchImplementation(endpoint(method), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          "Telegram is temporarily unavailable.",
        ),
        effectUncertain: method === "sendMessage",
      };
    }

    const envelope = await parseEnvelope(response);
    if (!response.ok || envelope.ok !== true) {
      const errorCode =
        typeof envelope.error_code === "number"
          ? envelope.error_code
          : response.status;
      const retryAfter = envelope.parameters?.retry_after;
      return {
        kind: "failed",
        failure: failureForStatus(
          errorCode,
          typeof retryAfter === "number" ? retryAfter : undefined,
        ),
        effectUncertain:
          method === "sendMessage" &&
          response.ok &&
          envelope.ok !== false,
      };
    }
    return { kind: "ok", envelope };
  };

  return {
    identity: () => identity,
    capabilities: () => ["read", "write"],

    async read(
      request: ProviderReadRequest,
    ): Promise<ProviderReadResult<readonly TelegramUpdate[]>> {
      if (request.reference.trim().length === 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Telegram read requires a non-empty update reference.",
          ),
        };
      }

      const offset = offsetFromReference(request.reference);
      if (offset === null) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Telegram polling offset must be a non-negative safe integer.",
          ),
        };
      }

      const retrievedAt = now();
      const performed = await perform("getUpdates", {
        ...(offset === undefined ? {} : { offset }),
        allowed_updates: ["message", "callback_query"],
      });
      if (performed.kind === "failed") {
        return { kind: "failed", failure: performed.failure };
      }
      if (!Array.isArray(performed.envelope.result)) {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Telegram returned an unreadable update response.",
          ),
        };
      }

      const updates = performed.envelope.result.flatMap((rawUpdate) => {
        const normalized = normalizeUpdate(rawUpdate);
        return normalized === undefined ? [] : [normalized];
      });
      const asOf = asOfFor(performed.envelope.result, retrievedAt);
      const source = provenance(request.reference, asOf, retrievedAt);
      const value = updates;
      return source.freshness === "stale"
        ? { kind: "stale", identity, provenance: source, value }
        : { kind: "ok", identity, provenance: source, value };
    },

    async write(request: ProviderWriteRequest): Promise<ProviderWriteResult> {
      if (
        request.idempotencyKey.trim().length === 0 ||
        request.reference.trim().length === 0
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Telegram write requires an idempotency key and chat reference.",
          ),
        };
      }
      const sensitiveFields = detectSensitiveFields(
        Object.fromEntries(
          Object.entries(request.payload).filter(([field]) => field !== "controls"),
        ),
      );
      if (sensitiveFields.length > 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            `A Telegram write rejected Sensitive Secret fields: ${sensitiveFields.join(", ")}.`,
          ),
        };
      }

      const text = request.payload["text"] ?? request.payload["note"];
      if (text === undefined || text.trim().length === 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Telegram write requires non-empty message text.",
          ),
        };
      }
      const controls = parseInlineControls(request.payload["controls"]);
      if (controls === null) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "Telegram review controls are not valid inline controls.",
          ),
        };
      }

      const payloadDigest = writePayloadDigest(request);
      const claim = options.deliveryLedger.claim(request.idempotencyKey, {
        reference: request.reference,
        payloadDigest,
      });
      if (claim === "conflict") {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Telegram idempotency key was reused for a different effect.",
          ),
        };
      }
      if (claim === "in-flight") {
        return {
          kind: "failed",
          failure: {
            class: "provider-error",
            retryable: false,
            message:
              "The Telegram effect is already in flight; reconcile its delivery before retrying.",
          },
        };
      }
      if (claim === "completed") {
        const retrievedAt = now();
        return {
          kind: "ok",
          identity,
          provenance: provenance(request.reference, retrievedAt, retrievedAt),
          effectReference: request.idempotencyKey,
          deduplicated: true,
        };
      }

      const performed = await perform("sendMessage", {
        chat_id: request.reference,
        text,
        ...(controls === undefined
          ? {}
          : { reply_markup: { inline_keyboard: [controls] } }),
      });
      if (performed.kind === "failed") {
        if (performed.effectUncertain) {
          return {
            kind: "failed",
            failure: {
              class: "provider-error",
              retryable: false,
              message:
                "Telegram delivery status is uncertain; reconcile it before retrying.",
            },
          };
        }
        options.deliveryLedger.release(request.idempotencyKey);
        return { kind: "failed", failure: performed.failure };
      }
      options.deliveryLedger.complete(request.idempotencyKey);
      const retrievedAt = now();
      return {
        kind: "ok",
        identity,
        provenance: provenance(request.reference, retrievedAt, retrievedAt),
        effectReference: request.idempotencyKey,
        deduplicated: false,
      };
    },
  };
}

export function createTelegramTransport(
  adapter: TelegramProviderAdapter,
): TelegramTransport {
  return {
    async send(message: TelegramSendRequest) {
      const result = await adapter.write({
        idempotencyKey: message.idempotencyKey,
        reference: message.chatId,
        payload: {
          text: message.text,
          ...(message.controls === undefined
            ? {}
            : {
                controls: JSON.stringify(
                  message.controls.map((control) => ({
                    label: control.label,
                    callbackData: control.callbackData,
                  })),
                ),
              }),
        },
      });
      if (result.kind === "failed") {
        return result;
      }
      return { kind: "sent" as const, deduplicated: result.deduplicated };
    },
  };
}
