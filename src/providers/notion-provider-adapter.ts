import { createHash } from "node:crypto";

import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  masterTasksSchema,
  masterTasksViewDefinitions,
  type MasterTaskPropertyType,
  type MasterTasksProvisioning,
  type MasterTasksWorkView,
} from "../master-tasks/master-tasks.js";
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

export const notionApiVersion = "2026-03-11";

interface NotionWriteReceipt {
  readonly reference: string;
  readonly payloadDigest: string;
  readonly effectReference: string;
}

export interface NotionWriteLedger {
  receipt(idempotencyKey: string): NotionWriteReceipt | undefined;
  record(idempotencyKey: string, receipt: NotionWriteReceipt): void;
}

export function createEphemeralNotionWriteLedger(): NotionWriteLedger {
  const receipts = new Map<string, NotionWriteReceipt>();
  return {
    receipt: (idempotencyKey) => receipts.get(idempotencyKey),
    record: (idempotencyKey, receipt) => {
      receipts.set(idempotencyKey, receipt);
    },
  };
}

export type NotionProvisionResult =
  | { readonly kind: "ok"; readonly value: MasterTasksProvisioning }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface NotionProviderAdapter extends ProviderAdapter<readonly unknown[]> {
  provisionMasterTasks(request: {
    readonly parentPageId: string;
    readonly idempotencyKey: string;
  }): Promise<NotionProvisionResult>;
}

interface NotionProviderAdapterOptions {
  readonly token: string;
  readonly workspaceId: string;
  readonly accountReference: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly writeLedger?: NotionWriteLedger;
}

interface NotionErrorBody {
  readonly message?: unknown;
}

interface NotionListResponse {
  readonly results?: readonly unknown[];
  readonly has_more?: boolean;
  readonly next_cursor?: string | null;
}

const stalenessThresholdMs = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadDigest(payload: Readonly<Record<string, string>>): string {
  const canonical = Object.entries(payload).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function notionFailureClass(status: number): ProviderFailure["class"] {
  if (status === 401) return "authentication-failed";
  if (status === 403) return "permission-denied";
  if (status === 429) return "rate-limited";
  if (status === 404 || status === 409) return "invalid-input";
  if (status === 503 || status === 504 || status === 529) return "unavailable";
  return "provider-error";
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function asOfFromRows(rows: readonly unknown[], fallback: string): string {
  const candidates = rows
    .map((row) =>
      isRecord(row) && typeof row["last_edited_time"] === "string"
        ? row["last_edited_time"]
        : undefined,
    )
    .filter((value): value is string => value !== undefined)
    .sort();
  return candidates.at(-1) ?? fallback;
}

function schemaOptions(name: string): readonly string[] | undefined {
  if (name === "Trust Domain") {
    return ["Personal", "Ming Creatives", "Academic", "Entertainment", "Finance"];
  }
  if (name === "Workstream") {
    return [
      "Personal Life",
      "Career Job",
      "Finance",
      "Academic",
      "MicroSaaS",
      "Content Creation",
    ];
  }
  if (name === "Accountable Executive" || name === "Collaborating Executives") {
    return ["COO", "CTO", "Personal CFO", "CAO", "CMO"];
  }
  if (name === "Lifecycle") {
    return [
      "Captured",
      "Triaged",
      "Planned",
      "Awaiting Approval",
      "Executing",
      "Waiting/Blocked",
      "Verifying",
      "Ready for CEO Review",
      "Completed",
      "Changes Requested",
      "Cancelled",
    ];
  }
  if (name === "Priority") return ["Low", "Medium", "High", "Critical"];
  if (name === "Risk Class") return ["low", "medium", "high"];
  return undefined;
}

function notionPropertySchema(
  name: string,
  type: MasterTaskPropertyType,
): Readonly<Record<string, unknown>> {
  const options = schemaOptions(name);
  if (type === "select" && options !== undefined) {
    return { select: { options: options.map((option) => ({ name: option })) } };
  }
  if (type === "multi_select" && options !== undefined) {
    return {
      multi_select: { options: options.map((option) => ({ name: option })) },
    };
  }
  return { [type]: {} };
}

export function notionMasterTasksSchema(): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    masterTasksSchema.map((property) => [
      property.name,
      notionPropertySchema(property.name, property.type),
    ]),
  );
}

