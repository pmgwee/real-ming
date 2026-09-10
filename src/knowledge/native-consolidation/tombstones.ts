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
    (entry) => entry.tombstoneId === tombstone.tombstoneId &&
      normalize(entry.subject) === normalize(tombstone.subject) &&
      entry.localEpoch >= tombstone.localEpoch &&
      (tombstone.aliases.length === 0 ||
        (entry.aliases !== undefined && tombstone.aliases.every((alias) =>
          entry.aliases?.some((entryAlias) => normalize(entryAlias) === normalize(alias))))),
  );
}

function sameIndependentHead(left: TombstoneHead, right: TombstoneHead): boolean {
  if (left.epoch !== right.epoch || left.version !== right.version || left.complete !== right.complete || left.entries.length !== right.entries.length) return false;
  const entries = (head: TombstoneHead) => [...head.entries]
    .map((entry) => ({
      tombstoneId: entry.tombstoneId,
      subject: normalize(entry.subject),
      aliases: (entry.aliases ?? []).map(normalize).sort(),
      localEpoch: entry.localEpoch,
    }))
    .sort((a, b) => a.localEpoch - b.localEpoch || a.tombstoneId.localeCompare(b.tombstoneId));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
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
    const outbox = input.registry.tombstoneOutbox().find((entry) => entry.tombstoneId === local.tombstoneId);
    if (outbox?.status !== "synced") {
      // A legacy or manually repaired database can contain a safe tombstone
      // without a synced outbox row. Never acknowledge that state as safe;
      // leave retrieval in repair and require reconciliation to establish the
      // independent propagation proof again.
      input.registry.setRepairState("needs-repair");
      throw new Error("restore-safe tombstone has an unsynced propagation outbox");
    }
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
  page: (Pick<StagedPage, "pageId" | "path" | "sourceCandidateIds" | "sourceReference"> & { readonly dependencies?: readonly string[] })
    | (Pick<NativeKnowledgeCandidateMetadata, "candidateId" | "dependencies" | "sourceReference">),
  tombstones: readonly TombstoneRecord[],
): boolean {
  const ids = "sourceCandidateIds" in page
    ? [page.pageId, page.path, page.sourceReference, ...(page.dependencies ?? []), ...page.sourceCandidateIds]
    : [page.candidateId, page.sourceReference, ...page.dependencies];
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
  // A pending-ID list is not a complete inventory: it only describes entries
  // whose propagation was unfinished at backup time. Once a backup contains
  // any local tombstone epoch, restore must carry the complete identity set so
  // an equal-epoch independent head cannot silently omit a forgotten alias.
  if (input.snapshotHighestLocalEpoch > 0 && input.snapshotTombstoneIds === undefined) {
    return { kind: "needs-repair", reason: "restored tombstone inventory is unavailable", head: remote.head };
  }
  const entryIds = new Set(remote.head.entries.map((entry) => entry.tombstoneId));
  const snapshotIds = input.snapshotTombstoneIds ?? [];
  const missingSnapshot = snapshotIds.find((id) => !entryIds.has(id));
  if (missingSnapshot !== undefined) {
    return { kind: "needs-repair", reason: `remote tombstone head is missing restored tombstone ${missingSnapshot}`, head: remote.head };
  }
  const missing = input.snapshotPendingTombstoneIds.find((id) => !entryIds.has(id));
  if (missing !== undefined) {
    return { kind: "needs-repair", reason: `remote tombstone head is missing ${missing}`, head: remote.head };
  }
  if (input.registry !== undefined) {
    const localTombstones = new Map(input.registry.tombstones().map((tombstone) => [tombstone.tombstoneId, tombstone]));
    try {
      for (const entry of [...remote.head.entries].sort((left, right) => left.localEpoch - right.localEpoch)) {
        const local = localTombstones.get(entry.tombstoneId);
        if (local !== undefined) {
          const remoteAliases = entry.aliases;
          if (local.subject !== entry.subject || local.localEpoch !== entry.localEpoch ||
            (local.aliases.length > 0 && (remoteAliases === undefined ||
              local.aliases.some((alias) => !remoteAliases.some((remoteAlias) => normalize(remoteAlias) === normalize(alias)))))) {
            throw new Error(`independent tombstone ${entry.tombstoneId} conflicts with restored state`);
          }
          input.registry.replayIndependentTombstone({
            tombstoneId: entry.tombstoneId,
            subject: entry.subject,
            ...(entry.aliases === undefined ? {} : { aliases: entry.aliases }),
            localEpoch: entry.localEpoch,
            restoredAt: input.restoredAt ?? new Date().toISOString(),
          });
          continue;
        }
        input.registry.replayIndependentTombstone({
          tombstoneId: entry.tombstoneId,
          subject: entry.subject,
          ...(entry.aliases === undefined ? {} : { aliases: entry.aliases }),
          localEpoch: entry.localEpoch,
          restoredAt: input.restoredAt ?? new Date().toISOString(),
        });
      }
      // The independent head may advance while a restore is replaying
      // entries. Do not enable retrieval from a stale read; a retry will
      // replay the new suffix against the now-complete local registry.
      const confirmed = await input.headStore.readHead();
      if (confirmed.kind !== "ok" || !confirmed.head.complete) {
        input.registry.setRepairState("needs-repair");
        return {
          kind: "needs-repair",
          reason: confirmed.kind === "ok" ? "independent tombstone head became incomplete during restore" : confirmed.reason,
          head: confirmed.kind === "ok" ? confirmed.head : remote.head,
        };
      }
      if (!sameIndependentHead(remote.head, confirmed.head)) {
        input.registry.setRepairState("needs-repair");
        return { kind: "needs-repair", reason: "independent tombstone head changed during restore reconciliation", head: confirmed.head };
      }
      input.registry.setTombstoneHeadEpoch(confirmed.head.epoch);
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
