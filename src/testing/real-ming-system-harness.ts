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
import {
  createTelegramFrontDoor,
  type TelegramFrontDoor,
} from "../telegram/telegram-front-door.js";
import type {
  PublishTelegramReviewControlsRequest,
  TelegramAuditEvent,
  TelegramDeliveryRetrySummary,
  TelegramIngressResult,
  TelegramInlineControl,
  TelegramNotification,
  TelegramNotificationResult,
  TelegramOutboundMessage,
  TelegramSendRequest,
  TelegramTransport,
  TelegramUpdate,
} from "../telegram/contracts.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import {
  MasterTasksProjection,
  type EditMasterTaskThroughViewRequest,
  type MasterTaskRecord,
  type MasterTasksStore,
  type MasterTasksViewName,
} from "../master-tasks/master-tasks.js";
import {
  TaskMigrationRehearsal,
  type LegacyTaskSource,
  type MigrationBackup,
  type TaskMigrationRehearsalResult,
} from "../migration/task-migration-rehearsal.js";

export interface RealMingSystemHarness {
  captureTaskMigrationBackups(): Promise<readonly MigrationBackup[]>;
  importTaskMigrationBackups(
    backups: readonly MigrationBackup[],
  ): Promise<TaskMigrationRehearsalResult>;
  migrationRehearsalTargetCount(): number;
  rollbackTaskMigrationRehearsal(): void;
  editMasterTaskThroughView(
    request: EditMasterTaskThroughViewRequest,
  ): Promise<MasterTaskRecord>;
  masterTasksView(name: MasterTasksViewName): Promise<readonly MasterTaskRecord[]>;
  reconcileMasterTasks(): Promise<void>;
  simulateMasterTasksProviderEdit(
    workItemId: string,
    changes: Partial<Pick<MasterTaskRecord, "priority" | "lifecycle" | "updatedAt">>,
  ): void;
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
  receiveTelegramUpdate(update: TelegramUpdate): Promise<TelegramIngressResult>;
  publishTelegramReviewControls(
    request: PublishTelegramReviewControlsRequest,
  ): Promise<readonly TelegramInlineControl[]>;
  notifyTelegram(
    notification: TelegramNotification,
  ): Promise<TelegramNotificationResult>;
  retryPendingTelegramDeliveries(): Promise<TelegramDeliveryRetrySummary>;
  telegramMessages(): readonly TelegramOutboundMessage[];
  telegramAuditTrail(): TelegramAuditEvent[];
  close(): void;
}

class ControlledTelegramTransport implements TelegramTransport {
  readonly #messages = new Map<string, TelegramOutboundMessage>();

  constructor(
    private readonly failure?: ProviderFailure,
    private readonly crashAfterSendError?: string,
  ) {}

  async send(message: TelegramSendRequest) {
    if (this.failure !== undefined) {
      return { kind: "failed" as const, failure: this.failure };
    }
    if (this.#messages.has(message.idempotencyKey)) {
      return { kind: "sent" as const, deduplicated: true };
    }
    const { idempotencyKey: _idempotencyKey, ...outbound } = message;
    this.#messages.set(message.idempotencyKey, outbound);
    if (this.crashAfterSendError !== undefined) {
      throw new Error(this.crashAfterSendError);
    }
    return { kind: "sent" as const, deduplicated: false };
  }

