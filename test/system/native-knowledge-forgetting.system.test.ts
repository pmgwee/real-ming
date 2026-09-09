import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createNativeKnowledgeRegistry } from "../../src/knowledge/native-consolidation/registry.js";
import type { TombstoneHead, TombstoneHeadStore, StagedPage } from "../../src/knowledge/native-consolidation/contracts.js";
import {
  forgetWikiKnowledge,
  isSuppressedByTombstone,
  reconcileTombstonesAfterRestore,
} from "../../src/knowledge/native-consolidation/tombstones.js";
import { createAzureBlobTombstoneHeadStore } from "../../src/providers/azure-blob-tombstone-head-store.js";

function fakeHeadStore(options: { unavailable?: boolean } = {}): {
  readonly store: TombstoneHeadStore;
  head(): TombstoneHead;
} {
  let current: TombstoneHead = { epoch: 0, entries: [], complete: true, version: "v0" };
  return {
    head: () => current,
    store: {
      async readHead() {
        return options.unavailable
          ? { kind: "unavailable" as const, reason: "controlled-outage" }
          : { kind: "ok" as const, head: current };
      },
      async appendIfVersion(input) {
        if (options.unavailable) return { kind: "unavailable" as const, reason: "controlled-outage" };
        if (input.expectedVersion !== current.version) return { kind: "conflict" as const, head: current };
        current = {
          epoch: current.epoch + 1,
          entries: [...current.entries, {
            tombstoneId: input.tombstone.tombstoneId,
            subject: input.tombstone.subject,
            localEpoch: input.tombstone.localEpoch,
          }],
          complete: true,
          version: `v${current.epoch + 1}`,
        };
        return { kind: "appended" as const, head: current };
      },
    },
  };
}

function withRegistry(run: (registry: ReturnType<typeof createNativeKnowledgeRegistry>) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-forgetting-"));
  const registry = createNativeKnowledgeRegistry({
    statePath: join(directory, "state.sqlite"),
    now: () => "2026-09-09T02:00:00.000Z",
  });
  return run(registry).finally(() => {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  });
}

