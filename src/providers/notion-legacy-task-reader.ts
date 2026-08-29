import {
  legacyTaskSourceDefinitions,
  type LegacyTaskRecord,
  type LegacyTaskSource,
} from "../migration/task-migration-rehearsal.js";
import { notionApiVersion } from "./notion-provider-adapter.js";
import type { Workstream } from "../operations/contracts.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFragments(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (!isRecord(item)) return "";
    if (typeof item["plain_text"] === "string") return item["plain_text"];
    const text = item["text"];
    return isRecord(text) && typeof text["content"] === "string" ? text["content"] : "";
  }).join("");
}

function propertyValue(property: Record<string, unknown>): string {
  if (Array.isArray(property["title"])) return textFragments(property["title"]);
  if (Array.isArray(property["rich_text"])) return textFragments(property["rich_text"]);
  for (const kind of ["status", "select"] as const) {
    const selected = property[kind];
    if (isRecord(selected) && typeof selected["name"] === "string") return selected["name"];
  }
  const date = property["date"];
  if (isRecord(date) && typeof date["start"] === "string") return date["start"];
  const people = property["people"];
  if (Array.isArray(people)) {
    return people.flatMap((person) => isRecord(person) && typeof person["name"] === "string" ? [person["name"]] : []).join(", ");
  }
  return "";
}

function propertyEntries(page: Record<string, unknown>): readonly [string, Record<string, unknown>][] {
  const properties = page["properties"];
  return isRecord(properties)
    ? Object.entries(properties).flatMap(([name, value]) => isRecord(value) ? [[name, value] as const] : [])
    : [];
}

function findProperty(
  entries: readonly [string, Record<string, unknown>][],
  predicate: (name: string, property: Record<string, unknown>) => boolean,
): string {
  const found = entries.find(([name, property]) => predicate(name, property));
  return found === undefined ? "" : propertyValue(found[1]);
}

export function legacyTaskRecordFromNotion(value: unknown): LegacyTaskRecord {
  if (!isRecord(value) || typeof value["id"] !== "string") {
    throw new Error("Notion returned an unreadable legacy task page.");
  }
  const entries = propertyEntries(value);
  const title = findProperty(entries, (_name, property) => property["type"] === "title" || Array.isArray(property["title"]));
  const status = findProperty(entries, (name, property) =>
    /status|state/i.test(name) || property["type"] === "status");
  const owner = findProperty(entries, (name) => /owner|executive|assignee/i.test(name));
  const commitment = entries
    .filter(([name]) => /commitment|deadline|due|date/i.test(name))
    .map(([, property]) => propertyValue(property))
    .find((value) => value !== "") ?? "";
  const sourceWorkstream = findProperty(entries, (name) => /workstream|category|domain/i.test(name));
  const normalizedWorkstream: Workstream | null =
    /^personal life$|^life$/i.test(sourceWorkstream)
      ? "Personal Life"
      : /^career job$|^job$|^career$/i.test(sourceWorkstream)
        ? "Career Job"
        : null;
  return {
    id: value["id"],
    title,
    status,
    owner,
    commitment,
    workstream: normalizedWorkstream,
    updatedAt: typeof value["last_edited_time"] === "string" ? value["last_edited_time"] : "",
    sourcePayload: structuredClone(value),
  };
}

function sourceTitle(value: Record<string, unknown>): string {
  return textFragments(value["title"]);
}

function normalizedLegacySourceTitle(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("en");
}

export async function readLegacyNotionTaskSources(options: {
  readonly token: string;
  readonly fetch?: typeof fetch;
}): Promise<readonly LegacyTaskSource[]> {
  const request = options.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Notion-Version": notionApiVersion,
    "Content-Type": "application/json",
  };
  const sources: LegacyTaskSource[] = [];
  for (const definition of legacyTaskSourceDefinitions) {
    const search = await request("https://api.notion.com/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ query: definition.name, page_size: 100 }),
    });
    if (!search.ok) throw new Error(`Notion source discovery failed with HTTP ${search.status}.`);
    const searchBody: unknown = await search.json();
    const expectedTitle = normalizedLegacySourceTitle(definition.name);
    const matches = isRecord(searchBody) && Array.isArray(searchBody["results"])
      ? searchBody["results"].filter((item) =>
        isRecord(item) &&
        item["object"] === "data_source" &&
        normalizedLegacySourceTitle(sourceTitle(item)) === expectedTitle)
      : [];
    if (matches.length !== 1 || !isRecord(matches[0]) || typeof matches[0]["id"] !== "string") {
      throw new Error(
        matches.length === 0
          ? `Notion source is not shared with Real-Ming: ${definition.name}.`
          : `Notion source name is ambiguous: ${definition.name}.`,
      );
    }
    const sourceId = matches[0]["id"];
    const recordsById = new Map<string, LegacyTaskRecord>();
    for (const isArchived of [false, true]) {
      let cursor: string | undefined;
      do {
        const response = await request(
          `https://api.notion.com/v1/data_sources/${encodeURIComponent(sourceId)}/query`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              page_size: 100,
              is_archived: isArchived,
              ...(cursor === undefined ? {} : { start_cursor: cursor }),
            }),
          },
        );
        if (!response.ok) throw new Error(`Notion source backup failed with HTTP ${response.status}.`);
        const body: unknown = await response.json();
        if (!isRecord(body) || !Array.isArray(body["results"])) {
          throw new Error("Notion returned an unreadable legacy task list.");
        }
        for (const value of body["results"]) {
          const record = legacyTaskRecordFromNotion(value);
          recordsById.set(record.id, record);
        }
        cursor = body["has_more"] === true && typeof body["next_cursor"] === "string"
          ? body["next_cursor"]
          : undefined;
      } while (cursor !== undefined);
    }
    sources.push({
      id: sourceId,
      name: definition.name,
      workstream: definition.workstream,
      records: [...recordsById.values()],
    });
  }
  return sources;
}
