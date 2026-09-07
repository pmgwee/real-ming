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
  ExecutiveRole,
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
import type {
  ProviderObservation,
  ProviderObservationTransition,
  RetentionPurgeEvent,
} from "../operations/operations-state.js";
import { createCommandClassifier } from "../operations/command-classifier.js";
import {
  createDashboardServer,
  type DashboardCredential,
  type DashboardServer,
} from "../dashboard/dashboard-server.js";
import { buildDashboardOverview } from "../dashboard/dashboard-read-model.js";
import type { DashboardOverview } from "../dashboard/dashboard-read-model.js";
import type { RepositoryCenterView } from "../portfolio/repository-center.js";
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
import type { ProviderObservationInput } from "../providers/provider-health.js";
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
import {
  buildDeploymentCandidate,
  deploymentCandidateStatePath,
  SqliteDeploymentCandidateStore,
  type DeploymentCandidate,
  type DeploymentCandidateBuildInput,
  type DeploymentCandidateBuildResult,
} from "../portfolio/deployment-candidate.js";
import {
  createDeploymentPromotionCoordinator,
  deploymentPromotionStatePath,
  SqliteDeploymentPromotionStore,
  type DeploymentPromotionApprovalRequest,
  type DeploymentPromotionApprovalResult,
  type DeploymentPromotionExecutor,
  type DeploymentPromotionRequest,
  type DeploymentPromotionResult,
  type DeploymentPromotionRecord,
} from "../portfolio/deployment-promotion.js";
import {
  createEmailOperationsCoordinator,
  type EmailApprovedProjection,
  type EmailCaptureResult,
  type EmailMailboxKind,
  type EmailOperationsCoordinator,
  type EmailReadResult,
  type EmailDraftResult,
  type EmailSendResult,
} from "../operations/email-operations.js";
import {
  createHermesProjectionBroker,
  type CompiledKnowledgePage,
  type CompiledKnowledgeQuery,
  type CompiledKnowledgeResult,
} from "../knowledge/hermes-projection.js";
import {
  createKnowledgeCompiler,
  type KnowledgeCompilationResult,
  type KnowledgeOperationalRecord,
} from "../knowledge/knowledge-compiler.js";
import {
  createKnowledgeOperations,
  knowledgeJobInventory,
  type KnowledgeDomainHealth,
  type KnowledgeJobHealth,
  type KnowledgeJobDefinition,
  type KnowledgeOperations,
  type KnowledgeSource,
} from "../knowledge/knowledge-operations.js";
import type { KnowledgeOperationalOutput } from "../knowledge/knowledge-compiler.js";
import {
  createKnowledgeVault,
  type KnowledgeVault,
  type VaultGeneration,
  type VaultRoot,
} from "../knowledge/knowledge-vault.js";
import {
  createEvidenceEnablementCoordinator,
  type EvidenceEnablementCandidate,
  type EvidenceEnablementResult,
} from "../operations/evidence-enablement.js";
import {
  createMeteredCostLedger,
  type CostBudget,
  type CostBudgetScope,
  type CostGroupings,
  type CostObservationInput,
  type ModelRoutingRequest,
  type ModelRoutingResult,
  type RecordCostObservationResult,
} from "../operations/metered-cost.js";
import {
  createFinancialSnapshotLedger,
  type CompleteFinancialSnapshotResult,
  type FinancialSnapshot,
  type PrepareFinancialSnapshotRequest,
  type PrepareFinancialSnapshotResult,
  type PresentFinancialSnapshotResult,
  type ValidateFinancialSnapshotResult,
} from "../operations/financial-snapshot.js";
import {
  createFinancialReconciliationCoordinator,
  type FinancialExportSource,
  type FinancialReconciliationResult,
} from "../operations/financial-reconciliation.js";
import {
  createFinancialRecordChangeCoordinator,
  type FinancialRecordChangeRequest,
  type FinancialRecordChangeResult,
} from "../operations/financial-record-change.js";
import type {
  DuitSiniAdapter,
  DuitSiniRecord,
} from "../providers/duitsini-adapter.js";
import {
  createCareerGroundingCoordinator,
  type CareerFile,
  type CareerGroundingRequest,
  type CareerGroundingResult,
} from "../operations/career-grounding.js";
import {
  createContentWorkflowCoordinator,
  type ContentWorkflowRequest,
  type ContentWorkflowResult,
} from "../operations/content-workflow-coordination.js";
import {
  createAcademicCoordinator,
  type AcademicCoordinationRequest,
  type AcademicCoordinationResult,
  type AcademicSubmissionResult,
} from "../operations/academic-coordination.js";
import type { CanvasAdapter } from "../providers/canvas-adapter.js";
import type { Microsoft365Adapter } from "../providers/microsoft365-adapter.js";
import {
  createEntertainmentEmailDigestRunner,
  type EntertainmentEmailDigestRunResult,
} from "../operations/entertainment-email-digest.js";
import type { EmailMessage, GmailEmailAdapter } from "../providers/email-provider-adapter.js";
import type { CutoverBindings } from "../migration/master-tasks-cutover.js";
import type { HermesRuntimeClient } from "../hermes/contracts.js";
import {
  executionLinkStatePath,
  SqliteExecutionLinkStore,
} from "../integration/execution-link.js";
import {
  createRealMingTools,
  type RealMingToolDefinition,
  type RealMingToolResult,
} from "../integration/real-ming-tools.js";
import {
  createHermesSessionStore,
  type HermesSessionStore,
} from "../hermes/hermes-session-store.js";
import {
  createHermesTurnCoordinator,
  type HermesTurnCoordinator,
} from "../hermes/hermes-turn-coordinator.js";
import type { HermesProjectionBroker } from "../knowledge/hermes-projection.js";

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
  createMorningBriefComposer,
  type MorningBriefResult,
  type MorningBriefRunner,
} from "../operations/morning-brief.js";

import {
  createExecutiveRollUpRunner,
  createExecutiveRollUpComposer,
  type ExecutiveRollUpResult,
  type ExecutiveRollUpRunner,
} from "../operations/executive-roll-up.js";
import {
  createNativeScheduledReportService,
  type NativeScheduledReportRequest,
  type NativeScheduledReportResult,
  type NativeScheduledReportService,
} from "../operations/native-scheduled-reports.js";
import {
  createPersonalContextIngestion,
  type PersonalContextCandidate,
  type PersonalContextAllowlistEntry,
  type PersonalContextIngestion,
  type PersonalContextIngestionResult,
  type PersonalContextManifestEntry,
  type PersonalContextSourceReader,
  type PersonalContextSourceValue,
} from "../knowledge/personal-context-ingestion.js";
import {
  createPersonalContextProjectionBroker,
  type PersonalContextDrillDownRequest,
  type PersonalContextProjection,
  type PersonalContextProjectionBroker,
  type PersonalContextProjectionRequest,
} from "../knowledge/personal-context-projection.js";
import {
  createExceptionNoticeRhythm,
  type ExceptionNotice,
  type ExceptionNoticeAdmission,
  type ExceptionNoticeRhythm,
  type HeldRelease,
} from "../operations/exception-notice-rhythm.js";
import { createProviderObservationCoordinator } from "../operations/provider-observation-coordinator.js";
import {
  createPrivateWorker,
  createPrivateWorkerVerifier,
  type PrivateWorker,
  type PrivateWorkerExecutor,
  type PrivateWorkerHeartbeat,
  type PrivateWorkerJob,
  type PrivateWorkerCapability,
} from "../workers/private-worker.js";
import {
  ProjectPortfolio,
  type PortfolioProject,
  type PortfolioProjectInput,
  type PortfolioReconciliation,
} from "../portfolio/project-portfolio.js";
import {
  createProjectEvidenceBroker,
  type AgentBrainEvidenceProvider,
  type CandidateEnvelope,
  type ProjectEvidenceBroker,
  type ProjectEvidenceRequest,
  type ProjectEvidenceCandidateResult,
  type ProjectEvidenceResult,
} from "../evidence/evidence-broker.js";

