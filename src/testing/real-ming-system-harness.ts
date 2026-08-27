import type {
  Approval,
  AuditEvent,
  CeoCommand,
  CeoCommandResult,
  CeoReviewRequest,
  ControlledWorker,
  EffectVerifier,
  ExpectedEffect,
  NormalizedCeoAction,
  OperationsResult,
  OutcomeReport,
  GrantApprovalRequest,
  GrantStandingAuthorityRequest,
  PolicyDecision,
  QuestionResponder,
  RecordWorkItemCommitmentRequest,
  RequestedAction,
  StandingAuthority,
  WorkItem,
  WorkerEffect,
  WorkerReceipt,
  VerifierResult,
} from "../operations/contracts.js";
import { createOperationsGateway } from "../operations/operations-gateway.js";
import { OperationsState } from "../operations/operations-state.js";
import { createCommandClassifier } from "../operations/command-classifier.js";
import {
  createDashboardServer,
  type DashboardCredential,
  type DashboardServer,
} from "../dashboard/dashboard-server.js";
import { buildDashboardOverview } from "../dashboard/dashboard-read-model.js";
import type { DashboardOverview } from "../dashboard/dashboard-read-model.js";

export interface RealMingSystemHarness {
  submitCeoCommand(command: CeoCommand): Promise<CeoCommandResult>;
  submitCeoAction(action: NormalizedCeoAction): Promise<OperationsResult>;
  executeWorkItem(workItemId: string): Promise<OperationsResult>;
  reworkWorkItem(workItemId: string): Promise<OperationsResult>;
  stageWorkItemForApproval(workItemId: string): Promise<WorkItem>;
  requestAction(action: RequestedAction): Promise<PolicyDecision>;
  grantApproval(request: GrantApprovalRequest): Promise<Approval>;
  grantStandingAuthority(
    request: GrantStandingAuthorityRequest,
  ): Promise<StandingAuthority>;
  approval(id: string): Approval | undefined;
  approvals(workItemId: string): Approval[];
  standingAuthorities(): StandingAuthority[];
  dashboardOverview(session: {
    readonly actorId: string;
    readonly workspaceId: string;
  }): DashboardOverview;
  startDashboard(
    credentials: readonly DashboardCredential[],
  ): Promise<DashboardServer>;
  reviewWorkItem(request: CeoReviewRequest): Promise<WorkItem>;
  recordWorkItemCommitment(
    request: RecordWorkItemCommitmentRequest,
  ): Promise<WorkItem>;
  workItem(id: string): WorkItem | undefined;
  workItems(): WorkItem[];
  outcomeReport(workItemId: string): OutcomeReport | undefined;
  outcomeReportRevisions(workItemId: string): OutcomeReport[];
  auditTrail(workItemId: string): AuditEvent[];
  controlledEffects(): readonly WorkerEffect[];
  controlledReceipts(): readonly WorkerReceipt[];
  controlledVerificationResults(): readonly VerifierResult[];
  close(): void;
}

class ControlledQuestionResponder implements QuestionResponder {
  constructor(private readonly answerText: string) {}

  async answer(): Promise<string> {
    return this.answerText;
  }
}

class ControlledEffectLedger {
  readonly #effects = new Map<string, WorkerEffect>();
  readonly #receipts = new Map<string, WorkerReceipt>();

  record(receipt: WorkerReceipt): void {
    this.#effects.set(receipt.effect.idempotencyKey, receipt.effect);
    this.#receipts.set(receipt.effect.idempotencyKey, receipt);
  }

  effect(idempotencyKey: string): WorkerEffect | undefined {
    return this.#effects.get(idempotencyKey);
  }

