import type {
  ExecutiveRole,
  MigratedCommitmentProvenance,
  MigratedWorkItemState,
  WorkItem,
  WorkItemPriority,
  Workstream,
} from "../operations/contracts.js";
import { migratedWorkItemStates } from "../operations/contracts.js";
import { workstreamRoutes } from "../operations/executive-role-router.js";
import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import type {
  MasterTasksProjection,
  MasterTasksStore,
} from "../master-tasks/master-tasks.js";

/**
 * The lifecycles a migration may land, re-exported from the contracts so the
 * plan and the Operations Gateway can never drift apart on what is importable.
 */
export const migrationImportLifecycles = migratedWorkItemStates;
export type MigrationLifecycle = MigratedWorkItemState;

export type CutoverDisposition = "migrate" | "archive-only";
export type CutoverCommitmentProvenance = MigratedCommitmentProvenance;

export const cutoverSourceReferencePrefix = "notion-migration:";

export function cutoverSourceReference(
  dataSourceId: string,
  pageId: string,
): string {
  return `${cutoverSourceReferencePrefix}${dataSourceId}:${pageId}`;
}

export interface CutoverSourceBinding {
  readonly dataSourceId: string;
  readonly recordCount: number;
}

export interface CutoverLifecycleCount {
  readonly lifecycle: MigrationLifecycle | "Cancelled";
  readonly count: number;
}

export interface CutoverRoutingCount {
  readonly workstream: Workstream;
  readonly accountableExecutive: ExecutiveRole;
  readonly count: number;
}

export interface CutoverBindings {
  readonly planVersion: string;
  readonly digestVersion: string;
  readonly digestSha256: string;
  readonly backupSha256: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly archivePrefix: string;
  readonly sources: readonly CutoverSourceBinding[];
  readonly reviewedRecordCount: number;
  readonly canonicalImportCount: number;
  readonly archiveOnlyCount: number;
  readonly sourceCommitmentCount: number;
  readonly lifecycleCounts: readonly CutoverLifecycleCount[];
  readonly routingCounts: readonly CutoverRoutingCount[];
}

export interface CutoverDecision {
  readonly dataSourceId: string;
  readonly pageId: string;
  readonly payloadHash: string;
  readonly disposition: CutoverDisposition;
  readonly lifecycle: MigrationLifecycle | "Cancelled";
  readonly workstream: Workstream;
  readonly accountableExecutive: ExecutiveRole;
  readonly commitmentProvenance: CutoverCommitmentProvenance;
}

export interface CutoverPlan {
  readonly bindings: CutoverBindings;
  readonly decisions: readonly CutoverDecision[];
}

export interface CutoverApproval {
  readonly approvalId: string;
  readonly planVersion: string;
  readonly digestVersion: string;
  readonly digestSha256: string;
  readonly backupSha256: string;
}

export interface CutoverSourceRecord {
  readonly pageId: string;
  readonly payloadHash: string;
  readonly title: string;
  readonly legacyStatus: string;
}

export interface CutoverSourceSnapshot {
  readonly dataSourceId: string;
  readonly parentDatabaseId: string;
  readonly name: string;
  readonly records: readonly CutoverSourceRecord[];
}

export interface CutoverTarget {
  readonly databaseId: string;
  readonly dataSourceId: string;
}

export interface CutoverLinkedView {
  readonly id: string;
  readonly name: string;
  readonly dataSourceId: string;
  readonly workstreams: readonly Workstream[];
}

export interface CutoverRetirement {
  readonly dataSourceId: string;
  readonly archivedName: string;
  readonly locked: boolean;
}

export interface CutoverWorkspace {
  readSources(): Promise<readonly CutoverSourceSnapshot[]>;
  masterTasksTarget(): Promise<CutoverTarget>;
  ensureLinkedView(request: {
    readonly name: string;
    readonly dataSourceId: string;
    readonly workstreams: readonly Workstream[];
  }): Promise<CutoverLinkedView>;
  /**
   * Read-only probe that the source can be renamed and locked. Every bound
   * source is probed before any of them is retired, so a refusal leaves all
   * five legacy databases writable and daily use unchanged.
   */
  verifyRetirable(dataSourceId: string): Promise<void>;
  retireLegacySource(request: {
    readonly dataSourceId: string;
    readonly archivedName: string;
  }): Promise<CutoverRetirement>;
  writableTaskSystems(): Promise<readonly string[]>;
}

