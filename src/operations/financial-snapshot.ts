import { createHash, randomUUID } from "node:crypto";

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
      readonly reason: "unknown-snapshot" | "reconciliation-mismatch";
    };

export type PresentFinancialSnapshotResult =
  | {
      readonly kind: "approval-required";
      readonly approvalId: string;
      readonly workItemId: string;
    }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-snapshot" | "not-validated-by-personal-cfo";
    };

export type CompleteFinancialSnapshotResult =
  | {
      readonly kind: "approved";
      readonly snapshot: FinancialSnapshot;
      readonly workItem: WorkItem;
    }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-snapshot" | "approval-not-granted";
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
  readonly now: () => string;
}): FinancialSnapshotLedger {
  const snapshots = new Map<string, FinancialSnapshot>();
  const workItemBySnapshot = new Map<string, string>();

  const put = (snapshot: FinancialSnapshot): FinancialSnapshot => {
    snapshots.set(snapshot.id, snapshot);
    return snapshot;
  };

  return {
    prepare(request): PrepareFinancialSnapshotResult {
      let version = 1;
      if (request.supersedes !== undefined) {
        const predecessor = snapshots.get(request.supersedes);
        if (predecessor === undefined) {
          return { kind: "refused", reason: "unknown-predecessor" };
        }
        if (predecessor.state === "superseded") {
          return { kind: "refused", reason: "predecessor-already-superseded" };
        }
        version = predecessor.version + 1;
        // The predecessor is marked, never edited or removed. A correction
        // produces a new dated version; the workbook it corrects stays readable.
        put({ ...predecessor, state: "superseded" });
      }

      const id = randomUUID();
      return {
        kind: "prepared",
        snapshot: put({
          id,
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
        }),
      };
    },

    validate(request): ValidateFinancialSnapshotResult {
      const snapshot = snapshots.get(request.snapshotId);
      if (snapshot === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
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
      const snapshot = snapshots.get(snapshotId);
      if (snapshot === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
      }
      // Technical preparation is not validation. Presenting an unvalidated
      // workbook would ask the CEO to approve numbers nobody has checked.
      if (snapshot.validatedBy === null) {
        return { kind: "refused", reason: "not-validated-by-personal-cfo" };
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
      workItemBySnapshot.set(snapshot.id, acknowledgement.workItem.id);

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
      const snapshot = snapshots.get(snapshotId);
      const workItemId = workItemBySnapshot.get(snapshotId);
      if (snapshot === undefined || workItemId === undefined) {
        return { kind: "refused", reason: "unknown-snapshot" };
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

    snapshot: (id) => snapshots.get(id),
    snapshots: () => [...snapshots.values()],
  };
}
