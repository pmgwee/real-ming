import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { backupSqliteState } from "./sqlite-state-backup.js";
import { OperationsState } from "../operations/operations-state.js";

export interface ControlPlaneBackupManifest {
  readonly backupId: string;
  readonly createdAt: string;
  readonly files: readonly {
    readonly role:
      | "operations-state"
      | "notion-write-ledger"
      | "hermes-session"
      | "hermes-native-state"
      | "hermes-native-file"
      | "hermes-native-vault"
      | "native-knowledge-state"
      | "native-knowledge-tombstone-outbox";
    readonly name: string;
    readonly sha256: string;
  }[];
  readonly directories?: readonly {
    readonly role: "hermes-native-vault";
    readonly name: "hermes-vault";
    readonly fileCount: number;
    readonly sha256: string;
  }[];
}

export interface ControlPlaneBackupSet {
  readonly directory: string;
  readonly statePath: string;
  readonly notionLedgerPath: string;
  readonly hermesSessionPath?: string;
  /** Optional Hermes-native state.db containing its persisted conversation. */
  readonly hermesStatePath?: string;
  /** Optional staged directory containing the whitelisted native Hermes state. */
  readonly hermesNativeStateDirectory?: string;
  /** Optional native Obsidian/LLM-Wiki vault directory. */
  readonly hermesVaultPath?: string;
  /** Optional opaque local tombstone sync outbox. */
  readonly nativeKnowledgeTombstoneOutboxPath?: string;
  /** Optional native knowledge registry SQLite database. */
  readonly nativeKnowledgeStatePath?: string;
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

/**
 * The native registry keeps the full tombstone payload in its SQLite state.
 * This sidecar is deliberately opaque: it is a durable inventory of pending
 * propagation work, not a second memory store. A state database without the
 * native outbox table is left unchanged for legacy control-plane backups.
 */
function nativeKnowledgeOutboxSnapshot(statePath: string): readonly Record<string, unknown>[] | undefined {
  const database = new DatabaseSync(statePath, { readOnly: true });
  try {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'native_knowledge_tombstone_outbox'",
    ).get() as { readonly name: string } | undefined;
    if (table === undefined) return undefined;
    const rows = database.prepare(
      `SELECT outbox_id, tombstone_id, local_epoch, status, attempts, created_at, updated_at
       FROM native_knowledge_tombstone_outbox ORDER BY local_epoch, outbox_id`,
    ).all() as readonly Record<string, unknown>[];
    return rows.map((row) => ({
      outboxId: row.outbox_id,
      tombstoneId: row.tombstone_id,
      localEpoch: row.local_epoch,
      status: row.status,
      attempts: row.attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } finally {
    database.close();
  }
}

/**
 * Generation rows contain absolute paths because the live registry is local to
 * its vault. A verified restore copies that vault under a new root, so rebase
 * only the known `.real-ming/generated/generations/<id>` suffix. Any row that
 * cannot be proven to match is left untouched and the restored registry is
 * repair-locked rather than pointed at an inferred path.
 */
function rebaseNativeKnowledgeGenerationPaths(statePath: string, restoredVaultPath: string): void {
  const database = new DatabaseSync(statePath);
  try {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'native_knowledge_generations'",
    ).get() as { readonly name: string } | undefined;
    if (table === undefined) return;
    const rows = database.prepare(
      "SELECT generation_id, path FROM native_knowledge_generations",
    ).all() as unknown as readonly { readonly generation_id: string; readonly path: string }[];
    database.exec("BEGIN IMMEDIATE;");
    try {
      let unprovable = false;
      for (const row of rows) {
        const normalized = typeof row.path === "string" ? row.path.replaceAll("\\", "/") : "";
        const match = normalized.match(/\/\.real-ming\/generated\/generations\/([^/]+)$/u);
        if (
          match === null ||
          !/^[A-Za-z0-9._-]+$/u.test(row.generation_id) ||
          match[1] !== row.generation_id
        ) {
          unprovable = true;
          continue;
        }
        const rebased = join(
          resolve(restoredVaultPath),
          ".real-ming",
          "generated",
          "generations",
          row.generation_id,
        );
        database.prepare(
          "UPDATE native_knowledge_generations SET path = ? WHERE generation_id = ?",
        ).run(rebased, row.generation_id);
      }
      if (unprovable) {
        database.prepare(
          "UPDATE native_knowledge_state SET repair_state = 'needs-repair' WHERE id = 1",
        ).run();
      }
      database.exec("COMMIT;");
    } catch (error) {
      try { database.exec("ROLLBACK;"); } catch { /* already rolled back */ }
      throw error;
    }
  } finally {
    database.close();
  }
}

/**
 * Durable Hermes files that are safe to copy into a recovery set. This is a
 * deliberately closed list: auth.json, .env, config, caches, logs and OAuth
 * material remain outside the backup boundary even when they live below the
 * same HERMES_HOME directory.
 */
const hermesNativeStateFiles = [
  { relativePath: "state.db", kind: "sqlite" },
  { relativePath: "kanban.db", kind: "sqlite" },
  { relativePath: "cron/executions.db", kind: "sqlite" },
  { relativePath: "response_store.db", kind: "sqlite" },
  { relativePath: "verification_evidence.db", kind: "sqlite" },
  { relativePath: "runs_idempotency.db", kind: "sqlite" },
  { relativePath: "projects.db", kind: "sqlite" },
  { relativePath: "sessions/sessions.json", kind: "file" },
  { relativePath: "memories/USER.md", kind: "file" },
  { relativePath: "memories/MEMORY.md", kind: "file" },
] as const;

type HermesNativeStateFile = (typeof hermesNativeStateFiles)[number];

function hermesNativeStateFileForManifest(name: string): HermesNativeStateFile | undefined {
  if (!name.startsWith("hermes-native/")) return undefined;
  const relativePath = name.slice("hermes-native/".length);
  return hermesNativeStateFiles.find((file) => file.relativePath === relativePath);
}

function nativeStateSourcePath(root: string, relativePath: string): string {
  const sourceRoot = resolve(root);
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    throw new Error("The native Hermes state backup source must be a real directory.");
  }
  return containedPath(sourceRoot, safeManifestName(relativePath));
}

function assertRegularFile(path: string, description: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`The ${description} must be a regular file.`);
  }
}

