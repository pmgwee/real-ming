import type {
  Approval,
  GrantApprovalRequest,
  GrantStandingAuthorityRequest,
  PolicyDecision,
  RequestedAction,
  StandingAuthority,
  CeoReviewRequest,
  ControlledWorker,
  CeoCommand,
  CeoCommandResult,
  CommandClassifier,
  EffectVerifier,
  ImportMigratedWorkItemRequest,
  NormalizedCeoAction,
  OperationsResult,
  QuestionResponder,
  RecordWorkItemCommitmentRequest,
  RecordWorkItemPriorityRequest,
  WorkItem,
  WorkItemAcknowledgement,
  WorkItemState,
  WorkerEffect,
} from "./contracts.js";
import { migratedWorkItemStates } from "./contracts.js";
import { OperationsState } from "./operations-state.js";
import { isCeoActor } from "./actor-identity.js";
import {
  routeAccountableExecutive,
  workstreamRoutes,
} from "./executive-role-router.js";
import { lifecyclePathTo } from "./work-item-lifecycle.js";
import { evaluateAction, findEffectiveApproval } from "./policy-engine.js";
import { detectSensitiveFields } from "./sensitive-secret.js";

const reviewTargetStates = {
  complete: "Completed",
  "request-changes": "Changes Requested",
  reject: "Cancelled",
  cancel: "Cancelled",
} as const satisfies Readonly<
  Record<CeoReviewRequest["decision"], WorkItemState>
>;

