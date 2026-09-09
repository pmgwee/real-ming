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
            aliases: [...input.tombstone.aliases],
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

  it("does not permit a pending outbox to be promoted directly to restore-safe", async () => {
    await withRegistry(async (registry) => {
      const tombstone = registry.appendLocalTombstone({
        tombstoneId: "pending-transition",
        subject: "pending-transition-subject",
        aliases: [],
        reason: "controlled transition fixture",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      expect(tombstone.status).toBe("local-suppressed");
      expect(() => registry.updateTombstoneStatus(tombstone.tombstoneId, "restore-safe"))
        .toThrow(/outbox.*synced/i);
      expect(registry.tombstones()[0]?.status).toBe("local-suppressed");
    });
  });

  it("rejects an independent replay that skips a required tombstone epoch", async () => {
    await withRegistry(async (registry) => {
      expect(() => registry.replayIndependentTombstone({
        tombstoneId: "out-of-order",
        subject: "out-of-order-subject",
        localEpoch: 2,
        restoredAt: "2026-09-09T02:00:00.000Z",
      })).toThrow(/epoch.*(gap|order)/i);
      expect(registry.tombstones()).toHaveLength(0);
      expect(registry.tombstoneOutbox()).toHaveLength(0);
    });
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
        snapshotTombstoneIds: ["old"],
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

  it("canonicalizes aliases when verifying an independent head read-back", async () => {
    await withRegistry(async (registry) => {
      let head: TombstoneHead = { epoch: 0, entries: [], complete: true, version: "v0" };
      const result = await forgetWikiKnowledge({
        registry,
        headStore: {
          async readHead() { return { kind: "ok", head } as const; },
          async appendIfVersion(input) {
            head = {
              epoch: 1,
              entries: [{
                tombstoneId: input.tombstone.tombstoneId,
                subject: input.tombstone.subject.toLocaleUpperCase("en-US"),
                aliases: ["Legacy Page"],
                localEpoch: input.tombstone.localEpoch,
              }],
              complete: true,
              version: "v1",
            };
            return { kind: "appended", head } as const;
          },
        },
        subject: "alias-readback",
        aliases: ["legacy page"],
        reason: "canonical alias read-back",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      expect(result.status).toBe("restore-safe");
      expect(result.verifiedHeadEpoch).toBe(1);
    });
  });

  it("fails a repeated forget that omits or changes an existing alias set", async () => {
    await withRegistry(async (registry) => {
      const first = registry.appendLocalTombstone({
        tombstoneId: "alias-set",
        subject: "alias-set-subject",
        aliases: ["Legacy Page"],
        reason: "controlled alias identity",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      expect(first.aliases).toEqual(["legacy page"]);
      expect(() => registry.appendLocalTombstone({
        subject: "alias-set-subject",
        aliases: [],
        reason: "omitted aliases",
        requestedAt: "2026-09-09T02:00:30.000Z",
      })).toThrow(/alias set conflicts/i);
      expect(() => registry.appendLocalTombstone({
        subject: "alias-set-subject",
        aliases: ["different alias"],
        reason: "conflicting retry",
        requestedAt: "2026-09-09T02:01:00.000Z",
      })).toThrow(/alias set conflicts/i);
      expect(registry.tombstones()[0]?.aliases).toEqual(["legacy page"]);
    });
  });

  it("preserves an alias-only suppression identity through independent restore replay", async () => {
    await withRegistry(async (registry) => {
      const head: TombstoneHead = {
        epoch: 1,
        entries: [{ tombstoneId: "alias-tombstone", subject: "canonical-candidate", aliases: ["legacy-page-alias"], localEpoch: 1 }],
        complete: true,
        version: "v1",
      };
      const result = await reconcileTombstonesAfterRestore({
        headStore: {
          async readHead() { return { kind: "ok", head } as const; },
          async appendIfVersion() { return { kind: "conflict", head } as const; },
        },
        registry,
        snapshotHighestLocalEpoch: 0,
        snapshotPendingTombstoneIds: [],
        restoredAt: "2026-09-09T02:00:00.000Z",
      });
      expect(result.kind).toBe("safe");
      expect(isSuppressedByTombstone({
        pageId: "derived-page",
        path: "pages/derived-page.md",
        sourceReference: "fixture:derived",
        sourceCandidateIds: ["legacy-page-alias"],
      }, registry.tombstones())).toBe(true);
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

  it("fails closed when an equal-epoch head omits a tombstone present in the backup", async () => {
    const head: TombstoneHead = {
      epoch: 1,
      entries: [{ tombstoneId: "other", subject: "other-subject", localEpoch: 1 }],
      complete: true,
      version: "v1",
    };
    await expect(reconcileTombstonesAfterRestore({
      headStore: {
        async readHead() { return { kind: "ok", head } as const; },
        async appendIfVersion() { return { kind: "conflict", head } as const; },
      },
      snapshotHighestLocalEpoch: 1,
      snapshotPendingTombstoneIds: [],
      snapshotTombstoneIds: ["forgotten-in-backup"],
    })).resolves.toMatchObject({ kind: "needs-repair", reason: expect.stringContaining("forgotten-in-backup") });
  });

  it("keeps restore locked when a nonzero backup epoch has no complete tombstone inventory", async () => {
    const head: TombstoneHead = {
      epoch: 1,
      entries: [{ tombstoneId: "head-entry", subject: "head-entry", localEpoch: 1 }],
      complete: true,
      version: "v1",
    };
    await expect(reconcileTombstonesAfterRestore({
      headStore: {
        async readHead() { return { kind: "ok", head } as const; },
        async appendIfVersion() { return { kind: "conflict", head } as const; },
      },
      snapshotHighestLocalEpoch: 1,
      snapshotPendingTombstoneIds: [],
    })).resolves.toMatchObject({ kind: "needs-repair", reason: expect.stringContaining("inventory") });
  });

  it("rejects restore when a local alias is absent from the independent head", async () => {
    await withRegistry(async (registry) => {
      const local = registry.appendLocalTombstone({
        tombstoneId: "alias-missing-head",
        subject: "alias-missing-head-subject",
        aliases: ["legacy page"],
        reason: "restore alias coverage",
        requestedAt: "2026-09-09T02:00:00.000Z",
      });
      const head: TombstoneHead = {
        epoch: 1,
        entries: [{ tombstoneId: local.tombstoneId, subject: local.subject, localEpoch: 1 }],
        complete: true,
        version: "v1",
      };
      const result = await reconcileTombstonesAfterRestore({
        headStore: {
          async readHead() { return { kind: "ok", head } as const; },
          async appendIfVersion() { return { kind: "conflict", head } as const; },
        },
        registry,
        snapshotHighestLocalEpoch: 1,
        snapshotPendingTombstoneIds: [local.tombstoneId],
        snapshotTombstoneIds: [local.tombstoneId],
        restoredAt: "2026-09-09T02:01:00.000Z",
      });
      expect(result.kind).toBe("needs-repair");
      expect(registry.runHealth().repairState).toBe("needs-repair");
    });
  });

  it("keeps restore locked when the independent head advances during reconciliation", async () => {
    const first: TombstoneHead = {
      epoch: 1,
      entries: [{ tombstoneId: "first", subject: "first", localEpoch: 1 }],
      complete: true,
      version: "v1",
    };
    const advanced: TombstoneHead = {
      epoch: 2,
      entries: [
        ...first.entries,
        { tombstoneId: "second", subject: "second", localEpoch: 2 },
      ],
      complete: true,
      version: "v2",
    };
    await withRegistry(async (registry) => {
      let reads = 0;
      const result = await reconcileTombstonesAfterRestore({
        headStore: {
          async readHead() {
            reads += 1;
            return { kind: "ok", head: reads === 1 ? first : advanced } as const;
          },
          async appendIfVersion() { return { kind: "conflict", head: advanced } as const; },
        },
        registry,
        snapshotHighestLocalEpoch: 0,
        snapshotPendingTombstoneIds: [],
      });
      expect(reads).toBeGreaterThanOrEqual(2);
      expect(result.kind).toBe("needs-repair");
      if (result.kind === "needs-repair") expect(result.reason).toMatch(/changed during restore/i);
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
    expect(new Headers(put?.headers).get("If-None-Match")).toBe("*");
    expect(new Headers(put?.headers).get("If-Match")).toBeNull();
    expect(JSON.stringify(result)).not.toContain("opaque-test-token");
  });

  it("uses concrete ETags for updates and exposes competing creation as a conflict", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    let stored: TombstoneHead | undefined;
    let createAttempts = 0;
    const store = createAzureBlobTombstoneHeadStore({
      accountName: "controlledaccount",
      containerName: "protected-backups",
      fetch: async (url, init = {}) => {
        requests.push({ url: String(url), init });
        if (String(url).startsWith("http://169.254.169.254/")) {
          return new Response(JSON.stringify({ access_token: "opaque-test-token" }), { status: 200 });
        }
        if (init.method === "PUT") {
          const headers = new Headers(init.headers);
          if (headers.get("If-None-Match") === "*") {
            createAttempts += 1;
            if (createAttempts === 1) {
              stored = {
                epoch: 1,
                entries: [{ tombstoneId: "competing", subject: "other", localEpoch: 1 }],
                complete: true,
                version: "v1",
              };
              return new Response(null, { status: 412 });
            }
            stored = {
              epoch: 1,
              entries: [{ tombstoneId: "competing", subject: "other", localEpoch: 1 }],
              complete: true,
              version: "v1",
            };
            return new Response(null, { status: 201, headers: { etag: "v1" } });
          }
          expect(headers.get("If-Match")).toBe("v1");
          stored = {
            epoch: 2,
            entries: [
              ...(stored?.entries ?? []),
              { tombstoneId: "updated", subject: "updated", localEpoch: 2 },
            ],
            complete: true,
            version: "v2",
          };
          return new Response(null, { status: 201, headers: { etag: "v2" } });
        }
        if (stored === undefined) return new Response(null, { status: 404 });
        return new Response(JSON.stringify(stored), { status: 200, headers: { etag: stored.version } });
      },
    });
    const competing = await store.appendIfVersion({
      expectedVersion: "v0",
      tombstone: {
        tombstoneId: "attempted", subject: "attempted", aliases: [], reason: "controlled", localEpoch: 1,
        status: "local-suppressed", createdAt: "2026-09-09T02:00:00.000Z",
      },
    });
    expect(competing).toMatchObject({ kind: "conflict", head: { epoch: 1 } });
    const updated = await store.appendIfVersion({
      expectedVersion: "v1",
      tombstone: {
        tombstoneId: "updated", subject: "updated", aliases: [], reason: "controlled", localEpoch: 2,
        status: "local-suppressed", createdAt: "2026-09-09T02:01:00.000Z",
      },
    });
    expect(updated).toMatchObject({ kind: "appended", head: { epoch: 2 } });
    expect(requests.filter(({ init }) => init.method === "PUT")).toHaveLength(2);
    expect(JSON.stringify(updated)).not.toContain("opaque-test-token");
  });

  it("reports a stale concrete ETag conflict without overwriting the newer head", async () => {
    const puts: RequestInit[] = [];
    let readCount = 0;
    let stored: TombstoneHead = {
      epoch: 1,
      entries: [{ tombstoneId: "current", subject: "current", localEpoch: 1 }],
      complete: true,
      version: "v1",
    };
    const store = createAzureBlobTombstoneHeadStore({
      accountName: "controlledaccount",
      containerName: "protected-backups",
      fetch: async (url, init = {}) => {
        if (String(url).startsWith("http://169.254.169.254/")) {
          return new Response(JSON.stringify({ access_token: "opaque-test-token" }), { status: 200 });
        }
        if (init.method === "PUT") {
          puts.push(init);
          const headers = new Headers(init.headers);
          expect(headers.get("If-Match")).toBe("v1");
          stored = {
            epoch: 2,
            entries: [...stored.entries, { tombstoneId: "newer", subject: "newer", localEpoch: 2 }],
            complete: true,
            version: "v2",
          };
          return new Response(null, { status: 412 });
        }
        readCount += 1;
        return new Response(JSON.stringify(stored), { status: 200, headers: { etag: readCount === 1 ? "v1" : "v2" } });
      },
    });
    const result = await store.appendIfVersion({
      expectedVersion: "v1",
      tombstone: {
        tombstoneId: "attempted-stale", subject: "attempted-stale", aliases: [], reason: "controlled", localEpoch: 2,
        status: "local-suppressed", createdAt: "2026-09-09T02:00:00.000Z",
      },
    });
    expect(result).toMatchObject({ kind: "conflict", head: { version: "v2", epoch: 2 } });
    expect(puts).toHaveLength(1);
    expect(stored.entries.map((entry) => entry.tombstoneId)).toEqual(["current", "newer"]);
  });

  it("carries the server ETag forward after a successful conditional write", async () => {
    let stored: TombstoneHead | undefined;
    const serverEtag = '"opaque-etag-1"';
    const store = createAzureBlobTombstoneHeadStore({
      accountName: "controlledaccount",
      containerName: "protected-backups",
      fetch: async (url, init = {}) => {
        if (String(url).startsWith("http://169.254.169.254/")) {
          return new Response(JSON.stringify({ access_token: "opaque-test-token" }), { status: 200 });
        }
        if (init.method === "PUT") {
          stored = {
            epoch: 1,
            entries: [{ tombstoneId: "etag", subject: "etag", localEpoch: 1 }],
            complete: true,
            // The service returns an opaque ETag that is not a synthetic vN.
            version: "v1",
          };
          return new Response(null, { status: 201, headers: { etag: serverEtag } });
        }
        return stored === undefined
          ? new Response(null, { status: 404 })
          : new Response(JSON.stringify(stored), { status: 200, headers: { etag: serverEtag } });
      },
    });
    const result = await store.appendIfVersion({
      expectedVersion: "v0",
      tombstone: {
        tombstoneId: "etag", subject: "etag", aliases: [], reason: "controlled", localEpoch: 1,
        status: "local-suppressed", createdAt: "2026-09-09T02:00:00.000Z",
      },
    });
    expect(result).toMatchObject({ kind: "appended", head: { version: serverEtag } });
  });

  it("fails closed when Azure returns a malformed ETag on an existing head", async () => {
    const store = createAzureBlobTombstoneHeadStore({
      accountName: "controlledaccount",
      containerName: "protected-backups",
      fetch: async (url, init = {}) => {
        if (String(url).startsWith("http://169.254.169.254/")) {
          return new Response(JSON.stringify({ access_token: "opaque-test-token" }), { status: 200 });
        }
        if (init.method === "PUT") return new Response(null, { status: 500 });
        return new Response(JSON.stringify({
          epoch: 1,
          entries: [{ tombstoneId: "existing", subject: "existing", localEpoch: 1 }],
          complete: true,
          version: "v1",
        }), { status: 200, headers: { etag: "malformed-etag" } });
      },
    });
    const result = await store.readHead();
    expect(result).toEqual({ kind: "unavailable", reason: "tombstone head is invalid" });
  });
});
