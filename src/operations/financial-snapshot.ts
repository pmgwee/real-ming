import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { OperationsGateway } from "./operations-gateway.js";
import type { WorkItem } from "./contracts.js";

export const financialSnapshotEffectKind = "financial-snapshot";

export type FinancialSnapshotState =
  | "prepared"
  | "validated"
  | "approved"
  | "superseded";

export interface FinancialSnapshot {
  readonly id: string;
  readonly period: string;
  readonly version: number;
  readonly digest: string;
  /** Kept verbatim. A successor never edits this; it is the preserved record. */
  readonly workbook: string;
  readonly sourceExports: readonly string[];
  readonly reconciliationReference: string;
  readonly preparedBy: "CTO";
  readonly validatedBy: "Personal CFO" | null;
  readonly approvalId: string | null;
  readonly supersedes: string | null;
  readonly state: FinancialSnapshotState;
  readonly createdAt: string;
}

export interface PrepareFinancialSnapshotRequest {
  readonly period: string;
  readonly workbook: string;
  readonly sourceExports: readonly string[];
  readonly reconciliationReference: string;
  readonly supersedes?: string;
}

export type PrepareFinancialSnapshotResult =
  | { readonly kind: "prepared"; readonly snapshot: FinancialSnapshot }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-predecessor" | "predecessor-already-superseded";
    };

export type ValidateFinancialSnapshotResult =
  | { readonly kind: "validated"; readonly snapshot: FinancialSnapshot }
  | {
      readonly kind: "refused";
      readonly reason:
        | "unknown-snapshot"
        | "reconciliation-mismatch"
        | "invalid-state";
    };

export type PresentFinancialSnapshotResult =
  | {
      readonly kind: "approval-required";
      readonly approvalId: string;
      readonly workItemId: string;
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "unknown-snapshot"
        | "not-validated-by-personal-cfo"
        | "invalid-state";
    };

export type CompleteFinancialSnapshotResult =
  | {
      readonly kind: "approved";
      readonly snapshot: FinancialSnapshot;
      readonly workItem: WorkItem;
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "unknown-snapshot"
        | "approval-not-granted"
        | "invalid-state";
    };

export interface FinancialSnapshotLedger {
  prepare(
    request: PrepareFinancialSnapshotRequest,
  ): PrepareFinancialSnapshotResult;
  validate(request: {
    readonly snapshotId: string;
    readonly reconciliationReference: string;
  }): ValidateFinancialSnapshotResult;
  present(snapshotId: string): Promise<PresentFinancialSnapshotResult>;
  complete(snapshotId: string): Promise<CompleteFinancialSnapshotResult>;
  snapshot(id: string): FinancialSnapshot | undefined;
  snapshots(): readonly FinancialSnapshot[];
  close(): void;
}

interface FinancialSnapshotRow {
  readonly id: string;
  readonly period: string;
  readonly version: number;
  readonly digest: string;
  readonly workbook: string;
  readonly source_exports_json: string;
  readonly reconciliation_reference: string;
  readonly prepared_by: "CTO";
  readonly validated_by: "Personal CFO" | null;
  readonly approval_id: string | null;
  readonly supersedes: string | null;
  readonly state: FinancialSnapshotState;
  readonly created_at: string;
  readonly work_item_id: string | null;
}

function mapFinancialSnapshot(row: FinancialSnapshotRow): FinancialSnapshot {
  return {
    id: row.id,
    period: row.period,
    version: row.version,
    digest: row.digest,
    workbook: row.workbook,
    sourceExports: JSON.parse(row.source_exports_json) as readonly string[],
    reconciliationReference: row.reconciliation_reference,
    preparedBy: row.prepared_by,
    validatedBy: row.validated_by,
    approvalId: row.approval_id,
    supersedes: row.supersedes,
    state: row.state,
    createdAt: row.created_at,
  };
}

function digestOf(workbook: string, period: string, version: number): string {
  return `sha256:${createHash("sha256")
    .update(`${period}|${version}|${workbook}`)
    .digest("hex")}`;
}

