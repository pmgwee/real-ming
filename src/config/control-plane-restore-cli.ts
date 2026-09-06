import { restoreControlPlaneBackup } from "../runtime/control-plane-backup.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1]?.trim();
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${name} is required for an isolated control-plane restore.`);
  }
  return value;
}

function main(): void {
  if (!process.argv.includes("--live")) {
    process.stdout.write(
      "Control-plane restore skipped; pass --live with --backup and --destination explicitly.\n",
    );
    return;
  }
  const restored = restoreControlPlaneBackup({
    backupDirectory: argument("--backup"),
    destinationDirectory: argument("--destination"),
  });
  process.stdout.write(
    `Control-plane restore verified ${restored.verifiedFiles} files at ${restored.directory}; ` +
    `${restored.sqliteIntegrity.length} SQLite stores passed integrity checks.\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Control-plane restore failed."}\n`,
  );
  process.exitCode = 1;
}
