import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backupAndUploadControlPlaneState,
  backupControlPlaneState,
  restoreControlPlaneBackup,
  verifyControlPlaneBackup,
} from "../../src/runtime/control-plane-backup.js";
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

  it("backs up the native Obsidian vault as checksummed files without sharing the generated projection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-native-vault-backup-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion.sqlite");
    const vaultPath = join(directory, "native-vault");
    sqliteFile(statePath);
    sqliteFile(notionLedgerPath);
    mkdirSync(join(vaultPath, "wiki"), { recursive: true });
    writeFileSync(join(vaultPath, "MEMORY.md"), "# Approved memory\n", "utf8");
    writeFileSync(join(vaultPath, "wiki", "brief.md"), "[source](notion://brief)\n", "utf8");
    const uploaded: string[] = [];

    const backup = await backupAndUploadControlPlaneState({
      statePath,
      notionLedgerPath,
      hermesVaultPath: vaultPath,
      destinationDirectory: join(directory, "backups"),
      backupId: "2026-09-06-native-vault",
      createdAt: "2026-09-06T08:00:00.000Z",
      uploader: {
        upload: async ({ blobName }) => {
          uploaded.push(blobName);
          return { kind: "ok" } as const;
        },
      },
    });

    if (backup.hermesVaultPath === undefined) throw new Error("Native vault backup path was not returned.");
    expect(readFileSync(join(backup.hermesVaultPath, "MEMORY.md"), "utf8")).toBe("# Approved memory\n");
    expect(readFileSync(join(backup.hermesVaultPath, "wiki", "brief.md"), "utf8")).toContain("notion://brief");
    expect(backup.manifest.directories).toEqual([
      expect.objectContaining({
        role: "hermes-native-vault",
        name: "hermes-vault",
        fileCount: 2,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
    expect(backup.manifest.files.filter((file) => file.role === "hermes-native-vault").map((file) => file.name).sort()).toEqual([
      "hermes-vault/MEMORY.md",
      "hermes-vault/wiki/brief.md",
    ]);
    expect(uploaded.at(-1)).toBe("2026-09-06-native-vault/manifest.json");
    expect(uploaded).toContain("2026-09-06-native-vault/hermes-vault/MEMORY.md");
    expect(uploaded).toContain("2026-09-06-native-vault/hermes-vault/wiki/brief.md");
  });

  it("backs up the whitelisted native Hermes state and excludes auth material", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-native-state-backup-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion.sqlite");
    const nativeStatePath = join(directory, "hermes-home");
    sqliteFile(statePath);
    sqliteFile(notionLedgerPath);
    for (const relativePath of [
      "state.db",
      "kanban.db",
      "cron/executions.db",
      "response_store.db",
      "verification_evidence.db",
      "runs_idempotency.db",
      "projects.db",
    ]) {
      const path = join(nativeStatePath, relativePath);
      mkdirSync(join(path, ".."), { recursive: true });
      sqliteFile(path);
    }
    mkdirSync(join(nativeStatePath, "sessions"), { recursive: true });
    mkdirSync(join(nativeStatePath, "memories"), { recursive: true });
    writeFileSync(join(nativeStatePath, "sessions", "sessions.json"), "{\"sessions\":[]}", "utf8");
    writeFileSync(join(nativeStatePath, "memories", "USER.md"), "# Ming\n", "utf8");
    writeFileSync(join(nativeStatePath, "auth.json"), "should never be copied", "utf8");
    writeFileSync(join(nativeStatePath, ".env"), "OAUTH_TOKEN=secret", "utf8");

    const backup = await backupControlPlaneState({
      statePath,
      notionLedgerPath,
      hermesNativeStateDirectory: nativeStatePath,
      destinationDirectory: join(directory, "backups"),
      backupId: "native-state-whitelist",
      createdAt: "2026-09-06T08:30:00.000Z",
    });

    expect(backup.hermesNativeStateDirectory).toBe(
      join(directory, "backups", "native-state-whitelist", "hermes-native"),
    );
    expect(backup.manifest.files.map((file) => file.name)).toEqual([
      "state.sqlite",
      "notion-write-ledger.sqlite",
      "hermes-native/state.db",
      "hermes-native/kanban.db",
      "hermes-native/cron/executions.db",
      "hermes-native/response_store.db",
      "hermes-native/verification_evidence.db",
      "hermes-native/runs_idempotency.db",
      "hermes-native/projects.db",
      "hermes-native/sessions/sessions.json",
      "hermes-native/memories/USER.md",
    ]);
    expect(existsSync(join(backup.directory, "hermes-native", "auth.json"))).toBe(false);
    expect(existsSync(join(backup.directory, "hermes-native", ".env"))).toBe(false);
    expect(verifyControlPlaneBackup({ backupDirectory: backup.directory }).sqliteIntegrity.map((entry) => entry.name)).toEqual([
      "state.sqlite",
      "notion-write-ledger.sqlite",
      "hermes-native/state.db",
      "hermes-native/kanban.db",
      "hermes-native/cron/executions.db",
      "hermes-native/response_store.db",
      "hermes-native/verification_evidence.db",
      "hermes-native/runs_idempotency.db",
      "hermes-native/projects.db",
    ]);

    const restored = restoreControlPlaneBackup({
      backupDirectory: backup.directory,
      destinationDirectory: join(directory, "isolated-native-restore"),
    });
    expect(readFileSync(join(restored.directory, "hermes-native", "sessions", "sessions.json"), "utf8"))
      .toBe("{\"sessions\":[]}");
    expect(readFileSync(join(restored.directory, "hermes-native", "memories", "USER.md"), "utf8"))
      .toBe("# Ming\n");
    expect(existsSync(join(restored.directory, "hermes-native", "auth.json"))).toBe(false);
    expect(restored.sqliteIntegrity).toHaveLength(9);
  });

  it("restores a manifest-verified set into an isolated destination and checks every SQLite store", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-restore-rehearsal-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion.sqlite");
    const hermesStatePath = join(directory, "hermes-state.db");
    const vaultPath = join(directory, "native-vault");
    sqliteFile(statePath);
    sqliteFile(notionLedgerPath);
    sqliteFile(hermesStatePath);
    mkdirSync(join(vaultPath, "wiki"), { recursive: true });
    writeFileSync(join(vaultPath, "MEMORY.md"), "# Native memory\n", "utf8");
    writeFileSync(join(vaultPath, "wiki", "brief.md"), "[source](notion://brief)\n", "utf8");

    const backup = await backupControlPlaneState({
      statePath,
      notionLedgerPath,
      hermesStatePath,
      hermesVaultPath: vaultPath,
      destinationDirectory: join(directory, "backups"),
      backupId: "restore-rehearsal",
      createdAt: "2026-09-06T08:10:00.000Z",
    });

    const restored = restoreControlPlaneBackup({
      backupDirectory: backup.directory,
      destinationDirectory: join(directory, "isolated-restore"),
    });

    expect(restored.verifiedFiles).toBe(5);
    expect(restored.sqliteIntegrity).toEqual([
      { name: "state.sqlite", result: "ok" },
      { name: "notion-write-ledger.sqlite", result: "ok" },
      { name: "hermes-state.db", result: "ok" },
    ]);
    expect(readFileSync(join(restored.directory, "hermes-vault", "MEMORY.md"), "utf8")).toBe(
      "# Native memory\n",
    );
    expect(readFileSync(join(restored.directory, "hermes-vault", "wiki", "brief.md"), "utf8")).toContain(
      "notion://brief",
    );
    expect(JSON.parse(readFileSync(restored.manifestPath, "utf8"))).toEqual(backup.manifest);
  });

  it("refuses a tampered recovery set before creating the restore destination", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-restore-tamper-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");
    const notionLedgerPath = join(directory, "notion.sqlite");
    sqliteFile(statePath);
    sqliteFile(notionLedgerPath);

    const backup = await backupControlPlaneState({
      statePath,
      notionLedgerPath,
      destinationDirectory: join(directory, "backups"),
      backupId: "tampered-recovery",
      createdAt: "2026-09-06T08:20:00.000Z",
    });
    writeFileSync(join(backup.directory, "state.sqlite"), "tampered", "utf8");
    const destination = join(directory, "isolated-restore");

    expect(() => restoreControlPlaneBackup({
      backupDirectory: backup.directory,
      destinationDirectory: destination,
    })).toThrow("sha256 mismatch");
    expect(existsSync(destination)).toBe(false);
  });
});
