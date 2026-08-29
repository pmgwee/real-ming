import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createOperationsGateway } from "../operations/operations-gateway.js";
import { OperationsState } from "../operations/operations-state.js";
import { createCommandClassifier } from "../operations/command-classifier.js";
import { MasterTasksProjection } from "../master-tasks/master-tasks.js";
import {
  createNotionMasterTasksStore,
  createNotionProviderAdapter,
  SqliteNotionWriteLedger,
} from "../providers/notion-provider-adapter.js";
import {
  createNotionCutoverWorkspace,
  cutoverPayloadHash,
} from "../providers/notion-cutover-workspace.js";
import { MasterTasksCutover } from "../migration/master-tasks-cutover.js";
import { buildCutoverPlan } from "../migration/cutover-plan-builder.js";
import {
  rm11CutoverBindings,
  rm11CutoverTitleMatches,
} from "../migration/rm11-cutover-bindings.js";
import type {
  ControlledWorker,
  EffectVerifier,
  QuestionResponder,
  WorkItem,
  WorkerReceipt,
} from "../operations/contracts.js";

const evidenceDirectory = fileURLToPath(
  new URL("../../tmp/rm11-cutover/", import.meta.url),
);
const digestPath = fileURLToPath(
  new URL("../../tmp/rm11-ceo-review-digest.md", import.meta.url),
);
const backupPath = fileURLToPath(
  new URL("../../tmp/rm10-migration-rehearsal/source-backups.json", import.meta.url),
);
const statePath = fileURLToPath(
  new URL("../../.real-ming-operations.sqlite", import.meta.url),
);
const ledgerPath = fileURLToPath(
  new URL("../../.real-ming-notion-ledger.sqlite", import.meta.url),
);

