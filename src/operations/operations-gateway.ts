import type {
  CeoReviewRequest,
  ControlledWorker,
  CeoCommand,
  CeoCommandResult,
  CommandClassifier,
  EffectVerifier,
  NormalizedCeoAction,
  OperationsResult,
  QuestionResponder,
  RecordWorkItemCommitmentRequest,
  WorkItem,
  WorkItemAcknowledgement,
  WorkItemState,
  WorkerEffect,
} from "./contracts.js";
import { OperationsState } from "./operations-state.js";
import { isCeoActor } from "./actor-identity.js";
import { routeAccountableExecutive } from "./executive-role-router.js";
import { lifecyclePathTo } from "./work-item-lifecycle.js";

const reviewTargetStates = {
  complete: "Completed",
  "request-changes": "Changes Requested",
  cancel: "Cancelled",
} as const satisfies Readonly<
  Record<CeoReviewRequest["decision"], WorkItemState>
>;

export interface OperationsGateway {
  acknowledgeCeoAction(
    action: NormalizedCeoAction,
  ): Promise<WorkItemAcknowledgement>;
  executeWorkItem(workItemId: string): Promise<OperationsResult>;
  recordWorkItemCommitment(
    request: RecordWorkItemCommitmentRequest,
  ): Promise<WorkItem>;
  reviewWorkItem(request: CeoReviewRequest): Promise<WorkItem>;
  stageWorkItemForApproval(workItemId: string): Promise<WorkItem>;
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

  const requireWorkItem = (workItemId: string): WorkItem => {
    const workItem = options.state.workItem(workItemId);
    if (workItem === undefined) {
      throw new Error("The Work Item does not exist.");
    }
    return workItem;
  };

  const advanceWorkItem = (
    workItem: WorkItem,
    target: Exclude<WorkItemState, "Ready for CEO Review">,
    rejectionReason: string,
  ): WorkItem => {
    const path = lifecyclePathTo(workItem.state, target);
    if (path === undefined) {
      options.state.recordRejectedTransition(
        workItem.id,
        { from: workItem.state, to: target, reason: rejectionReason },
        now(),
      );
      throw new Error(
        `Work Item transition ${workItem.state} -> ${target} is not allowed.`,
      );
    }

    let current = workItem;
    for (const next of path) {
      current = options.state.transition(
        current.id,
        next as Exclude<WorkItemState, "Ready for CEO Review">,
        now(),
      );
    }
    return current;
  };

