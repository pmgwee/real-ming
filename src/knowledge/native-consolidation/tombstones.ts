import { createHash } from "node:crypto";

import type {
  ForgetRequest,
  ForgetResult,
  NativeKnowledgeCandidateMetadata,
  RestoreTombstoneRequest,
  RestoreTombstoneResult,
  StagedPage,
  TombstoneHead,
  TombstoneHeadStore,
  TombstoneRecord,
} from "./contracts.js";
import type { NativeKnowledgeRegistry } from "./registry.js";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function entryMatches(tombstone: TombstoneRecord, id: string): boolean {
  const normalized = normalize(id);
  return normalize(tombstone.subject) === normalized || tombstone.aliases.some((alias) => normalize(alias) === normalized);
}

function headContains(head: TombstoneHead, tombstone: TombstoneRecord): boolean {
  return head.entries.some(
    (entry) => entry.tombstoneId === tombstone.tombstoneId && entry.subject === tombstone.subject && entry.localEpoch >= tombstone.localEpoch,
  );
}

function pendingResult(tombstone: TombstoneRecord, reason: string): ForgetResult {
  return { ...tombstone, status: "head-sync-pending", verifiedHeadEpoch: null, reason } as ForgetResult & { readonly reason: string };
}

function safeResult(tombstone: TombstoneRecord, epoch: number): ForgetResult {
  return { ...tombstone, status: "restore-safe", verifiedHeadEpoch: epoch };
}

/**
 * Suppression is local and immediate. Restore-safe is deliberately a stronger
 * state: it requires an independent append-only head and exact read-back.
 */
export async function forgetWikiKnowledge(input: ForgetRequest & {
  readonly registry: NativeKnowledgeRegistry;
  readonly headStore: TombstoneHeadStore;
}): Promise<ForgetResult> {
  const subject = normalize(input.subject);
  const aliases = [...new Set((input.aliases ?? []).map(normalize).filter(Boolean))].sort();
  const local = input.registry.appendLocalTombstone({
    subject,
    aliases,
    reason: input.reason,
    requestedAt: input.requestedAt,
  });
  if (local.status === "restore-safe" || local.status === "cleanup-complete") {
    return {
      ...local,
      verifiedHeadEpoch: input.registry.runHealth().tombstoneHeadEpoch,
    };
  }

  let remote = await input.headStore.readHead();
  if (remote.kind === "unavailable") {
    input.registry.updateTombstoneStatus(local.tombstoneId, "head-sync-pending");
    input.registry.recordTombstoneOutboxFailure(local.tombstoneId, input.requestedAt);
    input.registry.setRepairState("head_sync_pending");
    return pendingResult(local, remote.reason);
  }
  if (!remote.head.complete) {
    input.registry.updateTombstoneStatus(local.tombstoneId, "head-sync-pending");
    input.registry.recordTombstoneOutboxFailure(local.tombstoneId, input.requestedAt);
    input.registry.setRepairState("needs-repair");
    return pendingResult(local, "independent tombstone head is incomplete");
  }

  // A competing writer may advance the head. Retry only on a version conflict;
  // every attempt still uses the exact identity and monotonic local epoch.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (headContains(remote.head, local)) {
      input.registry.setTombstoneHeadEpoch(remote.head.epoch);
      input.registry.markTombstoneOutboxSynced(local.tombstoneId, input.requestedAt);
      const restored = input.registry.updateTombstoneStatus(local.tombstoneId, "restore-safe") ?? local;
      input.registry.setRepairState("healthy");
      return safeResult(restored, remote.head.epoch);
    }
    const appended = await input.headStore.appendIfVersion({
      expectedVersion: remote.head.version,
      tombstone: local,
    });
    if (appended.kind === "unavailable") {
      input.registry.updateTombstoneStatus(local.tombstoneId, "head-sync-pending");
      input.registry.recordTombstoneOutboxFailure(local.tombstoneId, input.requestedAt);
      input.registry.setRepairState("head_sync_pending");
      return pendingResult(local, appended.reason);
    }
    if (appended.kind === "conflict") {
      remote = { kind: "ok", head: appended.head };
      continue;
    }
    const readBack = await input.headStore.readHead();
    if (readBack.kind !== "ok" || !readBack.head.complete || !headContains(readBack.head, local)) {
      input.registry.updateTombstoneStatus(local.tombstoneId, "head-sync-pending");
      input.registry.setRepairState("head_sync_pending");
      return pendingResult(local, "tombstone head append read-back failed");
    }
    input.registry.setTombstoneHeadEpoch(readBack.head.epoch);
    input.registry.markTombstoneOutboxSynced(local.tombstoneId, input.requestedAt);
    const restored = input.registry.updateTombstoneStatus(local.tombstoneId, "restore-safe") ?? local;
    input.registry.setRepairState("healthy");
    return safeResult(restored, readBack.head.epoch);
  }
  input.registry.updateTombstoneStatus(local.tombstoneId, "head-sync-pending");
  input.registry.recordTombstoneOutboxFailure(local.tombstoneId, input.requestedAt);
  input.registry.setRepairState("head_sync_pending");
  return pendingResult(local, "tombstone head version conflict");
}

