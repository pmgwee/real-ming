import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type {
  TombstoneHead,
  TombstoneHeadStore,
} from "../../src/knowledge/native-consolidation/contracts.js";
import {
  createNativeKnowledgeRegistry,
  type NativeKnowledgeRegistry,
} from "../../src/knowledge/native-consolidation/registry.js";
import { wikiRetrieve } from "../../src/knowledge/native-consolidation/retrieval.js";
import { createRealMingMcpComposition } from "../../src/config/real-ming-mcp-cli.js";
import {
  backupControlPlaneState,
  restoreControlPlaneBackup,
  verifyControlPlaneBackup,
} from "../../src/runtime/control-plane-backup.js";
import { sha256ContentHash } from "../../src/knowledge/native-consolidation/evidence.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = join(repositoryRoot, "hermes", "scripts", "run-native-knowledge-consolidation.py");
const candidateId = "native-knowledge-controlled-candidate";
const sourceBytes = "Controlled native knowledge exact source bytes.\n";
const now = "2026-09-09T02:00:00.000Z";
const permitted = [
  "real_ming_knowledge_list_candidates",
  "real_ming_read_knowledge_source",
  "real_ming_stage_knowledge_generation",
  "real_ming_wiki_retrieve",
].join(",");

function resolvePython(): string {
  const candidates = [
    process.env.LOCALAPPDATA === undefined
      ? undefined
      : join(process.env.LOCALAPPDATA, "hermes", "hermes-agent", "venv", "Scripts", "python.exe"),
    "python3",
    "python",
  ].filter((value): value is string => value !== undefined);
  for (const candidate of candidates) {
    if ((candidate.includes("\\") || candidate.includes("/")) && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.error === undefined && result.status === 0) return candidate;
  }
  throw new Error("portable Hermes Python interpreter is unavailable");
}

function sqliteFile(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('controlled');");
  } finally {
    database.close();
  }
}

function localHeadStore(): { readonly store: TombstoneHeadStore; head(): TombstoneHead } {
  let current: TombstoneHead = { epoch: 0, entries: [], complete: true, version: "v0" };
  return {
    head: () => current,
    store: {
      async readHead() {
        return { kind: "ok", head: current } as const;
      },
      async appendIfVersion(input) {
        if (input.expectedVersion !== current.version) return { kind: "conflict", head: current } as const;
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
        return { kind: "appended", head: current } as const;
      },
    },
  };
}

function controlledEnvironment(directory: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of [
    "TELEGRAM_BOT_TOKEN",
    "NOTION_TOKEN",
    "GOOGLE_REFRESH_TOKEN",
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "DUITSINI_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LLM_API_KEY",
    "ZAI_API_KEY",
  ]) delete environment[name];
  const python = resolvePython();
  return {
    ...environment,
    HERMES_SKIP_MEMORY: "1",
    HERMES_MCP_TOOLS: permitted,
    HERMES_KNOWLEDGE_AUTH_PROFILE: "controlled-local-profile",
    REAL_MING_NETWORK_DISABLED: "1",
    REAL_MING_NO_CREDENTIALS: "1",
    REAL_MING_KNOWLEDGE_CONTROLLED_FIXTURE: "1",
    REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE: "true",
    REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH: join(directory, "native-knowledge.sqlite"),
    REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT: join(directory, "vault", ".real-ming", "generated"),
    REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT: join(directory, "vault", ".real-ming", "staging"),
    REAL_MING_STATE_PATH: join(directory, "operations.sqlite"),
    REAL_MING_KNOWLEDGE_NOW: now,
    REAL_MING_PYTHON: python,
    HERMES_HOME: join(directory, "interactive-home"),
  };
}