  messages(): readonly TelegramOutboundMessage[] {
    return [...this.#messages.values()];
  }
}

function normalizeHarnessTelegramUpdate(update: TelegramUpdate): TelegramUpdate {
  if ("message" in update) {
    return {
      ...update,
      message: {
        ...update.message,
        chatType: update.message.chatType ?? "private",
      },
    };
  }
  if ("callbackQuery" in update) {
    return {
      ...update,
      callbackQuery: {
        ...update.callbackQuery,
        chatType: update.callbackQuery.chatType ?? "private",
      },
    };
  }
  if ("unsupported" in update) {
    return {
      ...update,
      unsupported: {
        ...update.unsupported,
        chatType: update.unsupported.chatType ?? "private",
      },
    };
  }
  return update;
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
  readonly telegram?: {
    readonly ceoTelegramId: string;
    readonly ceoTelegramChatId?: string;
    readonly deliveryFailure?: ProviderFailure;
    readonly crashAfterDelivery?: string;
    readonly afterReviewAppliedError?: string;
    readonly afterReviewControlClaimedError?: string;
    readonly afterReplyDeliveredError?: string;
    readonly auditPseudonymKey?: string;
  };
  readonly legacyTaskSources?: readonly LegacyTaskSource[];
}): RealMingSystemHarness {
  const state = new OperationsState(options.statePath);
  const masterTaskRecords = new Map<string, MasterTaskRecord>();
  const masterTasksStore: MasterTasksStore = {
    records: async () => [...masterTaskRecords.values()],
    upsert: async (record) => {
      masterTaskRecords.set(record.workItemId, record);
      return record;
    },
  };
  const masterTasks = new MasterTasksProjection(state, masterTasksStore);
  const migrationRehearsal = new TaskMigrationRehearsal(
    options.legacyTaskSources ?? [],
    options.now,
  );
  for (const workItem of state.workItems()) {
    masterTaskRecords.set(workItem.id, masterTasks.recordFor(workItem));
  }
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
    workItemChanged: (workItem) => masterTasks.sync(workItem).then(() => undefined),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const telegramTransport = new ControlledTelegramTransport(
    options.telegram?.deliveryFailure,
    options.telegram?.crashAfterDelivery,
  );
  const telegramFrontDoor: TelegramFrontDoor = createTelegramFrontDoor({
    ceoTelegramId: options.telegram?.ceoTelegramId ?? "100000001",
    ceoTelegramChatId:
      options.telegram?.ceoTelegramChatId ??
      options.telegram?.ceoTelegramId ??
      "100000001",
    gateway,
    state,
    transport: telegramTransport,
    auditPseudonymKey:
      options.telegram?.auditPseudonymKey ??
      "controlled-telegram-audit-pseudonym-key",
    ...(options.telegram?.afterReviewAppliedError === undefined
      ? {}
      : {
          afterReviewApplied: () => {
            throw new Error(options.telegram?.afterReviewAppliedError);
          },
        }),
    ...(options.telegram?.afterReviewControlClaimedError === undefined
      ? {}
      : {
          afterReviewControlClaimed: () => {
            throw new Error(options.telegram?.afterReviewControlClaimedError);
          },
        }),
    ...(options.telegram?.afterReplyDeliveredError === undefined
      ? {}
      : {
          afterReplyDelivered: () => {
            throw new Error(options.telegram?.afterReplyDeliveredError);
          },
        }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    captureTaskMigrationBackups: async () => migrationRehearsal.captureBackups(),
    importTaskMigrationBackups: async (backups) =>
      migrationRehearsal.importVerifiedBackups(backups),
    migrationRehearsalTargetCount: () => migrationRehearsal.targetCount(),
    rollbackTaskMigrationRehearsal: () => migrationRehearsal.rollback(),
    editMasterTaskThroughView: async (request) =>
      masterTasks.editThroughView(request, gateway),
    masterTasksView: (name) => masterTasks.view(name),
    reconcileMasterTasks: () => masterTasks.reconcileFromStore(gateway),
    simulateMasterTasksProviderEdit: (workItemId, changes) => {
      const record = masterTaskRecords.get(workItemId);
      if (record === undefined) throw new Error("Controlled Master Tasks record not found.");
      masterTaskRecords.set(workItemId, { ...record, ...changes });
    },
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
    receiveTelegramUpdate: (update) =>
      telegramFrontDoor.receiveUpdate(normalizeHarnessTelegramUpdate(update)),
    publishTelegramReviewControls: (request) =>
      telegramFrontDoor.publishReviewControls(request),
    notifyTelegram: (notification) => telegramFrontDoor.notify(notification),
    retryPendingTelegramDeliveries: () =>
      telegramFrontDoor.retryPendingDeliveries(),
    telegramMessages: () => telegramTransport.messages(),
    telegramAuditTrail: () => state.telegramAuditTrail(),
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
