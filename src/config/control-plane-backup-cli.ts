import { existsSync } from "node:fs";
import { createAzureBlobBackupUploader } from "../providers/azure-blob-backup-uploader.js";
import { backupAndUploadControlPlaneState } from "../runtime/control-plane-backup.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the remote state backup.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    process.stdout.write("Control-plane backup skipped; pass --live explicitly.\n");
    return;
  }
  const sourcePath = required("REAL_MING_STATE_PATH");
  const notionLedgerPath = required("REAL_MING_NOTION_LEDGER_PATH");
  const configuredHermesSessionPath = process.env["REAL_MING_HERMES_SESSIONS_PATH"]?.trim();
  // Hermes is opt-in. Before first activation its SQLite file does not exist;
  // the control-plane state backup must still run and preserve the two
  // mandatory stores rather than turning an optional feature into a backup
  // outage.
  const hermesSessionPath = configuredHermesSessionPath !== undefined && configuredHermesSessionPath.length > 0 && existsSync(configuredHermesSessionPath)
    ? configuredHermesSessionPath
    : undefined;
  const configuredHermesStatePath = process.env["REAL_MING_HERMES_STATE_PATH"]?.trim();
  const hermesStatePath = configuredHermesStatePath !== undefined && configuredHermesStatePath.length > 0 && existsSync(configuredHermesStatePath)
    ? configuredHermesStatePath
    : undefined;
  const directory =
    process.env["REAL_MING_LOCAL_BACKUP_DIRECTORY"]?.trim() ||
    "/var/lib/real-ming/backups";
  const createdAt = new Date().toISOString();
  const backupId = createdAt.replaceAll(":", "-");
  const uploader = createAzureBlobBackupUploader({
    accountName: required("REAL_MING_BACKUP_STORAGE_ACCOUNT"),
    containerName: required("REAL_MING_BACKUP_STORAGE_CONTAINER"),
  });
  await backupAndUploadControlPlaneState({
    statePath: sourcePath,
    notionLedgerPath,
    ...(hermesSessionPath === undefined || hermesSessionPath.length === 0
      ? {}
      : { hermesSessionPath }),
    ...(hermesStatePath === undefined || hermesStatePath.length === 0
      ? {}
      : { hermesStatePath }),
    destinationDirectory: directory,
    backupId,
    createdAt,
    uploader,
  });
  process.stdout.write(`Control-plane state backup completed: ${backupId}.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Control-plane backup failed."}\n`,
  );
  process.exitCode = 1;
});
