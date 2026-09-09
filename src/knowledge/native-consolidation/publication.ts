import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  ActivationRequest,
  GenerationManifest,
  ReconcileRequest,
  ReconcileResult,
  StageGenerationRequest,
  StagedGeneration,
  StagedPage,
} from "./contracts.js";
import { manifestHash, type NativeKnowledgeRegistry } from "./registry.js";
import { NATIVE_KNOWLEDGE_LIMITS } from "./contracts.js";

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fileHash(path: string): string {
  return sha256(readFileSync(path));
}

function isContained(root: string, target: string): boolean {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rel = relative(rootPath, targetPath);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function assertRegularDirectory(path: string, label: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

function boundedPositiveLimit(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return limit;
}

function directoryBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`directory contains a symlink: ${child}`);
    if (entry.isDirectory()) {
      total += directoryBytes(child);
      continue;
    }
    if (!entry.isFile()) throw new Error(`directory contains a non-regular entry: ${child}`);
    total += statSync(child).size;
  }
  return total;
}

/** Return bytes occupied by the generated root, rejecting symlink escapes. */
export function generatedRootBytes(root: string): number {
  assertRegularDirectory(root, "generated root");
  assertNoSymlink(root, root, "generated root");
  return directoryBytes(root);
}

export interface RetainedGenerationCleanupResult {
  readonly removedGenerationIds: readonly string[];
  readonly retainedGenerationIds: readonly string[];
  readonly bytes: number;
}

/**
 * Delete only valid, superseded generations outside the retention set. Active,
 * protected and malformed/incomplete directories are always left untouched.
 * Re-running after an interrupted cleanup is safe because missing candidates
 * are simply skipped.
 */
export function cleanupRetainedGenerations(input: {
  readonly generatedRoot: string;
  readonly activeGenerationId?: string | null;
  readonly maxRetainedGenerations?: number;
  readonly protectedGenerationIds?: readonly string[];
}): RetainedGenerationCleanupResult {
  const root = resolve(input.generatedRoot);
  const generationsRoot = join(root, "generations");
  assertRegularDirectory(root, "generated root");
  assertRegularDirectory(generationsRoot, "generated generations root");
  const maxRetained = boundedPositiveLimit(
    input.maxRetainedGenerations,
    NATIVE_KNOWLEDGE_LIMITS.maxRetainedGenerations,
    NATIVE_KNOWLEDGE_LIMITS.maxRetainedGenerations,
    "maxRetainedGenerations",
  );
  const protectedIds = new Set(input.protectedGenerationIds ?? []);
  if (input.activeGenerationId !== undefined && input.activeGenerationId !== null) {
    protectedIds.add(input.activeGenerationId);
  }
  const valid: { readonly id: string; readonly path: string; readonly createdAt: string }[] = [];
  for (const entry of readdirSync(generationsRoot, { withFileTypes: true })) {
    const path = join(generationsRoot, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.includes(".")) continue;
    assertNoSymlink(path, generationsRoot, "generation directory");
    try {
      const manifest = readManifest(join(path, "manifest.json"));
      if (!Number.isFinite(Date.parse(manifest.createdAt))) continue;
      valid.push({ id: manifest.generationId, path, createdAt: manifest.createdAt });
    } catch {
      // Malformed, partial and quarantined generations are evidence for
      // reconciliation, not retention candidates. Never delete them here.
    }
  }
  valid.sort((left, right) => {
    const byDate = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return byDate !== 0 ? byDate : right.id.localeCompare(left.id);
  });
  const keep = new Set(protectedIds);
  for (const generation of valid) {
    if (keep.has(generation.id)) continue;
    if (keep.size >= maxRetained) break;
    keep.add(generation.id);
  }
  const removed: string[] = [];
  for (const generation of valid) {
    if (keep.has(generation.id)) continue;
    if (!existsSync(generation.path)) continue;
    rmSync(generation.path, { recursive: true, force: false });
    removed.push(generation.id);
  }
  return {
    removedGenerationIds: removed,
    retainedGenerationIds: valid.filter((generation) => keep.has(generation.id)).map((generation) => generation.id),
    bytes: generatedRootBytes(root),
  };
}

