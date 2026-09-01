import {
  createControlPlaneSupervisor,
  type ControlPlaneSupervisor,
} from "../runtime/control-plane-supervisor.js";
import {
  type DailyOperationsControlPlane,
} from "../runtime/daily-operations-control-plane.js";
import { createProductionControlPlane } from "../runtime/production-control-plane.js";

import {
  pollTelegramUpdates as pollUpdates,
  type TelegramPollResult,
} from "../runtime/telegram-ingress.js";

import {
  resolveControlPlaneCredentials as resolveCredentials,
  type ResolvedCredentials,
  type VaultFailure,
  type VaultReadResult,
  type VaultSecretReader,
} from "../runtime/credential-resolver.js";
import { tracerCredentials } from "../config/tracer-secrets.js";
import { backupSqliteState } from "../runtime/sqlite-state-backup.js";
import { backupAndUploadControlPlaneState } from "../runtime/control-plane-backup.js";
import { verifyControlPlaneDeployment } from "../runtime/control-plane-deployment-preflight.js";
import {
  verifyControlPlaneDashboard,
  type ControlPlaneSmokeResult,
} from "../runtime/control-plane-smoke.js";

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
  WorkItemAcknowledgement,
  VerifierResult,
} from "../operations/contracts.js";
import {
  createOperationsGateway,
  type MaterialBlockerReason,
} from "../operations/operations-gateway.js";
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
import type {
  ProviderFailure,
  ProviderReadResult,
} from "../providers/adapter-contract.js";
import type { Workstream } from "../operations/contracts.js";
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
import {
  MasterTasksCutover,
  type CutoverApproval,
  type CutoverLinkedView,
  type CutoverPhaseAReport,
  type CutoverPhaseBReport,
  type CutoverPlan,
  type CutoverRecovery,
  type CutoverRetirement,
  type CutoverSourceSnapshot,
  type CutoverTarget,
  type CutoverWorkspace,
} from "../migration/master-tasks-cutover.js";

import {
  buildCutoverPlan,
  type CutoverEvidenceSource,
  type CutoverPlanBuildResult,
  type CutoverTitleMatchCounts,
} from "../migration/cutover-plan-builder.js";
import type { CutoverBindings } from "../migration/master-tasks-cutover.js";

import {
  createGoogleCalendarAdapter,
  type CalendarEvent,
} from "../providers/google-calendar-adapter.js";
import {
  createCalendarReconciler,
  type CalendarChange,
  type CalendarReconciliation,
  type ChangeCalendarCommitmentRequest,
  type ReconcileCalendarCommitmentRequest,
} from "../calendar/calendar-reconciliation.js";

import {
  createMorningBriefRunner,
  type MorningBriefResult,
  type MorningBriefRunner,
} from "../operations/morning-brief.js";

import {
  createExecutiveRollUpRunner,
  type ExecutiveRollUpResult,
  type ExecutiveRollUpRunner,
} from "../operations/executive-roll-up.js";
import {
  createExceptionNoticeRhythm,
  type ExceptionNotice,
  type ExceptionNoticeAdmission,
  type ExceptionNoticeRhythm,
  type HeldRelease,
} from "../operations/exception-notice-rhythm.js";

import {
  createDailyOperationsScheduler,
  executiveRollUpJobName,
  morningBriefJobName,
  releaseHeldJobName,
  type DailyOperationsScheduler,
  type DailyOperationsTick,
} from "../operations/daily-operations-scheduler.js";

export interface ControlledMorningBriefOptions {
  readonly calendarId: string;
}

export type ControlledCutoverSource = CutoverSourceSnapshot;

/**
 * A controlled stand-in for Azure Key Vault. Tests configure what the vault
 * holds, or how it fails, without any network call or credential.
 */
export interface ControlledVaultOptions {
  readonly secrets?: Readonly<Record<string, string>>;
  readonly failure?: VaultFailure;
  /** Counts reads, so a test can prove a failed vault is not retried per credential. */
  readonly onRead?: () => void;
}

export interface ControlledCalendarOptions {
  readonly events: readonly CalendarEvent[];
  readonly failure?: "unavailable" | "authentication-failed";
  readonly asOf?: string;
}

/**
 * Serves the controlled events in Google's own wire shape, so the adapter's
 * normalization is exercised rather than bypassed.
 */
