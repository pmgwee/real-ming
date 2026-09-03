import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

/**
 * Take a transactionally consistent SQLite backup while the control plane is
 * running. The destination must be new: silently replacing the last recoverable
 * copy would turn a backup failure into data loss.
 */
export async function backupSqliteState(options: {
  readonly sourcePath: string;
  readonly destinationPath: string;
}): Promise<void> {
  const source = resolve(options.sourcePath);
  const destination = resolve(options.destinationPath);
  if (source === destination) {
    throw new Error("A SQLite backup destination must differ from its source.");
  }
  if (existsSync(destination)) {
    throw new Error("A SQLite backup destination must not already exist.");
  }

  const database = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(database, destination);
  } finally {
    database.close();
  }
}
