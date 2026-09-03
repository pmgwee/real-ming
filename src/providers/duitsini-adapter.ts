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

export const duitsiniProvider = "duitsini";

export type DuitSiniRecordKind =
  | "recurring-subscription"
  | "bill"
  | "payment-method";

export interface DuitSiniRecord {
  readonly id: string;
  readonly kind: DuitSiniRecordKind;
  readonly label: string;
  readonly renewalSchedule: string;
  /** A human label such as "Visa ending 4242". Never a card or account number. */
  readonly paymentMethodLabel: string;
  readonly updatedAt: string;
  readonly sourceReference: string;
}

export interface DuitSiniWriteReceipt {
  readonly payloadDigest: string;
  readonly effectReference: string;
}

export interface DuitSiniWriteLedger {
  receipt(idempotencyKey: string): DuitSiniWriteReceipt | undefined;
  record(idempotencyKey: string, receipt: DuitSiniWriteReceipt): void;
}

export function createEphemeralDuitSiniWriteLedger(): DuitSiniWriteLedger {
  const receipts = new Map<string, DuitSiniWriteReceipt>();
  return {
    receipt: (key) => receipts.get(key),
    record: (key, receipt) => receipts.set(key, receipt),
  };
}

/**
 * DuitSini is the Source of Record for subscriptions, renewal schedules, bills
 * and payment-method labels, and Real-Ming may maintain that metadata.
 *
 * There is deliberately no bank login, transfer, card charge, bill payment or
 * any other Money Movement method here. That boundary is structural: it is not
 * a guard that could be bypassed or a flag that could be flipped, there is
 * simply nothing to call.
 */