export interface OperationsGateway {
  acknowledgeCeoAction(
    action: NormalizedCeoAction,
  ): Promise<WorkItemAcknowledgement>;
  importMigratedWorkItem(
    request: ImportMigratedWorkItemRequest,
  ): Promise<WorkItem>;
  executeWorkItem(workItemId: string): Promise<OperationsResult>;
  reworkWorkItem(workItemId: string): Promise<OperationsResult>;
  recordWorkItemCommitment(
    request: RecordWorkItemCommitmentRequest,
  ): Promise<WorkItem>;
  recordWorkItemPriority(request: RecordWorkItemPriorityRequest): Promise<WorkItem>;
  requestAction(action: RequestedAction): Promise<PolicyDecision>;
  grantApproval(request: GrantApprovalRequest): Promise<Approval>;
  grantStandingAuthority(
    request: GrantStandingAuthorityRequest,
  ): Promise<StandingAuthority>;
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
  readonly workItemChanged?: (workItem: WorkItem) => Promise<void>;
  /**
   * Raised when a Work Item is blocked by a failure it cannot recover from on
   * its own. CONTEXT.md counts a material blocker among the four things that
   * may interrupt the CEO directly, and until this existed nothing did: the
   * only callers of the Exception Notice rhythm were the 07:30 brief and the
   * 21:30 roll-up, so work that blocked at 08:00 sat silent for the rest of
   * the day while the CEO had no reason to look.
   *
   * The gateway does not know what a notice is, deliberately. It reports the
   * fact; the composition decides who hears about it.
   */
  readonly materialBlocker?: (
    workItem: WorkItem,
    reason: string,
  ) => Promise<void>;
}): OperationsGateway {
  const now = options.now ?? (() => new Date().toISOString());

  const requireWorkItem = (workItemId: string): WorkItem => {
    const workItem = options.state.workItem(workItemId);
    if (workItem === undefined) {
      throw new Error("The Work Item does not exist.");
    }
    return workItem;
  };

  const publish = async (workItem: WorkItem): Promise<WorkItem> => {
    await options.workItemChanged?.(workItem);
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

  const blockAfterWorkerFailure = async (
    workItemId: string,
    reason: "collaborator-execution-failed" | "worker-execution-failed",
    message: string,
  ): Promise<never> => {
    options.state.recordWorkerFailure(workItemId, now());
    const blocked = options.state.transition(workItemId, "Waiting/Blocked", now(), { reason });
    await publish(blocked);
    // Raised after the block is durable, so the CEO is never told about a
    // state the database does not already hold. A failure to notify must not
    // undo the block or mask the original fault, so it is swallowed here and
    // remains visible in the Work Item's own state and audit trail.
    await options.materialBlocker?.(blocked, reason).catch(() => undefined);
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
      return await blockAfterWorkerFailure(
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
      return {
        kind: "work-item-acknowledgement",
        workItem: await publish(existing),
      };
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
      workItem: await publish(options.state.createWorkItem(routedAction, now())),
    };
  };

  const runControlledExecution = async (
    entryWorkItem: WorkItem,
  ): Promise<OperationsResult> => {
    const revision = options.state.nextOutcomeReportRevision(entryWorkItem.id);
    const revisionSuffix = revision === 1 ? "" : `:revision-${revision}`;

    let workItem = advanceWorkItem(
      entryWorkItem,
      "Executing",
      "execution-not-permitted",
    );

    for (const assignment of workItem.collaboratingExecutives) {
      const contributionEffect: WorkerEffect = {
        workItemId: workItem.id,
        executive: assignment.executive,
        authority: "contribute-only",
        idempotencyKey: `${workItem.workspaceId}:${workItem.idempotencyKey}:contribution:${assignment.executive}${revisionSuffix}`,
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
      idempotencyKey: `${workItem.workspaceId}:${workItem.idempotencyKey}:effect${revisionSuffix}`,
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
      const blocked = options.state.transition(workItem.id, "Waiting/Blocked", now(), {
        reason: "effect-verification-failed",
      });
      await publish(blocked);
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

    const result = options.state.recordReviewReadyOutcome(
      workItem,
      receipt,
      verification,
      now(),
    );
    await publish(result.workItem);
    return result;
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
        return {
          workItem: await publish(storedWorkItem),
          outcomeReport: existingOutcome,
        };
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

    if (
      storedWorkItem.state === "Awaiting Approval" &&
      findEffectiveApproval(
        options.state.approvals(workItemId),
        now(),
      ) === undefined
    ) {
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

    return runControlledExecution(storedWorkItem);
  };

  const reworkWorkItem: OperationsGateway["reworkWorkItem"] = async (
    workItemId,
  ) => {
    const storedWorkItem = requireWorkItem(workItemId);

    if (storedWorkItem.state !== "Changes Requested") {
      options.state.recordRejectedTransition(
        workItemId,
        {
          from: storedWorkItem.state,
          to: "Executing",
          reason: "changes-requested-required",
        },
        now(),
      );
      throw new Error("Only Changes Requested Work can be reworked.");
    }

    return runControlledExecution(storedWorkItem);
  };

  const requestAction: OperationsGateway["requestAction"] = async (action) => {
    const workItem = requireWorkItem(action.workItemId);

    const sensitiveFields = detectSensitiveFields(action.payload);
    if (sensitiveFields.length > 0) {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.denied",
        {
          reason: "sensitive-secret-rejected",
          operation: action.operation,
          sensitiveFields,
        },
        now(),
      );
      return { kind: "denied", reason: "sensitive-secret-rejected", sensitiveFields };
    }

    const outcome = evaluateAction({
      action,
      standingAuthorities: options.state.standingAuthorities(),
      approvals: options.state.approvals(workItem.id),
      now: now(),
    });

    if (outcome.kind === "capability-not-grantable") {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.denied",
        {
          reason: "capability-not-grantable",
          capability: outcome.capability,
          operation: action.operation,
        },
        now(),
      );
      return {
        kind: "denied",
        reason: "capability-not-grantable",
        capability: outcome.capability,
      };
    }

    if (outcome.kind === "automatic-baseline") {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.permitted",
        { basis: "automatic-baseline", operation: action.operation },
        now(),
      );
      return { kind: "permitted", basis: "automatic-baseline" };
    }

    if (outcome.kind === "standing-authority") {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.permitted",
        {
          basis: "standing-authority",
          operation: action.operation,
          standingAuthorityId: outcome.standingAuthority.id,
        },
        now(),
      );
      return {
        kind: "permitted",
        basis: "standing-authority",
        standingAuthorityId: outcome.standingAuthority.id,
      };
    }

    if (outcome.kind === "approval") {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.permitted",
        {
          basis: "approval",
          operation: action.operation,
          approvalId: outcome.approval.id,
        },
        now(),
      );
      return { kind: "permitted", basis: "approval", approvalId: outcome.approval.id };
    }

    const target = action.target;
    const scope = action.scope;
    if (target === undefined || scope === undefined) {
      options.state.recordPolicyDecision(
        workItem.id,
        "policy.denied",
        { reason: "approval-target-required", operation: action.operation },
        now(),
      );
      return { kind: "denied", reason: "approval-target-required" };
    }

    if (outcome.invalidatedApproval !== undefined) {
      options.state.invalidateApproval(
        outcome.invalidatedApproval.id,
        outcome.reason === "approval-expired" ? "expired" : "invalidated",
        {
          reason:
            outcome.reason === "approval-expired"
              ? "approval-expired"
              : "target-changed",
          approvedVersion: outcome.invalidatedApproval.targetVersion,
          requestedVersion: target.version,
        },
        now(),
      );
    }

    if (workItem.state !== "Awaiting Approval") {
      advanceWorkItem(workItem, "Awaiting Approval", "approval-staging-not-permitted");
    }

    const approval = options.state.requestApproval(
      {
        workItemId: workItem.id,
        scope,
        targetType: target.type,
        targetIdentity: target.identity,
        targetVersion: target.version,
        riskClass: action.riskClass,
        reason: outcome.reason,
      },
      now(),
    );
    await publish(requireWorkItem(workItem.id));

    return {
      kind: "approval-required",
      approvalId: approval.id,
      scope,
      target,
      riskClass: action.riskClass,
      reason: outcome.reason,
    };
  };

  const grantApproval: OperationsGateway["grantApproval"] = async (request) => {
    if (!isCeoActor(request.actorId)) {
      throw new Error("Only the CEO may grant an Approval.");
    }
    const approval = options.state.approval(request.approvalId);
    if (approval === undefined) {
      throw new Error("The Approval does not exist.");
    }
    if (approval.state !== "requested") {
      throw new Error("Only a requested Approval can be granted.");
    }

    return options.state.grantApproval(
      request.approvalId,
      request.actorId,
      request.expiresAt,
      now(),
    );
  };

  const grantStandingAuthority: OperationsGateway["grantStandingAuthority"] =
    async (request) => {
      if (!isCeoActor(request.actorId)) {
        throw new Error("Only the CEO may grant Standing Authority.");
      }

      return options.state.recordStandingAuthority(request, now());
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
        decision: request.decision,
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
      decision: request.decision,
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

  const importMigratedWorkItem: OperationsGateway["importMigratedWorkItem"] =
    async (request) => {
      if (request.approvalReference.trim() === "") {
        throw new Error(
          "A migrated Work Item requires the exact cutover Approval reference.",
        );
      }
      if (!migratedWorkItemStates.includes(request.lifecycle)) {
        throw new Error(
          `A migration may not create a Work Item in ${request.lifecycle}.`,
        );
      }
      const expectedExecutive =
        workstreamRoutes[request.workstream].executive;
      if (request.accountableExecutive !== expectedExecutive) {
        throw new Error(
          `Workstream ${request.workstream} is accountable to ${expectedExecutive}, not ${request.accountableExecutive}.`,
        );
      }
      return publish(
        options.state.importMigratedWorkItem(request, now()),
      );
    };

  const recordWorkItemPriority: OperationsGateway["recordWorkItemPriority"] =
    async (request) => {
      requireWorkItem(request.workItemId);
      return publish(options.state.recordPriority(
        request.workItemId,
        request.priority,
        request.idempotencyKey,
        now(),
      ));
    };

  const submitCeoAction: OperationsGateway["submitCeoAction"] = async (
    action,
  ) => {
    const acknowledgement = await acknowledgeCeoAction(action);
    return executeWorkItem(acknowledgement.workItem.id);
  };

  return {
    acknowledgeCeoAction,
    importMigratedWorkItem,
    executeWorkItem,
    reworkWorkItem,
    requestAction,
    grantApproval,
    grantStandingAuthority,
    recordWorkItemCommitment: async (request) =>
      publish(await recordWorkItemCommitment(request)),
    recordWorkItemPriority,
    reviewWorkItem: async (request) => publish(await reviewWorkItem(request)),
    stageWorkItemForApproval: async (workItemId) =>
      publish(await stageWorkItemForApproval(workItemId)),
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
