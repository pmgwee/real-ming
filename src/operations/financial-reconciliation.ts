import type { OperationsGateway } from "./operations-gateway.js";
import type { WorkItem } from "./contracts.js";
import { providerStalenessThresholdMs } from "../providers/adapter-contract.js";

export const financialReconciliationEffectKind = "financial-reconciliation";

/**
 * The only shapes this reconciliation accepts. Anything else is reported as
 * unsupported rather than parsed on a guess: a live OpenD feed or a brokerage
 * session is not an export, and treating one as though it were is how an
 * unsupported capability creeps in.
 */
export type FinancialExportKind =
  | "moomoo-holdings"
  | "money-manager-activity"
  | "unsupported";

export interface FinancialExportRow {
  readonly identity: string;
  readonly quantity: string;
  readonly value: string;
  readonly currency: string;
}

export interface FinancialExportSource {
  readonly kind: FinancialExportKind;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly rows: readonly FinancialExportRow[];
}

export interface FinancialSourceReport {
  readonly kind: FinancialExportKind;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly rowCount: number;
  readonly freshness: "current" | "stale";
}

export interface FinancialConflict {
  readonly identity: string;
  readonly field: "value" | "quantity";
  readonly moomoo: string;
  readonly moneyManager: string;
}

export interface FinancialMissingLine {
  readonly identity: string;
  readonly absentFrom: "moomoo-holdings" | "money-manager-activity";
}

/**
 * What the CEO sees: how much agreed, how much did not, and which exports it
 * came from. Never a holding, a quantity or a balance — those stay in the
 * Finance Trust Domain.
 */
export interface FinancialCeoProjection {
  readonly kind: "approved-projection";
  readonly workItemId: string;
  readonly agreedCount: number;
  readonly conflictCount: number;
  readonly missingCount: number;
  readonly unsupportedCount: number;
  readonly evidence: readonly string[];
  readonly asOf: string;
}

export type FinancialReconciliationResult =
  | {
      readonly kind: "reconciled";
      readonly workItem: WorkItem;
      readonly sources: readonly FinancialSourceReport[];
      readonly agreed: readonly FinancialExportRow[];
      readonly conflicts: readonly FinancialConflict[];
      readonly missing: readonly FinancialMissingLine[];
      readonly staleSources: readonly string[];
      readonly unsupported: readonly string[];
      readonly ceoProjection: FinancialCeoProjection;
    }
  | {
      readonly kind: "incomplete";
      readonly reason:
        | "moomoo-holdings-missing"
        | "money-manager-activity-missing";
    };

export interface FinancialReconciliationCoordinator {
  reconcile(): Promise<FinancialReconciliationResult>;
}

function freshnessOf(asOf: string, now: string): "current" | "stale" {
  return Date.parse(now) - Date.parse(asOf) > providerStalenessThresholdMs
    ? "stale"
    : "current";
}

export function createFinancialReconciliationCoordinator(options: {
  readonly sources: readonly FinancialExportSource[];
  readonly gateway: OperationsGateway;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly now: () => string;
}): FinancialReconciliationCoordinator {
  return {
    async reconcile(): Promise<FinancialReconciliationResult> {
      const at = options.now();
      const moomoo = options.sources.find(
        (source) => source.kind === "moomoo-holdings",
      );
      const moneyManager = options.sources.find(
        (source) => source.kind === "money-manager-activity",
      );
      // One side alone is not a reconciliation. Reporting it as one would let a
      // half-read balance look like a complete picture.
      if (moomoo === undefined) {
        return { kind: "incomplete", reason: "moomoo-holdings-missing" };
      }
      if (moneyManager === undefined) {
        return { kind: "incomplete", reason: "money-manager-activity-missing" };
      }

      const sources: FinancialSourceReport[] = options.sources.map((source) => ({
        kind: source.kind,
        sourceReference: source.sourceReference,
        asOf: source.asOf,
        rowCount: source.rows.length,
        freshness: freshnessOf(source.asOf, at),
      }));
      const supported = sources.filter((source) => source.kind !== "unsupported");

      const byIdentity = new Map(
        moneyManager.rows.map((row) => [row.identity, row]),
      );
      const agreed: FinancialExportRow[] = [];
      const conflicts: FinancialConflict[] = [];
      const missing: FinancialMissingLine[] = [];

      for (const row of moomoo.rows) {
        const other = byIdentity.get(row.identity);
        if (other === undefined) {
          missing.push({
            identity: row.identity,
            absentFrom: "money-manager-activity",
          });
          continue;
        }
        byIdentity.delete(row.identity);
        // Disagreement is reported, never averaged or preferred. Only Ming
        // knows which export is right.
        if (other.quantity !== row.quantity) {
          conflicts.push({
            identity: row.identity,
            field: "quantity",
            moomoo: row.quantity,
            moneyManager: other.quantity,
          });
          continue;
        }
        if (other.value !== row.value) {
          conflicts.push({
            identity: row.identity,
            field: "value",
            moomoo: row.value,
            moneyManager: other.value,
          });
          continue;
        }
        agreed.push(row);
      }
      for (const remaining of byIdentity.values()) {
        missing.push({ identity: remaining.identity, absentFrom: "moomoo-holdings" });
      }

      const staleSources = supported
        .filter((source) => source.freshness === "stale")
        .map((source) => source.sourceReference);
      const unsupported = sources
        .filter((source) => source.kind === "unsupported")
        .map((source) => source.sourceReference);

      const evidence = supported.map((source) => source.sourceReference);
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey: `financial-reconciliation:${evidence.join("|")}`,
        intent: "Reconcile Moomoo holdings against Money Manager activity",
        expectedEffect: {
          kind: financialReconciliationEffectKind,
          // Counts and citations only. A holding in the effect would put the
          // Finance Trust Domain into every Outcome Report reader's hands.
          value: `${agreed.length} agreed, ${conflicts.length} conflicting, ${missing.length} missing across ${evidence.join(", ")}`,
        },
        workstream: "Finance",
      });
      const executed = await options.gateway.executeWorkItem(
        acknowledgement.workItem.id,
      );

      return {
        kind: "reconciled",
        workItem: executed.workItem,
        sources,
        agreed,
        conflicts,
        missing,
        staleSources,
        unsupported,
        ceoProjection: {
          kind: "approved-projection",
          workItemId: executed.workItem.id,
          agreedCount: agreed.length,
          conflictCount: conflicts.length,
          missingCount: missing.length,
          unsupportedCount: unsupported.length,
          evidence,
          asOf: at,
        },
      };
    },
  };
}
