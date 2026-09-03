import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  TaskMigrationRehearsal,
  type MigrationBackup,
} from "../migration/task-migration-rehearsal.js";
import { readLegacyNotionTaskSources } from "../providers/notion-legacy-task-reader.js";

const outputDirectory = fileURLToPath(new URL("../../tmp/rm10-migration-rehearsal/", import.meta.url));

function requireEnvironment(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") throw new Error(`${name} is not set in the local environment.`);
  return value;
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(`${outputDirectory}${name}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    throw new Error(
      "Live Notion source reads are disabled. Pass --live only after the five sources are shared with Real-Ming.",
    );
  }
  const sources = await readLegacyNotionTaskSources({
    token: requireEnvironment("REAL_MING_NOTION_TOKEN"),
  });
  const rehearsal = new TaskMigrationRehearsal(sources);
  const backups = rehearsal.captureBackups();
  mkdirSync(outputDirectory, { recursive: true });
  writeJson("source-backups.json", backups);
  const durableBackups = JSON.parse(
    readFileSync(`${outputDirectory}source-backups.json`, "utf8"),
  ) as readonly MigrationBackup[];
  const first = rehearsal.importVerifiedBackups(durableBackups);
  const countAfterFirst = rehearsal.targetCount();
  const replay = rehearsal.importVerifiedBackups(durableBackups);
  if (rehearsal.targetCount() !== countAfterFirst) {
    throw new Error("Migration rehearsal replay created duplicate target Work Items.");
  }
  writeJson("isolated-target.json", replay.targetRecords);
  writeJson("reconciliation-report.json", replay.report);
  writeJson("manifest.json", {
    sourceCount: sources.length,
    sourceRecordCounts: first.backups.map(({ sourceId, recordCount, integrity }) => ({
      sourceId,
      recordCount,
      integrity,
    })),
    isolatedTargetCount: countAfterFirst,
    replayTargetCount: rehearsal.targetCount(),
    sourcesMutated: false,
    targetKind: "local-isolated-rehearsal",
  });
  rehearsal.rollback();
  if (rehearsal.targetCount() !== 0) {
    throw new Error("Migration rehearsal target rollback failed.");
  }
  process.stdout.write(
    [
      "RM-10 migration rehearsal complete.",
      `Sources backed up: ${sources.length}`,
      `Isolated target records: ${countAfterFirst}`,
      "Replay created no duplicate target Work Items.",
      "Source databases were read only; the isolated target was rolled back.",
      `Evidence directory: ${outputDirectory}`,
    ].join("\n") + "\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "RM-10 rehearsal failed."}\n`);
  process.exitCode = 1;
});
