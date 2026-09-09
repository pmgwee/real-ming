import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync as readText,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type {
  HermesRuntimeClient,
  HermesTurnRequest,
} from "../../src/hermes/contracts.js";
import {
  captureCandidate,
  sha256ContentHash,
  verifyEvidence,
} from "../../src/knowledge/native-consolidation/evidence.js";
import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../../src/knowledge/native-consolidation/registry.js";
import type {
  NativeKnowledgeCandidate,
  SourceSnapshot,
  StagedPage,
  TombstoneHead,
  TombstoneHeadStore,
  TombstoneRecord,
} from "../../src/knowledge/native-consolidation/contracts.js";
import {
  activateGeneration,
  readManifest,
  reconcileGenerations,
  stageGeneration,
} from "../../src/knowledge/native-consolidation/publication.js";
import { runConsolidation } from "../../src/knowledge/native-consolidation/runner.js";
import { wikiRetrieve } from "../../src/knowledge/native-consolidation/retrieval.js";
import {
  forgetWikiKnowledge,
  reconcileTombstonesAfterRestore,
} from "../../src/knowledge/native-consolidation/tombstones.js";
import { createRealMingTools } from "../../src/integration/real-ming-tools.js";
import { SqliteExecutionLinkStore } from "../../src/integration/execution-link.js";
import { nativeKnowledgeCronManifest } from "../../src/config/native-knowledge-cron-manifest.js";
import {
  backupControlPlaneState,
  restoreControlPlaneBackup,
  verifyControlPlaneBackup,
} from "../../src/runtime/control-plane-backup.js";
import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

const now = "2026-09-09T02:00:00.000Z";

function candidate(
  id: string,
  kind: NativeKnowledgeCandidate["kind"] = "project-artifact",
): NativeKnowledgeCandidate {
  const excerpt = `Controlled source-backed claim ${id}.`;
  const claimClass =
    kind === "decision" || kind === "correction"
      ? "decision"
      : kind === "research-artifact"
        ? "research"
        : "project";
  const retentionClass =
    claimClass === "decision"
      ? "decision"
      : claimClass === "research"
        ? "research-30d"
        : "project-90d";
  return {
    candidateId: `candidate-${id}`,
    kind,
    claimClass,
    claim: `Controlled source-backed claim ${id}.`,
    sourceIdentity: `fixture:${id}`,
    sourceReference: `fixture:${id}`,
    sourceVersion: "v1",
    excerpt,
    contentHash: sha256ContentHash(excerpt),
    capturedAt: now,
    asOf: now,
    trustDomain: "Ming Creatives",
    sensitivity: "normal",
    retentionClass,
    dependencies: [`candidate-${id}`],
  };
}

function sourceFor(value: NativeKnowledgeCandidate): SourceSnapshot {
  return {
    sourceIdentity: value.sourceIdentity,
    sourceReference: value.sourceReference,
    sourceVersion: value.sourceVersion,
    content: value.excerpt,
    contentHash: value.contentHash,
    asOf: value.asOf,
    retrievedAt: now,
  };
}

function pageFor(value: NativeKnowledgeCandidate): StagedPage {
  return {
    pageId: value.candidateId,
    path: `pages/${value.candidateId}.md`,
    content: `# ${value.candidateId}\n\n${value.claim}`,
    sourceCandidateIds: [value.candidateId],
    claimClass: value.claimClass,
    sourceReference: value.sourceReference,
    capturedAt: value.capturedAt,
    asOf: value.asOf,
    disposition: "supported",
    uncertainty: "none",
  };
}

function sqliteFile(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('controlled');");
  } finally {
    database.close();
  }
}