export function createFinancialSnapshotLedger(options: {
  readonly gateway: OperationsGateway;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly statePath: string;
  readonly now: () => string;
  /** Controlled failure seam used only through the Real-Ming System Harness. */
  readonly beforeSuccessorInsert?: () => void;
}): FinancialSnapshotLedger {
  const database = new DatabaseSync(options.statePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS financial_snapshots (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      version INTEGER NOT NULL,
      digest TEXT NOT NULL,
      workbook TEXT NOT NULL,
      source_exports_json TEXT NOT NULL,
      reconciliation_reference TEXT NOT NULL,
      prepared_by TEXT NOT NULL,
      validated_by TEXT,
      approval_id TEXT,
      supersedes TEXT,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      work_item_id TEXT
    );

    CREATE TRIGGER IF NOT EXISTS financial_snapshots_reject_delete
    BEFORE DELETE ON financial_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'financial snapshots are retained indefinitely');
    END;

    CREATE TRIGGER IF NOT EXISTS financial_snapshots_preserve_artifact
    BEFORE UPDATE ON financial_snapshots
    WHEN NEW.id != OLD.id
      OR NEW.period != OLD.period
      OR NEW.version != OLD.version
      OR NEW.digest != OLD.digest
      OR NEW.workbook != OLD.workbook
      OR NEW.source_exports_json != OLD.source_exports_json
      OR NEW.reconciliation_reference != OLD.reconciliation_reference
      OR NEW.prepared_by != OLD.prepared_by
      OR COALESCE(NEW.supersedes, '') != COALESCE(OLD.supersedes, '')
      OR NEW.created_at != OLD.created_at
    BEGIN
      SELECT RAISE(ABORT, 'financial snapshot artifacts are immutable');
    END;
  `);

  const put = (snapshot: FinancialSnapshot): FinancialSnapshot => {
    database.prepare(`
      INSERT INTO financial_snapshots (
        id, period, version, digest, workbook, source_exports_json,
        reconciliation_reference, prepared_by, validated_by, approval_id,
        supersedes, state, created_at, work_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        validated_by = excluded.validated_by,
        approval_id = excluded.approval_id,
        state = excluded.state
    `).run(
      snapshot.id,
      snapshot.period,
      snapshot.version,
      snapshot.digest,
      snapshot.workbook,
      JSON.stringify(snapshot.sourceExports),
      snapshot.reconciliationReference,
      snapshot.preparedBy,
      snapshot.validatedBy,
      snapshot.approvalId,
      snapshot.supersedes,
      snapshot.state,
      snapshot.createdAt,
    );
    return snapshot;
  };

  const snapshotById = (id: string): FinancialSnapshot | undefined => {
    const row = database
      .prepare("SELECT * FROM financial_snapshots WHERE id = ?")
      .get(id) as unknown as FinancialSnapshotRow | undefined;
    return row === undefined ? undefined : mapFinancialSnapshot(row);
  };

  const workItemForSnapshot = (id: string): string | undefined => {
    const row = database
      .prepare("SELECT work_item_id FROM financial_snapshots WHERE id = ?")
      .get(id) as unknown as { readonly work_item_id: string | null } | undefined;
    return row?.work_item_id ?? undefined;
  };

  return {
    prepare(request): PrepareFinancialSnapshotResult {
      let version = 1;
      let predecessor: FinancialSnapshot | undefined;
      if (request.supersedes !== undefined) {
        predecessor = snapshotById(request.supersedes);
        if (predecessor === undefined) {
          return { kind: "refused", reason: "unknown-predecessor" };
        }
        if (predecessor.state === "superseded") {
          return { kind: "refused", reason: "predecessor-already-superseded" };
        }
        version = predecessor.version + 1;
      }

      const snapshot: FinancialSnapshot = {
        id: randomUUID(),
        period: request.period,
        version,
        digest: digestOf(request.workbook, request.period, version),
        workbook: request.workbook,
        sourceExports: request.sourceExports,
        reconciliationReference: request.reconciliationReference,
        // Preparation is technical work. It never asserts that the numbers
        // mean what they should; that is the Personal CFO's separate step.
        preparedBy: "CTO",
        validatedBy: null,
        approvalId: null,
        supersedes: request.supersedes ?? null,
        state: "prepared",
        createdAt: options.now(),
      };

      if (predecessor === undefined) {
        put(snapshot);
      } else {
        database.exec("BEGIN IMMEDIATE;");
        try {
          // The predecessor transition and the successor artifact are one
          // durable fact. A failure between them must leave neither visible.
          put({ ...predecessor, state: "superseded" });
          options.beforeSuccessorInsert?.();
          put(snapshot);
          database.exec("COMMIT;");
        } catch (error) {
          database.exec("ROLLBACK;");
          throw error;
        }
      }

      return {
        kind: "prepared",
        snapshot,
      };
    },

    validate(request): ValidateFinancialSnapshotResult {
      const snapshot = snapshotById(request.snapshotId);
      if (snapshot === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
      }
      if (snapshot.state !== "prepared") {
        return { kind: "refused", reason: "invalid-state" };
      }
      if (
        snapshot.reconciliationReference !== request.reconciliationReference
      ) {
        return { kind: "refused", reason: "reconciliation-mismatch" };
      }
      return {
        kind: "validated",
        snapshot: put({
          ...snapshot,
          validatedBy: "Personal CFO",
          state: "validated",
        }),
      };
    },

    async present(snapshotId): Promise<PresentFinancialSnapshotResult> {
      const snapshot = snapshotById(snapshotId);
      if (snapshot === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
      }
      // Technical preparation is not validation. Presenting an unvalidated
      // workbook would ask the CEO to approve numbers nobody has checked.
      if (snapshot.state === "prepared" && snapshot.validatedBy === null) {
        return { kind: "refused", reason: "not-validated-by-personal-cfo" };
      }
      if (snapshot.state !== "validated") {
        return { kind: "refused", reason: "invalid-state" };
      }

      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey: `financial-snapshot:${snapshot.id}`,
        intent: `Approve Financial Snapshot ${snapshot.period} v${snapshot.version}`,
        expectedEffect: {
          kind: financialSnapshotEffectKind,
          value: [
            `period=${snapshot.period}`,
            `version=${snapshot.version}`,
            `digest=${snapshot.digest}`,
            `exports=${snapshot.sourceExports.join(", ")}`,
            `reconciliation=${snapshot.reconciliationReference}`,
            `validatedBy=${snapshot.validatedBy}`,
            `supersedes=${snapshot.supersedes ?? "none"}`,
          ].join("; "),
        },
        workstream: "Finance",
      });
      database
        .prepare("UPDATE financial_snapshots SET work_item_id = ? WHERE id = ?")
        .run(acknowledgement.workItem.id, snapshot.id);

      const decision = await options.gateway.requestAction({
        workItemId: acknowledgement.workItem.id,
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "financial-record-change",
        // Bound to this exact successor. A later version has a different
        // digest, so an Approval granted here cannot travel to it.
        target: {
          type: "financial-snapshot",
          identity: snapshot.id,
          version: snapshot.digest,
        },
      });
      if (decision.kind !== "approval-required") {
        return { kind: "refused", reason: "not-validated-by-personal-cfo" };
      }
      put({ ...snapshot, approvalId: decision.approvalId });
      return {
        kind: "approval-required",
        approvalId: decision.approvalId,
        workItemId: acknowledgement.workItem.id,
      };
    },

    async complete(snapshotId): Promise<CompleteFinancialSnapshotResult> {
      const snapshot = snapshotById(snapshotId);
      const workItemId = workItemForSnapshot(snapshotId);
      if (snapshot === undefined || workItemId === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
      }
      if (snapshot.state !== "validated" || snapshot.approvalId === null) {
        return { kind: "refused", reason: "invalid-state" };
      }
      const decision = await options.gateway.requestAction({
        workItemId,
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "financial-record-change",
        target: {
          type: "financial-snapshot",
          identity: snapshot.id,
          version: snapshot.digest,
        },
      });
      if (decision.kind !== "permitted") {
        return { kind: "refused", reason: "approval-not-granted" };
      }
      const executed = await options.gateway.executeWorkItem(workItemId);
      return {
        kind: "approved",
        snapshot: put({ ...snapshot, state: "approved" }),
        workItem: executed.workItem,
      };
    },

    snapshot: snapshotById,
    snapshots: () => {
      const rows = database
        .prepare("SELECT * FROM financial_snapshots ORDER BY created_at, id")
        .all() as unknown as readonly FinancialSnapshotRow[];
      return rows.map(mapFinancialSnapshot);
    },
    close: () => database.close(),
  };
}