function controlledCalendarFetch(
  options: ControlledCalendarOptions,
  onWrite: () => void,
  retrievedAt: string,
): typeof fetch {
  return async (input, init) => {
    if (options.failure !== undefined) {
      return Response.json(
        { error: { message: "Controlled calendar failure." } },
        { status: options.failure === "unavailable" ? 503 : 401 },
      );
    }
    const url = new URL(String(input));
    if ((init?.method ?? "GET") === "PATCH") {
      onWrite();
      return Response.json({
        etag: `"controlled-calendar-etag"`,
        updated: "2026-08-29T09:00:00.000Z",
      });
    }
    if (!url.pathname.endsWith("/events")) {
      return Response.json({ error: { message: "Unsupported" } }, { status: 404 });
    }
    // A real events list always carries the calendar's own last-modified time.
    // Omitting it would exercise a response Google does not send.
    const newestEvent = options.events.reduce(
      (latest, event) => (event.updatedAt > latest ? event.updatedAt : latest),
      "",
    );
    return Response.json({
      updated: options.asOf ?? (newestEvent === "" ? retrievedAt : newestEvent),
      items: options.events.map((event) => ({
        id: event.id,
        summary: event.title,
        status: event.status,
        updated: event.updatedAt,
        start: event.allDay
          ? { date: event.start }
          : { dateTime: event.start },
        end: event.allDay ? { date: event.end } : { dateTime: event.end },
      })),
    });
  };
}

export interface ControlledCutoverOptions {
  readonly plan: CutoverPlan;
  readonly approval: CutoverApproval;
  readonly sources: readonly ControlledCutoverSource[];
  readonly target: CutoverTarget;
  readonly foreignSourceReference?: string;
  readonly retirementFailureFor?: string;
  readonly retirementWriteFailureFor?: string;
}

class ControlledCutoverWorkspace implements CutoverWorkspace {
  #sourceReads = 0;
  readonly #views = new Map<string, CutoverLinkedView>();
  readonly #retired = new Map<string, CutoverRetirement>();

  constructor(private readonly options: ControlledCutoverOptions) {}

  async readSources(): Promise<readonly CutoverSourceSnapshot[]> {
    this.#sourceReads += 1;
    return this.options.sources;
  }

  async masterTasksTarget(): Promise<CutoverTarget> {
    return this.options.target;
  }

  async ensureLinkedView(request: {
    readonly name: string;
    readonly dataSourceId: string;
    readonly workstreams: readonly Workstream[];
  }): Promise<CutoverLinkedView> {
    const existing = this.#views.get(request.name);
    if (existing !== undefined) return existing;
    const view: CutoverLinkedView = {
      id: `linked-view:${this.#views.size + 1}`,
      name: request.name,
      dataSourceId: request.dataSourceId,
      workstreams: request.workstreams,
    };
    this.#views.set(request.name, view);
    return view;
  }

  async verifyRetirable(dataSourceId: string): Promise<void> {
    if (this.options.retirementFailureFor === dataSourceId) {
      throw new Error("Controlled Notion refused to lock the legacy source.");
    }
  }

  async retireLegacySource(request: {
    readonly dataSourceId: string;
    readonly archivedName: string;
  }): Promise<CutoverRetirement> {
    if (
      this.options.retirementFailureFor === request.dataSourceId ||
      this.options.retirementWriteFailureFor === request.dataSourceId
    ) {
      throw new Error("Controlled Notion refused to lock the legacy source.");
    }
    const retirement: CutoverRetirement = {
      dataSourceId: request.dataSourceId,
      archivedName: request.archivedName,
      locked: true,
    };
    this.#retired.set(request.dataSourceId, retirement);
    return retirement;
  }

