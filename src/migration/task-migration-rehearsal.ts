import { createHash } from "node:crypto";

import type { ExecutiveRole, WorkItemState, Workstream } from "../operations/contracts.js";
import { workstreamRoutes } from "../operations/executive-role-router.js";

export interface LegacyTaskRecord {
  readonly id: string;
  readonly title: string;
  readonly status?: string | null;
  readonly owner?: string | null;
  readonly commitment?: string | null;
  readonly workstream?: Workstream | null;
  readonly updatedAt: string;
  readonly sourcePayload?: Readonly<Record<string, unknown>>;
}

export const legacyTaskSourceDefinitions = [
  { name: "(IP Content Creation) Task To Do List", workstream: "Content Creation" },
  { name: "(MicroSaaS) Task To Do List", workstream: "MicroSaaS" },
  { name: "(Academic) Task To Do List", workstream: "Academic" },
  { name: "(Job x Life) Task To Do List", workstream: null },
  { name: "(Finance) Task To Do List", workstream: "Finance" },
] as const satisfies readonly { readonly name: string; readonly workstream: Workstream | null }[];

export interface LegacyTaskSource {
  readonly id: string;
  readonly name: string;
  readonly workstream: Workstream | null;
  readonly records: readonly LegacyTaskRecord[];
}

export interface MigrationBackup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceWorkstream: Workstream | null;
  readonly capturedAt: string;
  readonly recordCount: number;
  readonly integrity: `sha256:${string}`;
  readonly records: readonly LegacyTaskRecord[];
}

export interface RehearsalTargetRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceReference: string;
  readonly title: string;
  readonly workstream: Workstream | null;
  readonly accountableExecutive: ExecutiveRole;
  readonly lifecycle: WorkItemState;
  readonly reconciliationRequired: boolean;
  readonly proposedCommitment: string | null;
}

interface ReconciliationItem {
  readonly sourceId: string;
  readonly recordId: string;
}

interface DuplicateItem extends ReconciliationItem {
  readonly matchesSourceId: string;
  readonly matchesRecordId: string;
  readonly candidateKey: string;
}

export interface MigrationReconciliationReport {
  readonly duplicates: readonly DuplicateItem[];
  readonly missingFields: readonly (ReconciliationItem & { readonly field: string })[];
  readonly ambiguousOwnership: readonly (ReconciliationItem & {
    readonly sourceOwner: string;
    readonly proposedExecutive: ExecutiveRole;
  })[];
  readonly ambiguousStatus: readonly (ReconciliationItem & { readonly sourceStatus: string })[];
  readonly ambiguousWorkstream: readonly (ReconciliationItem & { readonly sourceValue: string })[];
  readonly proposedCommitments: readonly (ReconciliationItem & { readonly value: string })[];
}

export interface TaskMigrationRehearsalResult {
  readonly backups: readonly MigrationBackup[];
  readonly targetRecords: readonly RehearsalTargetRecord[];
  readonly report: MigrationReconciliationReport;
}

function cloneRecord(record: LegacyTaskRecord): LegacyTaskRecord {
  return structuredClone(record);
}

