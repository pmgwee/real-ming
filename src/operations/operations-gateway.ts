import type {
  ControlledWorker,
  CeoCommand,
  CeoCommandResult,
  CommandClassifier,
  EffectVerifier,
  NormalizedCeoAction,
  OperationsResult,
  QuestionResponder,
  WorkItemAcknowledgement,
  WorkerEffect,
} from "./contracts.js";
import { OperationsState } from "./operations-state.js";
import { routeAccountableExecutive } from "./executive-role-router.js";

export interface OperationsGateway {
  acknowledgeCeoAction(
    action: NormalizedCeoAction,
  ): Promise<WorkItemAcknowledgement>;
  executeWorkItem(workItemId: string): Promise<OperationsResult>;
  submitCeoAction(action: NormalizedCeoAction): Promise<OperationsResult>;
  submitCeoCommand(command: CeoCommand): Promise<CeoCommandResult>;
}

export function createOperationsGateway(options: {
  readonly state: OperationsState;
  readonly worker: ControlledWorker;
  readonly verifier: EffectVerifier;
  readonly questionResponder: QuestionResponder;
  readonly commandClassifier: CommandClassifier;
  readonly now?: () => string;
}): OperationsGateway {
  const now = options.now ?? (() => new Date().toISOString());

  const blockAfterWorkerFailure = (
    workItemId: string,
    reason: "collaborator-execution-failed" | "worker-execution-failed",
    message: string,
  ): never => {
    options.state.recordWorkerFailure(workItemId, now());
    options.state.transition(
      workItemId,
      "Waiting/Blocked",
      "work-item.waiting-blocked",
      now(),
      { reason },
    );
    throw new Error(message);
  };

  const executeControlledEffect = async (
    effect: WorkerEffect,
    failureReason:
      | "collaborator-execution-failed"
      | "worker-execution-failed",
    failureMessage: string,
  ) => {
    try {
      return await options.worker.execute(effect);
    } catch {
      return blockAfterWorkerFailure(
        effect.workItemId,
        failureReason,
        failureMessage,
      );
    }
  };

  const acknowledgeCeoAction: OperationsGateway["acknowledgeCeoAction"] = async (
    action,
  ) => {
    const existing = options.state.findWorkItemByCommand(
      action.workspaceId,
      action.idempotencyKey,
    );

    if (existing !== undefined) {
      return { kind: "work-item-acknowledgement", workItem: existing };
    }

    const routedAction: NormalizedCeoAction = {
      ...action,
      accountableExecutive: routeAccountableExecutive({
        explicitExecutive: action.accountableExecutive,
        workstream: action.workstream,
      }),
    };

    return {
      kind: "work-item-acknowledgement",
      workItem: options.state.createWorkItem(routedAction, now()),
    };
  };

  const executeWorkItem: OperationsGateway["executeWorkItem"] = async (
    workItemId,
  ) => {
    const storedWorkItem = options.state.workItem(workItemId);
    if (storedWorkItem === undefined) {
      throw new Error("The Work Item does not exist.");
    }

    const existingOutcome = options.state.outcomeReport(workItemId);
    if (
      storedWorkItem.state === "Ready for CEO Review" &&
      existingOutcome !== undefined
    ) {
      return { workItem: storedWorkItem, outcomeReport: existingOutcome };
    }

    let workItem = options.state.transition(
      workItemId,
      "Executing",
      "work-item.executing",
      now(),
    );

    for (const assignment of workItem.collaboratingExecutives) {
      const contributionEffect: WorkerEffect = {
        workItemId: workItem.id,
        executive: assignment.executive,
        authority: "contribute-only",
        idempotencyKey: `${workItem.workspaceId}:${workItem.idempotencyKey}:contribution:${assignment.executive}`,
        kind: "executive-contribution",
        value: assignment.contribution,
      };
      const contributionReceipt = await executeControlledEffect(
        contributionEffect,
        "collaborator-execution-failed",
        "Controlled contribution failed before verification.",
      );
      options.state.recordWorkerEffect(
        workItem.id,
        contributionReceipt,
        now(),
      );
    }

    const effect: WorkerEffect = {
      workItemId: workItem.id,
      executive: workItem.accountableExecutive,
      authority: "accountable",
      idempotencyKey: `${workItem.workspaceId}:${workItem.idempotencyKey}:effect`,
      kind: workItem.expectedEffect.kind,
      value: workItem.expectedEffect.value,
    };
    const receipt = await executeControlledEffect(
      effect,
      "worker-execution-failed",
      "Controlled work failed before verification.",
    );
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
  };

  const submitCeoAction: OperationsGateway["submitCeoAction"] = async (
    action,
  ) => {
    const acknowledgement = await acknowledgeCeoAction(action);
    return executeWorkItem(acknowledgement.workItem.id);
  };

  return {
    acknowledgeCeoAction,
    executeWorkItem,
    submitCeoAction,

    async submitCeoCommand(command: CeoCommand): Promise<CeoCommandResult> {
      const classification = options.commandClassifier.classify(command);

      if (classification.kind === "information-question") {
        return {
          kind: "information-answer",
          answer: await options.questionResponder.answer(command),
        };
      }

      if (
        classification.kind === "action" &&
        command.expectedEffect !== undefined
      ) {
        const action: NormalizedCeoAction = {
          actorId: command.actorId,
          workspaceId: command.workspaceId,
          idempotencyKey: command.idempotencyKey,
          intent: command.text,
          expectedEffect: command.expectedEffect,
          workstream: command.workstream ?? null,
          collaboratingExecutives: command.collaboratingExecutives ?? [],
          ...(command.addressedExecutive === undefined
            ? {}
            : { accountableExecutive: command.addressedExecutive }),
        };
        return acknowledgeCeoAction(action);
      }

      return {
        kind: "clarification",
        question:
          "What specific outcome should Real-Ming produce for this request?",
      };
    },
  };
}