  const blockAfterWorkerFailure = (
    workItemId: string,
    reason: "collaborator-execution-failed" | "worker-execution-failed",
    message: string,
  ): never => {
    options.state.recordWorkerFailure(workItemId, now());
    options.state.transition(workItemId, "Waiting/Blocked", now(), { reason });
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
    const storedWorkItem = requireWorkItem(workItemId);

    const existingOutcome = options.state.outcomeReport(workItemId);
    if (existingOutcome !== undefined) {
      if (
        storedWorkItem.state === "Ready for CEO Review" ||
        storedWorkItem.state === "Completed"
      ) {
        return { workItem: storedWorkItem, outcomeReport: existingOutcome };
      }

      options.state.recordRejectedTransition(
        workItemId,
        {
          from: storedWorkItem.state,
          to: "Executing",
          reason: "recorded-outcome-cannot-be-replaced",
        },
        now(),
      );
      throw new Error(
        "Work with a recorded Outcome Report cannot execute again.",
      );
    }

    if (storedWorkItem.state === "Awaiting Approval") {
      options.state.recordRejectedTransition(
        workItemId,
        {
          from: storedWorkItem.state,
          to: "Executing",
          reason: "approval-required",
        },
        now(),
      );
      throw new Error(
        "Awaiting Approval Work cannot execute without an Approval.",
      );
    }

    let workItem = advanceWorkItem(
      storedWorkItem,
      "Executing",
      "execution-not-permitted",
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

    workItem = options.state.transition(workItem.id, "Verifying", now());
    let verifierResult;
    try {
      verifierResult = await options.verifier.verify(
        receipt,
        workItem.expectedEffect,
      );
    } catch {
      options.state.recordVerificationFailure(workItem.id, now());
      options.state.transition(workItem.id, "Waiting/Blocked", now(), {
        reason: "effect-verification-failed",
      });
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

  const stageWorkItemForApproval: OperationsGateway["stageWorkItemForApproval"] =
    async (workItemId) =>
      advanceWorkItem(
        requireWorkItem(workItemId),
        "Awaiting Approval",
        "approval-staging-not-permitted",
      );

  const reviewWorkItem: OperationsGateway["reviewWorkItem"] = async (
    request,
  ) => {
    const workItem = requireWorkItem(request.workItemId);
    const target = reviewTargetStates[request.decision];
    const rejectReview = (reason: string, message: string): never => {
      options.state.recordRejectedTransition(
        workItem.id,
        {
          actorId: request.actorId,
          from: workItem.state,
          to: target,
          reason,
        },
        now(),
      );
      throw new Error(message);
    };

    if (!isCeoActor(request.actorId)) {
      return rejectReview(
        "ceo-review-required",
        "Only the CEO may review a Work Item outcome.",
      );
    }

    if (request.decision === "complete") {
      const outcomeReport = options.state.outcomeReport(workItem.id);
      if (
        workItem.state !== "Ready for CEO Review" ||
        outcomeReport === undefined ||
        outcomeReport.verification.status !== "verified"
      ) {
        return rejectReview(
          "review-ready-outcome-required",
          "Completion requires verified Review-Ready Work with an Outcome Report.",
        );
      }

      return options.state.transition(workItem.id, target, now(), {
        actorId: request.actorId,
        from: workItem.state,
      });
    }

    if (workItem.state !== "Ready for CEO Review") {
      return rejectReview(
        "review-ready-work-required",
        "Only Review-Ready Work can be changed or cancelled by the CEO.",
      );
    }

    return options.state.transition(workItem.id, target, now(), {
      actorId: request.actorId,
      from: workItem.state,
      reason: request.reason,
    });
  };

  const recordWorkItemCommitment: OperationsGateway["recordWorkItemCommitment"] =
    async (request) => {
      const workItem = requireWorkItem(request.workItemId);
      const actor = request.actor;

      if (actor.kind === "Executive Role") {
        return options.state.recordCommitment(
          workItem.id,
          {
            kind: "Proposed Commitment",
            value: request.value,
            provenance: {
              proposedBy: actor.executive,
              proposedAt: now(),
            },
          },
          now(),
        );
      }

      if (actor.kind === "External Source") {
        if (workItem.confirmedCommitment?.kind === "CEO-set") {
          options.state.recordRejectedCommitment(
            workItem.id,
            {
              kind: "Externally Sourced",
              reason: "ceo-set-commitment-immutable",
            },
            now(),
          );
          throw new Error(
            "A CEO-set commitment can only be changed by the CEO.",
          );
        }

        return options.state.recordCommitment(
          workItem.id,
          {
            kind: "Externally Sourced",
            value: request.value,
            provenance: {
              sourceIdentity: actor.sourceIdentity,
              sourceReference: actor.sourceReference,
              asOf: actor.asOf,
              recordedAt: now(),
            },
          },
          now(),
        );
      }

      if (!isCeoActor(actor.actorId)) {
        options.state.recordRejectedCommitment(
          workItem.id,
          { kind: "CEO-set", reason: "ceo-actor-required" },
          now(),
        );
        throw new Error("Only the CEO may set a CEO commitment.");
      }

      return options.state.recordCommitment(
        workItem.id,
        {
          kind: "CEO-set",
          value: request.value,
          provenance: {
            actorId: actor.actorId,
            recordedAt: now(),
          },
        },
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
    recordWorkItemCommitment,
    reviewWorkItem,
    stageWorkItemForApproval,
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