export interface LegacyLinkedViewSpec {
  readonly name: string;
  readonly workstreams: readonly Workstream[];
}

/**
 * Phase B keeps the familiar legacy page names so daily use is unchanged, but
 * every one of them now reads the single Master Tasks data source.
 */
export const legacyLinkedViewSpecs: readonly LegacyLinkedViewSpec[] = [
  {
    name: "(IP Content Creation) Task To Do List",
    workstreams: ["Content Creation"],
  },
  { name: "(MicroSaaS) Task To Do List", workstreams: ["MicroSaaS"] },
  { name: "(Academic) Task To Do List", workstreams: ["Academic"] },
  {
    name: "(Job x Life) Task To Do List",
    workstreams: ["Personal Life", "Career Job"],
  },
  { name: "(Finance) Task To Do List", workstreams: ["Finance"] },
] as const;

export interface CutoverSourceReport {
  readonly dataSourceId: string;
  readonly parentDatabaseId: string;
  readonly recordCount: number;
}

export interface CutoverSample {
  readonly workstream: Workstream;
  readonly sourceReference: string;
  readonly workItemId: string;
}

export interface CutoverPhaseAReport {
  readonly planVersion: string;
  readonly approvalId: string;
  readonly sources: readonly CutoverSourceReport[];
  readonly imported: readonly string[];
  readonly archiveOnly: readonly string[];
  readonly lifecycleCounts: readonly CutoverLifecycleCount[];
  readonly routingCounts: readonly CutoverRoutingCount[];
  readonly samples: readonly CutoverSample[];
  readonly legacySourcesMutated: false;
}

export interface CutoverSampleEdit {
  readonly viewName: string;
  readonly workItemId: string;
  readonly observedPriority: WorkItemPriority;
  readonly restoredPriority: WorkItemPriority | null;
}

export interface CutoverPhaseBReport {
  readonly views: readonly CutoverLinkedView[];
  readonly sampleEdits: readonly CutoverSampleEdit[];
  readonly retirements: readonly CutoverRetirement[];
  readonly writableTaskSystems: readonly string[];
  readonly completedAt: string;
}

export type CutoverRecoveryStage = "before-commit-point" | "after-commit-point";

export interface CutoverRecovery {
  readonly stage: CutoverRecoveryStage;
  readonly backupSha256: string;
  readonly quarantinePrefix: string;
  readonly bidirectionalSynchronization: false;
  readonly instruction: string;
}

const sampleEditPriority: WorkItemPriority = "High";

