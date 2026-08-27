import type {
  ControlledWorker,
  EffectVerifier,
  NormalizedCeoAction,
  OperationsResult,
  WorkerEffect,
} from "./contracts.js";
import { OperationsState } from "./operations-state.js";

export interface OperationsGateway {
  submitCeoAction(action: NormalizedCeoAction): Promise<OperationsResult>;
}

export function createOperationsGateway(options: {
  readonly state: OperationsState;
  readonly worker: ControlledWorker;
  readonly verifier: EffectVerifier;
  readonly now?: () => string;
}): OperationsGateway {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async submitCeoAction(
      action: NormalizedCeoAction,
    ): Promise<OperationsResult> {
      const existing = options.state.findWorkItemByCommand(
        action.workspaceId,
        action.idempotencyKey,
      );

      if (existing !== undefined) {
        const outcomeReport = options.state.outcomeReport(existing.id);
        if (outcomeReport === undefined) {
          throw new Error(
            "The idempotent Work Item exists but is not yet reviewable.",
          );
        }
        return { workItem: existing, outcomeReport };
      }

      let workItem = options.state.createWorkItem(action, now());
      workItem = options.state.transition(
        workItem.id,
        "Executing",
        "work-item.executing",
        now(),
      );

      const effect: WorkerEffect = {
        idempotencyKey: `${action.workspaceId}:${action.idempotencyKey}:effect`,
        kind: action.expectedEffect.kind,
        value: action.expectedEffect.value,
      };
      let receipt;
      try {
        receipt = await options.worker.execute(effect);
      } catch {
        options.state.recordWorkerFailure(workItem.id, now());
        options.state.transition(
          workItem.id,
          "Waiting/Blocked",
          "work-item.waiting-blocked",
          now(),
          { reason: "worker-execution-failed" },
        );
        throw new Error("Controlled work failed before verification.");
      }
      options.state.recordWorkerEffect(workItem.id, receipt, now());

      workItem = options.state.transition(
        workItem.id,
        "Verifying",
        "work-item.verifying",
        now(),
      );
      let verifierResult;
      try {
        verifierResult = await options.verifier.verify(
          receipt,
          workItem.expectedEffect,
        );
      } catch {
        options.state.recordVerificationFailure(workItem.id, now());
        options.state.transition(
          workItem.id,
          "Waiting/Blocked",
          "work-item.waiting-blocked",
          now(),
          { reason: "effect-verification-failed" },
        );
        throw new Error("Controlled work could not be verified.");
      }
      const verification = {
        status: verifierResult.status,
        evidence: {
          kind: "controlled-effect-reference",
          reference: receipt.effect.idempotencyKey,
        },
      } as const;
      options.state.recordVerification(workItem.id, verification, now());

      return options.state.recordReviewReadyOutcome(
        workItem,
        receipt,
        verification,
        now(),
      );
    },
  };
}
