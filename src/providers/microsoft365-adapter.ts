import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderFailureClass,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadResult,
  type ProviderWriteResult,
} from "./adapter-contract.js";

export const microsoft365Provider = "microsoft365";

export interface AcademicMailMessage {
  readonly id: string;
  readonly mailbox: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly sourceReference: string;
}

export interface TeamsMessage {
  readonly id: string;
  readonly channel: string;
  readonly from: string;
  readonly body: string;
  readonly postedAt: string;
  readonly sourceReference: string;
}

export interface AcademicFile {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly sourceReference: string;
}

export interface AcademicDraft {
  readonly id: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly sourceReference: string;
}

/**
 * Academic Microsoft 365 is read-and-draft. `sendMail` exists so the refusal is
 * part of the contract rather than a missing method, and it refuses before any
 * request: an unsupervised send cannot be taken back once Graph has accepted it.
 */
export interface Microsoft365Adapter
  extends ProviderAdapter<readonly AcademicMailMessage[]> {
  readAcademicMail(request: {
    readonly mailbox: string;
  }): Promise<ProviderReadResult<readonly AcademicMailMessage[]>>;
  readTeamsMessages(request: {
    readonly channel: string;
  }): Promise<ProviderReadResult<readonly TeamsMessage[]>>;
  readAcademicFiles(request: {
    readonly mailbox: string;
  }): Promise<ProviderReadResult<readonly AcademicFile[]>>;
  createDraft(request: {
    readonly mailbox: string;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<ProviderWriteResult & { readonly draft?: AcademicDraft }>;
  sendMail(request: {
    readonly mailbox: string;
  }): Promise<ProviderWriteResult>;
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

const sendExcluded = providerFailure(
  "unsupported-capability",
  "Academic Microsoft 365 is read-and-draft; unsupervised send is excluded.",
);

export interface AcademicDraftLedger {
  effectReference(idempotencyKey: string): string | undefined;
  record(idempotencyKey: string, effectReference: string): void;
}

export function createEphemeralAcademicDraftLedger(): AcademicDraftLedger {
  const receipts = new Map<string, string>();
  return {
    effectReference: (key) => receipts.get(key),
    record: (key, reference) => receipts.set(key, reference),
  };
}

export function createMicrosoft365Adapter(options: {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly draftLedger?: AcademicDraftLedger;
}): Microsoft365Adapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const baseUrl = options.baseUrl ?? "https://graph.microsoft.com/v1.0";
  const ledger = options.draftLedger ?? createEphemeralAcademicDraftLedger();
  const identity: ProviderIdentity = {
    provider: microsoft365Provider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };

  const provenanceFor = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: microsoft365Provider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const readList = async (
    path: string,
  ): Promise<readonly unknown[]> => {
    const response = await request(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`Microsoft 365 read failed with HTTP ${response.status}.`),
        { failureClass: failureClassForStatus(response.status) },
      );
    }
    const body: unknown = await response.json();
    const value = isRecord(body) ? body["value"] : undefined;
    if (!Array.isArray(value)) {
      throw Object.assign(new Error("Microsoft 365 returned an unreadable list."), {
        failureClass: "provider-error" as ProviderFailureClass,
      });
    }
    return value;
  };

  const failed = (error: unknown, fallback: string) => ({
    kind: "failed" as const,
    failure: providerFailure(
      isRecord(error) && typeof error["failureClass"] === "string"
        ? (error["failureClass"] as ProviderFailureClass)
        : "provider-error",
      error instanceof Error ? error.message : fallback,
      [options.accessToken],
    ),
  });

  const readAcademicMail: Microsoft365Adapter["readAcademicMail"] = async ({
    mailbox,
  }) => {
    const retrievedAt = now();
    try {
      const entries = await readList(
        `/users/${encodeURIComponent(mailbox)}/messages`,
      );
      const value: AcademicMailMessage[] = [];
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
        const from = isRecord(entry["from"]) && isRecord(entry["from"]["emailAddress"])
          ? String(entry["from"]["emailAddress"]["address"] ?? "")
          : "";
        const subject = typeof entry["subject"] === "string" ? entry["subject"] : "";
        const body =
          isRecord(entry["body"]) && typeof entry["body"]["content"] === "string"
            ? entry["body"]["content"]
            : "";
        // Academic mail can quote a credential or a reset link. Redact on the
        // way in, as the Gmail adapter does, rather than trusting every caller.
        const sensitive =
          detectSensitiveFields({ from, subject, body }).length > 0;
        value.push({
          id: entry["id"],
          mailbox,
          from: sensitive ? "[redacted]" : from,
          to: [mailbox],
          subject: sensitive ? "[redacted]" : subject,
          body: sensitive ? "[redacted]" : body,
          receivedAt:
            typeof entry["receivedDateTime"] === "string"
              ? entry["receivedDateTime"]
              : retrievedAt,
          sourceReference: `m365:mail:${entry["id"]}`,
        });
      }
      const asOf = value.reduce(
        (latest, message) => (message.receivedAt > latest ? message.receivedAt : latest),
        "",
      );
      if (asOf === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Microsoft 365 returned no as-of time, so the mailbox cannot be dated.",
            [options.accessToken],
          ),
        };
      }
      const provenance = provenanceFor(`m365:${mailbox}`, asOf, retrievedAt);
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    } catch (error) {
      return failed(error, "Microsoft 365 mail read failed.");
    }
  };

  const readTeamsMessages: Microsoft365Adapter["readTeamsMessages"] = async ({
    channel,
  }) => {
    const retrievedAt = now();
    try {
      const entries = await readList(
        `/teams/${encodeURIComponent(channel)}/channels/messages`,
      );
      const value: TeamsMessage[] = [];
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
        const from =
          isRecord(entry["from"]) && isRecord(entry["from"]["user"])
            ? String(entry["from"]["user"]["displayName"] ?? "")
            : "";
        const body =
          isRecord(entry["body"]) && typeof entry["body"]["content"] === "string"
            ? entry["body"]["content"]
            : "";
        const sensitive = detectSensitiveFields({ from, body }).length > 0;
        value.push({
          id: entry["id"],
          channel,
          from: sensitive ? "[redacted]" : from,
          body: sensitive ? "[redacted]" : body,
          postedAt:
            typeof entry["createdDateTime"] === "string"
              ? entry["createdDateTime"]
              : retrievedAt,
          sourceReference: `m365:teams:${channel}:${entry["id"]}`,
        });
      }
      const asOf = value.reduce(
        (latest, message) => (message.postedAt > latest ? message.postedAt : latest),
        "",
      );
      if (asOf === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Microsoft 365 returned no as-of time, so the channel cannot be dated.",
            [options.accessToken],
          ),
        };
      }
      const provenance = provenanceFor(`m365:teams:${channel}`, asOf, retrievedAt);
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    } catch (error) {
      return failed(error, "Microsoft 365 Teams read failed.");
    }
  };

  const readAcademicFiles: Microsoft365Adapter["readAcademicFiles"] = async ({
    mailbox,
  }) => {
    const retrievedAt = now();
    try {
      const entries = await readList(
        `/users/${encodeURIComponent(mailbox)}/drive/root/children`,
      );
      const value: AcademicFile[] = [];
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
        const name = typeof entry["name"] === "string" ? entry["name"] : "";
        // A file name can carry a credential just as a subject line can.
        const sensitive = detectSensitiveFields({ name }).length > 0;
        value.push({
          id: entry["id"],
          name: sensitive ? "[redacted]" : name,
          updatedAt:
            typeof entry["lastModifiedDateTime"] === "string"
              ? entry["lastModifiedDateTime"]
              : retrievedAt,
          sourceReference: `m365:file:${entry["id"]}`,
        });
      }
      const asOf = value.reduce(
        (latest, file) => (file.updatedAt > latest ? file.updatedAt : latest),
        "",
      );
      if (asOf === "") {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "Microsoft 365 returned no as-of time, so the files cannot be dated.",
            [options.accessToken],
          ),
        };
      }
      const provenance = provenanceFor(`m365:files:${mailbox}`, asOf, retrievedAt);
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    } catch (error) {
      return failed(error, "Microsoft 365 file read failed.");
    }
  };

  return {
    identity: () => identity,
    capabilities: () => ["read", "write"],
    read: (readRequest) => readAcademicMail({ mailbox: readRequest.reference }),
    // A generic write has no supervised path, so it refuses like send does.
    write: async () => ({ kind: "failed", failure: sendExcluded }),
    readAcademicMail,
    readTeamsMessages,
    readAcademicFiles,
    async createDraft(draftRequest) {
      const retrievedAt = now();
      if (
        draftRequest.to.length === 0 ||
        draftRequest.subject.trim().length === 0 ||
        draftRequest.body.trim().length === 0 ||
        detectSensitiveFields({
          subject: draftRequest.subject,
          body: draftRequest.body,
        }).length > 0
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "An academic draft requires a bounded, non-sensitive subject and body.",
          ),
        };
      }
      const replayed = ledger.effectReference(draftRequest.idempotencyKey);
      if (replayed !== undefined) {
        return {
          kind: "ok",
          identity,
          provenance: provenanceFor(replayed, retrievedAt, retrievedAt),
          effectReference: replayed,
          deduplicated: true,
        };
      }
      try {
        const response = await request(
          `${baseUrl}/users/${encodeURIComponent(draftRequest.mailbox)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              subject: draftRequest.subject,
              body: { contentType: "Text", content: draftRequest.body },
              toRecipients: draftRequest.to.map((address) => ({
                emailAddress: { address },
              })),
            }),
          },
        );
        if (!response.ok) {
          return {
            kind: "failed",
            failure: providerFailure(
              failureClassForStatus(response.status),
              `Microsoft 365 draft failed with HTTP ${response.status}.`,
              [options.accessToken],
            ),
          };
        }
        const body: unknown = await response.json();
        const id = isRecord(body) && typeof body["id"] === "string" ? body["id"] : "";
        const effectReference = `m365:draft:${id}`;
        ledger.record(draftRequest.idempotencyKey, effectReference);
        return {
          kind: "ok",
          identity,
          provenance: provenanceFor(effectReference, retrievedAt, retrievedAt),
          effectReference,
          deduplicated: false,
          draft: {
            id,
            to: draftRequest.to,
            subject: draftRequest.subject,
            body: draftRequest.body,
            sourceReference: effectReference,
          },
        };
      } catch (error) {
        return failed(error, "Microsoft 365 draft failed.");
      }
    },
    // Refused here, with no request made.
    sendMail: async () => ({ kind: "failed", failure: sendExcluded }),
  };
}