function fakeHeadStore(options: { readonly unavailable?: boolean } = {}): {
  readonly store: TombstoneHeadStore;
  head(): TombstoneHead;
} {
  let current: TombstoneHead = {
    epoch: 0,
    entries: [],
    complete: true,
    version: "v0",
  };
  return {
    head: () => current,
    store: {
      async readHead() {
        return options.unavailable
          ? { kind: "unavailable" as const, reason: "controlled-outage" }
          : { kind: "ok" as const, head: current };
      },
      async appendIfVersion(input) {
        if (options.unavailable) {
          return { kind: "unavailable" as const, reason: "controlled-outage" };
        }
        if (input.expectedVersion !== current.version) {
          return { kind: "conflict" as const, head: current };
        }
        current = {
          epoch: current.epoch + 1,
          entries: [
            ...current.entries,
            {
              tombstoneId: input.tombstone.tombstoneId,
              subject: input.tombstone.subject,
              localEpoch: input.tombstone.localEpoch,
            },
          ],
          complete: true,
          version: `v${current.epoch + 1}`,
        };
        return { kind: "appended" as const, head: current };
      },
    },
  };
}

async function workspace(): Promise<{
  readonly directory: string;
  readonly generatedRoot: string;
  readonly stagingRoot: string;
  readonly registry: NativeKnowledgeRegistry;
}> {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-native-acceptance-"));
  const generatedRoot = join(directory, "vault", ".real-ming", "generated");
  const stagingRoot = join(directory, "vault", ".real-ming", "staging");
  mkdirSync(generatedRoot, { recursive: true });
  mkdirSync(stagingRoot, { recursive: true });
  return {
    directory,
    generatedRoot,
    stagingRoot,
    registry: createNativeKnowledgeRegistry({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    }),
  };
}

function closeWorkspace(fixture: { readonly directory: string; readonly registry: NativeKnowledgeRegistry }): void {
  fixture.registry.close();
  rmSync(fixture.directory, { recursive: true, force: true });
}

async function runOne(
  fixture: Awaited<ReturnType<typeof workspace>>,
  values: ReadonlyMap<string, NativeKnowledgeCandidate>,
): Promise<Awaited<ReturnType<typeof runConsolidation>>> {
  return runConsolidation({
    registry: fixture.registry,
    isolationEligible: true,
    operatingDate: "2026-09-09",
    now,
    generatedRoot: fixture.generatedRoot,
    stagingRoot: fixture.stagingRoot,
    clock: () => now,
    loadCandidate: async (id) => values.get(id),
    readSource: async (value) => sourceFor(value),
    assessSupport: async () => "supported",
    synthesize: async ({ candidates }) => candidates.map(pageFor),
  });
}