function runWrapper(directory: string): { readonly status: number | null; readonly payload: Record<string, unknown> } {
  const result = spawnSync(resolvePython(), [wrapper, "--controlled"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: controlledEnvironment(directory),
    timeout: 120_000,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    payload: JSON.parse(String(result.stdout)) as Record<string, unknown>,
  };
}

function composition(
  directory: string,
  registry: NativeKnowledgeRegistry,
  headStore: TombstoneHeadStore,
) {
  return createRealMingMcpComposition({
    statePath: join(directory, "operations.sqlite"),
    knowledgeStatePath: join(directory, "native-knowledge.sqlite"),
    knowledgeGeneratedRoot: join(directory, "vault", ".real-ming", "generated"),
    knowledgeStagingRoot: join(directory, "vault", ".real-ming", "staging"),
    knowledgeRegistry: registry,
    knowledgeHeadStore: headStore,
    knowledgeIsolationEligible: () => true,
    now: () => now,
  });
}

describe("native knowledge production-path controlled acceptance", () => {
  it("runs the wrapper, publishes through MCP, forgets atomically, and restores without resurrection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-native-production-acceptance-"));
    const statePath = join(directory, "native-knowledge.sqlite");
    const generatedRoot = join(directory, "vault", ".real-ming", "generated");
    const stagingRoot = join(directory, "vault", ".real-ming", "staging");
    mkdirSync(generatedRoot, { recursive: true });
    mkdirSync(stagingRoot, { recursive: true });
    let registry: NativeKnowledgeRegistry | undefined;
    let activeComposition: ReturnType<typeof composition> | undefined;
    try {
      const wrapperRun = runWrapper(directory);
      expect(wrapperRun.status).toBe(0);
      expect(wrapperRun.payload).toMatchObject({
        eligible: true,
        executed: true,
        activated: true,
        pinnedCommit: "561b053f794a1781868bb032029d589c67708119",
      });

      registry = createNativeKnowledgeRegistry({ statePath, now: () => now });
      const metadata = registry.candidate(candidateId);
      expect(metadata).toMatchObject({
        candidateId,
        contentHash: sha256ContentHash(sourceBytes),
        status: "published",
      });
      const active = registry.activeGeneration();
      expect(active).toBeDefined();
      if (active === undefined) throw new Error("wrapper did not activate a generation");
      expect(readFileSync(join(active.path, "manifest.json"), "utf8")).toContain(active.generationId);

      const head = localHeadStore();
      activeComposition = composition(directory, registry, head.store);
      const retrieved = activeComposition.tools.call("real_ming_wiki_retrieve", {
        query: "controlled native knowledge path",
        now,
      });
      expect(retrieved.kind).toBe("ok");
      activeComposition.close();
      activeComposition = undefined;

      const notionPath = join(directory, "notion.sqlite");
      sqliteFile(notionPath);
      const beforeForget = await backupControlPlaneState({
        statePath: join(directory, "operations.sqlite"),
        notionLedgerPath: notionPath,
        nativeKnowledgeStatePath: statePath,
        hermesVaultPath: join(directory, "vault"),
        destinationDirectory: join(directory, "backups"),
        backupId: "before-forget",
        createdAt: now,
      });

      activeComposition = composition(directory, registry, head.store);
      const forgotten = await activeComposition.tools.callAsync!("real_ming_forget_wiki_knowledge", {
        subject: candidateId,
        reason: "controlled production acceptance cleanup",
        requestedAt: "2026-09-09T02:01:00.000Z",
      });
      expect(forgotten).toMatchObject({ kind: "ok", value: { status: "restore-safe" } });
      expect(registry.tombstoneOutbox()).toMatchObject([{ tombstoneId: expect.any(String), status: "synced" }]);
      expect(activeComposition.tools.call("real_ming_wiki_retrieve", { query: candidateId, now }).kind).toBe("failed");
      activeComposition.close();
      activeComposition = undefined;

      const afterForget = await backupControlPlaneState({
        statePath: join(directory, "operations.sqlite"),
        notionLedgerPath: notionPath,
        nativeKnowledgeStatePath: statePath,
        hermesVaultPath: join(directory, "vault"),
        destinationDirectory: join(directory, "backups"),
        backupId: "after-forget",
        createdAt: "2026-09-09T02:02:00.000Z",
      });
      expect(verifyControlPlaneBackup({ backupDirectory: afterForget.directory }).manifest.files)
        .toContainEqual(expect.objectContaining({ role: "native-knowledge-tombstone-outbox" }));

      const restoredOld = restoreControlPlaneBackup({
        backupDirectory: beforeForget.directory,
        destinationDirectory: join(directory, "restored-old"),
      });
      const restoredState = restoredOld.nativeKnowledgeStatePath;
      expect(restoredState).toBeDefined();
      if (restoredState === undefined) throw new Error("old backup did not include native knowledge state");
      const restoredRegistry = createNativeKnowledgeRegistry({ statePath: restoredState, now: () => now });
      const restoredGeneratedRoot = join(restoredOld.directory, "hermes-vault", ".real-ming", "generated");
      let duringReconciliation: ReturnType<typeof wikiRetrieve> | undefined;
      const observingHead: TombstoneHeadStore = {
        async readHead() {
          duringReconciliation = wikiRetrieve({
            registry: restoredRegistry,
            generatedRoot: restoredGeneratedRoot,
            query: "controlled native knowledge path",
            now,
          });
          return head.store.readHead();
        },
        appendIfVersion: (input) => head.store.appendIfVersion(input),
      };
      try {
        const reconciled = await (await import("../../src/knowledge/native-consolidation/tombstones.js")).reconcileTombstonesAfterRestore({
          registry: restoredRegistry,
          headStore: observingHead,
          snapshotHighestLocalEpoch: restoredRegistry.consistencyFence().tombstoneEpoch,
          snapshotPendingTombstoneIds: [],
          restoredAt: "2026-09-09T02:03:00.000Z",
        });
        expect(duringReconciliation?.kind).toBe("needs-repair");
        expect(reconciled.kind).toBe("safe");
        expect(restoredRegistry.tombstones()).toHaveLength(1);
        expect(wikiRetrieve({
          registry: restoredRegistry,
          generatedRoot: restoredGeneratedRoot,
          query: "controlled native knowledge path",
          now,
        }).kind).toBe("not-found");
      } finally {
        restoredRegistry.close();
      }

      const restoredAfter = restoreControlPlaneBackup({
        backupDirectory: afterForget.directory,
        destinationDirectory: join(directory, "restored-after"),
      });
      expect(restoredAfter.nativeKnowledgeTombstoneOutboxPath).toBeDefined();
      const restoredOutbox = JSON.parse(
        readFileSync(restoredAfter.nativeKnowledgeTombstoneOutboxPath!, "utf8"),
      ) as { entries: Array<Record<string, unknown>> };
      expect(restoredOutbox.entries).toHaveLength(1);
      expect(restoredOutbox.entries[0]).toMatchObject({
        localEpoch: 1,
        status: "synced",
        attempts: 0,
      });
      expect(String(restoredOutbox.entries[0]?.tombstoneId)).toMatch(/^native-knowledge:tombstone:/);
    } finally {
      activeComposition?.close();
      registry?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