function counted<Key>(
  entries: readonly Key[],
  key: (entry: Key) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const identity = key(entry);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

function routingKey(
  workstream: Workstream,
  accountableExecutive: ExecutiveRole,
): string {
  return `${workstream}|${accountableExecutive}`;
}

/**
 * Self-consistency of the Approval packet. Every count the CEO read must be
 * derivable from the decisions themselves, otherwise the packet described a
 * different migration from the one about to run.
 */
export function validateCutoverPlan(plan: CutoverPlan): readonly string[] {
  const { bindings, decisions } = plan;
  const problems: string[] = [];

  if (decisions.length !== bindings.reviewedRecordCount) {
    problems.push(
      `The plan carries ${decisions.length} decisions but binds ${bindings.reviewedRecordCount} reviewed records.`,
    );
  }

  const references = decisions.map((decision) =>
    cutoverSourceReference(decision.dataSourceId, decision.pageId),
  );
  if (new Set(references).size !== references.length) {
    problems.push("The plan repeats a source record.");
  }

  const boundSourceIds = new Set(
    bindings.sources.map((source) => source.dataSourceId),
  );
  for (const decision of decisions) {
    if (!boundSourceIds.has(decision.dataSourceId)) {
      problems.push(
        `Decision ${decision.pageId} names unbound source ${decision.dataSourceId}.`,
      );
    }
    const expectedExecutive =
      workstreamRoutes[decision.workstream].executive;
    if (decision.accountableExecutive !== expectedExecutive) {
      problems.push(
        `Decision ${decision.pageId} routes ${decision.workstream} to ${decision.accountableExecutive} instead of ${expectedExecutive}.`,
      );
    }
    if (decision.disposition === "archive-only") {
      if (decision.lifecycle !== "Cancelled") {
        problems.push(
          `Archive-only decision ${decision.pageId} must carry the Cancelled disposition.`,
        );
      }
    } else if (
      !migrationImportLifecycles.includes(
        decision.lifecycle as MigrationLifecycle,
      )
    ) {
      problems.push(
        `Decision ${decision.pageId} names lifecycle ${decision.lifecycle}, which a migration may not create.`,
      );
    }
  }

  const perSource = counted(decisions, (decision) => decision.dataSourceId);
  for (const source of bindings.sources) {
    const actual = perSource.get(source.dataSourceId) ?? 0;
    if (actual !== source.recordCount) {
      problems.push(
        `Source ${source.dataSourceId} binds ${source.recordCount} records but the plan decides ${actual}.`,
      );
    }
  }

  const migrating = decisions.filter(
    (decision) => decision.disposition === "migrate",
  );
  const archiving = decisions.filter(
    (decision) => decision.disposition === "archive-only",
  );
  if (migrating.length !== bindings.canonicalImportCount) {
    problems.push(
      `The plan migrates ${migrating.length} records but binds ${bindings.canonicalImportCount}.`,
    );
  }
  if (archiving.length !== bindings.archiveOnlyCount) {
    problems.push(
      `The plan archives ${archiving.length} records but binds ${bindings.archiveOnlyCount}.`,
    );
  }

  const commitments = decisions.filter(
    (decision) => decision.commitmentProvenance !== "none-in-source",
  ).length;
  if (commitments !== bindings.sourceCommitmentCount) {
    problems.push(
      `The plan carries ${commitments} source commitments but binds ${bindings.sourceCommitmentCount}.`,
    );
  }

  const lifecycles = counted(decisions, (decision) => decision.lifecycle);
  for (const expected of bindings.lifecycleCounts) {
    const actual = lifecycles.get(expected.lifecycle) ?? 0;
    if (actual !== expected.count) {
      problems.push(
        `Lifecycle ${expected.lifecycle} binds ${expected.count} records but the plan decides ${actual}.`,
      );
    }
    lifecycles.delete(expected.lifecycle);
  }
  for (const unexpected of lifecycles.keys()) {
    problems.push(`Lifecycle ${unexpected} is not part of the approved result.`);
  }

  const routes = counted(migrating, (decision) =>
    routingKey(decision.workstream, decision.accountableExecutive),
  );
  for (const expected of bindings.routingCounts) {
    const identity = routingKey(
      expected.workstream,
      expected.accountableExecutive,
    );
    const actual = routes.get(identity) ?? 0;
    if (actual !== expected.count) {
      problems.push(
        `Routing ${identity} binds ${expected.count} records but the plan decides ${actual}.`,
      );
    }
    routes.delete(identity);
  }
  for (const unexpected of routes.keys()) {
    problems.push(`Routing ${unexpected} is not part of the approved result.`);
  }

  return problems;
}

export function assertCutoverApproval(
  approval: CutoverApproval,
  bindings: CutoverBindings,
): void {
  const mismatches = (
    [
      ["plan version", approval.planVersion, bindings.planVersion],
      ["digest version", approval.digestVersion, bindings.digestVersion],
      ["digest SHA-256", approval.digestSha256, bindings.digestSha256],
      ["backup SHA-256", approval.backupSha256, bindings.backupSha256],
    ] as const
  ).filter(([, actual, expected]) => actual !== expected);

  if (approval.approvalId.trim() === "") {
    throw new Error(
      "The cutover Approval is stale: it carries no Approval identifier.",
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `The cutover Approval is stale: ${mismatches
        .map(([field]) => field)
        .join(", ")} does not match the bound plan.`,
    );
  }
}

export interface MasterTasksCutoverOptions {
  readonly plan: CutoverPlan;
  readonly approval: CutoverApproval;
  readonly workspace: CutoverWorkspace;
  readonly state: OperationsState;
  readonly gateway: OperationsGateway;
  readonly projection: MasterTasksProjection;
  readonly store: MasterTasksStore;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly now?: () => string;
}

export class MasterTasksCutover {
  #phaseAVerified = false;
  // Retirements are appended as each one succeeds, so a partial or crashed
  // Phase B still reports the commit point honestly.
  readonly #retirements: CutoverRetirement[] = [];

  constructor(private readonly options: MasterTasksCutoverOptions) {}

  async executePhaseA(
    approval: CutoverApproval = this.options.approval,
  ): Promise<CutoverPhaseAReport> {
    const { plan, workspace } = this.options;
    const { bindings } = plan;

    assertCutoverApproval(approval, bindings);
    const problems = validateCutoverPlan(plan);
    if (problems.length > 0) {
      throw new Error(
        `The cutover plan does not match its approved result shape: ${problems[0]}`,
      );
    }

    const snapshots = await workspace.readSources();
    const sources = this.#verifySnapshots(snapshots);

    const target = await workspace.masterTasksTarget();
    if (
      target.databaseId !== bindings.databaseId ||
      target.dataSourceId !== bindings.dataSourceId
    ) {
      throw new Error(
        "The Master Tasks target does not match the bound database and data source.",
      );
    }

    const planned = new Set(
      plan.decisions
        .filter((decision) => decision.disposition === "migrate")
        .map((decision) =>
          cutoverSourceReference(decision.dataSourceId, decision.pageId),
        ),
    );
    for (const record of await this.options.store.records()) {
      if (!record.sourceReference.startsWith(cutoverSourceReferencePrefix)) {
        continue;
      }
      if (!planned.has(record.sourceReference)) {
        throw new Error(
          `Master Tasks holds a conflicting migration reference: ${record.sourceReference}.`,
        );
      }
      // A planned record already in Master Tasks is only a safe replay when the
      // local Work Item that produced it still exists. Otherwise the duplicate
      // guard, which keys on Work Item ID, would let this import create a
      // second Master Tasks page for the same legacy record.
      const local = this.options.state.findWorkItemByCommand(
        this.options.workspaceId,
        record.sourceReference,
      );
      if (local === undefined || local.id !== record.workItemId) {
        throw new Error(
          `Master Tasks already imported ${record.sourceReference} under another Work Item. Reconcile it before replaying the cutover.`,
        );
      }
    }

    const titles = new Map<string, CutoverSourceRecord>();
    for (const snapshot of snapshots) {
      for (const record of snapshot.records) {
        titles.set(
          cutoverSourceReference(snapshot.dataSourceId, record.pageId),
          record,
        );
      }
    }

    const imported: string[] = [];
    const workItemsByReference = new Map<string, WorkItem>();
    for (const decision of plan.decisions) {
      if (decision.disposition !== "migrate") continue;
      const sourceReference = cutoverSourceReference(
        decision.dataSourceId,
        decision.pageId,
      );
      const source = titles.get(sourceReference);
      if (source === undefined) {
        throw new Error(
          `Source drift: ${sourceReference} is no longer present in its legacy source.`,
        );
      }
      const workItem = await this.options.gateway.importMigratedWorkItem({
        actorId: this.options.actorId,
        workspaceId: this.options.workspaceId,
        sourceReference,
        intent: source.title,
        lifecycle: decision.lifecycle as MigrationLifecycle,
        workstream: decision.workstream,
        accountableExecutive: decision.accountableExecutive,
        legacyStatus: source.legacyStatus,
        commitmentProvenance: decision.commitmentProvenance,
        approvalReference: approval.approvalId,
      });
      imported.push(sourceReference);
      workItemsByReference.set(sourceReference, workItem);
    }

    const archiveOnly = plan.decisions
      .filter((decision) => decision.disposition === "archive-only")
      .map((decision) =>
        cutoverSourceReference(decision.dataSourceId, decision.pageId),
      );

    const report: CutoverPhaseAReport = {
      planVersion: bindings.planVersion,
      approvalId: approval.approvalId,
      sources,
      imported,
      archiveOnly,
      lifecycleCounts: bindings.lifecycleCounts,
      routingCounts: bindings.routingCounts,
      samples: this.#samples(workItemsByReference),
      legacySourcesMutated: false,
    };

    this.#verifyImport(imported, workItemsByReference);
    await this.#verifyProjection(planned);
    this.#phaseAVerified = true;
    return report;
  }

  async executePhaseB(): Promise<CutoverPhaseBReport> {
    if (!this.#phaseAVerified) {
      throw new Error(
        "Phase A must import and verify the approved records before Phase B switches daily use.",
      );
    }
    const { bindings } = this.options.plan;

    const views: CutoverLinkedView[] = [];
    for (const spec of legacyLinkedViewSpecs) {
      const view = await this.options.workspace.ensureLinkedView({
        name: spec.name,
        dataSourceId: bindings.dataSourceId,
        workstreams: spec.workstreams,
      });
      if (view.dataSourceId !== bindings.dataSourceId) {
        throw new Error(
          `Linked view ${spec.name} does not read the bound Master Tasks data source.`,
        );
      }
      views.push(view);
    }

    const sampleEdits: CutoverSampleEdit[] = [];
    for (const spec of legacyLinkedViewSpecs) {
      const edit = await this.#editSampleThroughView(spec);
      if (edit !== undefined) sampleEdits.push(edit);
    }

    // Retiring the five legacy writers is one commit point. Probe them all
    // first so a single refusal leaves every legacy database writable rather
    // than stranding daily use across two half-retired systems.
    for (const source of bindings.sources) {
      await this.options.workspace
        .verifyRetirable(source.dataSourceId)
        .catch((error: unknown) => {
          throw new Error(
            `The cutover stopped before retirement: ${source.dataSourceId} cannot be retired (${
              error instanceof Error ? error.message : "unknown failure"
            }). No legacy source was changed.`,
          );
        });
    }

    for (const source of bindings.sources) {
      const snapshotName =
        this.#sourceNames.get(source.dataSourceId) ?? source.dataSourceId;
      const retirement = await this.options.workspace
        .retireLegacySource({
          dataSourceId: source.dataSourceId,
          archivedName: `${bindings.archivePrefix} ${snapshotName}`,
        })
        .catch((error: unknown) => {
          throw new Error(
            `The cutover stopped while retiring ${source.dataSourceId} (${
              error instanceof Error ? error.message : "unknown failure"
            }). ${this.#retirements.length} legacy sources are already retired.`,
          );
        });
      if (!retirement.locked) {
        throw new Error(
          `The cutover stopped while retiring ${source.dataSourceId}: it is not locked against editing.`,
        );
      }
      this.#retirements.push(retirement);
    }

    const writableTaskSystems = await this.options.workspace.writableTaskSystems();
    if (
      writableTaskSystems.length !== 1 ||
      writableTaskSystems[0] !== bindings.dataSourceId
    ) {
      throw new Error(
        "The cutover left more than one writable task system in place.",
      );
    }

    return {
      views,
      sampleEdits,
      retirements: [...this.#retirements],
      writableTaskSystems,
      completedAt: (this.options.now ?? (() => new Date().toISOString()))(),
    };
  }

  retirements(): readonly CutoverRetirement[] {
    return [...this.#retirements];
  }

  recovery(): CutoverRecovery {
    return this.#retirements.length > 0
      ? {
          stage: "after-commit-point",
          backupSha256: this.options.plan.bindings.backupSha256,
          quarantinePrefix: cutoverSourceReferencePrefix,
          bidirectionalSynchronization: false,
          instruction:
            "The commit point is behind you. Unlock and restore all five legacy databases together, then quarantine every Master Tasks record carrying the migration source-reference prefix. Never enable both systems as writable sources.",
        }
      : {
          stage: "before-commit-point",
          backupSha256: this.options.plan.bindings.backupSha256,
          quarantinePrefix: cutoverSourceReferencePrefix,
          bidirectionalSynchronization: false,
          instruction:
            "Stop. The five legacy databases remain the daily system and imported Master Tasks records can be quarantined by their migration source-reference prefix.",
        };
  }

  readonly #sourceNames = new Map<string, string>();

  #verifySnapshots(
    snapshots: readonly CutoverSourceSnapshot[],
  ): readonly CutoverSourceReport[] {
    const { bindings, decisions } = this.options.plan;
    const byId = new Map(
      snapshots.map((snapshot) => [snapshot.dataSourceId, snapshot]),
    );
    if (byId.size !== snapshots.length) {
      throw new Error("Source drift: a legacy data source was read twice.");
    }
    if (snapshots.length !== bindings.sources.length) {
      throw new Error(
        `Source drift: ${snapshots.length} legacy sources were read but ${bindings.sources.length} are bound.`,
      );
    }

    const expectedHashes = new Map(
      decisions.map((decision) => [
        cutoverSourceReference(decision.dataSourceId, decision.pageId),
        decision.payloadHash,
      ]),
    );

    return bindings.sources.map((source) => {
      const snapshot = byId.get(source.dataSourceId);
      if (snapshot === undefined) {
        throw new Error(
          `Source drift: bound source ${source.dataSourceId} was not returned.`,
        );
      }
      if (snapshot.records.length !== source.recordCount) {
        throw new Error(
          `Source drift: ${source.dataSourceId} returned ${snapshot.records.length} records but binds ${source.recordCount}.`,
        );
      }
      for (const record of snapshot.records) {
        const reference = cutoverSourceReference(
          source.dataSourceId,
          record.pageId,
        );
        const expected = expectedHashes.get(reference);
        if (expected === undefined) {
          throw new Error(
            `Source drift: ${reference} was not part of the reviewed snapshot.`,
          );
        }
        if (expected !== record.payloadHash) {
          throw new Error(
            `Source drift: the payload of ${reference} changed since the CEO reviewed it.`,
          );
        }
      }
      this.#sourceNames.set(source.dataSourceId, snapshot.name);
      return {
        dataSourceId: source.dataSourceId,
        parentDatabaseId: snapshot.parentDatabaseId,
        recordCount: snapshot.records.length,
      };
    });
  }

  #samples(
    workItemsByReference: ReadonlyMap<string, WorkItem>,
  ): readonly CutoverSample[] {
    const samples: CutoverSample[] = [];
    for (const routing of this.options.plan.bindings.routingCounts) {
      const found = [...workItemsByReference.entries()].find(
        ([, workItem]) => workItem.workstream === routing.workstream,
      );
      if (found === undefined) {
        throw new Error(
          `Post-cutover verification failed: no imported record samples ${routing.workstream}.`,
        );
      }
      samples.push({
        workstream: routing.workstream,
        sourceReference: found[0],
        workItemId: found[1].id,
      });
    }
    return samples;
  }

  #verifyImport(
    imported: readonly string[],
    workItemsByReference: ReadonlyMap<string, WorkItem>,
  ): void {
    const { bindings } = this.options.plan;
    if (imported.length !== bindings.canonicalImportCount) {
      throw new Error(
        `Post-cutover verification failed: ${imported.length} records were imported but ${bindings.canonicalImportCount} were approved.`,
      );
    }

    const lifecycles = counted(
      [...workItemsByReference.values()],
      (workItem) => workItem.state,
    );
    for (const expected of bindings.lifecycleCounts) {
      if (expected.lifecycle === "Cancelled") continue;
      const actual = lifecycles.get(expected.lifecycle) ?? 0;
      if (actual !== expected.count) {
        throw new Error(
          `Post-cutover verification failed: lifecycle ${expected.lifecycle} holds ${actual} records but ${expected.count} were approved.`,
        );
      }
    }

    const routes = counted([...workItemsByReference.values()], (workItem) =>
      routingKey(
        workItem.workstream ?? "Personal Life",
        workItem.accountableExecutive,
      ),
    );
    for (const expected of bindings.routingCounts) {
      const identity = routingKey(
        expected.workstream,
        expected.accountableExecutive,
      );
      const actual = routes.get(identity) ?? 0;
      if (actual !== expected.count) {
        throw new Error(
          `Post-cutover verification failed: routing ${identity} holds ${actual} records but ${expected.count} were approved.`,
        );
      }
    }
  }

  async #verifyProjection(planned: ReadonlySet<string>): Promise<void> {
    const projected = new Set(
      (await this.options.store.records()).map(
        (record) => record.sourceReference,
      ),
    );
    for (const reference of planned) {
      if (!projected.has(reference)) {
        throw new Error(
          `Post-cutover verification failed: ${reference} is missing from Master Tasks.`,
        );
      }
    }
  }

  async #editSampleThroughView(
    spec: LegacyLinkedViewSpec,
  ): Promise<CutoverSampleEdit | undefined> {
    const records = await this.options.store.records();
    const sample = records.find(
      (record) =>
        record.workstream !== null &&
        spec.workstreams.includes(record.workstream) &&
        record.sourceReference.startsWith(cutoverSourceReferencePrefix),
    );
    if (sample === undefined) return undefined;

    const before = this.options.state.workItem(sample.workItemId);
    if (before === undefined) {
      throw new Error(
        `Linked view ${spec.name} shows a record with no canonical Work Item.`,
      );
    }
    const restoredPriority = before.priority;

    await this.options.store.upsert({
      ...sample,
      priority: sampleEditPriority,
    });
    await this.options.projection.reconcileFromStore(this.options.gateway);

    const observed = this.options.state.workItem(sample.workItemId);
    if (observed?.priority !== sampleEditPriority) {
      throw new Error(
        `An edit through linked view ${spec.name} did not reach the canonical Work Item.`,
      );
    }

    await this.options.gateway.recordWorkItemPriority({
      workItemId: sample.workItemId,
      priority: restoredPriority,
      idempotencyKey: `${sample.sourceReference}:sample-restore:${spec.name}`,
    });

    return {
      viewName: spec.name,
      workItemId: sample.workItemId,
      observedPriority: sampleEditPriority,
      restoredPriority,
    };
  }
}