describe("native knowledge forgetting and restore fencing", () => {
  it("is idempotent and acknowledges restore-safe only after exact head read-back", async () => {
    await withRegistry(async (registry) => {
      const remote = fakeHeadStore();
      const first = await forgetWikiKnowledge({
        registry,
        headStore: remote.store,
        subject: "candidate-a",
        aliases: ["Page A"],
        reason: "acceptance data",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      expect(first.status).toBe("restore-safe");
      expect(first.verifiedHeadEpoch).toBe(1);
      expect(registry.tombstoneOutbox()).toMatchObject([{
        tombstoneId: first.tombstoneId,
        status: "synced",
        attempts: 0,
      }]);
      const replay = await forgetWikiKnowledge({
        registry,
        headStore: remote.store,
        subject: "candidate-a",
        aliases: ["Page A"],
        reason: "repeat",
        requestedAt: "2026-09-09T02:01:00.000Z",
      });
      expect(replay.tombstoneId).toBe(first.tombstoneId);
      expect(registry.tombstones()).toHaveLength(1);
    });
  });

  it("keeps an unavailable independent head pending and disables restore", async () => {
    await withRegistry(async (registry) => {
      const pending = await forgetWikiKnowledge({
        registry,
        headStore: fakeHeadStore({ unavailable: true }).store,
        subject: "candidate-pending",
        aliases: [],
        reason: "controlled outage",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      expect(pending.status).toBe("head-sync-pending");
      expect(pending.verifiedHeadEpoch).toBeNull();
      expect(registry.tombstoneOutbox()).toMatchObject([{
        tombstoneId: pending.tombstoneId,
        status: "failed",
        attempts: 1,
      }]);
      const restore = await reconcileTombstonesAfterRestore({
        headStore: fakeHeadStore().store,
        snapshotHighestLocalEpoch: pending.localEpoch,
        snapshotPendingTombstoneIds: [pending.tombstoneId],
      });
      expect(restore.kind).toBe("needs-repair");
    });
  });

  it("atomically creates the local suppression and durable outbox, and survives reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-forgetting-atomic-"));
    const statePath = join(directory, "state.sqlite");
    const firstRegistry = createNativeKnowledgeRegistry({
      statePath,
      now: () => "2026-09-09T02:00:00.000Z",
    });
    const first = firstRegistry.appendLocalTombstone({
      tombstoneId: "atomic-tombstone",
      subject: "atomic-subject",
      aliases: [],
      reason: "controlled crash-boundary fixture",
      requestedAt: "2026-09-09T02:00:00.000Z",
    });
    expect(first.status).toBe("local-suppressed");
    expect(firstRegistry.tombstoneOutbox()).toHaveLength(1);
    firstRegistry.close();
    const reopened = createNativeKnowledgeRegistry({ statePath, now: () => "2026-09-09T02:01:00.000Z" });
    try {
      expect(reopened.tombstones()).toHaveLength(1);
      expect(reopened.tombstoneOutbox()).toMatchObject([{
        outboxId: "native-knowledge:outbox:atomic-tombstone",
        tombstoneId: "atomic-tombstone",
        status: "pending",
      }]);
      expect(() => reopened.updateTombstoneStatus("atomic-tombstone", "cleanup-complete")).toThrow(/transition/);
      expect(reopened.appendLocalTombstone({
        tombstoneId: "atomic-tombstone",
        subject: "atomic-subject",
        aliases: [],
        reason: "retry",
        requestedAt: "2026-09-09T02:02:00.000Z",
      }).tombstoneId).toBe("atomic-tombstone");
      expect(reopened.tombstoneOutbox()).toHaveLength(1);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("suppresses a derived page when any source dependency is forgotten", async () => {
    await withRegistry(async (registry) => {
      const remote = fakeHeadStore();
      const forgotten = await forgetWikiKnowledge({
        registry,
        headStore: remote.store,
        subject: "candidate-a",
        aliases: ["page-a"],
        reason: "remove test data",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      const page: StagedPage = {
        pageId: "summary-a-b",
        path: "pages/summary-a-b.md",
        content: "derived",
        sourceCandidateIds: ["candidate-a", "candidate-b"],
        claimClass: "project",
        sourceReference: "fixture:summary",
        capturedAt: "2026-09-09T02:00:00.000Z",
        asOf: "2026-09-09T02:00:00.000Z",
        disposition: "supported",
        uncertainty: "none",
      };
      expect(isSuppressedByTombstone(page, [forgotten])).toBe(true);
    });
  });

  it("fails closed for incomplete or uncovered remote heads", async () => {
    const incomplete: TombstoneHeadStore = {
      async readHead() {
        return { kind: "ok", head: { epoch: 4, entries: [], complete: false, version: "v4" } };
      },
      async appendIfVersion() {
        return { kind: "unavailable", reason: "not-used" };
      },
    };
    await expect(reconcileTombstonesAfterRestore({
      headStore: incomplete,
      snapshotHighestLocalEpoch: 3,
      snapshotPendingTombstoneIds: [],
    })).resolves.toMatchObject({ kind: "needs-repair" });
  });

  it("replays newer independent tombstones before reopening a restored registry", async () => {
    await withRegistry(async (registry) => {
      const head: TombstoneHead = {
        epoch: 2,
        entries: [
          { tombstoneId: "old", subject: "old-subject", localEpoch: 1 },
          { tombstoneId: "new", subject: "new-subject", localEpoch: 2 },
        ],
        complete: true,
        version: "v2",
      };
      const store: TombstoneHeadStore = {
        async readHead() { return { kind: "ok", head } as const; },
        async appendIfVersion() { return { kind: "conflict", head } as const; },
      };
      const result = await reconcileTombstonesAfterRestore({
        headStore: store,
        registry,
        snapshotHighestLocalEpoch: 1,
        snapshotPendingTombstoneIds: ["old"],
        restoredAt: "2026-09-09T02:00:00.000Z",
      });
      expect(result.kind).toBe("safe");
      expect(registry.tombstones()).toMatchObject([
        { tombstoneId: "old", subject: "old-subject", localEpoch: 1 },
        { tombstoneId: "new", subject: "new-subject", localEpoch: 2, status: "restore-safe" },
      ]);
      expect(registry.runHealth().repairState).toBe("healthy");
      expect(registry.tombstoneOutbox().every((entry) => entry.status === "synced")).toBe(true);
    });
  });

  it("keeps retrieval repair-locked when the independent head has an epoch gap", async () => {
    await withRegistry(async (registry) => {
      const store: TombstoneHeadStore = {
        async readHead() {
          return {
            kind: "ok",
            head: {
              epoch: 3,
              entries: [
                { tombstoneId: "t1", subject: "one", localEpoch: 1 },
                { tombstoneId: "t3", subject: "three", localEpoch: 3 },
              ],
              complete: true,
              version: "v3",
            },
          } as const;
        },
        async appendIfVersion() { return { kind: "unavailable", reason: "not-used" } as const; },
      };
      const result = await reconcileTombstonesAfterRestore({
        headStore: store,
        registry,
        snapshotHighestLocalEpoch: 1,
        snapshotPendingTombstoneIds: [],
        restoredAt: "2026-09-09T02:00:00.000Z",
      });
      expect(result.kind).toBe("needs-repair");
      expect(registry.runHealth().repairState).toBe("needs-repair");
    });
  });

  it("uses a conditional Azure Blob head without returning credential material", async () => {
    const requests: RequestInit[] = [];
    const store = createAzureBlobTombstoneHeadStore({
      accountName: "controlledaccount",
      containerName: "protected-backups",
      fetch: async (url, init = {}) => {
        requests.push(init);
        if (String(url).startsWith("http://169.254.169.254/")) {
          return new Response(JSON.stringify({ access_token: "opaque-test-token" }), { status: 200 });
        }
        if (init.method === "PUT") return new Response(null, { status: 201, headers: { etag: "v1" } });
        return new Response(null, { status: 404 });
      },
    });
    const result = await store.appendIfVersion({
      expectedVersion: "v0",
      tombstone: {
        tombstoneId: "t1",
        subject: "candidate-a",
        aliases: [],
        reason: "controlled",
        localEpoch: 1,
        status: "local-suppressed",
        createdAt: "2026-09-09T02:00:00.000Z",
      },
    });
    expect(result.kind).toBe("appended");
    const put = requests.find((request) => request.method === "PUT");
    expect(new Headers(put?.headers).get("If-Match")).toBe("*");
    expect(JSON.stringify(result)).not.toContain("opaque-test-token");
  });
});
