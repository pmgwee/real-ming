import { createHash } from "node:crypto";

import type { Workstream } from "../operations/contracts.js";
import type {
  CutoverLinkedView,
  CutoverRetirement,
  CutoverSourceRecord,
  CutoverSourceSnapshot,
  CutoverTarget,
  CutoverWorkspace,
} from "../migration/master-tasks-cutover.js";
import { notionApiVersion } from "./notion-provider-adapter.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Key order in a Notion response is not guaranteed, so a payload hash is taken
 * over a canonical ordering. Two reads of an unchanged page must hash the same,
 * and any edited property must change the hash.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function cutoverPayloadHash(page: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(page)))
    .digest("hex")}`;
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) =>
      isRecord(item) && typeof item["plain_text"] === "string"
        ? item["plain_text"]
        : "",
    )
    .join("");
}

function pageTitle(page: Record<string, unknown>): string {
  const properties = page["properties"];
  if (!isRecord(properties)) return "";
  for (const property of Object.values(properties)) {
    if (isRecord(property) && Array.isArray(property["title"])) {
      return plainText(property["title"]);
    }
  }
  return "";
}

function pageStatus(page: Record<string, unknown>): string {
  const properties = page["properties"];
  if (!isRecord(properties)) return "";
  for (const [name, property] of Object.entries(properties)) {
    if (!isRecord(property)) continue;
    const isStatus = property["type"] === "status" || /status|state/i.test(name);
    if (!isStatus) continue;
    for (const kind of ["status", "select"] as const) {
      const selected = property[kind];
      if (isRecord(selected) && typeof selected["name"] === "string") {
        return selected["name"];
      }
    }
  }
  return "";
}

export interface NotionCutoverWorkspaceOptions {
  readonly token: string;
  readonly databaseId: string;
  /**
   * Page the linked views are created on. Creating a view means creating a
   * database block that points at an existing data source, so Notion needs a
   * page to put it on.
   */
  readonly linkedViewParentPageId: string;
  readonly sourceDataSourceIds: readonly string[];
  readonly fetch?: typeof fetch;
}

export function createNotionCutoverWorkspace(
  options: NotionCutoverWorkspaceOptions,
): CutoverWorkspace {
  const request = options.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Notion-Version": notionApiVersion,
    "Content-Type": "application/json",
  };

  const call = async (
    path: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown>> => {
    const response = await request(`https://api.notion.com${path}`, {
      ...init,
      headers,
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body)) {
      // Notion names the field it rejected. Reporting only the status would
      // leave the operator guessing in the middle of a one-way cutover.
      const code =
        isRecord(body) && typeof body["code"] === "string"
          ? ` ${body["code"]}:`
          : "";
      const detail =
        isRecord(body) && typeof body["message"] === "string"
          ? ` ${body["message"]}`
          : "";
      throw new Error(
        `Notion cutover call failed with HTTP ${response.status} for ${path}.${code}${detail}`,
      );
    }
    return body;
  };

  const dataSource = (id: string): Promise<Record<string, unknown>> =>
    call(`/v1/data_sources/${encodeURIComponent(id)}`);

  const databaseOf = async (
    id: string,
  ): Promise<{ readonly id: string; readonly locked: boolean }> => {
    const source = await dataSource(id);
    const parent = source["parent"];
    const databaseId =
      isRecord(parent) && typeof parent["database_id"] === "string"
        ? parent["database_id"]
        : undefined;
    if (databaseId === undefined) {
      throw new Error(`Notion data source ${id} has no parent database.`);
    }
    const database = await call(`/v1/databases/${encodeURIComponent(databaseId)}`);
    return {
      id: databaseId,
      locked: database["is_locked"] === true || database["in_trash"] === true,
    };
  };

  const queryPages = async (
    id: string,
  ): Promise<readonly CutoverSourceRecord[]> => {
    const records: CutoverSourceRecord[] = [];
    let cursor: string | undefined;
    do {
      const body = await call(
        `/v1/data_sources/${encodeURIComponent(id)}/query`,
        {
          method: "POST",
          body: JSON.stringify({
            page_size: 100,
            ...(cursor === undefined ? {} : { start_cursor: cursor }),
          }),
        },
      );
      const results = body["results"];
      if (!Array.isArray(results)) {
        throw new Error(`Notion returned an unreadable page list for ${id}.`);
      }
      for (const page of results) {
        if (!isRecord(page) || typeof page["id"] !== "string") {
          throw new Error(`Notion returned an unreadable page in ${id}.`);
        }
        records.push({
          pageId: page["id"],
          payloadHash: cutoverPayloadHash(page),
          title: pageTitle(page),
          legacyStatus: pageStatus(page),
        });
      }
      cursor =
        body["has_more"] === true && typeof body["next_cursor"] === "string"
          ? body["next_cursor"]
          : undefined;
    } while (cursor !== undefined);
    return records;
  };

  return {
    async readSources(): Promise<readonly CutoverSourceSnapshot[]> {
      const snapshots: CutoverSourceSnapshot[] = [];
      for (const id of options.sourceDataSourceIds) {
        const source = await dataSource(id);
        const parent = await databaseOf(id);
        snapshots.push({
          dataSourceId: id,
          parentDatabaseId: parent.id,
          name: plainText(source["title"]),
          records: await queryPages(id),
        });
      }
      return snapshots;
    },

    async masterTasksTarget(): Promise<CutoverTarget> {
      const database = await call(
        `/v1/databases/${encodeURIComponent(options.databaseId)}`,
      );
      const sources = database["data_sources"];
      const first = Array.isArray(sources) ? sources[0] : undefined;
      if (!isRecord(first) || typeof first["id"] !== "string") {
        throw new Error("Master Tasks reported no data source.");
      }
      return { databaseId: options.databaseId, dataSourceId: first["id"] };
    },

    async ensureLinkedView(view: {
      readonly name: string;
      readonly dataSourceId: string;
      readonly workstreams: readonly Workstream[];
    }): Promise<CutoverLinkedView> {
      const clauses = view.workstreams.map((workstream) => ({
        property: "Workstream",
        select: { equals: workstream },
      }));
      const filter = clauses.length === 1 ? clauses[0] : { or: clauses };

      // The listing returns identity only, so each view has to be retrieved to
      // learn its name. Matching against the listing alone would find nothing
      // and create a duplicate view on every run.
      const listed = await call(
        `/v1/views?data_source_id=${encodeURIComponent(view.dataSourceId)}`,
      );
      const results = listed["results"];
      const ids = Array.isArray(results)
        ? results.flatMap((candidate) =>
            isRecord(candidate) && typeof candidate["id"] === "string"
              ? [candidate["id"]]
              : [],
          )
        : [];
      for (const id of ids) {
        const candidate = await call(`/v1/views/${encodeURIComponent(id)}`);
        if (candidate["name"] !== view.name) continue;
        // A view whose database is in the trash is not a live view; reusing one
        // would point daily use at something Notion has already discarded.
        const parent = candidate["parent"];
        const parentDatabaseId =
          isRecord(parent) && typeof parent["database_id"] === "string"
            ? parent["database_id"]
            : undefined;
        if (parentDatabaseId !== undefined) {
          const parentDatabase = await call(
            `/v1/databases/${encodeURIComponent(parentDatabaseId)}`,
          );
          if (parentDatabase["in_trash"] === true) continue;
        }
        await call(`/v1/views/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ filter }),
        });
        return {
          id,
          name: view.name,
          dataSourceId: view.dataSourceId,
          workstreams: view.workstreams,
        };
      }

      const created = await call("/v1/views", {
        method: "POST",
        body: JSON.stringify({
          create_database: {
            parent: {
              type: "page_id",
              page_id: options.linkedViewParentPageId,
            },
          },
          data_source_id: view.dataSourceId,
          name: view.name,
          type: "table",
          filter,
        }),
      });
      if (typeof created["id"] !== "string") {
        throw new Error(`Notion did not return an id for linked view ${view.name}.`);
      }
      return {
        id: created["id"],
        name: view.name,
        dataSourceId: view.dataSourceId,
        workstreams: view.workstreams,
      };
    },

    async verifyRetirable(dataSourceId: string): Promise<void> {
      const parent = await databaseOf(dataSourceId);
      if (parent.locked) {
        throw new Error(
          `Legacy database ${parent.id} is already locked or in the trash.`,
        );
      }
    },

    async retireLegacySource(retirement: {
      readonly dataSourceId: string;
      readonly archivedName: string;
    }): Promise<CutoverRetirement> {
      const parent = await databaseOf(retirement.dataSourceId);
      const updated = await call(
        `/v1/databases/${encodeURIComponent(parent.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: [{ type: "text", text: { content: retirement.archivedName } }],
            is_locked: true,
          }),
        },
      );
      return {
        dataSourceId: retirement.dataSourceId,
        archivedName: retirement.archivedName,
        locked: updated["is_locked"] === true,
      };
    },

    async writableTaskSystems(): Promise<readonly string[]> {
      const target = await this.masterTasksTarget();
      const writable: string[] = [target.dataSourceId];
      for (const id of options.sourceDataSourceIds) {
        const parent = await databaseOf(id);
        if (!parent.locked) writable.push(id);
      }
      return writable;
    },
  };
}
