import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import type {
  GenerationManifest,
  NativeKnowledgeConsistencyFence,
  WikiRetrieveRequest,
  WikiRetrieveResult,
} from "./contracts.js";
import { isFresh } from "./evidence.js";
import { isSuppressedByTombstone } from "./tombstones.js";
import { readManifest } from "./publication.js";
import type { NativeKnowledgeRegistry } from "./registry.js";
import type { GenerationPageMetadata } from "./contracts.js";

const supportedRoles = new Set(["CEO", "COO", "CTO", "CMO", "CAO", "Personal CFO"]);

function sameFence(left: NativeKnowledgeConsistencyFence, right: NativeKnowledgeConsistencyFence): boolean {
  return left.activeGenerationId === right.activeGenerationId &&
    left.publicationEpoch === right.publicationEpoch &&
    left.sourceEpoch === right.sourceEpoch &&
    left.tombstoneEpoch === right.tombstoneEpoch &&
    left.tombstoneHeadEpoch === right.tombstoneHeadEpoch &&
    left.repairState === right.repairState;
}

function contained(root: string, target: string): boolean {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const child = relative(rootPath, targetPath);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function pageMatches(page: GenerationPageMetadata, content: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("en-US");
  if (needle.length === 0) return false;
  return `${page.pageId}\n${page.path}\n${page.sourceReference}\n${content}`
    .toLocaleLowerCase("en-US")
    .includes(needle);
}

/**
 * The only supported reader for the generated wiki. It never searches the
 * filesystem broadly: one registry pointer selects one verified snapshot.
 */
export function wikiRetrieve(input: WikiRetrieveRequest & {
  readonly registry: NativeKnowledgeRegistry;
  readonly generatedRoot: string;
}): WikiRetrieveResult {
  if (input.role !== undefined && !supportedRoles.has(input.role)) {
    return { kind: "wiki-unavailable", reason: "unsupported knowledge role" };
  }
  if (input.query.trim().length === 0) return { kind: "not-found", reason: "query is empty" };
  const health = input.registry.runHealth();
  // A local forget immediately suppresses its dependencies even while the
  // independent head is catching up. Other already-published pages remain
  // readable; only an unknown/repair state disables the whole reader.
  if (health.repairState === "needs-repair") {
    return { kind: "needs-repair", reason: "knowledge registry needs repair" };
  }
  const snapshot = input.registry.consistencySnapshot();
  const initialFence = snapshot.fence;
  const active = snapshot.active;
  if (active === undefined) return { kind: "wiki-unavailable", reason: "no active knowledge generation" };
  const generationsRoot = join(resolve(input.generatedRoot), "generations");
  if (!contained(generationsRoot, active.path) || !existsSync(active.path) || lstatSync(active.path).isSymbolicLink()) {
    input.registry.setRepairState("needs-repair");
    return { kind: "needs-repair", reason: "active generation path is outside generated root" };
  }
  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(join(active.path, "manifest.json"));
  } catch {
    input.registry.setRepairState("needs-repair");
    return { kind: "needs-repair", reason: "active generation manifest could not be verified" };
  }
  if (
    manifest.generationId !== active.generationId ||
    manifest.runId !== active.runId ||
    manifestHashEquals(manifest, active.manifestHash) === false
  ) {
    input.registry.setRepairState("needs-repair");
    return { kind: "needs-repair", reason: "active generation pointer does not match manifest" };
  }
  const tombstones = input.registry.tombstones();
  const limit = input.maxResults === undefined
    ? 5
    : Number.isSafeInteger(input.maxResults) && input.maxResults > 0
      ? Math.min(input.maxResults, 10)
      : 0;
  if (limit === 0) return { kind: "not-found", reason: "maxResults must be positive" };
  const results: Extract<WikiRetrieveResult, { readonly kind: "ok" }>['results'][number][] = [];
  for (const page of manifest.pages) {
    if (results.length >= limit) break;
    if (isSuppressedByTombstone(page, tombstones)) continue;
    if (page.disposition !== "supported") continue;
    const freshness = isFresh({ claimClass: page.claimClass, asOf: page.asOf, now: input.now });
    let content: string;
    let contentBytes: Buffer;
    let contentModifiedAt = 0;
    try {
      const read = readPage(active.path, page.path);
      content = read.content;
      contentBytes = read.bytes;
      contentModifiedAt = read.modifiedAt;
    } catch {
      input.registry.setRepairState("needs-repair");
      return { kind: "needs-repair", reason: "published page could not be read safely" };
    }
    if (!sameFence(initialFence, input.registry.consistencyFence())) {
      input.registry.setRepairState("needs-repair");
      return { kind: "needs-repair", reason: "publication or tombstone fence changed during retrieval" };
    }
    // Take a second fence immediately before validating the bytes. This closes
    // the window in which a writer can commit between the first post-read
    // check and hashing the exact buffer that will be returned.
    if (!sameFence(initialFence, input.registry.consistencyFence())) {
      input.registry.setRepairState("needs-repair");
      return { kind: "needs-repair", reason: "publication or tombstone fence changed before byte validation" };
    }
    const actualHash = `sha256:${createHash("sha256").update(contentBytes).digest("hex")}`;
    const currentStat = statSafe(active.path, page.path);
    if (currentStat === undefined || currentStat.mtimeMs !== contentModifiedAt ||
      contentBytes.byteLength !== page.bytes || actualHash !== page.sha256) {
      input.registry.setRepairState("needs-repair");
      return { kind: "needs-repair", reason: "published page changed during retrieval" };
    }
    if (!freshness.fresh || !pageMatches(page, content, input.query)) continue;
    results.push({
      pageId: page.pageId,
      path: page.path,
      content: content.slice(0, 16 * 1024),
      citation: {
        sourceReference: page.sourceReference,
        excerpt: content.slice(0, 512),
        capturedAt: page.capturedAt,
        asOf: page.asOf,
        generationId: manifest.generationId,
        disposition: page.disposition,
        uncertainty: page.uncertainty,
      },
    });
  }
  if (!sameFence(initialFence, input.registry.consistencyFence())) {
    input.registry.setRepairState("needs-repair");
    return { kind: "needs-repair", reason: "publication or tombstone fence changed before return" };
  }
  return results.length === 0 ? { kind: "not-found", reason: "no published supported page matched" } : { kind: "ok", results };
}

function readPage(generationPath: string, pagePath: string): { readonly content: string; readonly bytes: Buffer; readonly modifiedAt: number } {
  const target = resolve(generationPath, pagePath);
  if (!contained(generationPath, target) || !existsSync(target) || lstatSync(target).isSymbolicLink()) {
    throw new Error("generated page path is unsafe");
  }
  const before = statSync(target);
  const bytes = readFileSync(target);
  const after = statSync(target);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error("published page changed during read");
  return { content: bytes.toString("utf8"), bytes, modifiedAt: after.mtimeMs };
}

function statSafe(generationPath: string, pagePath: string): { readonly mtimeMs: number; readonly size: number } | undefined {
  const target = resolve(generationPath, pagePath);
  if (!contained(generationPath, target) || !existsSync(target) || lstatSync(target).isSymbolicLink()) return undefined;
  try {
    const stat = statSync(target);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

function manifestHashEquals(manifest: GenerationManifest, expected: string): boolean {
  // Keep the registry pointer check independent from any caller-provided
  // manifest object: hash the canonical JSON exactly as the registry does.
  const actual = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
  return actual === expected;
}