function requireEnvironment(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) {
    throw new Error(`${name} is not set in the local environment.`);
  }
  return value;
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function requireFlag(name: string): string {
  const value = flag(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Pass --${name}=<value> exactly as the Approval records it.`);
  }
  return value.trim();
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface BackupRecord {
  readonly id: string;
  readonly title: string;
  readonly sourcePayload?: unknown;
}

interface BackupSource {
  readonly sourceId: string;
  readonly records: readonly BackupRecord[];
}

/**
 * A migration never runs a controlled effect: every imported record enters at
 * the lifecycle the CEO reconciled. These stubs exist so the Operations Gateway
 * can be constructed, and they fail loudly if anything tries to execute.
 */
const refusingWorker: ControlledWorker = {
  async execute(): Promise<WorkerReceipt> {
    throw new Error("The RM-11 cutover never executes controlled effects.");
  },
};
const refusingVerifier: EffectVerifier = {
  async verify() {
    throw new Error("The RM-11 cutover never verifies controlled effects.");
  },
};
const refusingResponder: QuestionResponder = {
  async answer(): Promise<string> {
    throw new Error("The RM-11 cutover never answers questions.");
  },
};

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    throw new Error(
      "The live Master Tasks cutover is disabled. Pass --live only with the exact CEO Approval.",
    );
  }

  const phase = requireFlag("phase").toUpperCase();
  if (phase !== "A" && phase !== "B") {
    throw new Error("Pass --phase=A or --phase=B.");
  }

  const bindings = rm11CutoverBindings;
  const approvalId = requireFlag("approval");
  const planVersion = requireFlag("plan-version");
  const digestSha256 = requireFlag("digest-sha256");
  const backupSha256 = requireFlag("backup-sha256");

  if (planVersion !== bindings.planVersion) {
    throw new Error(
      `The Approval is stale: it names ${planVersion}, not ${bindings.planVersion}.`,
    );
  }
  if (
    digestSha256 !== bindings.digestSha256 ||
    backupSha256 !== bindings.backupSha256
  ) {
    throw new Error(
      "The Approval is stale: a supplied hash does not match the bound plan.",
    );
  }

  const observedDigest = fileSha256(digestPath);
  const observedBackup = fileSha256(backupPath);
  if (observedDigest !== bindings.digestSha256) {
    throw new Error(
      "The local reconciliation digest no longer hashes to the approved value.",
    );
  }
  if (observedBackup !== bindings.backupSha256) {
    throw new Error(
      "The local RM-10 backup no longer hashes to the approved value.",
    );
  }

  const backups = JSON.parse(
    readFileSync(backupPath, "utf8"),
  ) as readonly BackupSource[];
  // The drift baseline is the payload the CEO actually reviewed. Phase A hashes
  // the live page the same way and refuses to write if the two differ.
  const { plan, titleMatches, descriptiveLabelRefs } = buildCutoverPlan({
    digest: readFileSync(digestPath, "utf8"),
    bindings,
    expectedTitleMatches: rm11CutoverTitleMatches,
    sources: backups.map((source) => ({
      dataSourceId: source.sourceId,
      records: source.records.map((record) => ({
        pageId: record.id,
        title: record.title,
        payloadHash: cutoverPayloadHash(record.sourcePayload),
      })),
    })),
  });

  const token = requireEnvironment("REAL_MING_NOTION_TOKEN");
  const workspace = createNotionCutoverWorkspace({
    token,
    databaseId: bindings.databaseId,
    sourceDataSourceIds: bindings.sources.map((source) => source.dataSourceId),
  });

  const state = new OperationsState(statePath);
  const ledger = new SqliteNotionWriteLedger(ledgerPath);
  const adapter = createNotionProviderAdapter({
    token,
    workspaceId: "workspace:real-ming",
    accountReference: "notion:account:real-ming",
    writeLedger: ledger,
  });
  const store = createNotionMasterTasksStore({
    adapter,
    dataSourceId: bindings.dataSourceId,
  });
  const projection = new MasterTasksProjection(state, store);
  const gateway = createOperationsGateway({
    state,
    worker: refusingWorker,
    verifier: refusingVerifier,
    questionResponder: refusingResponder,
    commandClassifier: createCommandClassifier(),
    workItemChanged: (workItem: WorkItem) =>
      projection.sync(workItem).then(() => undefined),
  });
  const cutover = new MasterTasksCutover({
    plan,
    approval: {
      approvalId,
      planVersion,
      digestVersion: bindings.digestVersion,
      digestSha256,
      backupSha256,
    },
    workspace,
    state,
    gateway,
    projection,
    store,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
  });

  try {
    mkdirSync(evidenceDirectory, { recursive: true });
    if (phase === "A") {
      const report = await cutover.executePhaseA();
      writeFileSync(
        `${evidenceDirectory}phase-a-report.json`,
        `${JSON.stringify({ ...report, titleMatches, descriptiveLabelRefs }, null, 2)}\n`,
        "utf8",
      );
      process.stdout.write(
        [
          "RM-11 Phase A complete.",
          `Plan: ${report.planVersion}  Approval: ${report.approvalId}`,
          `Sources re-read without mutation: ${report.sources.length}`,
          `Canonical imports: ${report.imported.length}`,
          `Archive-only records: ${report.archiveOnly.length}`,
          `Digest join: ${titleMatches.exact} exact, ${titleMatches.blankSource} blank-source, ${titleMatches.descriptiveLabel} descriptive (${descriptiveLabelRefs.join(", ")})`,
          "Legacy databases remain the daily system until Phase B.",
          `Evidence: ${evidenceDirectory}phase-a-report.json`,
        ].join("\n") + "\n",
      );
      return;
    }

    // Phase B may only follow a verified Phase A in the same process, so the
    // import is replayed first. It is idempotent: no second record is created.
    await cutover.executePhaseA();
    const report = await cutover.executePhaseB().catch((error: unknown) => {
      // Retirement is the commit point. A failure part-way through it must
      // leave the operator a durable record of what was already retired.
      const recovery = cutover.recovery();
      writeFileSync(
        `${evidenceDirectory}phase-b-failure.json`,
        `${JSON.stringify(
          {
            failure: error instanceof Error ? error.message : String(error),
            retirements: cutover.retirements(),
            recovery,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      process.stderr.write(
        [
          `Recovery stage: ${recovery.stage}`,
          `Legacy sources already retired: ${cutover.retirements().length}`,
          recovery.instruction,
          `Evidence: ${evidenceDirectory}phase-b-failure.json`,
        ].join("\n") + "\n",
      );
      throw error;
    });
    writeFileSync(
      `${evidenceDirectory}phase-b-report.json`,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    const recovery = cutover.recovery();
    process.stdout.write(
      [
        "RM-11 Phase B complete.",
        `Linked views: ${report.views.map((view) => view.name).join(", ")}`,
        `Sample edits verified and restored: ${report.sampleEdits.length}`,
        `Legacy sources retired read-only: ${report.retirements.length}`,
        `Writable task systems: ${report.writableTaskSystems.join(", ")}`,
        `Recovery stage: ${recovery.stage}`,
        `Evidence: ${evidenceDirectory}phase-b-report.json`,
      ].join("\n") + "\n",
    );
  } finally {
    ledger.close();
    state.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "The RM-11 cutover failed."}\n`,
  );
  process.exitCode = 1;
});
