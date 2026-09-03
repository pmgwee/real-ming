import type { OperationsGateway } from "./operations-gateway.js";
import type { OperationsState } from "./operations-state.js";
import type { WorkItem } from "./contracts.js";
import { detectSensitiveFields } from "./sensitive-secret.js";
import type {
  DuitSiniAdapter,
  DuitSiniRecord,
} from "../providers/duitsini-adapter.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";

export const financialRecordChangeEffectKind = "duitsini-record-change";

export interface FinancialRecordChangeRequest {
  readonly recordId: string;
  readonly reason: string;
  readonly label?: string;
  readonly renewalSchedule?: string;
  readonly paymentMethodLabel?: string;
}

export type FinancialRecordChangeResult =
  | {
      readonly kind: "changed";
      readonly workItem: WorkItem;
      readonly verifiedRecord: DuitSiniRecord;
      readonly effectReference: string;
      readonly deduplicated: boolean;
    }
  | {
      readonly kind: "approval-required";
      readonly approvalId: string;
      readonly workItemId: string;
    }
  | {
      readonly kind: "verification-failed";
      readonly reason: "read-back-mismatch";
      readonly workItemId: string;
    }
  | { readonly kind: "failed"; readonly failure: ProviderFailure }
  | {
      readonly kind: "denied";
      readonly reason: "record-not-found" | "unbounded-change" | "sensitive-change";
    };

export interface FinancialRecordChangeCoordinator {
  readRecord(id: string): ReturnType<DuitSiniAdapter["readRecord"]>;
  change(
    request: FinancialRecordChangeRequest,
  ): Promise<FinancialRecordChangeResult>;
}

export function createFinancialRecordChangeCoordinator(options: {
  readonly adapter: DuitSiniAdapter;
  readonly gateway: OperationsGateway;
  readonly state: OperationsState;
  readonly actorId: string;
  readonly workspaceId: string;
}): FinancialRecordChangeCoordinator {
  return {
    readRecord: (id) => options.adapter.readRecord({ id }),

    async change(request): Promise<FinancialRecordChangeResult> {
      const reason = request.reason.replace(/\s+/gu, " ").trim();
      const fields = {
        ...(request.label === undefined ? {} : { label: request.label }),
        ...(request.renewalSchedule === undefined
          ? {}
          : { renewalSchedule: request.renewalSchedule }),
        ...(request.paymentMethodLabel === undefined
          ? {}
          : { paymentMethodLabel: request.paymentMethodLabel }),
      };
      if (reason.length === 0 || reason.length > 240 || Object.keys(fields).length === 0) {
        return { kind: "denied", reason: "unbounded-change" };
      }
      // A payment-method LABEL is metadata; an account or card number is not.
      // The generic heuristic only catches 13-19 digit runs, so a ten-digit
      // bank account number would slip through and reach the Approval target,
      // the audit log and the Outcome Report. A label needs no long digit run
      // at all: "Visa ending 4242" is four.
      if (
        detectSensitiveFields({ reason, ...fields }).length > 0 ||
        Object.values(fields).some((value) =>
          /(?:\d[ -]?){7,}/u.test(value),
        )
      ) {
        return { kind: "denied", reason: "sensitive-change" };
      }

      const before = await options.adapter.readRecord({ id: request.recordId });
      if (before.kind === "failed") {
        return { kind: "denied", reason: "record-not-found" };
      }

      // The Work Item is bound to this exact record and this exact change, so a
      // retry lands on the same item and the Approval cannot be reused for a
      // different edit.
      const changeIdentity = Object.entries(fields)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([field, value]) => `${field}=${value}`)
        .join("&");
      const idempotencyKey = `duitsini-record-change:${request.recordId}:${changeIdentity}`;
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey,
        intent: `Change ${request.recordId}: ${reason}`,
        expectedEffect: {
          kind: financialRecordChangeEffectKind,
          value: `${request.recordId} ${changeIdentity}`,
        },
        workstream: "Finance",
      });
      const workItem = acknowledgement.workItem;

      const decision = await options.gateway.requestAction({
        workItemId: workItem.id,
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "financial-record-change",
        target: {
          type: "duitsini-record",
          identity: request.recordId,
          version: changeIdentity,
        },
      });
      if (decision.kind === "approval-required") {
        return {
          kind: "approval-required",
          approvalId: decision.approvalId,
          workItemId: workItem.id,
        };
      }
      if (decision.kind !== "permitted") {
        return { kind: "denied", reason: "unbounded-change" };
      }

      const written = await options.adapter.changeRecordMetadata({
        id: request.recordId,
        ...fields,
        idempotencyKey,
      });
      if (written.kind === "failed") {
        return { kind: "failed", failure: written.failure };
      }

      // Read back before claiming anything. A write that reported success but
      // did not land is exactly what a financial record must never assert.
      const after = await options.adapter.readRecord({ id: request.recordId });
      if (after.kind === "failed") {
        return {
          kind: "verification-failed",
          reason: "read-back-mismatch",
          workItemId: workItem.id,
        };
      }
      const mismatched = Object.entries(fields).some(
        ([field, value]) =>
          after.value[field as keyof DuitSiniRecord] !== value,
      );
      if (mismatched) {
        return {
          kind: "verification-failed",
          reason: "read-back-mismatch",
          workItemId: workItem.id,
        };
      }

      const executed = await options.gateway.executeWorkItem(workItem.id);
      return {
        kind: "changed",
        workItem: executed.workItem,
        verifiedRecord: after.value,
        effectReference: written.effectReference,
        deduplicated: written.deduplicated,
      };
    },
  };
}
