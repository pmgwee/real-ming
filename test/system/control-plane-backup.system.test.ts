import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { backupControlPlaneState } from "../../src/runtime/control-plane-backup.js";
import { createHermesSessionStore } from "../../src/hermes/hermes-session-store.js";

const directories: string[] = [];

function sqliteFile(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('controlled');");
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("control-plane recovery sets", () => {
  it("includes the durable Hermes session mapping when configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-hermes-backup-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion.sqlite");
    const hermesSessionPath = join(directory, "hermes.sqlite");
    const hermesStatePath = join(directory, "hermes-state.db");
    sqliteFile(statePath);
    sqliteFile(notionLedgerPath);
    sqliteFile(hermesStatePath);
    const sessions = createHermesSessionStore(hermesSessionPath);
    sessions.bindTelegramSession("telegram-chat:100", "hermes:session", "2026-09-04T00:00:00.000Z");
    sessions.close();

    const backup = await backupControlPlaneState({
      statePath,
      notionLedgerPath,
      hermesSessionPath,
      hermesStatePath,
      destinationDirectory: join(directory, "backups"),
      backupId: "2026-09-04T00-00-00Z",
      createdAt: "2026-09-04T00:00:00.000Z",
    });

    if (backup.hermesSessionPath === undefined) throw new Error("Hermes backup path was not returned.");
    if (backup.hermesStatePath === undefined) throw new Error("Hermes native-state backup path was not returned.");
    expect(backup.hermesSessionPath).toBe(join(directory, "backups", "2026-09-04T00-00-00Z", "hermes.sqlite"));
    expect(existsSync(backup.hermesSessionPath)).toBe(true);
    expect(backup.hermesStatePath).toBe(join(directory, "backups", "2026-09-04T00-00-00Z", "hermes-state.db"));
    expect(existsSync(backup.hermesStatePath)).toBe(true);
    expect(backup.manifest.files.map((file) => file.role)).toEqual([
      "operations-state",
      "notion-write-ledger",
      "hermes-session",
      "hermes-native-state",
    ]);
    const manifest = JSON.parse(readFileSync(backup.manifestPath, "utf8")) as {
      readonly files: readonly { readonly name: string; readonly sha256: string }[];
    };
    expect(manifest.files.find((file) => file.name === "hermes.sqlite")?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.files.find((file) => file.name === "hermes-state.db")?.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