describe("native knowledge controlled acceptance matrix", () => {
  it("covers NKC-01/02/03: selective capture, idempotency, semantic support and freshness", async () => {
    const fixture = await workspace();
    const decision = candidate("decision", "decision");
    const research = candidate("research", "research-artifact");
    try {
      await expect(
        captureCandidate({
          candidate: decision,
          explicit: false,
          marked: false,
          registry: fixture.registry,
        }),
      ).resolves.toEqual({ kind: "ignored", reason: "not-explicit" });
      await expect(
        captureCandidate({
          candidate: decision,
          explicit: true,
          marked: false,
          registry: fixture.registry,
        }),
      ).resolves.toMatchObject({ kind: "accepted" });
      await expect(
        captureCandidate({
          candidate: decision,
          explicit: true,
          marked: true,
          registry: fixture.registry,
        }),
      ).resolves.toEqual({ kind: "accepted", admission: { kind: "duplicate", candidateId: decision.candidateId } });

      const supported = await verifyEvidence({
        candidate: research,
        source: sourceFor(research),
        now,
        semanticSupport: "supported",
      });
      expect(supported).toMatchObject({
        disposition: "supported",
        identityMatches: true,
        fresh: true,
      });
      const sameBytesButUnsupported = await verifyEvidence({
        candidate: research,
        source: sourceFor(research),
        now,
        semanticSupport: "unsupported",
      });
      expect(sameBytesButUnsupported).toMatchObject({
        disposition: "quarantined",
        support: "unsupported",
      });
      const stale = await verifyEvidence({
        candidate: { ...research, asOf: "2026-07-01T00:00:00.000Z" },
        source: sourceFor({ ...research, asOf: "2026-07-01T00:00:00.000Z" }),
        now: "2026-09-09T02:00:00.000Z",
        semanticSupport: "supported",
      });
      expect(stale.disposition).toBe("stale");
    } finally {
      closeWorkspace(fixture);
    }
  });

  it("covers NKC-05/NKC-14: one-owner activation, complete snapshots and selective forgetting", async () => {
    const fixture = await workspace();
    const values = new Map<string, NativeKnowledgeCandidate>();
    const first = candidate("a");
    const second = candidate("b");
    const third = candidate("c");
    values.set(first.candidateId, first);
    values.set(second.candidateId, second);
    values.set(third.candidateId, third);
    try {
      fixture.registry.admitCandidate(first);
      expect((await runOne(fixture, values)).kind).toBe("succeeded");
      fixture.registry.admitCandidate(second);
      expect((await runOne(fixture, values)).kind).toBe("succeeded");

      const both = wikiRetrieve({
        registry: fixture.registry,
        generatedRoot: fixture.generatedRoot,
        query: "Controlled source-backed claim",
        now,
        maxResults: 10,
      });
      expect(both.kind).toBe("ok");
      if (both.kind !== "ok") throw new Error("expected complete snapshot");
      expect(both.results.map((result) => result.pageId)).toEqual([
        first.candidateId,
        second.candidateId,
      ]);

      const remote = fakeHeadStore();
      const forgotten = await forgetWikiKnowledge({
        registry: fixture.registry,
        headStore: remote.store,
        subject: first.candidateId,
        aliases: [first.candidateId],
        reason: "controlled acceptance cleanup",
        requestedAt: now,
      });
      expect(forgotten.status).toBe("restore-safe");

      // A new candidate forces a new complete generation. The runner removes
      // the forgotten page before carry-forward; valid B survives.
      fixture.registry.admitCandidate(third);
      expect((await runOne(fixture, values)).kind).toBe("succeeded");
      const active = fixture.registry.activeGeneration();
      if (active === undefined) throw new Error("expected active generation");
      const manifest = readManifest(join(active.path, "manifest.json"));
      expect(manifest.pages.map((page) => page.pageId)).toEqual([
        second.candidateId,
        third.candidateId,
      ]);
      expect(
        wikiRetrieve({
          registry: fixture.registry,
          generatedRoot: fixture.generatedRoot,
          query: first.candidateId,
          now,
        }).kind,
      ).toBe("not-found");
      expect(
        wikiRetrieve({
          registry: fixture.registry,
          generatedRoot: fixture.generatedRoot,
          query: second.candidateId,
          now,
        }).kind,
      ).toBe("ok");
    } finally {
      closeWorkspace(fixture);
    }
  });

  it("covers NKC-06/07/09: publication crash boundaries, final-commit forget fencing and path safety", async () => {
    const fixture = await workspace();
    const value = candidate("race");
    const leaseResult = fixture.registry.claimRun({ operatingDate: "2026-09-09", limit: 12 });
    if (leaseResult.kind !== "claimed") throw new Error("expected controlled lease");
    try {
      const staged = await stageGeneration({
        run: leaseResult,
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        pages: [pageFor(value)],
        sourceEpoch: 0,
        tombstoneEpoch: 0,
        now,
      });
      fixture.registry.recordStagedGeneration(staged);
      fixture.registry.appendLocalTombstone({
        subject: value.candidateId,
        aliases: [],
        reason: "forget during final commit",
        requestedAt: now,
      });
      expect(
        activateGeneration({
          registry: fixture.registry,
          generation: staged,
          lease: leaseResult,
          activePath: fixture.generatedRoot,
          now,
        }),
      ).toMatchObject({ kind: "invalid", reason: "tombstone-epoch-advanced" });
      expect(fixture.registry.activeGeneration()).toBeUndefined();
      await expect(
        stageGeneration({
          run: leaseResult,
          generatedRoot: fixture.generatedRoot,
          stagingRoot: fixture.stagingRoot,
          pages: [{ ...pageFor(value), path: "../escape.md" }],
          sourceEpoch: 0,
          tombstoneEpoch: 1,
          now,
        }),
      ).rejects.toThrow(/path/i);
    } finally {
      closeWorkspace(fixture);
    }

    const tamper = await workspace();
    const safe = candidate("safe");
    try {
      tamper.registry.admitCandidate(safe);
      expect((await runOne(tamper, new Map([[safe.candidateId, safe]]) )).kind).toBe("succeeded");
      const active = tamper.registry.activeGeneration();
      if (active === undefined) throw new Error("expected active generation");
      writeFileSync(join(active.path, "pages", `${safe.candidateId}.md`), "tampered", "utf8");
      expect(
        wikiRetrieve({
          registry: tamper.registry,
          generatedRoot: tamper.generatedRoot,
          query: safe.candidateId,
          now,
        }).kind,
      ).toBe("needs-repair");
      const reconciliation = reconcileGenerations({
        generatedRoot: tamper.generatedRoot,
        registry: tamper.registry,
        now,
      });
      expect(reconciliation.kind).toBe("needs-repair");
    } finally {
      closeWorkspace(tamper);
    }
  });

  it("covers NKC-08: pending local forgets, independent head recovery and opaque outbox backup", async () => {
    const fixture = await workspace();
    try {
      const pending = await forgetWikiKnowledge({
        registry: fixture.registry,
        headStore: fakeHeadStore({ unavailable: true }).store,
        subject: "candidate-pending",
        aliases: [],
        reason: "controlled head outage",
        requestedAt: now,
      });
      expect(pending.status).toBe("head-sync-pending");
      expect(
        await reconcileTombstonesAfterRestore({
          headStore: fakeHeadStore().store,
          snapshotHighestLocalEpoch: pending.localEpoch,
          snapshotPendingTombstoneIds: [pending.tombstoneId],
        }),
      ).toMatchObject({ kind: "needs-repair" });

      const complete = fakeHeadStore();
      const append = await complete.store.appendIfVersion({
        expectedVersion: "v0",
        tombstone: pending,
      });
      expect(append.kind).toBe("appended");
      expect(
        await reconcileTombstonesAfterRestore({
          headStore: complete.store,
          snapshotHighestLocalEpoch: pending.localEpoch,
          snapshotPendingTombstoneIds: [pending.tombstoneId],
        }),
      ).toMatchObject({ kind: "safe" });

      const recovery = mkdtempSync(join(tmpdir(), "real-ming-native-recovery-"));
      try {
        const statePath = join(recovery, "state.sqlite");
        const notionPath = join(recovery, "notion.sqlite");
        const outboxPath = join(recovery, "tombstone-outbox.json");
        sqliteFile(statePath);
        sqliteFile(notionPath);
        writeFileSync(
          outboxPath,
          JSON.stringify({ tombstoneIds: [pending.tombstoneId], status: "head_sync_pending" }),
          "utf8",
        );
        const backup = await backupControlPlaneState({
          statePath,
          notionLedgerPath: notionPath,
          nativeKnowledgeTombstoneOutboxPath: outboxPath,
          destinationDirectory: join(recovery, "backups"),
          backupId: "native-knowledge-acceptance",
          createdAt: now,
        });
        expect(verifyControlPlaneBackup({ backupDirectory: backup.directory }).verifiedFiles).toBe(3);
        const restored = restoreControlPlaneBackup({
          backupDirectory: backup.directory,
          destinationDirectory: join(recovery, "restore"),
        });
        expect(restored.nativeKnowledgeTombstoneOutboxPath).toBeDefined();
        expect(readText(restored.nativeKnowledgeTombstoneOutboxPath!, "utf8")).toContain(pending.tombstoneId);
        expect(readText(restored.nativeKnowledgeTombstoneOutboxPath!, "utf8")).not.toContain("token=");
      } finally {
        rmSync(recovery, { recursive: true, force: true });
      }
    } finally {
      closeWorkspace(fixture);
    }
  });

  it("covers NKC-04/NKC-10/NKC-11: failed consolidation leaves native Hermes chat available", async () => {
    const fixture = await workspace();
    const value = candidate("failure");
    try {
      fixture.registry.admitCandidate(value);
      const failed = await runConsolidation({
        registry: fixture.registry,
        isolationEligible: true,
        operatingDate: "2026-09-09",
        now,
        generatedRoot: fixture.generatedRoot,
        stagingRoot: fixture.stagingRoot,
        loadCandidate: async () => value,
        readSource: async () => ({ kind: "unavailable" as const, reason: "controlled-source-outage" }),
        synthesize: async () => [],
      });
      expect(failed.kind).toBe("failed");
      expect(fixture.registry.activeGeneration()).toBeUndefined();

      const runtime: HermesRuntimeClient = {
        async turn(request: HermesTurnRequest) {
          return {
            sessionId: request.sessionId,
            turnId: request.turnId,
            plan: {
              intent: "answer" as const,
              answer: "Native Hermes chat remains available during a failed optional job.",
              contextRequests: [],
              toolRequests: [],
            },
          };
        },
        async health() {
          return { status: "healthy" as const, model: "controlled-native-hermes" };
        },
      };
      const harness = createRealMingSystemHarness({
        statePath: ":memory:",
        hermes: { runtime, model: "controlled-native-hermes" },
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        const chat = await harness.receiveTelegramUpdate({
          updateId: 9901,
          message: {
            messageId: 9901,
            senderId: "100000001",
            chatId: "100000001",
            text: "Answer while consolidation is unavailable.",
          },
        });
        expect(chat).toMatchObject({
          kind: "handled",
          response: {
            kind: "hermes-answer",
            answer: "Native Hermes chat remains available during a failed optional job.",
          },
        });
      } finally {
        harness.close();
      }
    } finally {
      closeWorkspace(fixture);
    }
  });

  it("covers NKC-12 and the inactive rollout boundary through health MCP and manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-native-health-"));
    const registry = createNativeKnowledgeRegistry({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    });
    const links = new SqliteExecutionLinkStore(join(directory, "links.sqlite"));
    try {
      const tools = createRealMingTools({
        workItems: () => [],
        workItem: () => undefined,
        links,
        now: () => now,
        knowledge: {
          registry,
          generatedRoot: join(directory, "generated"),
          isolationEligible: () => true,
        },
      });
      expect(tools.list().map((tool) => tool.name)).toContain("real_ming_knowledge_health");
      const health = tools.call("real_ming_knowledge_health", {});
      expect(health).toEqual({
        kind: "ok",
        value: expect.objectContaining({
          activeGenerationId: null,
          backlog: 0,
          isolationEligible: true,
          repairState: "healthy",
        }),
      });
      expect(nativeKnowledgeCronManifest.active).toBe(false);
      expect(nativeKnowledgeCronManifest.schedule).toBe("0 2 * * *");
      expect(nativeKnowledgeCronManifest.timeZone).toBe("Asia/Kuala_Lumpur");
      expect(nativeKnowledgeCronManifest.generatedRoot).toBe(
        "${OBSIDIAN_VAULT_PATH}/.real-ming/generated",
      );
      expect(nativeKnowledgeCronManifest.stagingRoot).toBe(
        "${OBSIDIAN_VAULT_PATH}/.real-ming/staging",
      );
      expect(JSON.stringify(nativeKnowledgeCronManifest)).not.toMatch(/(token|secret|password)=/iu);
    } finally {
      links.close();
      registry.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
