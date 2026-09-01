import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  executiveRoles,
  riskClasses,
  trustDomains,
  workItemPriorities,
  workItemStates,
  workstreams,
} from "../operations/contracts.js";
import {
  masterTasksSchema,
  masterTasksViewDefinitions,
  type MasterTaskPropertyType,
  type MasterTaskRecord,
  type MasterTasksProvisioning,
  type MasterTasksStore,
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

interface NotionWriteReceiptRow {
  readonly reference: string;
  readonly payload_digest: string;
  readonly effect_reference: string;
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

export class SqliteNotionWriteLedger implements NotionWriteLedger {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS notion_write_receipts (
        idempotency_key TEXT PRIMARY KEY,
        reference TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        effect_reference TEXT NOT NULL
      );
    `);
  }

  receipt(idempotencyKey: string): NotionWriteReceipt | undefined {
    const row = this.#database
      .prepare(
        `SELECT reference, payload_digest, effect_reference
         FROM notion_write_receipts WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as unknown as NotionWriteReceiptRow | undefined;
    return row === undefined
      ? undefined
      : {
          reference: row.reference,
          payloadDigest: row.payload_digest,
          effectReference: row.effect_reference,
        };
  }

  record(idempotencyKey: string, receipt: NotionWriteReceipt): void {
    this.#database
      .prepare(
        `INSERT INTO notion_write_receipts
         (idempotency_key, reference, payload_digest, effect_reference)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        idempotencyKey,
        receipt.reference,
        receipt.payloadDigest,
        receipt.effectReference,
      );
  }

  close(): void {
    this.#database.close();
  }
}

export type NotionProvisionResult =
  | { readonly kind: "ok"; readonly value: MasterTasksProvisioning }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface NotionProviderAdapter extends ProviderAdapter<readonly unknown[]> {
  provisionMasterTasks(request: {
    readonly parentPageId: string;
    readonly idempotencyKey: string;
  }): Promise<NotionProvisionResult>;
  upsertMasterTask(request: {
    readonly dataSourceId: string;
    readonly record: MasterTaskRecord;
  }): Promise<ProviderWriteResult>;
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
  if (name === "Trust Domain") return trustDomains;
  if (name === "Workstream") return workstreams;
  if (name === "Accountable Executive" || name === "Collaborating Executives") {
    return executiveRoles;
  }
  if (name === "Lifecycle") return workItemStates;
  if (name === "Priority") return workItemPriorities;
  if (name === "Risk Class") return riskClasses;
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

function viewFilterMatches(
  actual: unknown,
  executive: string | null,
  propertyId: string | undefined,
): boolean {
  if (executive === null) return actual === null || actual === undefined;
  if (!isRecord(actual) || !isRecord(actual["select"])) return false;
  const property = actual["property"];
  return (property === "Accountable Executive" || property === propertyId) &&
    actual["select"]["equals"] === executive;
}

function textValue(type: "title" | "rich_text", value: string): object {
  return { [type]: value === "" ? [] : [{ type: "text", text: { content: value } }] };
}

export function notionPageProperties(
  payload: Readonly<Record<string, string>>,
  options: { readonly allowLifecycle?: boolean } = {},
): Readonly<Record<string, unknown>> {
  const schema = new Map(masterTasksSchema.map((property) => [property.name, property.type]));
  return Object.fromEntries(Object.entries(payload).map(([name, value]) => {
    const type = schema.get(name);
    if (name === "Lifecycle" && options.allowLifecycle !== true) {
      throw new Error("Lifecycle changes must go through the Operations Gateway.");
    }
    if (type === "created_time" || type === "last_edited_time") {
      throw new Error(`${name} is computed by Notion and cannot be written.`);
    }
    if (type === "title" || type === "rich_text" || type === undefined) {
      return [name, textValue(type ?? "rich_text", value)];
    }
    if (type === "select") {
      return [name, { select: value === "" ? null : { name: value } }];
    }
    if (type === "checkbox") {
      if (value !== "true" && value !== "false") {
        throw new Error(`${name} must be true or false.`);
      }
      return [name, { checkbox: value === "true" }];
    }
    let values: unknown;
    try { values = JSON.parse(value); } catch { values = value.split(",").map((item) => item.trim()); }
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string")) {
      throw new Error(`${name} must be a string array.`);
    }
    return [name, { multi_select: values.map((item) => ({ name: item })) }];
  }));
}

function masterTaskPayload(record: MasterTaskRecord): Readonly<Record<string, string>> {
  return {
    Title: record.title,
    "Work Item ID": record.workItemId,
    Workspace: record.workspaceId,
    Source: record.source,
    "Source Reference": record.sourceReference,
    Intent: record.intent,
    "Trust Domain": record.trustDomain,
    ...(record.workstream === null ? {} : { Workstream: record.workstream }),
    "Accountable Executive": record.accountableExecutive,
    "Collaborating Executives": JSON.stringify(record.collaboratingExecutives),
    Lifecycle: record.lifecycle,
    ...(record.priority === null ? {} : { Priority: record.priority }),
    ...(record.commitmentValue === null ? {} : { "Commitment Value": record.commitmentValue }),
    ...(record.commitmentProvenance === null ? {} : { "Commitment Provenance": record.commitmentProvenance }),
    ...(record.riskClass === null ? {} : { "Risk Class": record.riskClass }),
    "Approval Required": String(record.approvalRequired),
    ...(record.approvalReference === null ? {} : { "Approval Reference": record.approvalReference }),
    ...(record.portfolioProject === null ? {} : { "Portfolio Project": record.portfolioProject }),
    "Evidence References": JSON.stringify(record.evidenceReferences),
    ...(record.outcomeReportReference === null ? {} : {
      "Outcome Report Reference": record.outcomeReportReference,
    }),
  };
}

function propertyOf(page: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const properties = page["properties"];
  const property = isRecord(properties) ? properties[name] : undefined;
  return isRecord(property) ? property : undefined;
}

function notionText(page: Record<string, unknown>, name: string): string {
  const property = propertyOf(page, name);
  const values = property?.["title"] ?? property?.["rich_text"];
  if (!Array.isArray(values)) return "";
  return values.map((value) => {
    if (!isRecord(value)) return "";
    if (typeof value["plain_text"] === "string") return value["plain_text"];
    const text = value["text"];
    return isRecord(text) && typeof text["content"] === "string" ? text["content"] : "";
  }).join("");
}

function notionSelect(page: Record<string, unknown>, name: string): string | null {
  const selected = propertyOf(page, name)?.["select"];
  return isRecord(selected) && typeof selected["name"] === "string" ? selected["name"] : null;
}

function notionMultiSelect(page: Record<string, unknown>, name: string): readonly string[] {
  const selected = propertyOf(page, name)?.["multi_select"];
  return Array.isArray(selected)
    ? selected.flatMap((value) => isRecord(value) && typeof value["name"] === "string" ? [value["name"]] : [])
    : [];
}

function parseMasterTaskPage(value: unknown): MasterTaskRecord {
  if (!isRecord(value)) throw new Error("Notion returned an unreadable Master Tasks page.");
  const workItemId = notionText(value, "Work Item ID");
  const accountableExecutive = notionSelect(value, "Accountable Executive");
  const trustDomain = notionSelect(value, "Trust Domain");
  const lifecycle = notionSelect(value, "Lifecycle");
  const workstream = notionSelect(value, "Workstream");
  const priority = notionSelect(value, "Priority");
  const riskClass = notionSelect(value, "Risk Class");
  if (workItemId === "" || !executiveRoles.includes(accountableExecutive as never) ||
    !trustDomains.includes(trustDomain as never) || !workItemStates.includes(lifecycle as never) ||
    (workstream !== null && !workstreams.includes(workstream as never)) ||
    (priority !== null && !workItemPriorities.includes(priority as never)) ||
    (riskClass !== null && !riskClasses.includes(riskClass as never))) {
    throw new Error("Notion Master Tasks contains an invalid canonical Work Item.");
  }
  const evidenceText = notionText(value, "Evidence References");
  let evidenceReferences: readonly string[] = [];
  if (evidenceText !== "") {
    const parsed: unknown = JSON.parse(evidenceText);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("Evidence References must be a string array.");
    }
    evidenceReferences = parsed;
  }
  return {
    id: workItemId,
    workItemId,
    workspaceId: notionText(value, "Workspace"),
    title: notionText(value, "Title"),
    intent: notionText(value, "Intent"),
    source: notionText(value, "Source"),
    sourceReference: notionText(value, "Source Reference"),
    trustDomain: trustDomain as MasterTaskRecord["trustDomain"],
    workstream: workstream as MasterTaskRecord["workstream"],
    accountableExecutive: accountableExecutive as MasterTaskRecord["accountableExecutive"],
    collaboratingExecutives: notionMultiSelect(value, "Collaborating Executives") as MasterTaskRecord["collaboratingExecutives"],
    lifecycle: lifecycle as MasterTaskRecord["lifecycle"],
    priority: priority as MasterTaskRecord["priority"],
    commitmentValue: notionText(value, "Commitment Value") || null,
    commitmentProvenance: notionText(value, "Commitment Provenance") || null,
    riskClass: riskClass as MasterTaskRecord["riskClass"],
    approvalRequired: propertyOf(value, "Approval Required")?.["checkbox"] === true,
    approvalReference: notionText(value, "Approval Reference") || null,
    portfolioProject: notionText(value, "Portfolio Project") || null,
    evidenceReferences,
    outcomeReportReference: notionText(value, "Outcome Report Reference") || null,
    createdAt: typeof value["created_time"] === "string" ? value["created_time"] : "",
    updatedAt: typeof value["last_edited_time"] === "string" ? value["last_edited_time"] : "",
  };
}

export function createNotionProviderAdapter(
  options: NotionProviderAdapterOptions,
): NotionProviderAdapter {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const ledger = options.writeLedger;
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
      const accountableExecutiveProperty = actualProperties?.["Accountable Executive"];
      const accountableExecutivePropertyId =
        isRecord(accountableExecutiveProperty) &&
        typeof accountableExecutiveProperty["id"] === "string"
          ? accountableExecutiveProperty["id"]
          : undefined;
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
        } else if (
          isRecord(viewObject) &&
          typeof viewObject["id"] === "string" &&
          !viewFilterMatches(
            viewObject["filter"],
            definition.accountableExecutive,
            accountableExecutivePropertyId,
          )
        ) {
          const desiredFilter = definition.accountableExecutive === null
            ? null
            : {
                property: accountableExecutivePropertyId ?? "Accountable Executive",
                select: { equals: definition.accountableExecutive },
              };
          const updated = await api(`/views/${viewObject["id"]}`, {
            method: "PATCH",
            headers: headers(true),
            body: JSON.stringify({ filter: desiredFilter }),
          });
          if (!updated.response.ok) {
            return { kind: "failed", failure: await normalizedFailure(updated.response) };
          }
          viewObject = updated.body;
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

  const upsertMasterTask: NotionProviderAdapter["upsertMasterTask"] = async ({
    dataSourceId,
    record,
  }) => {
    if (ledger === undefined) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unsupported-capability",
          "A durable Notion write ledger is required before Master Tasks writes are enabled.",
        ),
      };
    }
    const payload = masterTaskPayload(record);
    const digest = payloadDigest(payload);
    const idempotencyKey = `master-task:${record.workItemId}:${digest}`;
    const prior = ledger.receipt(idempotencyKey);
    if (prior !== undefined) {
      const timestamp = now();
      return {
        kind: "ok",
        identity,
        provenance: provenance(prior.reference, timestamp, timestamp),
        effectReference: prior.effectReference,
        deduplicated: true,
      };
    }

    try {
      const query = await api(
        `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
        {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify({
            filter: {
              property: "Work Item ID",
              rich_text: { equals: record.workItemId },
            },
            page_size: 2,
          }),
        },
      );
      if (!query.response.ok) {
        return { kind: "failed", failure: await normalizedFailure(query.response) };
      }
      const results = isRecord(query.body) && Array.isArray(query.body["results"])
        ? query.body["results"]
        : undefined;
      if (results === undefined || results.length > 1) {
        return {
          kind: "failed",
          failure: providerFailure(
            "provider-error",
            results === undefined
              ? "Notion returned an unreadable Master Tasks query."
              : `Master Tasks contains duplicate Work Item ID ${record.workItemId}.`,
          ),
        };
      }
      const properties = notionPageProperties(payload, { allowLifecycle: true });
      const existing = results[0];
      const existingId = isRecord(existing) && typeof existing["id"] === "string"
        ? existing["id"]
        : undefined;
      const write = existingId === undefined
        ? await api("/pages", {
            method: "POST",
            headers: headers(true),
            body: JSON.stringify({
              parent: { type: "data_source_id", data_source_id: dataSourceId },
              properties,
            }),
          })
        : await api(`/pages/${encodeURIComponent(existingId)}`, {
            method: "PATCH",
            headers: headers(true),
            body: JSON.stringify({ properties }),
          });
      if (!write.response.ok) {
        return { kind: "failed", failure: await normalizedFailure(write.response) };
      }
      const pageId = isRecord(write.body) && typeof write.body["id"] === "string"
        ? write.body["id"]
        : existingId;
      if (pageId === undefined) {
        return {
          kind: "failed",
          failure: providerFailure("provider-error", "Notion returned no Master Tasks page identity."),
        };
      }
      ledger.record(idempotencyKey, {
        reference: pageId,
        payloadDigest: digest,
        effectReference: pageId,
      });
      const timestamp = now();
      return {
        kind: "ok",
        identity,
        provenance: provenance(pageId, timestamp, timestamp),
        effectReference: pageId,
        deduplicated: false,
      };
    } catch (error) {
      return {
        kind: "failed",
        failure: providerFailure(
          "unavailable",
          error instanceof Error ? error.message : "Master Tasks write failed.",
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
      if (ledger === undefined) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unsupported-capability",
            "A durable Notion write ledger is required before production writes are enabled.",
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

      let properties: Readonly<Record<string, unknown>>;
      try {
        properties = notionPageProperties(writeRequest.payload);
      } catch (error) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            error instanceof Error ? error.message : "Notion properties are invalid.",
          ),
        };
      }

      try {
        const result = await api(`/pages/${encodeURIComponent(writeRequest.reference)}`, {
          method: "PATCH",
          headers: headers(true),
          body: JSON.stringify({ properties }),
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
    upsertMasterTask,
  };
}

export function createNotionMasterTasksStore(options: {
  readonly adapter: NotionProviderAdapter;
  readonly dataSourceId: string;
}): MasterTasksStore {
  return {
    records: async () => {
      const result = await options.adapter.read({ reference: options.dataSourceId });
      if (result.kind === "failed") {
        throw new Error(`Master Tasks read failed (${result.failure.class}): ${result.failure.message}`);
      }
      return result.value.map(parseMasterTaskPage);
    },
    upsert: async (record) => {
      const result = await options.adapter.upsertMasterTask({
        dataSourceId: options.dataSourceId,
        record,
      });
      if (result.kind === "failed") {
        const error = new Error(
          `Master Tasks write failed (${result.failure.class}): ${result.failure.message}`,
        );
        Object.assign(error, {
          class: result.failure.class,
          retryable: result.failure.retryable,
        });
        throw error;
      }
      return record;
    },
  };
}