function pageProperties(payload: Readonly<Record<string, string>>): object {
  return Object.fromEntries(
    Object.entries(payload).map(([name, value]) => [
      name,
      { rich_text: [{ type: "text", text: { content: value } }] },
    ]),
  );
}

export function createNotionProviderAdapter(
  options: NotionProviderAdapterOptions,
): NotionProviderAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.writeLedger ?? createEphemeralNotionWriteLedger();
  const identity: ProviderIdentity = {
    provider: "notion",
    workspaceId: options.workspaceId,
    accountReference: options.accountReference,
  };
  const baseUrl = "https://api.notion.com/v1";
  const headers = (withContent = false): Record<string, string> => ({
    Authorization: `Bearer ${options.token}`,
    "Notion-Version": notionApiVersion,
    ...(withContent ? { "Content-Type": "application/json" } : {}),
  });

  const normalizedFailure = async (response: Response): Promise<ProviderFailure> => {
    let body: NotionErrorBody = {};
    try {
      const parsed: unknown = await response.json();
      if (isRecord(parsed)) body = parsed;
    } catch {
      body = {};
    }
    const message =
      typeof body.message === "string"
        ? body.message
        : `Notion request failed with HTTP ${response.status}.`;
    return providerFailure(
      notionFailureClass(response.status),
      message,
      [options.token],
      retryAfterMs(response),
    );
  };

  const provenance = (
    reference: string,
    asOf: string,
    retrievedAt: string,
  ): ProviderProvenance => ({
    sourceIdentity: "notion:workspace:real-ming",
    sourceReference: reference,
    asOf,
    retrievedAt,
    freshness:
      Date.parse(retrievedAt) - Date.parse(asOf) > stalenessThresholdMs
        ? "stale"
        : "current",
  });

  const api = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ readonly response: Response; readonly body: unknown }> => {
    const response = await request(`${baseUrl}${path}`, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { response, body };
  };

  const listAll = async (path: string): Promise<readonly unknown[]> => {
    const results: unknown[] = [];
    let cursor: string | undefined;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const suffix = cursor === undefined ? "" : `${separator}start_cursor=${encodeURIComponent(cursor)}`;
      const result = await api(`${path}${suffix}`, { headers: headers() });
      if (!result.response.ok) throw await normalizedFailure(result.response);
      if (!isRecord(result.body)) throw new Error("Notion returned an unreadable list.");
      const list = result.body as NotionListResponse;
      results.push(...(Array.isArray(list.results) ? list.results : []));
      cursor =
        list.has_more === true && typeof list.next_cursor === "string"
          ? list.next_cursor
          : undefined;
    } while (cursor !== undefined);
    return results;
  };

  const provisionMasterTasks = async (provisionRequest: {
    readonly parentPageId: string;
    readonly idempotencyKey: string;
  }): Promise<NotionProvisionResult> => {
    if (
      provisionRequest.parentPageId.trim().length === 0 ||
      provisionRequest.idempotencyKey.trim().length === 0
    ) {
      return {
        kind: "failed",
        failure: providerFailure(
          "invalid-input",
          "Master Tasks provisioning requires a parent page and idempotency key.",
        ),
      };
    }

    try {
      const children = await listAll(
        `/blocks/${encodeURIComponent(provisionRequest.parentPageId)}/children?page_size=100`,
      );
      const existing = children.find(
        (child) =>
          isRecord(child) &&
          child["type"] === "child_database" &&
          isRecord(child["child_database"]) &&
          child["child_database"]["title"] === "Master Tasks",
      );

      let database: unknown;
      if (isRecord(existing) && typeof existing["id"] === "string") {
        const retrieved = await api(`/databases/${existing["id"]}`, {
          headers: headers(),
        });
        if (!retrieved.response.ok) {
          return { kind: "failed", failure: await normalizedFailure(retrieved.response) };
        }
        database = retrieved.body;
      } else {
        const created = await api("/databases", {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({
            parent: { type: "page_id", page_id: provisionRequest.parentPageId },
            title: [{ type: "text", text: { content: "Master Tasks" } }],
            description: [
              {
                type: "text",
                text: { content: "Canonical Real-Ming operational Work Items · RM-09" },
              },
            ],
            is_inline: false,
            initial_data_source: { properties: notionMasterTasksSchema() },
          }),
        });
        if (!created.response.ok) {
          return { kind: "failed", failure: await normalizedFailure(created.response) };
        }
        database = created.body;
      }

      if (!isRecord(database) || typeof database["id"] !== "string") {
        throw new Error("Notion returned no database identity for Master Tasks.");
      }
      const sources = Array.isArray(database["data_sources"])
        ? database["data_sources"]
        : [];
      const firstSource = sources.find(
        (source) => isRecord(source) && typeof source["id"] === "string",
      );
      if (!isRecord(firstSource) || typeof firstSource["id"] !== "string") {
        throw new Error("Notion returned no data source identity for Master Tasks.");
      }
      const databaseId = database["id"];
      const dataSourceId = firstSource["id"];
      const retrievedDataSource = await api(`/data_sources/${dataSourceId}`, {
        headers: headers(),
      });
      if (!retrievedDataSource.response.ok) {
        return {
          kind: "failed",
          failure: await normalizedFailure(retrievedDataSource.response),
        };
      }
      const actualProperties =
        isRecord(retrievedDataSource.body) &&
        isRecord(retrievedDataSource.body["properties"])
          ? retrievedDataSource.body["properties"]
          : undefined;
      const driftedProperties = masterTasksSchema.filter((property) => {
        const actual = actualProperties?.[property.name];
        return !isRecord(actual) || actual["type"] !== property.type;
      });
      if (driftedProperties.length > 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            `Master Tasks schema is missing or incompatible: ${driftedProperties
              .map((property) => property.name)
              .join(", ")}.`,
          ),
        };
      }
      const listedViews = await listAll(
        `/views?data_source_id=${encodeURIComponent(dataSourceId)}&page_size=100`,
      );
      const existingViews: unknown[] = [];
      for (const listedView of listedViews) {
        if (isRecord(listedView) && typeof listedView["name"] === "string") {
          existingViews.push(listedView);
          continue;
        }
        if (!isRecord(listedView) || typeof listedView["id"] !== "string") {
          throw new Error("Notion returned a view without an identity.");
        }
        const retrievedView = await api(`/views/${listedView["id"]}`, {
          headers: headers(),
        });
        if (!retrievedView.response.ok) {
          return {
            kind: "failed",
            failure: await normalizedFailure(retrievedView.response),
          };
        }
        existingViews.push(retrievedView.body);
      }
      const activeViews: unknown[] = [];
      const databaseTrashState = new Map<string, boolean>();
      for (const view of existingViews) {
        const parent = isRecord(view) ? view["parent"] : undefined;
        const parentDatabaseId =
          isRecord(parent) && typeof parent["database_id"] === "string"
            ? parent["database_id"]
            : undefined;
        if (parentDatabaseId === undefined) {
          activeViews.push(view);
          continue;
        }
        let inTrash = databaseTrashState.get(parentDatabaseId);
        if (inTrash === undefined) {
          const parentDatabase = await api(`/databases/${parentDatabaseId}`, {
            headers: headers(),
          });
          if (!parentDatabase.response.ok) {
            return {
              kind: "failed",
              failure: await normalizedFailure(parentDatabase.response),
            };
          }
          inTrash =
            isRecord(parentDatabase.body) &&
            parentDatabase.body["in_trash"] === true;
          databaseTrashState.set(parentDatabaseId, inTrash);
        }
        if (!inTrash) activeViews.push(view);
      }
      const views: MasterTasksWorkView[] = [];

      for (const definition of masterTasksViewDefinitions) {
        const found = activeViews.find(
          (view) => isRecord(view) && view["name"] === definition.name,
        );
        let viewObject: unknown = found;
        if (viewObject === undefined) {
          const created = await api("/views", {
            method: "POST",
            headers: headers(true),
            body: JSON.stringify({
              create_database: {
                parent: {
                  type: "page_id",
                  page_id: provisionRequest.parentPageId,
                },
              },
              data_source_id: dataSourceId,
              name: definition.name,
              type: "table",
              ...(definition.accountableExecutive === null
                ? {}
                : {
                    filter: {
                      property: "Accountable Executive",
                      select: { equals: definition.accountableExecutive },
                    },
                  }),
            }),
          });
          if (!created.response.ok) {
            return { kind: "failed", failure: await normalizedFailure(created.response) };
          }
          viewObject = created.body;
        }
        if (!isRecord(viewObject) || typeof viewObject["id"] !== "string") {
          throw new Error(`Notion returned no identity for ${definition.name}.`);
        }
        views.push({
          id: viewObject["id"],
          name: definition.name,
          dataSourceId,
          accountableExecutive: definition.accountableExecutive,
          filter:
            definition.accountableExecutive === null
              ? null
              : {
                  property: "Accountable Executive",
                  select: { equals: definition.accountableExecutive },
                },
        });
      }

      return {
        kind: "ok",
        value: {
          parentPageId: provisionRequest.parentPageId,
          databaseId,
          dataSourceId,
          dataSourceName: "Master Tasks",
          schema: masterTasksSchema,
          views,
        },
      };
    } catch (error) {
      if (isRecord(error) && typeof error["class"] === "string") {
        return { kind: "failed", failure: error as unknown as ProviderFailure };
      }
      return {
        kind: "failed",
        failure: providerFailure(
          "provider-error",
          error instanceof Error ? error.message : "Notion provisioning failed.",
          [options.token],
        ),
      };
    }
  };

  return {
    identity: () => identity,
    capabilities: () => ["read", "write"],

    async read(
      readRequest: ProviderReadRequest,
    ): Promise<ProviderReadResult<readonly unknown[]>> {
      if (readRequest.reference.trim().length === 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Notion read requires a data source reference.",
          ),
        };
      }
      try {
        const result = await api(
          `/data_sources/${encodeURIComponent(readRequest.reference)}/query`,
          { method: "POST", headers: headers(true), body: "{}" },
        );
        if (!result.response.ok) {
          return { kind: "failed", failure: await normalizedFailure(result.response) };
        }
        if (!isRecord(result.body) || !Array.isArray(result.body["results"])) {
          return {
            kind: "failed",
            failure: providerFailure("provider-error", "Notion returned an unreadable query."),
          };
        }
        const retrievedAt = now();
        const rows = result.body["results"];
        const sourceAsOf = asOfFromRows(rows, retrievedAt);
        const readProvenance = provenance(
          readRequest.reference,
          sourceAsOf,
          retrievedAt,
        );
        return readProvenance.freshness === "stale"
          ? { kind: "stale", identity, provenance: readProvenance, value: rows }
          : { kind: "ok", identity, provenance: readProvenance, value: rows };
      } catch (error) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unavailable",
            error instanceof Error ? error.message : "Notion read failed.",
            [options.token],
          ),
        };
      }
    },

    async write(writeRequest: ProviderWriteRequest): Promise<ProviderWriteResult> {
      if (
        writeRequest.idempotencyKey.trim().length === 0 ||
        writeRequest.reference.trim().length === 0
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A Notion write requires an idempotency key and page reference.",
          ),
        };
      }
      const sensitiveFields = detectSensitiveFields(writeRequest.payload);
      if (sensitiveFields.length > 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            `A Notion write rejected Sensitive Secret fields: ${sensitiveFields.join(", ")}.`,
          ),
        };
      }
      const digest = payloadDigest(writeRequest.payload);
      const prior = ledger.receipt(writeRequest.idempotencyKey);
      if (prior !== undefined) {
        if (prior.reference !== writeRequest.reference || prior.payloadDigest !== digest) {
          return {
            kind: "failed",
            failure: providerFailure(
              "invalid-input",
              "A Notion idempotency key was reused for a different effect.",
            ),
          };
        }
        const timestamp = now();
        return {
          kind: "ok",
          identity,
          provenance: provenance(writeRequest.reference, timestamp, timestamp),
          effectReference: prior.effectReference,
          deduplicated: true,
        };
      }

      try {
        const result = await api(`/pages/${encodeURIComponent(writeRequest.reference)}`, {
          method: "PATCH",
          headers: headers(true),
          body: JSON.stringify({ properties: pageProperties(writeRequest.payload) }),
        });
        if (!result.response.ok) {
          return { kind: "failed", failure: await normalizedFailure(result.response) };
        }
        ledger.record(writeRequest.idempotencyKey, {
          reference: writeRequest.reference,
          payloadDigest: digest,
          effectReference: writeRequest.idempotencyKey,
        });
        const timestamp = now();
        return {
          kind: "ok",
          identity,
          provenance: provenance(writeRequest.reference, timestamp, timestamp),
          effectReference: writeRequest.idempotencyKey,
          deduplicated: false,
        };
      } catch (error) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unavailable",
            error instanceof Error ? error.message : "Notion write failed.",
            [options.token],
          ),
        };
      }
    },

    provisionMasterTasks,
  };
}