export function isSuppressedByTombstone(
  page: Pick<StagedPage, "pageId" | "path" | "sourceCandidateIds"> | Pick<NativeKnowledgeCandidateMetadata, "candidateId">,
  tombstones: readonly TombstoneRecord[],
): boolean {
  const ids = "sourceCandidateIds" in page
    ? [page.pageId, page.path, ...page.sourceCandidateIds]
    : [page.candidateId];
  return tombstones.some((tombstone) => ids.some((id) => entryMatches(tombstone, id)));
}

export async function reconcileTombstonesAfterRestore(input: RestoreTombstoneRequest & {
  readonly headStore: TombstoneHeadStore;
  /** Registry is required by the production restore path; omitted only for legacy read-only checks. */
  readonly registry?: NativeKnowledgeRegistry;
}): Promise<RestoreTombstoneResult> {
  input.registry?.setRepairState("needs-repair");
  const remote = await input.headStore.readHead();
  if (remote.kind === "unavailable") return { kind: "needs-repair", reason: remote.reason };
  if (!remote.head.complete) return { kind: "needs-repair", reason: "independent tombstone head is incomplete", head: remote.head };
  const epochs = remote.head.entries.map((entry) => entry.localEpoch);
  const uniqueEpochs = new Set(epochs);
  if (
    remote.head.epoch === 0
      ? remote.head.entries.length !== 0
      : remote.head.entries.length === 0 ||
        uniqueEpochs.size !== epochs.length ||
        Math.max(...epochs) !== remote.head.epoch ||
        epochs.some((epoch) => !Number.isSafeInteger(epoch) || epoch < 1) ||
        Array.from({ length: remote.head.epoch }, (_, index) => index + 1).some((epoch) => !uniqueEpochs.has(epoch))
  ) {
    return { kind: "needs-repair", reason: "independent tombstone head has an unprovable epoch sequence", head: remote.head };
  }
  if (remote.head.epoch < input.snapshotHighestLocalEpoch) {
    return { kind: "needs-repair", reason: "remote tombstone head does not cover snapshot epoch", head: remote.head };
  }
  const entryIds = new Set(remote.head.entries.map((entry) => entry.tombstoneId));
  const missing = input.snapshotPendingTombstoneIds.find((id) => !entryIds.has(id));
  if (missing !== undefined) {
    return { kind: "needs-repair", reason: `remote tombstone head is missing ${missing}`, head: remote.head };
  }
  if (input.registry !== undefined) {
    const localTombstones = new Map(input.registry.tombstones().map((tombstone) => [tombstone.tombstoneId, tombstone]));
    try {
      for (const entry of remote.head.entries) {
        const local = localTombstones.get(entry.tombstoneId);
        if (local !== undefined) {
          if (local.subject !== entry.subject || local.localEpoch !== entry.localEpoch) {
            throw new Error(`independent tombstone ${entry.tombstoneId} conflicts with restored state`);
          }
          input.registry.replayIndependentTombstone({
            tombstoneId: entry.tombstoneId,
            subject: entry.subject,
            localEpoch: entry.localEpoch,
            restoredAt: input.restoredAt ?? new Date().toISOString(),
          });
          continue;
        }
        input.registry.replayIndependentTombstone({
          tombstoneId: entry.tombstoneId,
          subject: entry.subject,
          localEpoch: entry.localEpoch,
          restoredAt: input.restoredAt ?? new Date().toISOString(),
        });
      }
      input.registry.setTombstoneHeadEpoch(remote.head.epoch);
      input.registry.setRepairState("healthy");
    } catch (error) {
      input.registry.setRepairState("needs-repair");
      return {
        kind: "needs-repair",
        reason: error instanceof Error ? `restore tombstone replay failed: ${error.message}` : "restore tombstone replay failed",
        head: remote.head,
      };
    }
  }
  return { kind: "safe", head: remote.head };
}

export function tombstoneFingerprint(tombstone: Pick<TombstoneRecord, "tombstoneId" | "subject" | "localEpoch">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(tombstone)).digest("hex")}`;
}