  effects(): readonly WorkerEffect[] {
    return [...this.#effects.values()];
  }

  receipts(): readonly WorkerReceipt[] {
    return [...this.#receipts.values()];
  }
}

class InMemoryControlledWorker implements ControlledWorker {
  constructor(
    private readonly ledger: ControlledEffectLedger,
    private readonly executionError?: string,
    private readonly receiptEvidence?: Readonly<Record<string, string>>,
  ) {}

  async execute(effect: WorkerEffect): Promise<WorkerReceipt> {
    if (this.executionError !== undefined) {
      throw new Error(this.executionError);
    }

    const receipt: WorkerReceipt = {
      effect,
      evidence: this.receiptEvidence ?? {
        adapter: "controlled-worker",
        effectId: effect.idempotencyKey,
      },
    };
    this.ledger.record(receipt);
    return receipt;
  }
}

class ControlledEffectVerifier implements EffectVerifier {
  readonly #results: VerifierResult[] = [];

  constructor(
    private readonly ledger: ControlledEffectLedger,
    private readonly result: "verify" | "error" = "verify",
    private readonly errorMessage = "The effect could not be verified.",
    private readonly evidence?: Readonly<Record<string, string>>,
  ) {}

  async verify(
    receipt: WorkerReceipt,
    expectedEffect: ExpectedEffect,
  ): Promise<VerifierResult> {
    if (this.result === "error") {
      throw new Error(this.errorMessage);
    }

    const recorded = this.ledger.effect(receipt.effect.idempotencyKey);
    if (
      recorded === undefined ||
      recorded.kind !== expectedEffect.kind ||
      recorded.value !== expectedEffect.value
    ) {
      throw new Error("The effect could not be verified.");
    }

    const result: VerifierResult = {
      status: "verified",
      evidence: this.evidence ?? {
        adapter: "controlled-effect-verifier",
        effectId: receipt.effect.idempotencyKey,
      },
    };
    this.#results.push(result);
    return result;
  }

  results(): readonly VerifierResult[] {
    return this.#results;
  }
}

export function createRealMingSystemHarness(options: {
  readonly statePath: string;
  readonly controlledQuestionAnswer?: string;
  readonly controlledWorker?: {
    readonly executionError?: string;
    readonly receiptEvidence?: Readonly<Record<string, string>>;
  };
  readonly controlledVerifier?: {
    readonly result: "verify" | "error";
    readonly errorMessage?: string;
    readonly evidence?: Readonly<Record<string, string>>;
  };
  readonly now?: () => string;
}): RealMingSystemHarness {
  const state = new OperationsState(options.statePath);
  const ledger = new ControlledEffectLedger();
  const worker = new InMemoryControlledWorker(
    ledger,
    options.controlledWorker?.executionError,
    options.controlledWorker?.receiptEvidence,
  );
  const verifier = new ControlledEffectVerifier(
    ledger,
    options.controlledVerifier?.result,
    options.controlledVerifier?.errorMessage,
    options.controlledVerifier?.evidence,
  );
  const questionResponder = new ControlledQuestionResponder(
    options.controlledQuestionAnswer ?? "No controlled answer was configured.",
  );
  const commandClassifier = createCommandClassifier();
  const gateway = createOperationsGateway({
    state,
    worker,
    verifier,
    questionResponder,
    commandClassifier,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    submitCeoCommand: (command) => gateway.submitCeoCommand(command),
    submitCeoAction: (action) => gateway.submitCeoAction(action),
    executeWorkItem: (workItemId) => gateway.executeWorkItem(workItemId),
    reworkWorkItem: (workItemId) => gateway.reworkWorkItem(workItemId),
    stageWorkItemForApproval: (workItemId) =>
      gateway.stageWorkItemForApproval(workItemId),
    requestAction: (action) => gateway.requestAction(action),
    grantApproval: (request) => gateway.grantApproval(request),
    grantStandingAuthority: (request) =>
      gateway.grantStandingAuthority(request),
    approval: (id) => state.approval(id),
    approvals: (workItemId) => state.approvals(workItemId),
    standingAuthorities: () => state.standingAuthorities(),
    dashboardOverview: (session) => buildDashboardOverview(state, session),
    startDashboard: (credentials) =>
      createDashboardServer({ state, gateway, credentials }),
    reviewWorkItem: (request) => gateway.reviewWorkItem(request),
    recordWorkItemCommitment: (request) =>
      gateway.recordWorkItemCommitment(request),
    workItem: (id) => state.workItem(id),
    workItems: () => state.workItems(),
    outcomeReport: (workItemId) => state.outcomeReport(workItemId),
    outcomeReportRevisions: (workItemId) =>
      state.outcomeReportRevisions(workItemId),
    auditTrail: (workItemId) => state.auditTrail(workItemId),
    controlledEffects: () => ledger.effects(),
    controlledReceipts: () => ledger.receipts(),
    controlledVerificationResults: () => verifier.results(),
    close: () => state.close(),
  };
}

export type {
  Approval,
  AuditEvent,
  DashboardCredential,
  DashboardOverview,
  DashboardServer,
  CeoReviewRequest,
  PolicyDecision,
  RequestedAction,
  StandingAuthority,
  NormalizedCeoAction,
  OperationsResult,
  OutcomeReport,
  RecordWorkItemCommitmentRequest,
  WorkItem,
};