function assertNoSymlink(path: string, root: string, label: string): void {
  if (!isContained(root, path)) throw new Error(`${label} escapes its root`);
  let current = resolve(root);
  const target = resolve(path);
  const suffix = relative(current, target);
  for (const segment of suffix === "" ? [] : suffix.split(sep)) {
    current = join(current, segment);
    if (!existsSync(current)) continue;
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symlink`);
  }
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return segment.length > 0 ? segment.slice(0, 100) : "run";
}

function flushFile(path: string): void {
  // Windows rejects fsync on a read-only descriptor; the file remains
  // private to the staging worker and is opened read/write only for this
  // durability flush.
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function flushDirectory(path: string): void {
  try {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch {
    // Windows does not permit fsync on every directory handle. File flushes
    // and the rename still provide the strongest portable local protocol.
  }
}

function assertRelativePagePath(path: string): void {
  if (
    path.trim() === "" ||
    isAbsolute(path) ||
    path.split(/[\\/]/u).some((part) => part === ".." || part === "") ||
    path === "manifest.json" ||
    path === "index.md" ||
    path === "log.md"
  ) {
    throw new Error(`page path is unsafe: ${path}`);
  }
}

function pageMetadata(page: StagedPage, path: string) {
  const bytes = Buffer.byteLength(page.content, "utf8");
  return {
    pageId: page.pageId,
    path: page.path.replaceAll("\\", "/"),
    sha256: fileHash(path),
    bytes,
    sourceCandidateIds: [...page.sourceCandidateIds],
    claimClass: page.claimClass,
    sourceReference: page.sourceReference,
    capturedAt: page.capturedAt,
    asOf: page.asOf,
    disposition: page.disposition,
    uncertainty: page.uncertainty,
  } as const;
}

function readManifestUnchecked(path: string): GenerationManifest {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<GenerationManifest>;
  if (
    raw.schema !== "real-ming.native-knowledge-generation.v1" ||
    typeof raw.generationId !== "string" ||
    typeof raw.runId !== "string" ||
    raw.complete !== true ||
    !Array.isArray(raw.pages) ||
    typeof raw.indexSha256 !== "string" ||
    typeof raw.logSha256 !== "string"
  ) {
    throw new Error("invalid or incomplete generation manifest");
  }
  return raw as GenerationManifest;
}

function verifyManifest(manifestPath: string): GenerationManifest {
  const manifest = readManifestUnchecked(manifestPath);
  const generationPath = dirname(manifestPath);
  if (!isContained(resolve(generationPath, ".."), generationPath)) {
    throw new Error("generation path escapes generated root");
  }
  const indexPath = join(generationPath, "index.md");
  const logPath = join(generationPath, "log.md");
  if (!existsSync(indexPath) || !existsSync(logPath)) throw new Error("generation sidecar missing");
  if (fileHash(indexPath) !== manifest.indexSha256 || fileHash(logPath) !== manifest.logSha256) {
    throw new Error("generation sidecar hash mismatch");
  }
  let total = Buffer.byteLength(readFileSync(indexPath)) + Buffer.byteLength(readFileSync(logPath));
  for (const page of manifest.pages) {
    assertRelativePagePath(page.path);
    const path = join(generationPath, page.path);
    assertNoSymlink(path, generationPath, "generation page");
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`generation page missing: ${page.path}`);
    const size = statSync(path).size;
    if (size !== page.bytes || size > NATIVE_KNOWLEDGE_LIMITS.maxPageBytes) throw new Error(`generation page size mismatch: ${page.path}`);
    if (fileHash(path) !== page.sha256) throw new Error(`generation page hash mismatch: ${page.path}`);
    total += size;
  }
  if (total !== manifest.totalBytes || total > NATIVE_KNOWLEDGE_LIMITS.maxActiveSnapshotBytes) {
    throw new Error("generation byte limit or total mismatch");
  }
  return manifest;
}

export async function stageGeneration(input: StageGenerationRequest): Promise<StagedGeneration> {
  assertRegularDirectory(input.generatedRoot, "generated root");
  assertRegularDirectory(input.stagingRoot, "staging root");
  const maxGeneratedRootBytes = boundedPositiveLimit(
    input.maxGeneratedRootBytes,
    NATIVE_KNOWLEDGE_LIMITS.maxGeneratedRootBytes,
    NATIVE_KNOWLEDGE_LIMITS.maxGeneratedRootBytes,
    "maxGeneratedRootBytes",
  );
  const generatedGenerations = join(input.generatedRoot, "generations");
  assertRegularDirectory(generatedGenerations, "generated generations root");
  if (statSync(input.generatedRoot).dev !== statSync(input.stagingRoot).dev) {
    throw new Error("staging and generated roots must share a filesystem");
  }
  if (input.pages.length > NATIVE_KNOWLEDGE_LIMITS.maxPagesPerGeneration) {
    throw new Error("generation page limit exceeded");
  }
  const generationId = `native-knowledge-generation-${randomUUID()}`;
  const runFolder = join(input.stagingRoot, safeSegment(input.run.runId));
  const temporaryPath = join(runFolder, `${generationId}.tmp`);
  assertNoSymlink(runFolder, input.stagingRoot, "staging run");
  mkdirSync(temporaryPath, { recursive: true });
  assertNoSymlink(temporaryPath, input.stagingRoot, "staging generation");

  const metadata = [] as ReturnType<typeof pageMetadata>[];
  let totalBytes = 0;
  for (const page of input.pages) {
    assertRelativePagePath(page.path);
    const bytes = Buffer.byteLength(page.content, "utf8");
    if (bytes > NATIVE_KNOWLEDGE_LIMITS.maxPageBytes) throw new Error(`page too large: ${page.pageId}`);
    const destination = join(temporaryPath, page.path);
    assertNoSymlink(destination, temporaryPath, "page path");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, page.content, { encoding: "utf8", flag: "wx" });
    flushFile(destination);
    metadata.push(pageMetadata(page, destination));
    totalBytes += bytes;
  }

  const indexContent = [
    "# Generated knowledge",
    "",
    ...metadata.map((page) => `- [${page.pageId}](${page.path})`),
    "",
  ].join("\n");
  const logContent = [
    `run_id: ${input.run.runId}`,
    `created_at: ${input.now}`,
    ...metadata.map((page) => `${page.pageId} ${page.disposition} ${page.sourceReference}`),
    "",
  ].join("\n");
  const indexPath = join(temporaryPath, "index.md");
  const logPath = join(temporaryPath, "log.md");
  writeFileSync(indexPath, indexContent, { encoding: "utf8", flag: "wx" });
  writeFileSync(logPath, logContent, { encoding: "utf8", flag: "wx" });
  flushFile(indexPath);
  flushFile(logPath);
  totalBytes += Buffer.byteLength(indexContent) + Buffer.byteLength(logContent);
  if (totalBytes > NATIVE_KNOWLEDGE_LIMITS.maxActiveSnapshotBytes) throw new Error("active snapshot limit exceeded");

  const manifest: GenerationManifest = {
    schema: "real-ming.native-knowledge-generation.v1",
    generationId,
    runId: input.run.runId,
    previousGenerationId: input.previous?.generationId ?? null,
    complete: true,
    createdAt: input.now,
    sourceEpoch: input.sourceEpoch,
    tombstoneEpoch: input.tombstoneEpoch,
    pages: metadata,
    indexSha256: fileHash(indexPath),
    logSha256: fileHash(logPath),
    totalBytes,
  };
  const manifestPath = join(temporaryPath, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  flushFile(manifestPath);
  flushDirectory(temporaryPath);
  const projectedRootBytes = generatedRootBytes(input.generatedRoot) + directoryBytes(temporaryPath);
  if (projectedRootBytes > maxGeneratedRootBytes) {
    rmSync(temporaryPath, { recursive: true, force: true });
    throw new Error("generated-root-byte-limit-exceeded");
  }
  const immutablePath = join(generatedGenerations, generationId);
  if (existsSync(immutablePath)) throw new Error("generation ID collision");
  renameSync(temporaryPath, immutablePath);
  flushDirectory(dirname(immutablePath));
  // The manifest is re-read after the durable rename. The filesystem is now
  // prepared; only the registry pointer transaction can make it eligible.
  const verified = verifyManifest(join(immutablePath, "manifest.json"));
  if (manifestHash(verified) !== manifestHash(manifest)) throw new Error("manifest changed during installation");
  return {
    generationId,
    runId: input.run.runId,
    immutablePath,
    manifest: verified,
    manifestHash: manifestHash(verified),
  };
}

export function readManifest(path: string): GenerationManifest {
  return verifyManifest(resolve(path));
}

export function activateGeneration(input: ActivationRequest & {
  readonly registry: NativeKnowledgeRegistry;
}): ReturnType<NativeKnowledgeRegistry["activateGeneration"]> {
  const generatedRoot = resolve(input.activePath);
  const generationPath = resolve(input.generation.immutablePath);
  if (!isContained(join(generatedRoot, "generations"), generationPath)) {
    return { kind: "invalid", reason: "generation path is outside generated root" };
  }
  let manifest: GenerationManifest;
  try {
    manifest = readManifest(join(generationPath, "manifest.json"));
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : "manifest verification failed" };
  }
  if (
    manifest.generationId !== input.generation.generationId ||
    manifest.runId !== input.lease.runId ||
    manifestHash(manifest) !== input.generation.manifestHash
  ) {
    return { kind: "invalid", reason: "generation manifest identity mismatch" };
  }
  const activated = input.registry.activateGeneration({
    ...input,
    generation: { ...input.generation, manifest },
  });
  if (activated.kind !== "activated") return activated;
  try {
    cleanupRetainedGenerations({
      generatedRoot,
      activeGenerationId: activated.generationId,
      ...(input.maxRetainedGenerations === undefined ? {} : { maxRetainedGenerations: input.maxRetainedGenerations }),
      ...(input.protectedGenerationIds === undefined ? {} : { protectedGenerationIds: input.protectedGenerationIds }),
    });
  } catch (error) {
    return {
      kind: "invalid",
      reason: `retention-cleanup-failed:${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
  return activated;
}

export function reconcileGenerations(input: ReconcileRequest & {
  readonly registry: NativeKnowledgeRegistry;
}): ReconcileResult {
  const root = resolve(input.generatedRoot);
  const generationsRoot = join(root, "generations");
  assertRegularDirectory(root, "generated root");
  assertRegularDirectory(generationsRoot, "generated generations root");
  const quarantined: string[] = [];
  for (const name of readdirSync(generationsRoot)) {
    const path = join(generationsRoot, name);
    if (!lstatSync(path).isDirectory() || name.includes(".")) continue;
    try {
      readManifest(join(path, "manifest.json"));
    } catch {
      quarantined.push(name);
    }
  }
  const active = input.registry.activeGeneration();
  if (active === undefined) {
    input.registry.setRepairState("healthy");
    return { kind: "healthy", activeGenerationId: null, quarantined };
  }
  try {
    const manifest = readManifest(join(active.path, "manifest.json"));
    if (manifest.generationId !== active.generationId || manifestHash(manifest) !== active.manifestHash) {
      throw new Error("active pointer does not match manifest");
    }
  } catch {
    input.registry.setRepairState("needs-repair");
    return { kind: "needs-repair", reason: "active generation is missing or unverifiable", quarantined };
  }
  input.registry.setRepairState("healthy");
  return { kind: "healthy", activeGenerationId: active.generationId, quarantined };
}