async function copyNativeStateSnapshot(
  source: string,
  destination: string,
): Promise<ReadonlyArray<{ readonly relativePath: string; readonly kind: HermesNativeStateFile["kind"] }>> {
  const sourceRoot = resolve(source);
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
    throw new Error("The native Hermes state backup source must be a real directory.");
  }
  const destinationRoot = resolve(destination);
  mkdirSync(destinationRoot, { recursive: true });
  const copied: { relativePath: string; kind: HermesNativeStateFile["kind"] }[] = [];
  for (const file of hermesNativeStateFiles) {
    const sourcePath = nativeStateSourcePath(sourceRoot, file.relativePath);
    if (!existsSync(sourcePath)) continue;
    assertRegularFile(sourcePath, `native Hermes state file ${file.relativePath}`);
    const destinationPath = containedPath(destinationRoot, file.relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    if (file.kind === "sqlite") {
      await backupSqliteState({ sourcePath, destinationPath });
    } else {
      copyFileSync(sourcePath, destinationPath);
    }
    copied.push(file);
  }
  if (!copied.some((file) => file.relativePath === "state.db")) {
    throw new Error("The native Hermes state backup must contain state.db.");
  }
  return copied;
}

interface DirectorySnapshotFile {
  readonly relativePath: string;
  readonly sha256: string;
}

interface DirectorySnapshot {
  readonly files: readonly DirectorySnapshotFile[];
  readonly sha256: string;
}

export interface ControlPlaneBackupVerification {
  readonly backupDirectory: string;
  readonly manifestPath: string;
  readonly manifest: ControlPlaneBackupManifest;
  readonly verifiedFiles: number;
  readonly sqliteIntegrity: readonly {
    readonly name: string;
    readonly result: "ok";
  }[];
}

export interface ControlPlaneBackupRestore extends ControlPlaneBackupVerification {
  readonly directory: string;
  readonly nativeKnowledgeStatePath?: string;
  readonly nativeKnowledgeTombstoneOutboxPath?: string;
}

