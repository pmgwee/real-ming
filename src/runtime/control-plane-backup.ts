import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { backupSqliteState } from "./sqlite-state-backup.js";
import { OperationsState } from "../operations/operations-state.js";

export interface ControlPlaneBackupManifest {
  readonly backupId: string;
  readonly createdAt: string;
  readonly files: readonly {
    readonly role: "operations-state" | "notion-write-ledger";
    readonly name: string;
    readonly sha256: string;
  }[];
}

export interface ControlPlaneBackupSet {
  readonly directory: string;
  readonly statePath: string;
  readonly notionLedgerPath: string;
  readonly manifestPath: string;
  readonly manifest: ControlPlaneBackupManifest;
}

export interface ControlPlaneBackupUploader {
  upload(request: {
    readonly blobName: string;
    readonly content: Uint8Array;
  }): Promise<
    | { readonly kind: "ok" }
    | { readonly kind: "failed"; readonly reason: "forbidden" | "unavailable" }
  >;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Create one immutable, checksummed recovery set for both production stores. */
export async function backupControlPlaneState(options: {
  readonly statePath: string;
  readonly notionLedgerPath: string;
  readonly destinationDirectory: string;
  readonly backupId: string;
  readonly createdAt: string;
}): Promise<ControlPlaneBackupSet> {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u.test(options.backupId)) {
    throw new Error("A control-plane backup ID must be a safe path segment.");
  }
  if (!existsSync(options.statePath) || !existsSync(options.notionLedgerPath)) {
    throw new Error("Both control-plane databases must exist before backup.");
  }
  const directory = join(options.destinationDirectory, options.backupId);
  const statePath = join(directory, "state.sqlite");
  const notionLedgerPath = join(directory, "notion-write-ledger.sqlite");
  const manifestPath = join(directory, "manifest.json");
  let createdDirectory = false;

  try {
    mkdirSync(options.destinationDirectory, { recursive: true });
    if (existsSync(directory)) {
      throw new Error("A control-plane backup set must not already exist.");
    }
    mkdirSync(directory, { recursive: false });
    createdDirectory = true;
    await backupSqliteState({
      sourcePath: options.statePath,
      destinationPath: statePath,
    });
    await backupSqliteState({
      sourcePath: options.notionLedgerPath,
      destinationPath: notionLedgerPath,
    });
    const manifest: ControlPlaneBackupManifest = {
      backupId: options.backupId,
      createdAt: options.createdAt,
      files: [
        {
          role: "operations-state",
          name: "state.sqlite",
          sha256: digest(statePath),
        },
        {
          role: "notion-write-ledger",
          name: "notion-write-ledger.sqlite",
          sha256: digest(notionLedgerPath),
        },
      ],
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return {
      directory,
      statePath,
      notionLedgerPath,
      manifestPath,
      manifest,
    };
  } catch (error) {
    if (createdDirectory && existsSync(directory)) {
      rmSync(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

function recordBackupHealth(
  statePath: string,
  outcome: "healthy" | "failed",
  checkedAt: string,
): void {
  const state = new OperationsState(statePath);
  try {
    state.recordControlPlaneHealth({
      component: "state-backup",
      outcome,
      checkedAt,
    });
  } finally {
    state.close();
  }
}

/**
 * Publish a complete recovery set. The manifest is uploaded last and acts as
 * the completeness marker; a partial prefix without it is never recoverable.
 */
export async function backupAndUploadControlPlaneState(options: {
  readonly statePath: string;
  readonly notionLedgerPath: string;
  readonly destinationDirectory: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly uploader: ControlPlaneBackupUploader;
}): Promise<ControlPlaneBackupSet> {
  let backup: ControlPlaneBackupSet;
  try {
    backup = await backupControlPlaneState(options);
    for (const [name, path] of [
      ["state.sqlite", backup.statePath],
      ["notion-write-ledger.sqlite", backup.notionLedgerPath],
      ["manifest.json", backup.manifestPath],
    ] as const) {
      const upload = await options.uploader.upload({
        blobName: `${backup.manifest.backupId}/${name}`,
        content: readFileSync(path),
      });
      if (upload.kind === "failed") {
        throw new Error(
          `Remote state backup failed (${upload.reason}); the local backup set was retained.`,
        );
      }
    }
    recordBackupHealth(options.statePath, "healthy", options.createdAt);
    return backup;
  } catch (error) {
    if (existsSync(options.statePath)) {
      recordBackupHealth(options.statePath, "failed", options.createdAt);
    }
    throw error;
  }
}
