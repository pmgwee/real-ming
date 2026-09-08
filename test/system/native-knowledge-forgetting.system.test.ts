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
      const restore = await reconcileTombstonesAfterRestore({
        headStore: fakeHeadStore().store,
        snapshotHighestLocalEpoch: pending.localEpoch,
        snapshotPendingTombstoneIds: [pending.tombstoneId],
      });
      expect(restore.kind).toBe("needs-repair");
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