function directoryFiles(root: string, relativePath = ""): readonly string[] {
  const directory = relativePath === "" ? root : join(root, relativePath);
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = relativePath === "" ? entry.name : join(relativePath, entry.name);
      const childPath = join(root, child);
      const stat = lstatSync(childPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Native Hermes vault contains an unsupported symbolic link: ${child}.`);
      }
      if (stat.isDirectory()) return directoryFiles(root, child);
      if (!stat.isFile()) {
        throw new Error(`Native Hermes vault contains an unsupported filesystem entry: ${child}.`);
      }
      return [child];
    });
}

function copyDirectorySnapshot(source: string, destination: string): DirectorySnapshot {
  const sourceStat = lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error("The native Hermes vault backup source must be a real directory.");
  }
  const relativePaths = directoryFiles(source);
  mkdirSync(destination, { recursive: true });
  const files = relativePaths.map((relativePath) => {
    const sourcePath = join(source, relativePath);
    const destinationPath = join(destination, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    return { relativePath, sha256: digest(sourcePath) };
  });
  const directoryDigest = createHash("sha256");
  for (const file of files) {
    // Keep the directory digest portable across the Windows workstation used
    // for controlled rehearsals and the Linux Azure host used in production.
    directoryDigest.update(file.relativePath.replaceAll("\\", "/"));
    directoryDigest.update("\u0000");
    directoryDigest.update(file.sha256);
    directoryDigest.update("\u0000");
  }
  return { files, sha256: directoryDigest.digest("hex") };
}

function safeManifestName(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.includes("\u0000") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`Backup manifest contains an unsafe path: ${name}.`);
  }
  return normalized;
}

function containedPath(root: string, name: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, name);
  const child = relative(rootPath, target);
  if (
    child.length === 0 ||
    child === ".." ||
    child.startsWith("..\\") ||
    child.startsWith("../") ||
    isAbsolute(child)
  ) {
    throw new Error(`Backup manifest path escapes its recovery set: ${name}.`);
  }
  return target;
}

function manifestFromDisk(manifestPath: string): ControlPlaneBackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("The control-plane backup manifest is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The control-plane backup manifest must be an object.");
  }
  const candidate = parsed as {
    readonly backupId?: unknown;
    readonly createdAt?: unknown;
    readonly files?: unknown;
    readonly directories?: unknown;
  };
  if (
    typeof candidate.backupId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    throw new Error("The control-plane backup manifest is missing required fields.");
  }
  const validRoles = new Set([
    "operations-state",
    "notion-write-ledger",
    "hermes-session",
    "hermes-native-state",
    "hermes-native-file",
    "hermes-native-vault",
    "native-knowledge-state",
    "native-knowledge-tombstone-outbox",
  ]);
  const names = new Set<string>();
  const files = candidate.files.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("The control-plane backup manifest contains an invalid file entry.");
    }
    const file = value as { readonly role?: unknown; readonly name?: unknown; readonly sha256?: unknown };
    if (
      typeof file.role !== "string" ||
      !validRoles.has(file.role) ||
      typeof file.name !== "string" ||
      typeof file.sha256 !== "string"
    ) {
      throw new Error("The control-plane backup manifest contains an invalid file entry.");
    }
    const name = safeManifestName(file.name);
    if (names.has(name)) {
      throw new Error(`The control-plane backup manifest repeats ${name}.`);
    }
    if (!/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw new Error(`The control-plane backup manifest has an invalid sha256 for ${name}.`);
    }
    const nativeStateFile = hermesNativeStateFileForManifest(name);
    if (name.startsWith("hermes-native/") && nativeStateFile === undefined) {
      throw new Error(`The control-plane backup contains an unapproved native Hermes file: ${name}.`);
    }
    if (nativeStateFile !== undefined) {
      const expectedRole = nativeStateFile.kind === "sqlite"
        ? "hermes-native-state"
        : "hermes-native-file";
      if (file.role !== expectedRole) {
        throw new Error(`The control-plane backup has an invalid role for ${name}.`);
      }
    }
    if (file.role === "hermes-native-file" && nativeStateFile === undefined) {
      throw new Error(`The control-plane backup has an unapproved native Hermes file role for ${name}.`);
    }
    if (
      file.role === "hermes-native-state" &&
      nativeStateFile === undefined &&
      name !== "hermes-state.db"
    ) {
      throw new Error(`The control-plane backup has an unapproved native Hermes state role for ${name}.`);
    }
    names.add(name);
    return {
      role: file.role as ControlPlaneBackupManifest["files"][number]["role"],
      name,
      sha256: file.sha256,
    };
  });
  let directories: ControlPlaneBackupManifest["directories"];
  if (candidate.directories !== undefined) {
    if (!Array.isArray(candidate.directories)) {
      throw new Error("The control-plane backup manifest has invalid directory metadata.");
    }
    directories = candidate.directories.map((value) => {
      if (typeof value !== "object" || value === null) {
        throw new Error("The control-plane backup manifest contains an invalid directory entry.");
      }
      const directory = value as {
        readonly role?: unknown;
        readonly name?: unknown;
        readonly fileCount?: unknown;
        readonly sha256?: unknown;
      };
      if (
        directory.role !== "hermes-native-vault" ||
        directory.name !== "hermes-vault" ||
        typeof directory.fileCount !== "number" ||
        !Number.isInteger(directory.fileCount) ||
        directory.fileCount < 0 ||
        typeof directory.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(directory.sha256)
      ) {
        throw new Error("The control-plane backup manifest contains invalid directory metadata.");
      }
      return {
        role: "hermes-native-vault" as const,
        name: "hermes-vault" as const,
        fileCount: directory.fileCount,
        sha256: directory.sha256,
      };
    });
  }
  return {
    backupId: candidate.backupId,
    createdAt: candidate.createdAt,
    files,
    ...(directories === undefined ? {} : { directories }),
  };
}

function directoryDigestForManifest(
  files: readonly { readonly name: string; readonly sha256: string }[],
): string {
  const directoryDigest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    directoryDigest.update(file.name);
    directoryDigest.update("\u0000");
    directoryDigest.update(file.sha256);
    directoryDigest.update("\u0000");
  }
  return directoryDigest.digest("hex");
}

function checkSqliteIntegrity(path: string): "ok" {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    const result = row === undefined ? undefined : Object.values(row)[0];
    if (result !== "ok") {
      throw new Error(`SQLite integrity check failed for ${basename(path)}.`);
    }
    return "ok";
  } finally {
    database.close();
  }
}

/** Verify every manifest entry before a recovery set is copied or opened. */
export function verifyControlPlaneBackup(options: {
  readonly backupDirectory: string;
}): ControlPlaneBackupVerification {
  const backupDirectory = resolve(options.backupDirectory);
  const manifestPath = join(backupDirectory, "manifest.json");
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
    throw new Error("A control-plane backup manifest is required for recovery.");
  }
  const manifest = manifestFromDisk(manifestPath);
  if (manifest.backupId !== basename(backupDirectory)) {
    throw new Error("The control-plane backup ID does not match its directory.");
  }
  const requiredRoles = new Set(["operations-state", "notion-write-ledger"]);
  const seenRoles = new Set<string>();
  for (const file of manifest.files) {
    const sourcePath = containedPath(backupDirectory, safeManifestName(file.name));
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
      throw new Error(`The control-plane backup is missing ${file.name}.`);
    }
    if (digest(sourcePath) !== file.sha256) {
      throw new Error(`The control-plane backup has a sha256 mismatch for ${file.name}.`);
    }
    seenRoles.add(file.role);
  }
  for (const role of requiredRoles) {
    if (!seenRoles.has(role)) {
      throw new Error(`The control-plane backup is missing its ${role} store.`);
    }
  }
  for (const directory of manifest.directories ?? []) {
    const entries = manifest.files
      .filter((file) => file.name.startsWith(`${directory.name}/`))
      .map((file) => ({
        name: file.name.slice(directory.name.length + 1),
        sha256: file.sha256,
      }));
    if (entries.length !== directory.fileCount) {
      throw new Error(`The ${directory.name} file count does not match its manifest.`);
    }
    if (directoryDigestForManifest(entries) !== directory.sha256) {
      throw new Error(`The ${directory.name} directory digest does not match its manifest.`);
    }
  }
  const sqliteRoles = new Set([
    "operations-state",
    "notion-write-ledger",
    "hermes-session",
    "hermes-native-state",
  ]);
  const sqliteIntegrity = manifest.files
    .filter((file) => sqliteRoles.has(file.role))
    .map((file) => ({
      name: file.name,
      result: checkSqliteIntegrity(containedPath(backupDirectory, file.name)),
    }));
  return {
    backupDirectory,
    manifestPath,
    manifest,
    verifiedFiles: manifest.files.length,
    sqliteIntegrity,
  };
}

/**
 * Copy a verified recovery set to a new, isolated destination. This helper
 * never restores credentials, enables providers or starts a service; the
 * caller must do those steps explicitly after reviewing the result.
 */
export function restoreControlPlaneBackup(options: {
  readonly backupDirectory: string;
  readonly destinationDirectory: string;
}): ControlPlaneBackupRestore {
  const verification = verifyControlPlaneBackup(options);
  const directory = resolve(options.destinationDirectory);
  if (existsSync(directory)) {
    throw new Error("A control-plane restore destination must not already exist.");
  }
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory, { recursive: false });
  let createdDirectory = true;
  try {
    for (const metadata of verification.manifest.directories ?? []) {
      mkdirSync(containedPath(directory, metadata.name), { recursive: true });
    }
    for (const file of verification.manifest.files) {
      const sourcePath = containedPath(verification.backupDirectory, file.name);
      const destinationPath = containedPath(directory, file.name);
      mkdirSync(dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
    const destinationManifest = join(directory, "manifest.json");
    copyFileSync(verification.manifestPath, destinationManifest);
  const restoredTombstoneOutbox = verification.manifest.files.some(
      (file) => file.role === "native-knowledge-tombstone-outbox",
    )
      ? containedPath(directory, "native-knowledge/tombstone-outbox.json")
      : undefined;
    const restoredNativeKnowledgeState = verification.manifest.files.some(
      (file) => file.role === "native-knowledge-state",
    )
      ? containedPath(directory, "native-knowledge/state.sqlite")
      : undefined;
    const restoredVaultPath = verification.manifest.directories?.some(
      (entry) => entry.name === "hermes-vault",
    ) === true
      ? containedPath(directory, "hermes-vault")
      : undefined;
    if (restoredNativeKnowledgeState !== undefined && restoredVaultPath !== undefined) {
      rebaseNativeKnowledgeGenerationPaths(restoredNativeKnowledgeState, restoredVaultPath);
    }
    const sqliteRoles = new Set([
      "operations-state",
      "notion-write-ledger",
      "hermes-session",
      "hermes-native-state",
      "native-knowledge-state",
    ]);
    const restoredSqliteIntegrity = verification.manifest.files
      .filter((file) => sqliteRoles.has(file.role))
      .map((file) => ({
        name: file.name,
        result: checkSqliteIntegrity(containedPath(directory, file.name)),
      }));
    createdDirectory = false;
    return {
      ...verification,
      directory,
      manifestPath: destinationManifest,
      sqliteIntegrity: restoredSqliteIntegrity,
      ...(restoredNativeKnowledgeState === undefined
        ? {}
        : { nativeKnowledgeStatePath: restoredNativeKnowledgeState }),
      ...(restoredTombstoneOutbox === undefined
        ? {}
        : { nativeKnowledgeTombstoneOutboxPath: restoredTombstoneOutbox }),
    };
  } catch (error) {
    if (createdDirectory && existsSync(directory)) {
      rmSync(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

/** Create one immutable, checksummed recovery set for both production stores. */
export async function backupControlPlaneState(options: {
  readonly statePath: string;
  readonly notionLedgerPath: string;
  /** Optional durable Hermes Telegram-session mapping database. */
  readonly hermesSessionPath?: string;
  /** Optional Hermes-native state.db containing the persistent transcript. */
  readonly hermesStatePath?: string;
  /** Optional staged directory containing the whitelisted native Hermes state. */
  readonly hermesNativeStateDirectory?: string;
  /** Optional native Obsidian/LLM-Wiki vault directory. */
  readonly hermesVaultPath?: string;
  /** Optional native registry database; auto-detected from statePath when omitted. */
  readonly nativeKnowledgeStatePath?: string;
  /** Optional opaque local tombstone sync outbox. */
  readonly nativeKnowledgeTombstoneOutboxPath?: string;
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
  if (options.hermesSessionPath !== undefined && !existsSync(options.hermesSessionPath)) {
    throw new Error("The configured Hermes session database must exist before backup.");
  }
  if (options.hermesStatePath !== undefined && !existsSync(options.hermesStatePath)) {
    throw new Error("The configured Hermes native state database must exist before backup.");
  }
  if (options.hermesStatePath !== undefined && options.hermesNativeStateDirectory !== undefined) {
    throw new Error("Use either hermesStatePath or hermesNativeStateDirectory, not both.");
  }
  if (options.hermesNativeStateDirectory !== undefined) {
    const sourceRoot = resolve(options.hermesNativeStateDirectory);
    if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) {
      throw new Error("The configured Hermes native state directory must be a real directory.");
    }
  }
  if (options.hermesVaultPath !== undefined && !existsSync(options.hermesVaultPath)) {
    throw new Error("The configured Hermes native vault must exist before backup.");
  }
  const nativeKnowledgeIsSeparate = options.nativeKnowledgeStatePath !== undefined &&
    resolve(options.nativeKnowledgeStatePath) !== resolve(options.statePath);
  if (nativeKnowledgeIsSeparate) {
    assertRegularFile(options.nativeKnowledgeStatePath!, "native knowledge registry state");
  }
  if (options.nativeKnowledgeTombstoneOutboxPath !== undefined) {
    if (!existsSync(options.nativeKnowledgeTombstoneOutboxPath)) {
      throw new Error("The configured native knowledge tombstone outbox must exist before backup.");
    }
    assertRegularFile(options.nativeKnowledgeTombstoneOutboxPath, "native knowledge tombstone outbox");
  }
  const directory = join(options.destinationDirectory, options.backupId);
  const statePath = join(directory, "state.sqlite");
  const notionLedgerPath = join(directory, "notion-write-ledger.sqlite");
  const hermesSessionPath = options.hermesSessionPath === undefined
    ? undefined
    : join(directory, "hermes.sqlite");
  const hermesStatePath = options.hermesStatePath === undefined
    ? undefined
    : join(directory, "hermes-state.db");
  const hermesNativeStateDirectory = options.hermesNativeStateDirectory === undefined
    ? undefined
    : join(directory, "hermes-native");
  const hermesVaultPath = options.hermesVaultPath === undefined
    ? undefined
    : join(directory, "hermes-vault");
  const nativeKnowledgeStatePath = nativeKnowledgeIsSeparate
    ? join(directory, "native-knowledge", "state.sqlite")
    : undefined;
  let nativeKnowledgeTombstoneOutboxPath = options.nativeKnowledgeTombstoneOutboxPath === undefined
    ? undefined
    : join(directory, "native-knowledge", "tombstone-outbox.json");
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
    if (hermesSessionPath !== undefined && options.hermesSessionPath !== undefined) {
      await backupSqliteState({
        sourcePath: options.hermesSessionPath,
        destinationPath: hermesSessionPath,
      });
    }
    if (hermesStatePath !== undefined && options.hermesStatePath !== undefined) {
      await backupSqliteState({
        sourcePath: options.hermesStatePath,
        destinationPath: hermesStatePath,
      });
    }
    if (nativeKnowledgeStatePath !== undefined && options.nativeKnowledgeStatePath !== undefined) {
      mkdirSync(dirname(nativeKnowledgeStatePath), { recursive: true });
      await backupSqliteState({
        sourcePath: options.nativeKnowledgeStatePath,
        destinationPath: nativeKnowledgeStatePath,
      });
    }
    let nativeStateFiles: readonly {
      readonly relativePath: string;
      readonly kind: HermesNativeStateFile["kind"];
    }[] = [];
    if (
      hermesNativeStateDirectory !== undefined &&
      options.hermesNativeStateDirectory !== undefined
    ) {
      nativeStateFiles = await copyNativeStateSnapshot(
        options.hermesNativeStateDirectory,
        hermesNativeStateDirectory,
      );
    }
    const vaultSnapshot =
      hermesVaultPath === undefined || options.hermesVaultPath === undefined
        ? undefined
        : copyDirectorySnapshot(options.hermesVaultPath, hermesVaultPath);
    if (nativeKnowledgeTombstoneOutboxPath !== undefined && options.nativeKnowledgeTombstoneOutboxPath !== undefined) {
      mkdirSync(dirname(nativeKnowledgeTombstoneOutboxPath), { recursive: true });
      copyFileSync(options.nativeKnowledgeTombstoneOutboxPath, nativeKnowledgeTombstoneOutboxPath);
    }
    if (nativeKnowledgeTombstoneOutboxPath === undefined) {
      const nativeStatePath = options.nativeKnowledgeStatePath ?? options.statePath;
      const snapshot = nativeKnowledgeOutboxSnapshot(nativeStatePath);
      if (snapshot !== undefined) {
        nativeKnowledgeTombstoneOutboxPath = join(directory, "native-knowledge", "tombstone-outbox.json");
        mkdirSync(dirname(nativeKnowledgeTombstoneOutboxPath), { recursive: true });
        writeFileSync(
          nativeKnowledgeTombstoneOutboxPath,
          `${JSON.stringify({ schema: "real-ming.native-knowledge-tombstone-outbox.v1", entries: snapshot }, null, 2)}\n`,
          { encoding: "utf8", flag: "wx" },
        );
      }
    }
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
        ...(hermesSessionPath === undefined
          ? []
          : [{
              role: "hermes-session" as const,
              name: "hermes.sqlite",
              sha256: digest(hermesSessionPath),
            }]),
        ...(hermesStatePath === undefined
          ? []
          : [{
              role: "hermes-native-state" as const,
              name: "hermes-state.db",
              sha256: digest(hermesStatePath),
            }]),
        ...nativeStateFiles.map((file) => ({
          role: file.kind === "sqlite" ? "hermes-native-state" as const : "hermes-native-file" as const,
          name: `hermes-native/${file.relativePath}`,
          sha256: digest(join(hermesNativeStateDirectory!, file.relativePath)),
        })),
        ...(vaultSnapshot === undefined
          ? []
          : vaultSnapshot.files.map((file) => ({
              role: "hermes-native-vault" as const,
              // Manifest names are blob/object paths, not host paths. Keep
              // them POSIX-stable even when a controlled backup is built on
              // Windows.
              name: `hermes-vault/${file.relativePath.replaceAll("\\", "/")}`,
              sha256: file.sha256,
            }))),
        ...(nativeKnowledgeStatePath === undefined
          ? []
          : [{
              role: "native-knowledge-state" as const,
              name: "native-knowledge/state.sqlite",
              sha256: digest(nativeKnowledgeStatePath),
            }]),
        ...(nativeKnowledgeTombstoneOutboxPath === undefined
          ? []
          : [{
              role: "native-knowledge-tombstone-outbox" as const,
              name: "native-knowledge/tombstone-outbox.json",
              sha256: digest(nativeKnowledgeTombstoneOutboxPath),
            }]),
      ],
      ...(vaultSnapshot === undefined
        ? {}
        : {
            directories: [{
              role: "hermes-native-vault" as const,
              name: "hermes-vault" as const,
              fileCount: vaultSnapshot.files.length,
              sha256: vaultSnapshot.sha256,
            }],
          }),
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
      ...(hermesSessionPath === undefined ? {} : { hermesSessionPath }),
      ...(hermesStatePath === undefined ? {} : { hermesStatePath }),
      ...(hermesNativeStateDirectory === undefined ? {} : { hermesNativeStateDirectory }),
      ...(hermesVaultPath === undefined ? {} : { hermesVaultPath }),
      ...(nativeKnowledgeStatePath === undefined ? {} : { nativeKnowledgeStatePath }),
      ...(nativeKnowledgeTombstoneOutboxPath === undefined ? {} : { nativeKnowledgeTombstoneOutboxPath }),
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
  readonly hermesSessionPath?: string;
  readonly hermesStatePath?: string;
  readonly hermesNativeStateDirectory?: string;
  readonly hermesVaultPath?: string;
  readonly nativeKnowledgeStatePath?: string;
  readonly nativeKnowledgeTombstoneOutboxPath?: string;
  readonly destinationDirectory: string;
  readonly backupId: string;
  readonly createdAt: string;
  /**
   * Where to copy the snapshot off the machine. Optional on purpose: no RM-15
   * acceptance criterion asks for off-host backup, it is Azure-specific, and
   * the day-31 host will not have one. Requiring it to take any backup at all
   * made the durable local copy hostage to a cloud resource that need not
   * exist.
   */
  readonly uploader?: ControlPlaneBackupUploader;
}): Promise<ControlPlaneBackupSet> {
  let backup: ControlPlaneBackupSet;
  try {
    backup = await backupControlPlaneState(options);
    const uploader = options.uploader;
    if (uploader !== undefined) {
      // The manifest goes last on purpose: it is the completeness marker, so a
      // partial upload can never look like a whole backup set.
      const files = backup.manifest.files.map((file) => [
        file.name,
        join(backup.directory, file.name),
      ] as const);
      for (const [name, path] of [
        ...files,
        ["manifest.json", backup.manifestPath] as const,
      ]) {
        const upload = await uploader.upload({
          blobName: `${backup.manifest.backupId}/${name}`,
          content: readFileSync(path),
        });
        if (upload.kind === "failed") {
          throw new Error(
            `Remote state backup failed (${upload.reason}); the local backup set was retained.`,
          );
        }
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