export interface DuitSiniAdapter extends ProviderAdapter<readonly DuitSiniRecord[]> {
  readRecord(request: {
    readonly id: string;
  }): Promise<ProviderReadResult<DuitSiniRecord>>;
  changeRecordMetadata(request: {
    readonly id: string;
    readonly label?: string;
    readonly renewalSchedule?: string;
    readonly paymentMethodLabel?: string;
    readonly idempotencyKey: string;
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

function parseRecord(value: unknown, fallbackAt: string): DuitSiniRecord | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string") return undefined;
  const kind = value["kind"];
  return {
    id: value["id"],
    kind:
      kind === "bill" || kind === "payment-method"
        ? kind
        : "recurring-subscription",
    label: typeof value["label"] === "string" ? value["label"] : "",
    renewalSchedule:
      typeof value["renewalSchedule"] === "string" ? value["renewalSchedule"] : "",
    paymentMethodLabel:
      typeof value["paymentMethodLabel"] === "string"
        ? value["paymentMethodLabel"]
        : "",
    updatedAt:
      typeof value["updatedAt"] === "string" ? value["updatedAt"] : fallbackAt,
    sourceReference: `${duitsiniProvider}:${value["id"]}`,
  };
}

export function createDuitSiniAdapter(options: {
  readonly accessToken: string;
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly writeLedger?: DuitSiniWriteLedger;
}): DuitSiniAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.writeLedger ?? createEphemeralDuitSiniWriteLedger();
  const identity: ProviderIdentity = {
    provider: duitsiniProvider,
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };

  const provenanceFor = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: duitsiniProvider,
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const call = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> => {
    const response = await request(`${options.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    return { ok: response.ok, status: response.status, body: await response.json() };
  };

  const readRecord: DuitSiniAdapter["readRecord"] = async ({ id }) => {
    const retrievedAt = now();
    try {
      const response = await call(`/records/${encodeURIComponent(id)}`);
      if (!response.ok) {
        return {
          kind: "failed",
          failure: providerFailure(
            failureClassForStatus(response.status),
            `DuitSini read failed with HTTP ${response.status}.`,
            [options.accessToken],
          ),
        };
      }
      const record = parseRecord(response.body, retrievedAt);
      if (record === undefined) {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            "DuitSini returned an unreadable record.",
            [options.accessToken],
          ),
        };
      }
      const provenance = provenanceFor(
        record.sourceReference,
        record.updatedAt,
        retrievedAt,
      );
      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value: record }
        : { kind: "ok", identity, provenance, value: record };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          error instanceof Error ? error.message : "DuitSini read failed.",
          [options.accessToken],
        ),
      };
    }
  };

  return {
    identity: () => identity,
    capabilities: () => ["read", "write"],
    read: async () => {
      const retrievedAt = now();
      try {
        const response = await call("/records");
        if (!response.ok || !Array.isArray(response.body)) {
          return {
            kind: "failed",
            failure: providerFailure(
              response.ok
                ? "provider-error"
                : failureClassForStatus(response.status),
              "DuitSini returned an unreadable record list.",
              [options.accessToken],
            ),
          };
        }
        const value = response.body.flatMap((entry) => {
          const record = parseRecord(entry, retrievedAt);
          return record === undefined ? [] : [record];
        });
        const asOf = value.reduce(
          (latest, record) => (record.updatedAt > latest ? record.updatedAt : latest),
          "",
        );
        if (asOf === "") {
          return {
            kind: "failed",
            failure: providerFailure(
              "provider-error",
              "DuitSini returned no as-of time, so the records cannot be dated.",
              [options.accessToken],
            ),
          };
        }
        const provenance = provenanceFor(`${duitsiniProvider}:records`, asOf, retrievedAt);
        return provenance.freshness === "stale"
          ? { kind: "stale", identity, provenance, value }
          : { kind: "ok", identity, provenance, value };
      } catch (error) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unavailable",
            error instanceof Error ? error.message : "DuitSini read failed.",
            [options.accessToken],
          ),
        };
      }
    },
    // The generic write has no bounded record to verify against, so metadata
    // changes go through changeRecordMetadata instead.
    write: async () => ({
      kind: "failed",
      failure: providerFailure(
        "unsupported-capability",
        "DuitSini changes must name one exact record through changeRecordMetadata.",
      ),
    }),
    readRecord,
    async changeRecordMetadata(change) {
      const retrievedAt = now();
      // A Record Change must survive an at-least-once retry without becoming a
      // second change on DuitSini's side. The ledger is what makes the
      // idempotency key mean something rather than merely being accepted.
      const payloadDigest = JSON.stringify({
        id: change.id,
        label: change.label ?? null,
        renewalSchedule: change.renewalSchedule ?? null,
        paymentMethodLabel: change.paymentMethodLabel ?? null,
      });
      const prior = ledger.receipt(change.idempotencyKey);
      if (prior !== undefined) {
        if (prior.payloadDigest !== payloadDigest) {
          return {
            kind: "failed",
            failure: providerFailure(
              "invalid-input",
              "A DuitSini idempotency key was reused for a different change.",
            ),
          };
        }
        return {
          kind: "ok",
          identity,
          provenance: provenanceFor(prior.effectReference, retrievedAt, retrievedAt),
          effectReference: prior.effectReference,
          deduplicated: true,
        };
      }
      try {
        const response = await call(`/records/${encodeURIComponent(change.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(change.label === undefined ? {} : { label: change.label }),
            ...(change.renewalSchedule === undefined
              ? {}
              : { renewalSchedule: change.renewalSchedule }),
            ...(change.paymentMethodLabel === undefined
              ? {}
              : { paymentMethodLabel: change.paymentMethodLabel }),
          }),
        });
        if (!response.ok) {
          return {
            kind: "failed",
            failure: providerFailure(
              failureClassForStatus(response.status),
              `DuitSini change failed with HTTP ${response.status}.`,
              [options.accessToken],
            ),
          };
        }
        const effectReference = `${duitsiniProvider}:${change.id}:change`;
        ledger.record(change.idempotencyKey, { payloadDigest, effectReference });
        return {
          kind: "ok",
          identity,
          provenance: provenanceFor(effectReference, retrievedAt, retrievedAt),
          effectReference,
          deduplicated: false,
        };
      } catch (error) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unavailable",
            error instanceof Error ? error.message : "DuitSini change failed.",
            [options.accessToken],
          ),
        };
      }
    },
  };
}
