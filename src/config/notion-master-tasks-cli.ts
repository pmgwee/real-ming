import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { upsertEnvValue } from "./google-oauth.js";
import {
  createNotionProviderAdapter,
  SqliteNotionWriteLedger,
} from "../providers/notion-provider-adapter.js";

const envPath = new URL("../../.env", import.meta.url);
const ledgerPath = new URL("../../.real-ming-notion-ledger.sqlite", import.meta.url);

function requireEnvironment(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) {
    throw new Error(`${name} is not set in the local environment.`);
  }
  return value;
}

export function notionPageId(input: string): string {
  const compact = input.trim().replaceAll("-", "");
  const match = compact.match(/([0-9a-f]{32})(?:\?.*)?$/i);
  if (match?.[1] === undefined) {
    throw new Error("Provide a Notion page URL or 32-character page id.");
  }
  const id = match[1].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function writeMasterTasksId(value: string): void {
  let existing = "";
  try {
    existing = readFileSync(envPath, "utf8");
  } catch {
    existing = "";
  }
  writeFileSync(
    envPath,
    upsertEnvValue(existing, "REAL_MING_NOTION_MASTER_TASKS_ID", value),
    "utf8",
  );
}

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    throw new Error(
      "Live Notion provisioning is disabled. Pass --live only after explicit CEO approval.",
    );
  }
  const parentInput = process.argv[2] ?? "";
  const parentPageId = notionPageId(parentInput);
  const ledger = new SqliteNotionWriteLedger(fileURLToPath(ledgerPath));
  const adapter = createNotionProviderAdapter({
    token: requireEnvironment("REAL_MING_NOTION_TOKEN"),
    workspaceId: "workspace:real-ming",
    accountReference: "notion:account:real-ming",
    writeLedger: ledger,
  });
  const result = await adapter.provisionMasterTasks({
    parentPageId,
    idempotencyKey: "rm09:master-tasks:v1",
  }).finally(() => ledger.close());
  if (result.kind === "failed") {
    throw new Error(
      `Master Tasks provisioning failed (${result.failure.class}): ${result.failure.message}`,
    );
  }

  writeMasterTasksId(result.value.dataSourceId);
  process.stdout.write(
    [
      "RM-09 Notion provisioning complete.",
      `Master Tasks database: ${result.value.databaseId}`,
      `Master Tasks data source: ${result.value.dataSourceId}`,
      `Work Views: ${result.value.views.map((view) => view.name).join(", ")}`,
      "REAL_MING_NOTION_MASTER_TASKS_ID written to .env; no credential value was printed.",
    ].join("\n") + "\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Master Tasks provisioning failed."}\n`,
  );
  process.exitCode = 1;
});