function backupIntegrity(backup: Omit<MigrationBackup, "integrity">): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(backup)).digest("hex")}`;
}

function routeFor(
  source: MigrationBackup,
  record: LegacyTaskRecord,
): { readonly workstream: Workstream | null; readonly executive: ExecutiveRole } {
  const workstream = source.sourceWorkstream ?? record.workstream ?? null;
  return workstream === null
    ? { workstream: null, executive: "COO" }
    : { workstream, executive: workstreamRoutes[workstream].executive };
}

export class TaskMigrationRehearsal {
  readonly #target = new Map<string, RehearsalTargetRecord>();

  constructor(
    private readonly sources: readonly LegacyTaskSource[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  captureBackups(): readonly MigrationBackup[] {
    const sourceIds = new Set(this.sources.map(({ id }) => id));
    const exactSources = legacyTaskSourceDefinitions.every((definition) =>
      this.sources.filter((source) =>
        source.name === definition.name && source.workstream === definition.workstream,
      ).length === 1,
    );
    if (this.sources.length !== 5 || sourceIds.size !== 5 || !exactSources) {
      throw new Error("The migration rehearsal requires the five exact, distinct legacy task sources.");
    }
    const capturedAt = this.now();
    return this.sources.map((source) => {
      const records = source.records.map(cloneRecord);
      const backup = {
        sourceId: source.id,
        sourceName: source.name,
        sourceWorkstream: source.workstream,
        capturedAt,
        recordCount: records.length,
        records,
      };
      return { ...backup, integrity: backupIntegrity(backup) };
    });
  }

  importVerifiedBackups(backups: readonly MigrationBackup[]): TaskMigrationRehearsalResult {
    const sourceIds = new Set(backups.map(({ sourceId }) => sourceId));
    const exactSources = legacyTaskSourceDefinitions.every((definition) =>
      backups.filter((backup) =>
        backup.sourceName === definition.name &&
        backup.sourceWorkstream === definition.workstream,
      ).length === 1,
    );
    if (backups.length !== 5 || sourceIds.size !== 5 || !exactSources ||
      backups.some((backup) =>
        backup.recordCount !== backup.records.length ||
        backup.integrity !== backupIntegrity({
          sourceId: backup.sourceId,
          sourceName: backup.sourceName,
          sourceWorkstream: backup.sourceWorkstream,
          capturedAt: backup.capturedAt,
          recordCount: backup.recordCount,
          records: backup.records,
        }))) {
      throw new Error("All five backups must pass count and SHA-256 verification before import.");
    }
    const duplicates: DuplicateItem[] = [];
    const missingFields: Array<ReconciliationItem & { field: string }> = [];
    const ambiguousOwnership: Array<ReconciliationItem & { sourceOwner: string; proposedExecutive: ExecutiveRole }> = [];
    const ambiguousStatus: Array<ReconciliationItem & { sourceStatus: string }> = [];
    const ambiguousWorkstream: Array<ReconciliationItem & { sourceValue: string }> = [];
    const proposedCommitments: Array<ReconciliationItem & { value: string }> = [];
    const firstByCandidateKey = new Map<string, ReconciliationItem>();

    for (const source of backups) {
      const seen = new Set<string>();
      for (const record of source.records) {
        const identity = { sourceId: source.sourceId, recordId: record.id };
        const sourceReference = `${source.sourceId}:${record.id}`;
        if (seen.has(record.id)) {
          duplicates.push({
            ...identity,
            matchesSourceId: source.sourceId,
            matchesRecordId: record.id,
            candidateKey: `source-id:${record.id}`,
          });
          continue;
        }
        seen.add(record.id);
        const candidateKey = record.title.trim().toLowerCase().replace(/\s+/g, " ");
        const possibleMatch = candidateKey === "" ? undefined : firstByCandidateKey.get(candidateKey);
        if (possibleMatch !== undefined) {
          duplicates.push({
            ...identity,
            matchesSourceId: possibleMatch.sourceId,
            matchesRecordId: possibleMatch.recordId,
            candidateKey: `normalized-title:${candidateKey}`,
          });
        } else if (candidateKey !== "") {
          firstByCandidateKey.set(candidateKey, identity);
        }
        if (record.title.trim() === "") missingFields.push({ ...identity, field: "title" });
        const status = record.status?.trim() ?? "";
        const completed = status.toLowerCase() === "done";
        if (!completed) ambiguousStatus.push({ ...identity, sourceStatus: status });
        const route = routeFor(source, record);
        if (source.sourceWorkstream === null && route.workstream === null) {
          ambiguousWorkstream.push({ ...identity, sourceValue: record.workstream ?? "" });
        }
        const owner = record.owner?.trim() ?? "";
        if (owner !== "" && owner !== route.executive) {
          ambiguousOwnership.push({
            ...identity,
            sourceOwner: owner,
            proposedExecutive: route.executive,
          });
        }
        const commitment = record.commitment?.trim() || null;
        if (commitment !== null) proposedCommitments.push({ ...identity, value: commitment });
        this.#target.set(sourceReference, {
          id: `rehearsal:${sourceReference}`,
          sourceId: source.sourceId,
          sourceReference,
          title: record.title,
          workstream: route.workstream,
          accountableExecutive: route.executive,
          lifecycle: completed ? "Completed" : "Captured",
          reconciliationRequired:
            !completed || route.workstream === null || record.title.trim() === "" ||
            (owner !== "" && owner !== route.executive) || commitment !== null,
          proposedCommitment: commitment,
        });
      }
    }
    return {
      backups,
      targetRecords: [...this.#target.values()],
      report: {
        duplicates,
        missingFields,
        ambiguousOwnership,
        ambiguousStatus,
        ambiguousWorkstream,
        proposedCommitments,
      },
    };
  }

  targetCount(): number {
    return this.#target.size;
  }

  rollback(): void {
    this.#target.clear();
  }
}