  async writableTaskSystems(): Promise<readonly string[]> {
    const remaining = this.options.plan.bindings.sources
      .filter((source) => !this.#retired.has(source.dataSourceId))
      .map((source) => source.dataSourceId);
    return [this.options.target.dataSourceId, ...remaining];
  }

  sourceReadCount(): number {
    return this.#sourceReads;
  }

  retiredSources(): readonly string[] {
    return [...this.#retired.keys()];
  }
}

export interface RealMingSystemHarness {
  captureTaskMigrationBackups(): Promise<readonly MigrationBackup[]>;
  importTaskMigrationBackups(
    backups: readonly MigrationBackup[],
  ): Promise<TaskMigrationRehearsalResult>;
  migrationRehearsalTargetCount(): number;
  rollbackTaskMigrationRehearsal(): void;
  executeCutoverPhaseA(approval?: CutoverApproval): Promise<CutoverPhaseAReport>;
  executeCutoverPhaseB(): Promise<CutoverPhaseBReport>;
  executeApprovedCutoverPhase(
    phase: "A" | "B",
  ): Promise<CutoverPhaseAReport | CutoverPhaseBReport>;
  seedPriorCutoverPhaseA(): Promise<CutoverPhaseAReport>;
  removeMasterTaskProjection(workItemId: string): void;
  duplicateMasterTaskProjection(
    workItemId: string,
    duplicateWorkItemId: string,
  ): void;
  cutoverSourceReadCount(): number;
  cutoverRetiredSources(): readonly string[];
  cutoverRecovery(): CutoverRecovery;
  resolveControlPlaneCredentials(request: {
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly vault?: ControlledVaultOptions;
  }): Promise<ResolvedCredentials>;
  runMorningBrief(): Promise<MorningBriefResult>;
  runExecutiveRollUp(): Promise<ExecutiveRollUpResult>;
  admitExceptionNotice(
    notification: ExceptionNotice,
  ): Promise<ExceptionNoticeAdmission>;
  recordExceptionNoticeRecovery(signature: string): Promise<ExceptionNoticeAdmission>;
  releaseHeldExceptionNotices(): Promise<HeldRelease>;
  tickDailyOperations(): Promise<DailyOperationsTick>;
  failNextScheduledRun(job: string): Promise<void>;
  failNextMasterTasksUpsert(message: string): void;
  setMasterTasksUpsertFailure(message?: string): void;
  setControlledWorkerExecutionError(message?: string): void;
  setTelegramDeliveryFailure(failure?: ProviderFailure): void;
  setTelegramCrashAfterDelivery(message?: string): void;
  acknowledgeCeoAction(
    action: NormalizedCeoAction,
  ): Promise<WorkItemAcknowledgement>;
  listCalendarEvents(request: {
    readonly calendarId: string;
  }): Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  reconcileCalendarCommitment(
    request: ReconcileCalendarCommitmentRequest,
  ): Promise<CalendarReconciliation>;
  changeCalendarEvent(
    request: ChangeCalendarCommitmentRequest,
  ): Promise<CalendarChange>;
  calendarWriteCount(): number;
  buildCutoverPlanFromEvidence(evidence: {
    readonly digest: string;
    readonly sources: readonly CutoverEvidenceSource[];
    readonly bindings: CutoverBindings;
    readonly expectedTitleMatches: CutoverTitleMatchCounts;
  }): CutoverPlanBuildResult;
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
  pollTelegramUpdates(
    updates: readonly TelegramUpdate[],
  ): Promise<TelegramPollResult>;
  telegramIngressCursor(): number;
  recordControlPlaneHealth(record: {
    readonly component:
      | "telegram-ingress"
      | "daily-scheduler"
      | "exception-notice"
      | "master-tasks-projection"
      | "state-backup";
    readonly outcome: "healthy" | "failed";
    readonly checkedAt: string;
  }): void;
  superviseControlPlane(overrides: {
    readonly pollTelegram?: () => Promise<unknown>;
    readonly tickSchedule?: () => Promise<unknown>;
    readonly wait?: () => Promise<void>;
    readonly onCycle?: () => void;
  }): ControlPlaneSupervisor;
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
    private failure?: ProviderFailure,
    private crashAfterSendError?: string,
  ) {}

  setFailure(failure?: ProviderFailure): void {
    this.failure = failure;
  }

  setCrashAfterDelivery(message?: string): void {
    this.crashAfterSendError = message;
  }

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
  #executionError: string | undefined;

  constructor(
    private readonly ledger: ControlledEffectLedger,
    executionError?: string,
    private readonly receiptEvidence?: Readonly<Record<string, string>>,
  ) {
    this.#executionError = executionError;
  }

  setExecutionError(message?: string): void {
    this.#executionError = message;
  }

  async execute(effect: WorkerEffect): Promise<WorkerReceipt> {
    if (this.#executionError !== undefined) {
      throw new Error(this.#executionError);
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
    /** Throw while handling this update, to prove the cursor stays behind it. */
    readonly ingressFailureFor?: number;
  };
  readonly legacyTaskSources?: readonly LegacyTaskSource[];
  readonly cutover?: ControlledCutoverOptions;
  readonly calendar?: ControlledCalendarOptions;
  readonly morningBrief?: ControlledMorningBriefOptions;
}): RealMingSystemHarness {
  const state = new OperationsState(options.statePath);
  const masterTaskRecords = new Map<string, MasterTaskRecord>();
  let nextMasterTasksUpsertError: string | undefined;
  let masterTasksUpsertFailure: string | undefined;
  const masterTasksStore: MasterTasksStore = {
    records: async () => [...masterTaskRecords.values()],
    upsert: async (record) => {
      if (masterTasksUpsertFailure !== undefined) {
        throw new Error(masterTasksUpsertFailure);
      }
      if (nextMasterTasksUpsertError !== undefined) {
        const message = nextMasterTasksUpsertError;
        nextMasterTasksUpsertError = undefined;
        throw new Error(message);
      }
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
  // The Exception Notice rhythm needs the front door, which needs the gateway,
  // so it cannot exist yet. Bound late rather than reordered, because the
  // gateway must not depend on the rhythm in either direction.
  let raiseMaterialBlocker:
    | ((workItem: WorkItem, reason: MaterialBlockerReason) => Promise<void>)
    | undefined;
  let recoverMaterialBlocker: ((workItem: WorkItem) => Promise<void>) | undefined;
  const gateway = createOperationsGateway({
    state,
    worker,
    verifier,
    questionResponder,
    commandClassifier,
    workItemChanged: async (workItem) => {
      await masterTasks.sync(workItem);
      state.recordControlPlaneHealth({
        component: "master-tasks-projection",
        outcome: "healthy",
        checkedAt: clock(),
      });
    },
    workItemProjectionRetryable: () => true,
    workItemProjectionFailed: async () => {
      state.recordControlPlaneHealth({
        component: "master-tasks-projection",
        outcome: "failed",
        checkedAt: clock(),
      });
    },
    materialBlocker: async (workItem, reason) => {
      await raiseMaterialBlocker?.(workItem, reason);
    },
    materialBlockerRecovered: async (workItem) => {
      await recoverMaterialBlocker?.(workItem);
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const cutoverWorkspace =
    options.cutover === undefined
      ? undefined
      : new ControlledCutoverWorkspace(options.cutover);
  if (options.cutover?.foreignSourceReference !== undefined) {
    const reference = options.cutover.foreignSourceReference;
    masterTaskRecords.set(reference, {
      id: reference,
      workItemId: reference,
      workspaceId: "workspace:real-ming",
      title: "Foreign migration record",
      intent: "Foreign migration record",
      source: "Notion",
      sourceReference: reference,
      trustDomain: "Personal",
      workstream: null,
      accountableExecutive: "COO",
      collaboratingExecutives: [],
      lifecycle: "Captured",
      priority: null,
      commitmentValue: null,
      commitmentProvenance: null,
      riskClass: null,
      approvalRequired: false,
      approvalReference: null,
      portfolioProject: null,
      evidenceReferences: [],
      outcomeReportReference: null,
      createdAt: "2026-08-29T09:00:00.000Z",
      updatedAt: "2026-08-29T09:00:00.000Z",
    });
  }
  const cutover =
    options.cutover === undefined || cutoverWorkspace === undefined
      ? undefined
      : new MasterTasksCutover({
          plan: options.cutover.plan,
          approval: options.cutover.approval,
          workspace: cutoverWorkspace,
          state,
          gateway,
          projection: masterTasks,
          store: masterTasksStore,
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          ...(options.now === undefined ? {} : { now: options.now }),
        });
  const phaseASeedCutover =
    options.cutover === undefined || cutoverWorkspace === undefined
      ? undefined
      : new MasterTasksCutover({
          plan: {
            ...options.cutover.plan,
            bindings: {
              ...options.cutover.plan.bindings,
              planVersion: `${options.cutover.plan.bindings.planVersion}-PRIOR-A`,
              executionPhase: "A",
            },
          },
          approval: {
            ...options.cutover.approval,
            approvalId: `${options.cutover.approval.approvalId}:prior-a`,
            planVersion: `${options.cutover.plan.bindings.planVersion}-PRIOR-A`,
            executionPhase: "A",
          },
          workspace: cutoverWorkspace,
          state,
          gateway,
          projection: masterTasks,
          store: masterTasksStore,
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          ...(options.now === undefined ? {} : { now: options.now }),
        });
  const requireCutover = (): MasterTasksCutover => {
    if (cutover === undefined) {
      throw new Error("This harness was not configured with a cutover plan.");
    }
    return cutover;
  };

  let calendarWrites = 0;
  const calendarAdapter = createGoogleCalendarAdapter({
    accessToken: "controlled-calendar-access-token",
    workspaceId: "workspace:real-ming",
    accountReference: "google-calendar:account:real-ming",
    fetch: controlledCalendarFetch(
      options.calendar ?? { events: [] },
      () => {
        calendarWrites += 1;
      },
      options.now?.() ?? "2026-08-29T09:00:00.000Z",
    ),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const calendarReconciler = createCalendarReconciler({
    adapter: calendarAdapter,
    state,
    gateway,
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
  const calendarId = options.morningBrief?.calendarId ?? "";
  const clock = options.now ?? (() => new Date().toISOString());
  const exceptionNoticeRhythm: ExceptionNoticeRhythm = createExceptionNoticeRhythm({
    state,
    notify: (notification) => telegramFrontDoor.notify(notification),
    now: clock,
  });
  const recordExceptionNoticeHealth = (
    admission: ExceptionNoticeAdmission | undefined,
    failedBeforeAdmission = false,
  ): void => {
    try {
      state.recordControlPlaneHealth({
        component: "exception-notice",
        outcome:
          failedBeforeAdmission || admission?.kind === "failed"
            ? "failed"
            : admission?.kind === "grouped" && admission.deliveryState === "pending"
              ? "failed"
              : "healthy",
        checkedAt: clock(),
      });
    } catch {
      // Health bookkeeping cannot undo or mask a durable notice attempt.
    }
  };
  const recordExceptionNoticeHealthOutcome = (outcome: "healthy" | "failed") => {
    recordExceptionNoticeHealth(
      outcome === "failed"
        ? undefined
        : { kind: "delivered", delivery: { kind: "sent", notificationKind: "material-blocker" } },
      outcome === "failed",
    );
  };
  const admitTracked = async (
    notice: ExceptionNotice,
  ): Promise<ExceptionNoticeAdmission> => {
    try {
      const admission = await exceptionNoticeRhythm.admit(notice);
      recordExceptionNoticeHealth(admission);
      return admission;
    } catch (error) {
      recordExceptionNoticeHealth(undefined, true);
      throw error;
    }
  };
  const releaseHeldTracked = async (): Promise<HeldRelease> => {
    const result = await exceptionNoticeRhythm.releaseHeld();
    if (result.failed > 0) {
      recordExceptionNoticeHealthOutcome("failed");
    } else if (result.released > 0) {
      recordExceptionNoticeHealthOutcome("healthy");
    }
    return result;
  };
  raiseMaterialBlocker = async (workItem, reason) => {
    // Signed by the Work Item, so the same item failing repeatedly groups into
    // one interruption and a recovery reopens it. The text carries the item's
    // own id and the reason code only: a provider's message could hold a
    // request URL, and this goes straight to the CEO's phone.
    await admitTracked({
      kind: "material-blocker",
      text: `Work Item ${workItem.id} is blocked (${reason}).`,
      idempotencyKey: `material-blocker:${workItem.id}:${clock()}`,
      signature: `work-item-blocked:${workItem.id}`,
    });
  };
  recoverMaterialBlocker = async (workItem) => {
    const admission = await exceptionNoticeRhythm.recordRecovery(
      `work-item-blocked:${workItem.id}`,
    );
    recordExceptionNoticeHealth(admission);
  };
  // Controlled failure injection, so a scheduler tick can be observed handling
  // one job failing without stranding the others.
  const forcedFailures = new Set<string>();
  const executiveRollUp: ExecutiveRollUpRunner = createExecutiveRollUpRunner({
    state,
    workspaceId: "workspace:real-ming",
    admit: admitTracked,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const morningBrief: MorningBriefRunner | undefined =
    options.morningBrief === undefined
      ? undefined
      : createMorningBriefRunner({
          state,
          listEvents: (window) =>
            calendarAdapter.listEvents(calendarId, window),
          admit: admitTracked,
          ...(options.now === undefined ? {} : { now: options.now }),
        });

  const guarded = (job: string, run: () => Promise<unknown>) => async () => {
    if (forcedFailures.delete(job)) {
      throw new Error(`Controlled failure of the ${job} job.`);
    }
    return run();
  };
  const dailyOperations: DailyOperationsScheduler =
    createDailyOperationsScheduler({
      state,
      now: clock,
      runners: {
        [releaseHeldJobName]: guarded(releaseHeldJobName, () =>
          releaseHeldTracked(),
        ),
        [morningBriefJobName]: guarded(morningBriefJobName, () => {
          if (morningBrief === undefined) {
            throw new Error("No Morning Brief is configured.");
          }
          return morningBrief.run();
        }),
        [executiveRollUpJobName]: guarded(executiveRollUpJobName, () =>
          executiveRollUp.run(),
        ),
      },
    });

  return {
    captureTaskMigrationBackups: async () => migrationRehearsal.captureBackups(),
    importTaskMigrationBackups: async (backups) =>
      migrationRehearsal.importVerifiedBackups(backups),
    migrationRehearsalTargetCount: () => migrationRehearsal.targetCount(),
    rollbackTaskMigrationRehearsal: () => migrationRehearsal.rollback(),
    executeCutoverPhaseA: (approval) =>
      approval === undefined
        ? requireCutover().executeApprovedPhase("A")
        : requireCutover().executeApprovedPhase("A", approval),
    executeCutoverPhaseB: () => requireCutover().executeApprovedPhase("B"),
    executeApprovedCutoverPhase: (phase) =>
      requireCutover().executeApprovedPhase(phase),
    seedPriorCutoverPhaseA: () => {
      if (phaseASeedCutover === undefined) {
        throw new Error("This harness was not configured with a cutover plan.");
      }
      return phaseASeedCutover.executeApprovedPhase("A");
    },
    removeMasterTaskProjection: (workItemId) => {
      masterTaskRecords.delete(workItemId);
    },
    duplicateMasterTaskProjection: (workItemId, duplicateWorkItemId) => {
      const record = masterTaskRecords.get(workItemId);
      if (record === undefined) {
        throw new Error("Controlled Master Tasks record not found.");
      }
      masterTaskRecords.set(duplicateWorkItemId, {
        ...record,
        id: duplicateWorkItemId,
        workItemId: duplicateWorkItemId,
      });
    },
    cutoverSourceReadCount: () => cutoverWorkspace?.sourceReadCount() ?? 0,
    cutoverRetiredSources: () => cutoverWorkspace?.retiredSources() ?? [],
    cutoverRecovery: () => requireCutover().recovery(),
    resolveControlPlaneCredentials: (request) => {
      const configured = request.vault;
      let vault: VaultSecretReader | undefined;
      if (configured !== undefined) {
        const failure = configured.failure;
        const secrets = configured.secrets ?? {};
        vault = {
          read: async (secretName): Promise<VaultReadResult> => {
            configured.onRead?.();
            if (failure !== undefined) return { kind: "failed", failure };
            const value = secrets[secretName];
            return value === undefined
              ? { kind: "absent" }
              : { kind: "found", value };
          },
        };
      }
      return vault === undefined
        ? resolveCredentials({ environment: request.environment })
        : resolveCredentials({ environment: request.environment, vault });
    },
    runMorningBrief: () => {
      if (morningBrief === undefined) {
        throw new Error("This harness was not configured with a Morning Brief.");
      }
      return morningBrief.run();
    },
    runExecutiveRollUp: () => executiveRollUp.run(),
    admitExceptionNotice: admitTracked,
    recordExceptionNoticeRecovery: async (signature) => {
      const admission = await exceptionNoticeRhythm.recordRecovery(signature);
      recordExceptionNoticeHealth(admission);
      return admission;
    },
    releaseHeldExceptionNotices: () => releaseHeldTracked(),
    tickDailyOperations: () => dailyOperations.tick(),
    failNextScheduledRun: async (job) => {
      forcedFailures.add(job);
    },
    failNextMasterTasksUpsert: (message) => {
      nextMasterTasksUpsertError = message;
    },
    setMasterTasksUpsertFailure: (message) => {
      masterTasksUpsertFailure = message;
    },
    setControlledWorkerExecutionError: (message) => {
      worker.setExecutionError(message);
    },
    setTelegramDeliveryFailure: (failure) => {
      telegramTransport.setFailure(failure);
    },
    setTelegramCrashAfterDelivery: (message) => {
      telegramTransport.setCrashAfterDelivery(message);
    },
    buildCutoverPlanFromEvidence: (evidence) => buildCutoverPlan(evidence),
    acknowledgeCeoAction: (action) => gateway.acknowledgeCeoAction(action),
    listCalendarEvents: ({ calendarId }) =>
      calendarAdapter.listEvents(calendarId),
    reconcileCalendarCommitment: (request) =>
      calendarReconciler.reconcile(request),
    changeCalendarEvent: (request) => calendarReconciler.change(request),
    calendarWriteCount: () => calendarWrites,
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
    dashboardOverview: (session) =>
      buildDashboardOverview(state, { ...session, now: clock() }),
    startDashboard: (credentials) =>
      createDashboardServer({ state, gateway, credentials, now: clock }),
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
    pollTelegramUpdates: (updates) =>
      pollUpdates({
        updates,
        cursor: () => state.telegramIngressCursor(),
        advance: (updateId) =>
          state.advanceTelegramIngressCursor(
            updateId,
            options.now?.() ?? new Date().toISOString(),
          ),
        receive: async (update) => {
          if (options.telegram?.ingressFailureFor === update.updateId) {
            throw new Error(
              `Controlled ingress failure for update ${update.updateId}.`,
            );
          }
          return telegramFrontDoor.receiveUpdate(
            normalizeHarnessTelegramUpdate(update),
          );
        },
      }),
    telegramIngressCursor: () => state.telegramIngressCursor(),
    recordControlPlaneHealth: (record) => state.recordControlPlaneHealth(record),
    superviseControlPlane: (overrides) =>
      createControlPlaneSupervisor({
        pollTelegram:
          overrides.pollTelegram ??
          (() =>
            pollUpdates({
              updates: [],
              cursor: () => state.telegramIngressCursor(),
              advance: (updateId) =>
                state.advanceTelegramIngressCursor(
                  updateId,
                  options.now?.() ?? new Date().toISOString(),
                ),
              receive: (update) =>
                telegramFrontDoor.receiveUpdate(
                  normalizeHarnessTelegramUpdate(update),
                ),
            })),
        tickSchedule: overrides.tickSchedule ?? (() => dailyOperations.tick()),
        now: options.now ?? (() => new Date().toISOString()),
        ...(overrides.wait === undefined ? {} : { wait: overrides.wait }),
        ...(overrides.onCycle === undefined
          ? {}
          : { onCycle: overrides.onCycle }),
      }),
    publishTelegramReviewControls: (request) =>
      telegramFrontDoor.publishReviewControls(request),
    notifyTelegram: (notification) => telegramFrontDoor.notify(notification),
    retryPendingTelegramDeliveries: async () => {
      const result = await telegramFrontDoor.retryPendingDeliveries();
      if (result.failed > 0 || result.uncertain > 0) {
        recordExceptionNoticeHealthOutcome("failed");
      } else if (result.sent > 0) {
        recordExceptionNoticeHealthOutcome("healthy");
      }
      return result;
    },
    telegramMessages: () => telegramTransport.messages(),
    telegramAuditTrail: () => state.telegramAuditTrail(),
    close: () => state.close(),
  };
}

export interface ControlPlaneSystemHarness {
  queueTelegramUpdate(update: {
    readonly updateId: number;
    readonly senderId: string;
    readonly chatId: string;
    readonly text: string;
  }): void;
  failNextTelegramPoll(): void;
  telegramPollRequests(): readonly unknown[];
  runCycle(): ReturnType<DailyOperationsControlPlane["runCycle"]>;
  dashboardOverview(): Promise<DashboardOverview>;
  telegramMessages(): readonly TelegramOutboundMessage[];
  backup(destinationPath: string): Promise<void>;
  backupSet(
    destinationDirectory: string,
    options?: {
      readonly failUpload?: boolean;
      /** Run with no off-host destination configured at all. */
      readonly localOnly?: boolean;
    },
  ): Promise<{
    readonly statePath: string;
    readonly notionLedgerPath: string;
    readonly manifest: {
      readonly files: readonly {
        readonly role: "operations-state" | "notion-write-ledger";
        readonly sha256: string;
      }[];
    };
  }>;
  smoke(): Promise<ControlPlaneSmokeResult>;
  deploymentPreflight(repositoryRoot: string): Promise<{
    readonly kind: "passed" | "failed";
    readonly failures: readonly string[];
  }>;
  close(): Promise<void>;
}

/**
 * The production composition exercised with provider-controlled edges. Tests
 * still enter through the Real-Ming System Harness, while the module under test
 * is the exact composition used by the deployed process.
 */
export async function createControlPlaneSystemHarness(options: {
  readonly statePath: string;
  readonly notionLedgerPath?: string;
  readonly now?: () => string;
  readonly telegramSendFailures?: number;
}): Promise<ControlPlaneSystemHarness> {
  const now = options.now ?? (() => new Date().toISOString());
  const dashboardToken = "controlled-dashboard-access-token";
  const updates: unknown[] = [];
  const messages: TelegramOutboundMessage[] = [];
  let telegramSendFailures = options.telegramSendFailures ?? 0;
  let telegramPollFailures = 0;
  const pollRequests: unknown[] = [];
  const controlledFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.telegram.org") && url.endsWith("/getUpdates")) {
      if (telegramPollFailures > 0) {
        telegramPollFailures -= 1;
        return Response.json(
          { ok: false, error_code: 503, description: "controlled failure" },
          { status: 503 },
        );
      }
      // Telegram confirms every update below the requested offset and
      // redelivers everything at or above it. Draining the queue regardless of
      // offset made the durable cursor untestable: an update the front door
      // never finished would silently vanish here, when in production it comes
      // back on every poll and blocks the ones behind it.
      const polled = JSON.parse(String(init?.body ?? "{}")) as {
        readonly offset?: number;
      };
      pollRequests.push(polled);
      const offset = typeof polled.offset === "number" ? polled.offset : 0;
      for (let index = updates.length - 1; index >= 0; index -= 1) {
        const queued = updates[index] as { readonly update_id: number };
        if (queued.update_id < offset) updates.splice(index, 1);
      }
      return Response.json({ ok: true, result: [...updates] });
    }
    if (url.includes("api.telegram.org") && url.endsWith("/sendMessage")) {
      if (telegramSendFailures > 0) {
        telegramSendFailures -= 1;
        return Response.json(
          { ok: false, error_code: 503, description: "controlled failure" },
          { status: 503 },
        );
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      messages.push({
        chatId: String(body["chat_id"] ?? ""),
        text: String(body["text"] ?? ""),
      });
      return Response.json({ ok: true, result: { message_id: messages.length } });
    }
    if (url.includes("api.notion.com/v1/data_sources/") && url.endsWith("/query")) {
      return Response.json({ object: "list", results: [], has_more: false, next_cursor: null });
    }
    if (url.endsWith("api.notion.com/v1/pages")) {
      return Response.json({ object: "page", id: `controlled-page-${messages.length}` });
    }
    throw new Error(`Controlled production edge received an unexpected request: ${new URL(url).host}.`);
  }) as typeof fetch;
  const environment = Object.fromEntries(
    tracerCredentials.map((credential) => [
      credential.name,
      credential.name === "REAL_MING_TELEGRAM_CEO_ID"
        ? "100000001"
        : credential.name === "REAL_MING_DASHBOARD_TOKEN"
          ? dashboardToken
          : `controlled-${credential.name.toLowerCase()}`,
    ]),
  );
  const controlPlane = await createProductionControlPlane({
    environment,
    statePath: options.statePath,
    notionLedgerPath:
      options.notionLedgerPath ?? `${options.statePath}.notion-ledger`,
    fetch: controlledFetch,
    dashboardPort: 0,
    now,
  });

  return {
    queueTelegramUpdate: (update) => {
      updates.push({
        update_id: update.updateId,
        message: {
          message_id: update.updateId,
          from: { id: Number(update.senderId) },
          chat: { id: Number(update.chatId), type: "private" },
          text: update.text,
          date: Math.floor(Date.parse(now()) / 1_000),
        },
      });
    },
    telegramPollRequests: () => pollRequests,
    failNextTelegramPoll: () => {
      telegramPollFailures += 1;
    },
    runCycle: () => controlPlane.runCycle(),
    dashboardOverview: async () => {
      const response = await fetch(`${controlPlane.dashboardOrigin}/api/overview`, {
        headers: { Authorization: `Bearer ${dashboardToken}` },
      });
      if (!response.ok) throw new Error("Controlled dashboard read failed.");
      return response.json() as Promise<DashboardOverview>;
    },
    telegramMessages: () => [...messages],
    backup: (destinationPath) =>
      backupSqliteState({
        sourcePath: options.statePath,
        destinationPath,
      }),
    backupSet: (destinationDirectory, backupOptions) =>
      backupAndUploadControlPlaneState({
        statePath: options.statePath,
        notionLedgerPath:
          options.notionLedgerPath ?? `${options.statePath}.notion-ledger`,
        destinationDirectory,
        backupId: now().replaceAll(":", "-"),
        createdAt: now(),
        ...(backupOptions?.localOnly === true
          ? {}
          : {
              uploader: {
                upload: async () =>
                  backupOptions?.failUpload === true
                    ? { kind: "failed", reason: "unavailable" }
                    : { kind: "ok" },
              },
            }),
      }),
    smoke: () =>
      verifyControlPlaneDashboard({
        origin: controlPlane.dashboardOrigin,
        dashboardToken,
      }),
    deploymentPreflight: (repositoryRoot) =>
      verifyControlPlaneDeployment(repositoryRoot),
    close: () => controlPlane.close(),
  };
}

export type {
  Approval,
  AuditEvent,
  ResolvedCredentials,
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