import {
  createDailyOperationsScheduler,
  entertainmentEmailDigestJobDefinition,
  entertainmentEmailDigestJobName,
  executiveRollUpJobName,
  morningBriefJobName,
  releaseHeldJobName,
  schedulerJobInventory,
  type DailyOperationsScheduler,
  type DailyOperationsTick,
} from "../operations/daily-operations-scheduler.js";
import { dailyOccurrence } from "../operations/daily-schedule.js";

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
  runNativeScheduledReport(
    request: NativeScheduledReportRequest,
  ): Promise<NativeScheduledReportResult>;
  admitExceptionNotice(
    notification: ExceptionNotice,
  ): Promise<ExceptionNoticeAdmission>;
  recordExceptionNoticeRecovery(signature: string): Promise<ExceptionNoticeAdmission>;
  releaseHeldExceptionNotices(): Promise<HeldRelease>;
  tickDailyOperations(): Promise<DailyOperationsTick>;
  failNextScheduledRun(job: string): Promise<void>;
  hangNextScheduledRun(job: string): void;
  /** Simulate a process crash after claiming an occurrence but before completion. */
  claimScheduledRunWithoutCompletion(job: string): void;
  failNextMasterTasksUpsert(message: string): void;
  setMasterTasksUpsertFailure(message?: string): void;
  setExceptionNoticeAdmissionFailure(message?: string): void;
  setControlledWorkerExecutionError(message?: string): void;
  setTelegramDeliveryFailure(failure?: ProviderFailure): void;
  setTelegramCrashAfterDelivery(message?: string): void;
  acknowledgeCeoAction(
    action: NormalizedCeoAction,
  ): Promise<WorkItemAcknowledgement>;
  /** The Real-Ming extension Hermes reaches as tools. Not a separate seam. */
  realMingTools(): readonly RealMingToolDefinition[];
  callRealMingTool(
    name: string,
    args: Record<string, unknown>,
  ): RealMingToolResult;
  /** The provider-backed tools (calendar, scheduled reports) answer here. */
  callRealMingToolAsync(
    name: string,
    args: Record<string, unknown>,
  ): Promise<RealMingToolResult>;
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
  buildDeploymentCandidate(
    input: DeploymentCandidateBuildInput,
  ): DeploymentCandidateBuildResult;
  deploymentCandidate(id: string): DeploymentCandidate | undefined;
  requestDeploymentPromotionApproval(
    input: DeploymentPromotionApprovalRequest,
  ): Promise<DeploymentPromotionApprovalResult>;
  promoteDeploymentCandidate(
    input: DeploymentPromotionRequest,
  ): Promise<DeploymentPromotionResult>;
  deploymentPromotion(candidateId: string): DeploymentPromotionRecord | undefined;
  readEmailMailbox(request: {
    readonly mailbox: string;
    readonly mailboxKind: EmailMailboxKind;
    readonly query?: string;
  }): Promise<EmailReadResult>;
  captureEmailActionable(input: {
    readonly message: EmailMessage;
    readonly mailboxKind: EmailMailboxKind;
    readonly summary: string;
    readonly workstream: Extract<Workstream, "Personal Life" | "Career Job">;
    readonly idempotencyKey: string;
  }): Promise<EmailCaptureResult>;
  createEmailDraft(input: {
    readonly mailbox: string;
    readonly mailboxKind: EmailMailboxKind;
    readonly to: readonly string[];
    readonly cc?: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<EmailDraftResult>;
  sendEmailDraft(input: {
    readonly draft: import("../providers/email-provider-adapter.js").EmailDraft;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
  }): Promise<EmailSendResult>;
  emailProjection(input: Parameters<EmailOperationsCoordinator["projection"]>[0]): EmailApprovedProjection;
  runEntertainmentEmailDigest(): Promise<EntertainmentEmailDigestRunResult>;
  coordinateAcademicCommitment(
    request: AcademicCoordinationRequest,
  ): Promise<AcademicCoordinationResult>;
  coordinateContentWorkItem(
    request: ContentWorkflowRequest,
  ): Promise<ContentWorkflowResult>;
  groundCareerWorkItem(
    request: CareerGroundingRequest,
  ): Promise<CareerGroundingResult>;
  readDuitSiniRecord(
    id: string,
  ): Promise<ProviderReadResult<DuitSiniRecord>>;
  changeDuitSiniRecord(
    request: FinancialRecordChangeRequest,
  ): Promise<FinancialRecordChangeResult>;
  reconcileFinancialExports(): Promise<FinancialReconciliationResult>;
  prepareFinancialSnapshot(
    request: PrepareFinancialSnapshotRequest,
  ): Promise<PrepareFinancialSnapshotResult>;
  validateFinancialSnapshot(request: {
    readonly snapshotId: string;
    readonly reconciliationReference: string;
  }): ValidateFinancialSnapshotResult;
  requestFinancialSnapshotApproval(
    snapshotId: string,
  ): Promise<PresentFinancialSnapshotResult>;
  completeFinancialSnapshot(
    snapshotId: string,
  ): Promise<CompleteFinancialSnapshotResult>;
  financialSnapshot(id: string): FinancialSnapshot | undefined;
  financialSnapshots(): readonly FinancialSnapshot[];
  recordCostObservation(input: CostObservationInput): RecordCostObservationResult;
  costByGrouping(period: string): CostGroupings;
  proposeCostBudget(request: {
    readonly scope: CostBudgetScope;
    readonly key: string;
    readonly amount: string;
  }): { readonly kind: "proposed"; readonly budget: CostBudget };
  requestCostBudgetApproval(budgetId: string): Promise<
    | { readonly kind: "approval-required"; readonly approvalId: string }
    | { readonly kind: "refused"; readonly reason: "unknown-budget" }
  >;
  confirmCostBudget(budgetId: string): Promise<
    | { readonly kind: "approved"; readonly budget: CostBudget }
    | {
        readonly kind: "refused";
        readonly reason: "unknown-budget" | "approval-not-granted";
      }
  >;
  costBudget(scope: CostBudgetScope, key: string): CostBudget | undefined;
  routeModelWork(request: ModelRoutingRequest): ModelRoutingResult;
  enableProjectEvidence(): Promise<EvidenceEnablementResult>;
  compileKnowledgeCandidate(
    candidate: CandidateEnvelope,
  ): KnowledgeCompilationResult;
  knowledgeJobDefinitions(): readonly KnowledgeJobDefinition[];
  knowledgeJobHealth(): readonly KnowledgeJobHealth[];
  knowledgeHealth(): readonly KnowledgeDomainHealth[];
  knowledgeStagedCandidates(): readonly CandidateEnvelope[];
  compiledKnowledgePages(): readonly CompiledKnowledgePage[];
  operationalKnowledgeOutputs(): readonly KnowledgeOperationalRecord[];
  retentionPurgeEvidence(): readonly RetentionPurgeEvent[];
  runKnowledgeJob(job: KnowledgeJobDefinition["job"]): Promise<void>;
  readVaultPage(root: VaultRoot, path: string): string | undefined;
  vaultGenerations(root: VaultRoot): readonly VaultGeneration[];
  vaultPurgeEvents(root?: VaultRoot): readonly import("../knowledge/knowledge-vault.js").VaultPurgeEvent[];
  vaultGenerationFileCount(root: VaultRoot, generationId: string): number;
  serveCompiledKnowledge(
    query: CompiledKnowledgeQuery,
  ): CompiledKnowledgeResult;
  attemptAcademicSubmission(request: {
    readonly courseId: string;
    readonly assignmentId: string;
  }): Promise<AcademicSubmissionResult>;
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
  hermesOverview(): import("../hermes/hermes-turn-coordinator.js").HermesConversationOverview | undefined;
  recordProviderObservation(
    record: ProviderObservationInput,
  ): Promise<ProviderObservationTransition>;
  providerObservations(): readonly ProviderObservation[];
  ingestPersonalContext(
    entry: PersonalContextManifestEntry,
  ): Promise<PersonalContextIngestionResult>;
  personalContextCandidates(): readonly PersonalContextCandidate[];
  readPersonalContext(
    candidateId: string,
    executive: ExecutiveRole,
  ): string;
  personalContextStagingFiles(): readonly string[];
  purgePersonalContext(at?: string): readonly string[];
  servePersonalContextProjection(
    request: PersonalContextProjectionRequest,
  ): PersonalContextProjection;
  drillDownPersonalContext(request: PersonalContextDrillDownRequest): string;
  personalContextAuditTrail(workItemId: string): readonly AuditEvent[];
  setPersonalContextSource(
    sourceKey: string,
    value: PersonalContextSourceValue,
  ): void;
  upsertPortfolioProject(input: PortfolioProjectInput): PortfolioProject;
  portfolioProject(id: string): PortfolioProject | undefined;
  portfolioProjects(): readonly PortfolioProject[];
  portfolioReconciliation(id: string): PortfolioReconciliation;
  setRepositoryCenterView(projectId: string, view: RepositoryCenterView): void;
  repositoryCenterView(projectId: string): RepositoryCenterView | undefined;
  bindPortfolioProject(workItemId: string, projectId: string): void;
  serveProjectEvidence(request: ProjectEvidenceRequest): Promise<ProjectEvidenceResult>;
  captureProjectEvidenceCandidate(
    request: ProjectEvidenceRequest,
  ): Promise<ProjectEvidenceCandidateResult>;
  evidenceAuditTrail(workItemId: string): readonly AuditEvent[];
  privateWorkerHeartbeat(): PrivateWorkerHeartbeat | undefined;
  privateWorkerJobs(): readonly PrivateWorkerJob[];
  setPrivateWorkerAvailable(available: boolean): void;
  expirePrivateWorkerLeases(at?: string): void;
  executePrivateWorkerEffect(effect: WorkerEffect): Promise<WorkerReceipt>;
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
    private readonly receiptEffect?: WorkerEffect,
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
      effect: this.receiptEffect ?? effect,
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

class ControlledDeploymentPromotionExecutor implements DeploymentPromotionExecutor {
  readonly #calls: string[] = [];

  constructor(
    private readonly options: {
      readonly merge?: "ok" | "failed";
      readonly verification?: "verified" | "failed";
      readonly verificationEvidence?: "present" | "missing";
      readonly verificationInvalid?: boolean;
      readonly rollback?: "rolled-back" | "failed";
      readonly freshness?: "current" | "drifted";
    },
  ) {}

  async verifyCandidateBeforeMerge(input: Parameters<DeploymentPromotionExecutor["verifyCandidateBeforeMerge"]>[0]) {
    if (this.options.freshness === "drifted") {
      return { kind: "drifted" as const, commitSha: "sha-drifted", reason: "candidate-drift" as const };
    }
    return { kind: "current" as const, commitSha: input.candidate.exactCommitSha };
  }

  async mergeDraftPullRequest(input: Parameters<DeploymentPromotionExecutor["mergeDraftPullRequest"]>[0]) {
    this.#calls.push(`merge:${input.candidate.id}`);
    if (this.options.merge === "failed") return { kind: "failed" as const, reason: "provider-error" as const };
    return {
      kind: "merged" as const,
      commitSha: input.candidate.exactCommitSha,
      effectReference: `github:merge:${input.candidate.pullRequest.number}`,
    };
  }

  async verifyProduction(input: Parameters<DeploymentPromotionExecutor["verifyProduction"]>[0]) {
    this.#calls.push(`verify:${input.candidate.id}`);
    if (this.options.verificationInvalid === true) {
      return { kind: "verified" as const, commitSha: input.candidate.exactCommitSha, evidenceReference: "", asOf: "not-a-date", assertions: [""] };
    }
    if (this.options.verification === "failed") {
      return this.options.verificationEvidence === "missing"
        ? { kind: "failed" as const, reason: "verification-failed" as const }
        : { kind: "failed" as const, reason: "verification-failed" as const, evidenceReference: "verification:production:failed", asOf: "2026-09-02T10:00:00.000Z" };
    }
    return {
      kind: "verified" as const,
      commitSha: input.candidate.exactCommitSha,
      evidenceReference: "verification:production:candidate",
      asOf: "2026-09-02T09:55:00.000Z",
      assertions: ["Production serves the approved candidate commit."],
    };
  }

  async rollback(input: Parameters<DeploymentPromotionExecutor["rollback"]>[0]) {
    this.#calls.push(`rollback:${input.candidate.id}`);
    if (this.options.rollback === "failed") return { kind: "failed" as const, reason: "rollback-failed" as const };
    return {
      kind: "rolled-back" as const,
      commitSha: input.candidate.rollback.commitSha,
      effectReference: input.candidate.rollback.sourceReference,
    };
  }

  calls(): readonly string[] {
    return [...this.#calls];
  }
}

export function createRealMingSystemHarness(options: {
  readonly statePath: string;
  readonly controlledQuestionAnswer?: string;
  readonly controlledWorker?: {
    readonly executionError?: string;
    readonly receiptEvidence?: Readonly<Record<string, string>>;
    /** Controlled seam for proving the gateway never persists untrusted receipt metadata. */
    readonly receiptEffect?: WorkerEffect;
  };
  readonly privateWorker?: {
    readonly available?: boolean;
    readonly capabilities?: readonly PrivateWorkerCapability[];
    readonly executor?: PrivateWorkerExecutor;
  };
  readonly controlledVerifier?: {
    readonly result: "verify" | "error";
    readonly errorMessage?: string;
    readonly evidence?: Readonly<Record<string, string>>;
  };
  readonly deploymentPromotion?: {
    readonly merge?: "ok" | "failed";
    readonly verification?: "verified" | "failed";
    readonly rollback?: "rolled-back" | "failed";
    readonly freshness?: "current" | "drifted";
  };
  /** Optional controlled Gmail adapter for RM-29 system scenarios. */
  readonly emailAdapter?: GmailEmailAdapter;
  readonly emailMailboxBindings?: Readonly<Record<EmailMailboxKind, string>>;
  readonly canvasAdapter?: CanvasAdapter;
  readonly microsoft365Adapter?: Microsoft365Adapter;
  readonly duitsini?: { readonly adapter: DuitSiniAdapter };
  readonly knowledgeVault?: {
    readonly encryptionKey: string;
    readonly statePath?: string;
  };
  readonly knowledgeOperations?: {
    readonly sources?: readonly KnowledgeSource[];
    readonly outputs?: readonly KnowledgeOperationalOutput[];
    readonly backup?: () => Promise<void>;
    readonly purgeBackups?: (at: string) => Promise<readonly import("../operations/retention-policy.js").RetentionBackupPurgeResult[]>;
    readonly runnerTimeoutMs?: number;
    readonly retentionRequired?: boolean;
  };
  readonly evidenceEnablement?: {
    readonly candidates: readonly EvidenceEnablementCandidate[];
    readonly healthFailureFor?: string;
  };
  readonly financialExports?: {
    readonly sources: readonly FinancialExportSource[];
  };
  readonly financialSnapshots?: {
    readonly beforeSuccessorInsert?: () => void;
  };
  readonly career?: {
    readonly files: Readonly<Record<string, CareerFile>>;
  };
  readonly academic?: {
    readonly courseId: string;
    readonly mailbox: string;
    readonly teamsChannel?: string;
    readonly calendarId?: string;
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
  readonly schedulerRunnerTimeoutMs?: number;
  readonly personalContext?: {
    readonly statePath: string;
    readonly stagingDirectory: string;
    readonly repositoryRoot: string;
    readonly encryptionKey: string;
    readonly sources: Readonly<Record<string, PersonalContextSourceValue>>;
    readonly allowlist: readonly PersonalContextAllowlistEntry[];
    readonly sourceReader?: PersonalContextSourceReader;
  };
  readonly evidence?: {
    readonly provider: AgentBrainEvidenceProvider;
  };
  /** Optional Hermes runtime used by the Telegram integration seam. */
  readonly hermes?: {
    readonly runtime: HermesRuntimeClient;
    readonly projection?: HermesProjectionBroker;
    readonly model?: string;
  };
}): RealMingSystemHarness {
  const state = new OperationsState(options.statePath);
  // Opened on first use, not at construction. Several scenarios deliberately
  // make harness construction throw, and a handle opened before that point is
  // never closed -- which on Windows leaves the temp directory undeletable and
  // fails an unrelated test's cleanup.
  let executionLinks: SqliteExecutionLinkStore | undefined;
  const links = (): SqliteExecutionLinkStore => {
    executionLinks ??= new SqliteExecutionLinkStore(
      executionLinkStatePath(options.statePath),
    );
    return executionLinks;
  };
  const realMingTools = createRealMingTools({
    workItems: () => state.workItems(),
    workItem: (id) => state.workItem(id),
    links: {
      link: (request) => links().link(request),
      forWorkItem: (workItemId) => links().forWorkItem(workItemId),
      close: () => links().close(),
    },
    now: () => (options.now ?? (() => new Date().toISOString()))(),
    // Registered only where a calendar is actually configured, so an agent
    // never holds a tool that can answer nothing.
    ...(options.calendar === undefined
      ? {}
      : {
          calendar: {
            listEvents: async ({
              calendarId,
            }: {
              readonly calendarId: string;
            }) => {
              const result = await calendarAdapter.listEvents(calendarId);
              if (result.kind === "failed") {
                return {
                  kind: "unavailable" as const,
                  reason: result.failure.message,
                };
              }
              return {
                kind: "ok" as const,
                events: result.value.map((event) => ({
                  title: event.title,
                  start: event.start,
                  end: event.end,
                  allDay: event.allDay,
                  status: event.status,
                })),
              };
            },
          },
        }),
  });
  const deploymentCandidateStore = new SqliteDeploymentCandidateStore(
    deploymentCandidateStatePath(options.statePath),
  );
  const deploymentPromotionStore = new SqliteDeploymentPromotionStore(
    deploymentPromotionStatePath(options.statePath),
  );
  const portfolio = new ProjectPortfolio(
    options.statePath,
    options.now,
  );
  const repositoryCenters = new Map<string, RepositoryCenterView>();
  const evidenceBroker: ProjectEvidenceBroker | undefined =
    options.evidence === undefined
      ? undefined
      : createProjectEvidenceBroker({
          state,
          portfolio,
          provider: options.evidence.provider,
          ...(options.now === undefined ? {} : { now: options.now }),
          recordAudit: (workItemId, type, occurredAt, details) =>
            state.recordAuditEvent(
              workItemId,
              type,
              occurredAt,
              details,
            ),
        });
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
  const personalContextSources = new Map(
    Object.entries(options.personalContext?.sources ?? {}),
  );
  const controlledPersonalContextReader: PersonalContextSourceReader = {
    read: async (entry) => {
      const source = personalContextSources.get(
        `${entry.sourceSystem}:${entry.sourceReference}`,
      );
      if (source === undefined) {
        throw new Error(
          `Controlled Personal Context source ${entry.sourceReference} was not found.`,
        );
      }
      return source;
    },
  };
  const personalContextReader =
    options.personalContext?.sourceReader ?? controlledPersonalContextReader;
  let personalContext: PersonalContextIngestion | undefined;
  let personalContextProjection: PersonalContextProjectionBroker | undefined;
  try {
    personalContext =
      options.personalContext === undefined
        ? undefined
        : createPersonalContextIngestion({
            statePath: options.personalContext.statePath,
            stagingDirectory: options.personalContext.stagingDirectory,
            repositoryRoot: options.personalContext.repositoryRoot,
            encryptionKey: options.personalContext.encryptionKey,
            allowlist: options.personalContext.allowlist,
            sourceReader: personalContextReader,
            ...(options.now === undefined ? {} : { now: options.now }),
          });
    personalContextProjection =
      personalContext === undefined
        ? undefined
        : createPersonalContextProjectionBroker({
            ingestion: personalContext,
            ...(options.now === undefined ? {} : { now: options.now }),
            recordAudit: (workItemId, type, occurredAt, details) => {
              const workItem = state.workItem(workItemId);
              if (workItem === undefined) {
                throw new Error("The Personal Context projection Work Item scope was not found.");
              }
              const executive = details["executive"];
              if (
                typeof executive === "string" &&
                workItem.accountableExecutive !== executive &&
                !workItem.collaboratingExecutives.some(
                  (assignment) => assignment.executive === executive,
                )
              ) {
                throw new Error("The Personal Context projection Executive is outside the Work Item scope.");
              }
              state.recordAuditEvent(workItemId, type, occurredAt, details);
            },
          });
  } catch (error) {
    portfolio.close();
    deploymentCandidateStore.close();
    deploymentPromotionStore.close();
    state.close();
    throw error;
  }
  for (const workItem of state.workItems()) {
    masterTaskRecords.set(workItem.id, masterTasks.recordFor(workItem));
  }
  const ledger = new ControlledEffectLedger();
  const controlledWorker = new InMemoryControlledWorker(
    ledger,
    options.controlledWorker?.executionError,
    options.controlledWorker?.receiptEvidence,
    options.controlledWorker?.receiptEffect,
  );
  const privateWorker: PrivateWorker | undefined =
    options.privateWorker === undefined
      ? undefined
      : createPrivateWorker({
          statePath: options.statePath,
          ...(options.privateWorker.available === undefined
            ? {}
            : { available: options.privateWorker.available }),
          ...(options.privateWorker.capabilities === undefined
            ? {}
            : { capabilities: options.privateWorker.capabilities }),
          ...(options.now === undefined ? {} : { now: options.now }),
          executor:
            options.privateWorker.executor ??
            (async (job) => ({
              evidence: {
                workerId: "lenovo-private-worker",
                expectedEvidence: job.expectedEvidence,
              },
              sourceReferences: job.sourceReferences,
              completedAt: options.now?.() ?? new Date().toISOString(),
            })),
        });
  const worker: ControlledWorker =
    privateWorker === undefined
      ? controlledWorker
      : {
          async execute(effect) {
            const receipt = await privateWorker.execute(effect);
            // The ledger is only the harness's verifier input. The Operations
            // State still records the bounded effect reference, not raw worker
            // output; verification remains mandatory before Review-Ready.
            ledger.record(receipt);
            return receipt;
          },
        };
  const controlledVerifier = new ControlledEffectVerifier(
    ledger,
    options.controlledVerifier?.result,
    options.controlledVerifier?.errorMessage,
    options.controlledVerifier?.evidence,
  );
  const verifier: EffectVerifier =
    privateWorker !== undefined && options.controlledVerifier === undefined
      ? createPrivateWorkerVerifier()
      : controlledVerifier;
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
  const hermesStore: HermesSessionStore | undefined = options.hermes === undefined
    ? undefined
    : createHermesSessionStore(
        options.statePath === ":memory:" ? ":memory:" : `${options.statePath}.hermes.sqlite`,
      );
  const hermesCoordinator: HermesTurnCoordinator | undefined =
    options.hermes === undefined || hermesStore === undefined
      ? undefined
      : createHermesTurnCoordinator({
          runtime: options.hermes.runtime,
          sessions: hermesStore,
          gateway,
          ...(options.hermes.projection === undefined ? {} : { projection: options.hermes.projection }),
          ...(options.hermes.model === undefined ? {} : { model: options.hermes.model }),
          workItem: (id) => state.workItem(id),
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
  const clock = options.now ?? (() => new Date().toISOString());
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
    ...(hermesCoordinator === undefined ? {} : { hermesTurn: hermesCoordinator }),
  });
  const deploymentPromotionExecutor = new ControlledDeploymentPromotionExecutor(
    options.deploymentPromotion ?? {},
  );
  const deploymentPromotion = createDeploymentPromotionCoordinator({
    candidates: deploymentCandidateStore,
    promotions: deploymentPromotionStore,
    state,
    gateway,
    ...(options.deploymentPromotion === undefined ? {} : { executor: deploymentPromotionExecutor }),
    notify: (notification) => telegramFrontDoor.notify(notification),
    now: clock,
  });
  const emailOperations = options.emailAdapter === undefined
    ? undefined
    : createEmailOperationsCoordinator({
        adapter: options.emailAdapter,
        gateway,
        mailboxBindings: options.emailMailboxBindings ?? { personal: "personal@example.test", opportunity: "personal@example.test", entertainment: "personal@example.test" },
      });
  const academicCoordinator =
    options.canvasAdapter === undefined ||
    options.microsoft365Adapter === undefined ||
    options.academic === undefined
      ? undefined
      : createAcademicCoordinator({
          canvas: options.canvasAdapter,
          microsoft365: options.microsoft365Adapter,
          gateway,
          state,
          courseId: options.academic.courseId,
          mailbox: options.academic.mailbox,
          teamsChannel: options.academic.teamsChannel ?? "academic",
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          calendar: calendarReconciler,
          ...(options.academic.calendarId === undefined
            ? {}
            : { calendarId: options.academic.calendarId }),
        });
  const knowledgeVault: KnowledgeVault | undefined =
    options.knowledgeVault === undefined
      ? undefined
      : createKnowledgeVault({
          statePath: options.knowledgeVault.statePath ?? ":memory:",
          encryptionKey: options.knowledgeVault.encryptionKey,
          ...(options.now === undefined ? {} : { now: options.now }),
        });
  const knowledgeCompiler =
    knowledgeVault === undefined
      ? undefined
      : createKnowledgeCompiler({
          vault: knowledgeVault,
          actorId: "ceo:ming",
          now: clock,
        });
  let knowledgeOperations: KnowledgeOperations | undefined;

  const hermesProjection = createHermesProjectionBroker({
    state,
    pages: () => knowledgeCompiler?.pages() ?? [],
  });
  const evidenceEnablement = createEvidenceEnablementCoordinator({
    candidates: options.evidenceEnablement?.candidates ?? [],
    portfolio,
    evidenceBroker,
    gateway,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    inspector: {
      restart: async () => true,
      healthy: async (evidenceIdentity) =>
        evidenceIdentity !== options.evidenceEnablement?.healthFailureFor,
      storageInspected: async () => true,
    },
    now: clock,
  });
  const meteredCost = createMeteredCostLedger({
    gateway,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    now: clock,
  });
  const financialSnapshots = createFinancialSnapshotLedger({
    gateway,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    statePath: options.statePath,
    now: clock,
    ...(options.financialSnapshots?.beforeSuccessorInsert === undefined
      ? {}
      : {
          beforeSuccessorInsert:
            options.financialSnapshots.beforeSuccessorInsert,
        }),
  });
  const financialReconciliation = createFinancialReconciliationCoordinator({
    sources: options.financialExports?.sources ?? [],
    gateway,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    now: clock,
  });
  const financialRecordChange =
    options.duitsini === undefined
      ? undefined
      : createFinancialRecordChangeCoordinator({
          adapter: options.duitsini.adapter,
          gateway,
          state,
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        });
  const careerGroundingCoordinator = createCareerGroundingCoordinator({
    gateway,
    files: options.career?.files ?? {},
    privateWorker,
    evidenceBroker,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    now: clock,
  });
  const contentWorkflowCoordinator = createContentWorkflowCoordinator({
    portfolio,
    gateway,
    evidenceBroker,
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
  });
  const calendarId = options.morningBrief?.calendarId ?? "";
  const exceptionNoticeRhythm: ExceptionNoticeRhythm = createExceptionNoticeRhythm({
    state,
    notify: (notification) => telegramFrontDoor.notify(notification),
    now: clock,
  });
  let exceptionNoticeAdmissionFailure: string | undefined;
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
    if (exceptionNoticeAdmissionFailure !== undefined) {
      throw new Error(exceptionNoticeAdmissionFailure);
    }
    try {
      const admission = await exceptionNoticeRhythm.admit(notice);
      recordExceptionNoticeHealth(admission);
      return admission;
    } catch (error) {
      recordExceptionNoticeHealth(undefined, true);
      throw error;
    }
  };
  const entertainmentEmailDigest = emailOperations === undefined
    ? undefined
    : createEntertainmentEmailDigestRunner({
        coordinator: emailOperations,
        mailbox: options.emailMailboxBindings?.entertainment ?? "personal@example.test",
        admit: admitTracked,
        now: clock,
      });
  const providerObservationCoordinator = createProviderObservationCoordinator({
    state,
    notices: exceptionNoticeRhythm,
  });
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
  const forcedHangs = new Set<string>();
  if (knowledgeCompiler !== undefined && knowledgeVault !== undefined) {
    knowledgeOperations = createKnowledgeOperations({
      state,
      compiler: knowledgeCompiler,
      vault: knowledgeVault,
      now: clock,
      ...(options.knowledgeOperations?.sources === undefined
        ? {}
        : { sources: options.knowledgeOperations.sources }),
      ...(options.knowledgeOperations?.outputs === undefined
        ? {}
        : { outputs: options.knowledgeOperations.outputs }),
      ...(personalContext === undefined ? {} : { personalContext }),
      ...(options.knowledgeOperations?.backup === undefined
        ? {}
        : { backup: options.knowledgeOperations.backup }),
      ...(options.knowledgeOperations?.purgeBackups === undefined
        ? {}
        : { purgeBackups: options.knowledgeOperations.purgeBackups }),
      ...(options.knowledgeOperations?.runnerTimeoutMs === undefined
        ? {}
        : { runnerTimeoutMs: options.knowledgeOperations.runnerTimeoutMs }),
      ...(options.knowledgeOperations?.retentionRequired === undefined
        ? {}
        : { retentionRequired: options.knowledgeOperations.retentionRequired }),
      admitExceptionNotice: admitTracked,
      recordExceptionNoticeRecovery: async (signature, details) => {
        const admission = await exceptionNoticeRhythm.recordRecovery(
          signature,
          details,
        );
        recordExceptionNoticeHealth(admission);
        return admission;
      },
      failureFor: (job) =>
        forcedFailures.delete(job)
          ? `Controlled failure of the ${job} job.`
          : undefined,
      hangFor: (job) => forcedHangs.delete(job),
    });
  }
  const executiveRollUpComposer = createExecutiveRollUpComposer({
    state,
    workspaceId: "workspace:real-ming",
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const executiveRollUp: ExecutiveRollUpRunner = createExecutiveRollUpRunner({
    state,
    workspaceId: "workspace:real-ming",
    admit: admitTracked,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const morningBriefComposer =
    options.morningBrief === undefined
      ? undefined
      : createMorningBriefComposer({
          state,
          listEvents: (window) =>
            calendarAdapter.listEvents(calendarId, window),
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
  const nativeScheduledReports: NativeScheduledReportService | undefined =
    morningBriefComposer === undefined
      ? undefined
      : createNativeScheduledReportService({
          state,
          morningBrief: morningBriefComposer,
          executiveRollUp: executiveRollUpComposer,
          ...(options.now === undefined ? {} : { now: options.now }),
        });

  const guarded = (job: string, run: () => Promise<unknown>) => async () => {
    if (forcedFailures.delete(job)) {
      throw new Error(`Controlled failure of the ${job} job.`);
    }
    if (forcedHangs.delete(job)) {
      await new Promise<never>(() => undefined);
    }
    return run();
  };
  const schedulerJobs = [
    ...(entertainmentEmailDigest === undefined
      ? schedulerJobInventory
      : [...schedulerJobInventory, entertainmentEmailDigestJobDefinition]),
    ...(knowledgeOperations?.definitions ?? []),
  ];
  const runEntertainmentEmailDigestJob = async (): Promise<void> => {
    if (entertainmentEmailDigest === undefined) return;
    const result = await entertainmentEmailDigest.run();
    if (result.kind === "failed") {
      throw new Error(`Entertainment email digest failed (${result.failure.class}).`);
    }
    if (result.kind === "denied") {
      throw new Error("Entertainment email digest mailbox is not authorized.");
    }
  };
  const dailyOperations: DailyOperationsScheduler =
    createDailyOperationsScheduler({
      state,
      now: clock,
      ...(options.schedulerRunnerTimeoutMs === undefined
        ? {}
        : { runnerTimeoutMs: options.schedulerRunnerTimeoutMs }),
      admitExceptionNotice: admitTracked,
      recordExceptionNoticeRecovery: async (signature, details) => {
        const admission = await exceptionNoticeRhythm.recordRecovery(
          signature,
          details,
        );
        recordExceptionNoticeHealth(admission);
        return admission;
      },
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
        ...(entertainmentEmailDigest === undefined
          ? {}
          : { [entertainmentEmailDigestJobName]: guarded(entertainmentEmailDigestJobName, runEntertainmentEmailDigestJob) }),
      },
      jobs: schedulerJobs,
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
    runNativeScheduledReport: (request) => {
      if (nativeScheduledReports === undefined) {
        throw new Error(
          "This harness was not configured with native scheduled reports.",
        );
      }
      return nativeScheduledReports.run(request);
    },
    admitExceptionNotice: admitTracked,
    recordExceptionNoticeRecovery: async (signature) => {
      const admission = await exceptionNoticeRhythm.recordRecovery(signature);
      recordExceptionNoticeHealth(admission);
      return admission;
    },
    releaseHeldExceptionNotices: () => releaseHeldTracked(),
    tickDailyOperations: async () => {
      const knowledgeTick = await knowledgeOperations?.scheduler.tick();
      const operationsTick = await dailyOperations.tick();
      return {
        now: operationsTick.now,
        ran: [ ...(knowledgeTick?.ran ?? []), ...operationsTick.ran ],
        failed: [ ...(knowledgeTick?.failed ?? []), ...operationsTick.failed ],
        notYetDue: [ ...(knowledgeTick?.notYetDue ?? []), ...operationsTick.notYetDue ],
        alreadyRun: [ ...(knowledgeTick?.alreadyRun ?? []), ...operationsTick.alreadyRun ],
      };
    },
    failNextScheduledRun: async (job) => {
      forcedFailures.add(job);
    },
    hangNextScheduledRun: (job) => {
      forcedHangs.add(job);
    },
    claimScheduledRunWithoutCompletion: (job) => {
      const definition = schedulerJobs.find((candidate) => candidate.job === job);
      if (definition === undefined) {
        throw new Error(`Controlled scheduler job ${job} is not registered.`);
      }
      const occurrence = dailyOccurrence({
        now: clock(),
        hour: definition.hour,
        minute: definition.minute,
        job,
      });
      const claim = state.claimSchedulerRun({
        job,
        occurrenceDate: occurrence.occurrenceDate,
        scheduledAt: occurrence.scheduledAt,
        startedAt: clock(),
      });
      if (claim.kind !== "claimed") {
        throw new Error(`Controlled scheduler job ${job} was already completed.`);
      }
    },
    failNextMasterTasksUpsert: (message) => {
      nextMasterTasksUpsertError = message;
    },
    setMasterTasksUpsertFailure: (message) => {
      masterTasksUpsertFailure = message;
    },
    setExceptionNoticeAdmissionFailure: (message) => {
      exceptionNoticeAdmissionFailure = message;
    },
    setControlledWorkerExecutionError: (message) => {
      if (privateWorker !== undefined) {
        throw new Error("The private worker is configured; replace its executor to inject failures.");
      }
      controlledWorker.setExecutionError(message);
    },
    setTelegramDeliveryFailure: (failure) => {
      telegramTransport.setFailure(failure);
    },
    setTelegramCrashAfterDelivery: (message) => {
      telegramTransport.setCrashAfterDelivery(message);
    },
    buildCutoverPlanFromEvidence: (evidence) => buildCutoverPlan(evidence),
    buildDeploymentCandidate: (input) => {
      const result = buildDeploymentCandidate(input);
      return result.kind === "candidate"
        ? { kind: "candidate", candidate: deploymentCandidateStore.save(result.candidate) }
        : result;
    },
    deploymentCandidate: (id) => deploymentCandidateStore.candidate(id),
    requestDeploymentPromotionApproval: (input) => deploymentPromotion.requestApproval(input),
    promoteDeploymentCandidate: (input) => deploymentPromotion.promote(input),
    deploymentPromotion: (candidateId) => deploymentPromotionStore.latestForCandidate(candidateId),
    readEmailMailbox: async (input) => {
      if (emailOperations === undefined) return { kind: "failed", failure: { class: "unsupported-capability", retryable: false, message: "Email operations are not configured." } };
      return emailOperations.readMailbox(input);
    },
    captureEmailActionable: async (input) => {
      if (emailOperations === undefined) throw new Error("Email operations are not configured.");
      return emailOperations.captureActionable(input);
    },
    createEmailDraft: async (input) => {
      if (emailOperations === undefined) return { kind: "failed", failure: { class: "unsupported-capability", retryable: false, message: "Email operations are not configured." } };
      return emailOperations.createDraft(input);
    },
    sendEmailDraft: async (input) => {
      if (emailOperations === undefined) return { kind: "failed", failure: { class: "unsupported-capability", retryable: false, message: "Email operations are not configured." } };
      return emailOperations.sendDraft(input);
    },
    emailProjection: (input) => {
      if (emailOperations === undefined) throw new Error("Email operations are not configured.");
      return emailOperations.projection(input);
    },
    coordinateContentWorkItem: (request) =>
      contentWorkflowCoordinator.coordinate(request),
    groundCareerWorkItem: (request) => careerGroundingCoordinator.ground(request),
    readDuitSiniRecord: async (id) => {
      if (financialRecordChange === undefined) {
        return {
          kind: "failed",
          failure: { class: "unsupported-capability", retryable: false, message: "DuitSini is not configured." },
        };
      }
      return financialRecordChange.readRecord(id);
    },
    reconcileFinancialExports: () => financialReconciliation.reconcile(),
    prepareFinancialSnapshot: async (request) => financialSnapshots.prepare(request),
    validateFinancialSnapshot: (request) => financialSnapshots.validate(request),
    requestFinancialSnapshotApproval: (snapshotId) =>
      financialSnapshots.present(snapshotId),
    completeFinancialSnapshot: (snapshotId) =>
      financialSnapshots.complete(snapshotId),
    financialSnapshot: (id) => financialSnapshots.snapshot(id),
    financialSnapshots: () => financialSnapshots.snapshots(),
    recordCostObservation: (input) => meteredCost.record(input),
    costByGrouping: (period) => meteredCost.grouping(period),
    proposeCostBudget: (request) => meteredCost.proposeBudget(request),
    requestCostBudgetApproval: (budgetId) =>
      meteredCost.requestBudgetApproval(budgetId),
    confirmCostBudget: (budgetId) => meteredCost.confirmBudget(budgetId),
    costBudget: (scope, key) => meteredCost.budget(scope, key),
    routeModelWork: (request) => meteredCost.route(request),
    enableProjectEvidence: () => evidenceEnablement.enable(),
    compileKnowledgeCandidate: (candidate) => {
      if (knowledgeCompiler === undefined) {
        return { kind: "rejected", reason: "uncited" };
      }
      return knowledgeCompiler.compile(candidate);
    },
    knowledgeJobDefinitions: () => knowledgeOperations?.definitions ?? knowledgeJobInventory,
    knowledgeJobHealth: () => knowledgeOperations?.jobHealth ?? [],
    knowledgeHealth: () => knowledgeOperations?.domainHealth ?? [],
    knowledgeStagedCandidates: () => knowledgeOperations?.stagedCandidates ?? [],
    compiledKnowledgePages: () => knowledgeCompiler?.pages() ?? [],
    operationalKnowledgeOutputs: () => knowledgeCompiler?.operationalOutputs() ?? [],
    retentionPurgeEvidence: () => state.retentionPurgeEvents(),
    runKnowledgeJob: async (job) => {
      if (knowledgeOperations === undefined) {
        throw new Error("Knowledge Operations are not configured.");
      }
      await knowledgeOperations.runJob(job);
    },
    readVaultPage: (root, path) =>
      knowledgeVault?.readForCeo(root, path, "ceo:ming"),
    vaultGenerations: (root) => knowledgeVault?.generations(root) ?? [],
    vaultPurgeEvents: (root) => knowledgeVault?.purgeEvents(root) ?? [],
    vaultGenerationFileCount: (root, generationId) =>
      knowledgeVault?.generationFileCount(root, generationId) ?? 0,
    serveCompiledKnowledge: (query) => hermesProjection.serve(query),
    changeDuitSiniRecord: async (request) => {
      if (financialRecordChange === undefined) {
        return { kind: "denied", reason: "record-not-found" };
      }
      return financialRecordChange.change(request);
    },
    coordinateAcademicCommitment: async (request) => {
      if (academicCoordinator === undefined) {
        return {
          kind: "failed",
          failure: { class: "unsupported-capability", retryable: false, message: "Academic coordination is not configured." },
        };
      }
      return academicCoordinator.coordinate(request);
    },
    attemptAcademicSubmission: async (request) => {
      if (academicCoordinator === undefined) {
        return { kind: "denied", reason: "submission-excluded" };
      }
      return academicCoordinator.attemptSubmission(request);
    },
    runEntertainmentEmailDigest: async () => {
      if (entertainmentEmailDigest === undefined) return { kind: "failed", failure: { class: "unsupported-capability", retryable: false, message: "Email operations are not configured." } };
      return entertainmentEmailDigest.run();
    },
    acknowledgeCeoAction: (action) => gateway.acknowledgeCeoAction(action),
    realMingTools: () => realMingTools.list(),
    callRealMingTool: (name, args) => realMingTools.call(name, args),
    callRealMingToolAsync: async (name, args) =>
      realMingTools.callAsync === undefined
        ? realMingTools.call(name, args)
        : realMingTools.callAsync(name, args),
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
      buildDashboardOverview(
        state,
        { ...session, now: clock() },
        portfolio,
        repositoryCenters,
        deploymentCandidateStore,
        schedulerJobs,
        knowledgeOperations?.domainHealth ?? [],
        hermesCoordinator?.overview(),
      ),
    hermesOverview: () => hermesCoordinator?.overview(),
    recordProviderObservation: (record) =>
      providerObservationCoordinator.observe(record),
    providerObservations: () => state.providerObservations(),
    ingestPersonalContext: async (entry) => {
      if (personalContext === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      return personalContext.ingest(entry);
    },
    personalContextCandidates: () => personalContext?.candidates() ?? [],
    readPersonalContext: (candidateId, executive) => {
      if (personalContext === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      return personalContext.read(candidateId, executive).content;
    },
    personalContextStagingFiles: () => personalContext?.stagingFiles() ?? [],
    purgePersonalContext: (at) => {
      if (personalContext === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      return personalContext.purgeExpired(at);
    },
    servePersonalContextProjection: (request) => {
      if (personalContextProjection === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      return personalContextProjection.serve(request);
    },
    drillDownPersonalContext: (request) => {
      if (personalContextProjection === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      return personalContextProjection.drillDown(request);
    },
    personalContextAuditTrail: (workItemId) =>
      state
        .auditTrail(workItemId)
        .filter((event) => event.type.startsWith("personal-context.")),
    setPersonalContextSource: (sourceKey, value) => {
      if (personalContext === undefined) {
        throw new Error("This harness was not configured for Personal Context.");
      }
      personalContextSources.set(sourceKey, value);
    },
    upsertPortfolioProject: (input) => portfolio.upsert(input),
    portfolioProject: (id) => portfolio.project(id),
    portfolioProjects: () => portfolio.projects(),
    portfolioReconciliation: (id) => portfolio.reconcile(id),
    setRepositoryCenterView: (projectId, view) => {
      if (view.projectId !== projectId) throw new Error("Repository Center project identity mismatch.");
      repositoryCenters.set(projectId, view);
    },
    repositoryCenterView: (projectId) => repositoryCenters.get(projectId),
    bindPortfolioProject: (workItemId, projectId) => {
      if (evidenceBroker === undefined) {
        portfolio.bindWorkItem(workItemId, projectId);
        return;
      }
      evidenceBroker.bind({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        workItemId,
        portfolioProjectId: projectId,
      });
    },
    serveProjectEvidence: (request) => {
      if (evidenceBroker === undefined) {
        throw new Error("This harness was not configured for Project Evidence.");
      }
      return evidenceBroker.serve(request);
    },
    captureProjectEvidenceCandidate: (request) => {
      if (evidenceBroker === undefined) {
        throw new Error("This harness was not configured for Project Evidence.");
      }
      return evidenceBroker.captureCandidate(request);
    },
    evidenceAuditTrail: (workItemId) =>
      state
        .auditTrail(workItemId)
        .filter((event) => event.type.startsWith("project-evidence.")),
    privateWorkerHeartbeat: () => privateWorker?.heartbeat(),
    privateWorkerJobs: () => privateWorker?.jobs() ?? [],
    setPrivateWorkerAvailable: (available) => {
      if (privateWorker === undefined) {
        throw new Error("This harness was not configured with a private worker.");
      }
      privateWorker.setAvailability(available);
    },
    expirePrivateWorkerLeases: (at) => {
      if (privateWorker === undefined) {
        throw new Error("This harness was not configured with a private worker.");
      }
      privateWorker.expireLeases(at);
    },
    executePrivateWorkerEffect: (effect) => {
      if (privateWorker === undefined) {
        throw new Error("This harness was not configured with a private worker.");
      }
      return privateWorker.execute(effect);
    },
    startDashboard: (credentials) =>
      createDashboardServer({
        state,
        gateway,
        credentials,
        now: clock,
        portfolio,
        repositoryCenters,
        deploymentCandidates: deploymentCandidateStore,
        deploymentPromotion,
        schedulerJobs,
        ...(hermesCoordinator === undefined
          ? {}
          : { hermesHealth: () => hermesCoordinator.overview() }),
        // Production wires this too. Without it the served page renders an
        // empty Knowledge Health section whatever the state holds, so no
        // browser check through this seam could ever prove the view.
        ...(knowledgeOperations === undefined
          ? {}
          : { knowledgeHealth: () => knowledgeOperations.domainHealth }),
        ...(evidenceBroker === undefined ? {} : { projectEvidence: evidenceBroker }),
      }),
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
    controlledVerificationResults: () => controlledVerifier.results(),
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
    close: () => {
      financialSnapshots.close();
      personalContext?.close();
      privateWorker?.close();
      portfolio.close();
      deploymentCandidateStore.close();
      deploymentPromotionStore.close();
      knowledgeVault?.close();
      hermesStore?.close();
      executionLinks?.close();
      state.close();
    },
  };
}

export interface ControlPlaneSystemHarness {
  telegramOwnership(): import("../runtime/daily-operations-control-plane.js").TelegramOwnership;
  schedulerOwnership(): "real-ming" | "native-hermes-cron";
  queueTelegramUpdate(update: {
    readonly updateId: number;
    readonly senderId: string;
    readonly chatId: string;
    readonly text: string;
  }): void;
  failNextTelegramPoll(): void;
  telegramPollRequests(): readonly unknown[];
  runCycle(): ReturnType<DailyOperationsControlPlane["runCycle"]>;
  runNativeScheduledReport(
    request: NativeScheduledReportRequest,
  ): ReturnType<DailyOperationsControlPlane["runNativeScheduledReport"]>;
  dashboardOverview(): Promise<DashboardOverview>;
  hermesOverview(): ReturnType<DailyOperationsControlPlane["hermesOverview"]>;
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
  /** Enable a fully controlled Hermes API edge for production-composition tests. */
  readonly hermesEnabled?: boolean;
  /** Rehearse the Revision 6 cutover, where the native gateway owns Telegram. */
  readonly telegramOwnership?: import("../runtime/daily-operations-control-plane.js").TelegramOwnership;
  /** Rehearse native Hermes cron ownership of the two scheduled reports. */
  readonly schedulerOwnership?: "real-ming" | "native-hermes-cron";
}): Promise<ControlPlaneSystemHarness> {
  const now = options.now ?? (() => new Date().toISOString());
  const dashboardToken = "controlled-dashboard-access-token";
  const updates: unknown[] = [];
  const messages: TelegramOutboundMessage[] = [];
  let telegramSendFailures = options.telegramSendFailures ?? 0;
  let telegramPollFailures = 0;
  const pollRequests: unknown[] = [];
  let controlledNotionPageCounter = 0;
  const controlledFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (options.hermesEnabled === true && url.endsWith("/health")) {
      return Response.json({ status: "ok", platform: "controlled-hermes", version: "test" });
    }
    if (options.hermesEnabled === true && url.endsWith("/api/sessions") && init?.method === "POST") {
      return Response.json({ status: "created" }, { status: 201 });
    }
    if (options.hermesEnabled === true && url.includes("/api/sessions/") && url.endsWith("/chat")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { readonly message?: string };
      const requestMessage = body.message ?? "";
      const request = JSON.parse(requestMessage) as { readonly request?: string };
      return Response.json({
        session_id: decodeURIComponent(url.split("/api/sessions/")[1]?.split("/")[0] ?? ""),
        message: {
          role: "assistant",
          content: JSON.stringify({
            intent: "answer",
            answer: `Controlled Hermes answered: ${request.request ?? ""}`,
            contextRequests: [],
            toolRequests: [],
          }),
        },
        usage: { input_tokens: 5, output_tokens: 7 },
        runtime: { model: "gpt-5.6-sol", provider: "openai-codex" },
      });
    }
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
      const pageId = `controlled-page-${controlledNotionPageCounter}`;
      controlledNotionPageCounter += 1;
      // The production adapter requires Notion's server version so it can
      // bind a subsequent overwrite to the page that was last read. Keep the
      // controlled edge faithful to that contract instead of returning an
      // identity-only page stub.
      return Response.json({
        object: "page",
        id: pageId,
        created_time: now(),
        last_edited_time: now(),
      });
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
  if (options.hermesEnabled === true) {
    Object.assign(environment, {
      REAL_MING_HERMES_ENABLED: "true",
      REAL_MING_HERMES_BASE_URL: "http://127.0.0.1:8642",
      REAL_MING_HERMES_API_KEY: "controlled-hermes-api-key",
      REAL_MING_HERMES_MODEL: "gpt-5.6-sol",
      REAL_MING_HERMES_PROVIDER: "openai-codex",
      REAL_MING_HERMES_REASONING: "medium",
    });
  }
  const controlPlane = await createProductionControlPlane({
    environment,
    statePath: options.statePath,
    notionLedgerPath:
      options.notionLedgerPath ?? `${options.statePath}.notion-ledger`,
    fetch: controlledFetch,
    dashboardPort: 0,
    ...(options.telegramOwnership === undefined
      ? {}
      : { telegramOwnership: options.telegramOwnership }),
    ...(options.schedulerOwnership === undefined
      ? {}
      : { schedulerOwnership: options.schedulerOwnership }),
    ...(options.hermesEnabled === true
      ? { nativeCronApiKey: "controlled-hermes-api-key" }
      : {}),
    now,
  });

  return {
    telegramOwnership: () => controlPlane.telegramOwnership,
    schedulerOwnership: () => controlPlane.schedulerOwnership,
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
    runNativeScheduledReport: (request) =>
      controlPlane.runNativeScheduledReport(request),
    dashboardOverview: async () => {
      const response = await fetch(`${controlPlane.dashboardOrigin}/api/overview`, {
        headers: { Authorization: `Bearer ${dashboardToken}` },
      });
      if (!response.ok) throw new Error("Controlled dashboard read failed.");
      return response.json() as Promise<DashboardOverview>;
    },
    hermesOverview: () => controlPlane.hermesOverview(),
    telegramMessages: () => [...messages],
    backup: (destinationPath) =>
      backupSqliteState({
        sourcePath: options.statePath,
        destinationPath,
      }),
    backupSet: async (destinationDirectory, backupOptions) => {
      const backup = await backupAndUploadControlPlaneState({
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
                      ? { kind: "failed", reason: "unavailable" as const }
                      : { kind: "ok" as const },
                },
              }),
        });
      return {
        statePath: backup.statePath,
        notionLedgerPath: backup.notionLedgerPath,
        manifest: {
          files: backup.manifest.files.flatMap((file) =>
            file.role === "hermes-session"
              ? []
              : [{
                  role: file.role as "operations-state" | "notion-write-ledger",
                  sha256: file.sha256,
                }]),
        },
      };
    },
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
