import type { RetentionBackupPurgeResult } from "../operations/retention-policy.js";
import type { CalendarEvent, CalendarWindow } from "../providers/google-calendar-adapter.js";
import type {
  ProviderReadResult,
  ProviderWriteResult,
} from "../providers/adapter-contract.js";
import type { MailBody, MailMessage } from "../providers/gmail-adapter.js";
import {
  providerObservationFromRead,
  statusForFailure,
  type ProviderObservationInput,
} from "../providers/provider-health.js";
import type { TelegramProviderAdapter } from "../providers/telegram-provider-adapter.js";
import { createTelegramTransport } from "../providers/telegram-provider-adapter.js";
import type { MasterTasksStore } from "../master-tasks/master-tasks.js";
import { MasterTasksProjection } from "../master-tasks/master-tasks.js";
import type {
  ControlledWorker,
  EffectVerifier,
  QuestionResponder,
  WorkerReceipt,
  WorkItem,
} from "../operations/contracts.js";
import { createCommandClassifier } from "../operations/command-classifier.js";
import { createDailyOperationsScheduler } from "../operations/daily-operations-scheduler.js";
import {
  entertainmentEmailDigestJobDefinition,
  entertainmentEmailDigestJobName,
  executiveRollUpJobName,
  morningBriefJobName,
  releaseHeldJobName,
  schedulerJobInventory,
  type SchedulerOwner,
} from "../operations/daily-operations-scheduler.js";
import { createExceptionNoticeRhythm } from "../operations/exception-notice-rhythm.js";
import { createProviderObservationCoordinator } from "../operations/provider-observation-coordinator.js";
import {
  createExecutiveRollUpComposer,
  createExecutiveRollUpRunner,
} from "../operations/executive-roll-up.js";
import {
  createMorningBriefComposer,
  createMorningBriefRunner,
} from "../operations/morning-brief.js";
import {
  createNativeScheduledReportService,
  nativeScheduledReportOwner,
  type NativeScheduledReportRequest,
  type NativeScheduledReportResult,
  type NativeScheduledReportService,
} from "../operations/native-scheduled-reports.js";
import {
  createOperationsGateway,
  type MaterialBlockerReason,
} from "../operations/operations-gateway.js";
import { createPrivateWorkerVerifier } from "../workers/private-worker.js";
import { OperationsState } from "../operations/operations-state.js";
import type { DashboardServer } from "../dashboard/dashboard-server.js";
import { createDashboardServer } from "../dashboard/dashboard-server.js";
import type { NativeHermesDashboardStatus } from "../dashboard/dashboard-read-model.js";
import type { NativeKnowledgeRunHealth } from "../knowledge/native-consolidation/contracts.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type { RepositoryCenterView } from "../portfolio/repository-center.js";
import {
  buildDeploymentCandidate,
  type DeploymentCandidate,
  type DeploymentCandidateBuildInput,
  type DeploymentCandidateBuildResult,
  type DeploymentCandidateStore,
} from "../portfolio/deployment-candidate.js";
import {
  createDeploymentPromotionCoordinator,
  type DeploymentPromotionApprovalRequest,
  type DeploymentPromotionApprovalResult,
  type DeploymentPromotionCoordinator,
  type DeploymentPromotionExecutor,
  type DeploymentPromotionRequest,
  type DeploymentPromotionResult,
  type DeploymentPromotionStore,
} from "../portfolio/deployment-promotion.js";
import {
  createEmailOperationsCoordinator,
  type EmailOperationsCoordinator,
  type EmailMailboxKind,
} from "../operations/email-operations.js";
import type { GmailEmailAdapter } from "../providers/email-provider-adapter.js";
import {
  createEntertainmentEmailDigestRunner,
  type EntertainmentEmailDigestRunner,
} from "../operations/entertainment-email-digest.js";
import {
  createProjectEvidenceBroker,
  type AgentBrainEvidenceProvider,
  type ProjectEvidenceBindingRequest,
  type ProjectEvidenceBroker,
} from "../evidence/evidence-broker.js";
import { createTelegramFrontDoor } from "../telegram/telegram-front-door.js";
import {
  createControlPlaneSupervisor,
  type ControlPlaneCycle,
} from "./control-plane-supervisor.js";
import { pollTelegramUpdates } from "./telegram-ingress.js";
import {
  createKnowledgeOperations,
  knowledgeJobInventory,
  type KnowledgeOperations,
  type KnowledgeSource,
} from "../knowledge/knowledge-operations.js";
import { createKnowledgeCompiler, type KnowledgeOperationalOutput } from "../knowledge/knowledge-compiler.js";
import { createKnowledgeVault, type KnowledgeVault, type VaultRoot } from "../knowledge/knowledge-vault.js";
import { createObsidianMaterializer, type ObsidianMaterializationResult, type ObsidianMaterializer } from "../knowledge/obsidian-materializer.js";
import { createHermesProjectionBroker } from "../knowledge/hermes-projection.js";
import type { PersonalContextIngestion } from "../knowledge/personal-context-ingestion.js";
import type { HermesRuntimeClient } from "../hermes/contracts.js";
import type { HermesSessionStore } from "../hermes/hermes-session-store.js";
import { createHermesTurnCoordinator, type HermesTurnCoordinator } from "../hermes/hermes-turn-coordinator.js";

const workspaceId = "workspace:real-ming";

const refusingWorker: ControlledWorker = {
  async execute(): Promise<WorkerReceipt> {
    throw new Error("The cloud control plane has no Local-Only worker yet.");
  },
};

const refusingVerifier: EffectVerifier = {
  async verify() {
    throw new Error("The cloud control plane has no effect verifier yet.");
  },
};

/**
 * The cloud control plane cannot research an answer until the Lenovo private
 * worker arrives in RM-21. It must still say so out loud.
 *
 * Throwing here looked like an honest refusal and was not. The classifier
 * routes anything opening "what/when/who/how" to this responder, the front
 * door does not catch, and the ingress loop then holds the cursor behind the
 * failed update -- correct in isolation, but Telegram redelivers that same
 * update every cycle, so one ordinary question silences every message sent
 * after it until Telegram's retention drops it about a day later. Silence is
 * indistinguishable from the service being dead.
 */
const refusingResponder: QuestionResponder = {
  async answer(): Promise<string> {
    return (
      "I cannot answer questions yet: the private worker that would research " +
      "this is not deployed. Send it as an instruction and I will capture it."
    );
  },
};

/**
 * Which process holds the single Telegram consumer. Telegram permits one
 * reliable polling owner; Architecture Revision 6 moves that owner to the
 * native Hermes gateway (ADR-0020) without relaxing the invariant.
 */
export type TelegramOwnership = "real-ming-ingress" | "native-hermes-gateway";

export interface DailyOperationsControlPlane {
  readonly dashboardOrigin: string;
  readonly telegramOwnership: TelegramOwnership;
  readonly schedulerOwnership: SchedulerOwner;
  readonly projectPortfolio: ProjectPortfolio | undefined;
  readonly projectEvidence: ProjectEvidenceBroker | undefined;
  bindPortfolioProject(request: ProjectEvidenceBindingRequest): void;
  prepareDeploymentCandidate(input: DeploymentCandidateBuildInput): DeploymentCandidateBuildResult;
  deploymentCandidate(id: string): DeploymentCandidate | undefined;
  requestDeploymentPromotionApproval(input: DeploymentPromotionApprovalRequest): Promise<DeploymentPromotionApprovalResult>;
  promoteDeploymentCandidate(input: DeploymentPromotionRequest): Promise<DeploymentPromotionResult>;
  readonly emailOperations: EmailOperationsCoordinator | undefined;
  readonly entertainmentEmailDigest: EntertainmentEmailDigestRunner | undefined;
  readonly hermesOverview: () => import("../hermes/hermes-turn-coordinator.js").HermesConversationOverview | undefined;
  readonly materializeObsidian: () => ObsidianMaterializationResult | undefined;
  /** Native Hermes cron calls this boundary and delivers the returned text. */
  readonly runNativeScheduledReport: (
    request: NativeScheduledReportRequest,
  ) => Promise<NativeScheduledReportResult>;
  runCycle(): Promise<ControlPlaneCycle>;
  run(): Promise<void>;
  stop(): void;
  close(): Promise<void>;
}

/**
 * Compose the complete cloud-capable Daily Operations slice behind one small
 * process interface. Provider adapters remain replaceable at their established
 * seams; state, policy, projection, schedules, dashboard and shutdown ordering
 * stay local to this module.
 */
export async function createDailyOperationsControlPlane(options: {
  readonly statePath: string;
  readonly masterTasks: MasterTasksStore;
  readonly portfolio?: ProjectPortfolio;
  /** Read-only repository observations prepared by the composition root. */
  readonly repositoryCenters?: ReadonlyMap<string, RepositoryCenterView>;
  /** Refreshes repository observations at the dashboard read boundary. */
  readonly refreshRepositoryCenters?: () => Promise<ReadonlyMap<string, RepositoryCenterView>>;
  /** Durable local record for review-ready candidates; no provider write is implied. */
  readonly deploymentCandidateStore?: DeploymentCandidateStore;
  /** Durable append-only promotion events; no provider write is implied. */
  readonly deploymentPromotionStore?: DeploymentPromotionStore;
  /** Explicitly supplied promotion capability; omitted in the cloud-only process. */
  readonly deploymentPromotionExecutor?: DeploymentPromotionExecutor;
  /** Optional Gmail adapter; omitted until the CEO provisions mailbox OAuth. */
  readonly emailAdapter?: GmailEmailAdapter;
  readonly emailMailboxBindings?: Readonly<Record<EmailMailboxKind, string>>;
  readonly evidenceProvider?: AgentBrainEvidenceProvider;
  /** Optional Lenovo/private-worker adapter for Local-Only Work. */
  readonly privateWorker?: ControlledWorker;
  /** Optional verifier paired with a supplied worker adapter. */
  readonly effectVerifier?: EffectVerifier;
  readonly telegram: TelegramProviderAdapter;
  readonly ceoTelegramId: string;
  readonly ceoTelegramChatId: string;
  readonly auditPseudonymKey: string;
  readonly dashboardToken: string;
  readonly dashboardHost?: string;
  readonly dashboardPort?: number;
  readonly listCalendarEvents: (
    window: CalendarWindow,
  ) => Promise<ProviderReadResult<readonly CalendarEvent[]>>;
  /** Present only where the calendar credential may write. */
  readonly createCalendarEvent?: (request: {
    readonly calendarId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly description?: string;
    readonly location?: string;
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteResult>;
  /** The mailboxes this process holds a credential for. */
  readonly mailboxes?: readonly string[];
  readonly searchMail?: (request: {
    readonly mailbox: string;
    readonly query?: string;
    readonly limit?: number;
  }) => Promise<ProviderReadResult<readonly MailMessage[]>>;
  /** Opens one message in full, on request. */
  readonly readMail?: (request: {
    readonly mailbox: string;
    readonly messageId: string;
  }) => Promise<ProviderReadResult<MailBody>>;
  /** Writes a draft. There is no send anywhere in this chain. */
  readonly draftMail?: (request: {
    readonly mailbox: string;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly cc?: readonly string[];
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteResult>;
  readonly now?: () => string;
  readonly wait?: () => Promise<void>;
  /** Optional scheduled Knowledge Compiler runtime backed by an encrypted vault. */
  readonly knowledgeOperations?: {
    readonly statePath?: string;
    readonly encryptionKey: string;
    readonly sources?: readonly KnowledgeSource[];
    readonly outputs?: readonly KnowledgeOperationalOutput[];
    readonly backup?: () => Promise<void>;
    readonly purgeBackups?: (at: string) => Promise<readonly RetentionBackupPurgeResult[]>;
    readonly runnerTimeoutMs?: number;
    readonly personalContext?: PersonalContextIngestion;
    readonly retentionRequired?: boolean;
  };
  /**
   * Which process owns the single Telegram consumer. Defaults to the
   * Revision 5 behaviour so nothing changes until the cutover runs.
   */
  readonly telegramOwnership?: TelegramOwnership;
  /** Which process owns the scheduled brief/roll-up trigger and delivery. */
  readonly schedulerOwnership?: SchedulerOwner;
  /** Shared Hermes bridge key for the loopback native-cron endpoint. */
  readonly nativeCronApiKey?: string;
  /** Optional payload-free native knowledge health for the private dashboard. */
  readonly nativeKnowledgeHealth?: () => NativeKnowledgeRunHealth | Promise<NativeKnowledgeRunHealth>;
  /** Optional real Hermes API-server runtime. Real-Ming remains the governance boundary. */
  readonly hermes?: {
    readonly runtime: HermesRuntimeClient;
    readonly sessions: HermesSessionStore;
    readonly model?: string;
  };
  /** Optional CEO-facing local Obsidian export. No directory means no export. */
  readonly obsidian?: {
    readonly directory: string;
    readonly roots?: readonly VaultRoot[];
  };
}): Promise<DailyOperationsControlPlane> {
  const now = options.now ?? (() => new Date().toISOString());
  const telegramOwnership: TelegramOwnership =
    options.telegramOwnership ?? "real-ming-ingress";
  const schedulerOwnership: SchedulerOwner =
    options.schedulerOwnership ?? "real-ming";
  const ownsTelegram = telegramOwnership === "real-ming-ingress";
  const state = new OperationsState(options.statePath);
  const projectEvidence =
    options.evidenceProvider === undefined || options.portfolio === undefined
      ? undefined
      : createProjectEvidenceBroker({
          state,
          portfolio: options.portfolio,
          provider: options.evidenceProvider,
          now,
          recordAudit: (workItemId, type, occurredAt, details) =>
            state.recordAuditEvent(workItemId, type, occurredAt, details),
        });
  const projection = new MasterTasksProjection(state, options.masterTasks);
  // The rhythm needs the front door, which needs the gateway, so it cannot
  // exist yet. Bound late rather than reordered, because the gateway must not
  // depend on the Exception Notice rhythm in either direction.
  let raiseMaterialBlocker:
    | ((workItem: WorkItem, reason: MaterialBlockerReason) => Promise<void>)
    | undefined;
  let recoverMaterialBlocker: ((workItem: WorkItem) => Promise<void>) | undefined;
  let observeProvider:
    | ((input: ProviderObservationInput) => Promise<void>)
    | undefined;
  const gateway = createOperationsGateway({
    state,
    worker: options.privateWorker ?? refusingWorker,
    verifier:
      options.effectVerifier ??
      (options.privateWorker === undefined
        ? refusingVerifier
        : createPrivateWorkerVerifier()),
    questionResponder: refusingResponder,
    commandClassifier: createCommandClassifier(),
    workItemChanged: async (workItem) => {
      await projection.sync(workItem);
      await observeProvider?.({
        provider: "notion",
        accountReference: "notion:real-ming",
        sourceReference: `master-tasks:${workItem.id}`,
        workItemId: workItem.id,
        status: "healthy",
        observedAt: now(),
      });
      state.recordControlPlaneHealth({
        component: "master-tasks-projection",
        outcome: "healthy",
        checkedAt: now(),
      });
    },
    workItemProjectionRetryable: (error) =>
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { readonly retryable?: unknown }).retryable === true,
    workItemProjectionFailed: async (workItem) => {
      await observeProvider?.({
        provider: "notion",
        accountReference: "notion:real-ming",
        sourceReference: `master-tasks:${workItem.id}`,
        workItemId: workItem.id,
        status: "unavailable",
        failureClass: "unavailable",
        retryable: true,
        observedAt: now(),
      });
      state.recordControlPlaneHealth({
        component: "master-tasks-projection",
        outcome: "failed",
        checkedAt: now(),
      });
    },
    materialBlocker: async (workItem, reason) => {
      await raiseMaterialBlocker?.(workItem, reason);
    },
    materialBlockerRecovered: async (workItem) => {
      await recoverMaterialBlocker?.(workItem);
    },
    now,
  });
  let knowledgeCompiler: import("../knowledge/knowledge-compiler.js").KnowledgeCompiler | undefined;
  const hermesProjection = options.hermes === undefined
    ? undefined
    : createHermesProjectionBroker({
        state,
        pages: () => knowledgeCompiler?.pages() ?? [],
      });
  // Revision 6 retires the mandatory JSON turn envelope. When the native
  // gateway owns conversation, Real-Ming must hold no Hermes conversation of
  // its own, or two systems would claim the same session and the CEO would
  // get two answers to one message.
  const hermesCoordinator: HermesTurnCoordinator | undefined = options.hermes === undefined || !ownsTelegram
    ? undefined
    : createHermesTurnCoordinator({
        runtime: options.hermes.runtime,
        sessions: options.hermes.sessions,
        gateway,
        ...(hermesProjection === undefined ? {} : { projection: hermesProjection }),
        ...(options.hermes.model === undefined ? {} : { model: options.hermes.model }),
        workItem: (id) => state.workItem(id),
        now,
      });
  // In Revision 6 the native gateway owns the Telegram conversation. Keep a
  // small, read-only reachability check in the Real-Ming dashboard without
  // fabricating legacy coordinator sessions or copying Hermes conversation
  // content into the control plane.
  const nativeHermesHealth =
    options.hermes === undefined || ownsTelegram
      ? undefined
      : async (): Promise<NativeHermesDashboardStatus> => {
          const configuredHermes = options.hermes;
          if (configuredHermes === undefined) {
            // The branch is unreachable by construction, but retaining an
            // explicit failed status makes a future configuration race safe.
            return {
              owner: "native-hermes-gateway",
              status: "failed",
              model: null,
              checkedAt: now(),
              lastFailure: "Native Hermes runtime is not configured.",
            };
          }
          try {
            const health = await configuredHermes.runtime.health();
            return {
              owner: "native-hermes-gateway",
              status: health.status,
              model: health.model ?? configuredHermes.model ?? null,
              checkedAt: now(),
              lastFailure: health.failure ?? null,
            };
          } catch {
            return {
              owner: "native-hermes-gateway",
              status: "failed",
              model: configuredHermes.model ?? null,
              checkedAt: now(),
              lastFailure: "Native Hermes health check failed.",
            };
          }
        };
  const frontDoor = createTelegramFrontDoor({
    ceoTelegramId: options.ceoTelegramId,
    ceoTelegramChatId: options.ceoTelegramChatId,
    gateway,
    state,
    transport: createTelegramTransport(options.telegram),
    auditPseudonymKey: options.auditPseudonymKey,
    now,
    ...(hermesCoordinator === undefined ? {} : { hermesTurn: hermesCoordinator }),
  });
  const deploymentPromotion =
    options.deploymentCandidateStore === undefined || options.deploymentPromotionStore === undefined
      ? undefined
      : createDeploymentPromotionCoordinator({
          candidates: options.deploymentCandidateStore,
          promotions: options.deploymentPromotionStore,
          state,
          gateway,
          ...(options.deploymentPromotionExecutor === undefined
            ? {}
            : { executor: options.deploymentPromotionExecutor }),
          notify: (notification) => frontDoor.notify(notification),
        now,
      });
  const emailOperations = options.emailAdapter === undefined
    ? undefined
      : createEmailOperationsCoordinator({ adapter: options.emailAdapter, gateway, mailboxBindings: options.emailMailboxBindings ?? { personal: "personal@example.test", opportunity: "personal@example.test", entertainment: "personal@example.test" } });
  const notices = createExceptionNoticeRhythm({
    state,
    notify: (notification) => frontDoor.notify(notification),
    now,
  });
  const recordExceptionNoticeHealth = (
    admission: Awaited<ReturnType<typeof notices.admit>> | undefined,
    failedBeforeAdmission = false,
  ): void => {
    try {
      state.recordControlPlaneHealth({
        component: "exception-notice",
        outcome:
          failedBeforeAdmission ||
          admission?.kind === "failed" ||
          (admission?.kind === "grouped" && admission.deliveryState === "pending")
            ? "failed"
            : "healthy",
        checkedAt: now(),
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
  const releaseHeldTracked = async () => {
    const result = await notices.releaseHeld();
    if (result.failed > 0) {
      recordExceptionNoticeHealthOutcome("failed");
    } else if (result.released > 0) {
      recordExceptionNoticeHealthOutcome("healthy");
    }
    return result;
  };
  const admitTracked: typeof notices.admit = async (notice) => {
    try {
      const admission = await notices.admit(notice);
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
        now,
      });
  const knowledgeVault: KnowledgeVault | undefined = options.knowledgeOperations === undefined
    ? undefined
    : createKnowledgeVault({
        statePath: options.knowledgeOperations.statePath ?? `${options.statePath}.knowledge.sqlite`,
        encryptionKey: options.knowledgeOperations.encryptionKey,
        now,
      });
  knowledgeCompiler = knowledgeVault === undefined
    ? undefined
    : createKnowledgeCompiler({ vault: knowledgeVault, actorId: "ceo:ming", now });
  const knowledgeRuntime: KnowledgeOperations | undefined =
    knowledgeVault === undefined || knowledgeCompiler === undefined
      ? undefined
      : createKnowledgeOperations({
          state,
          compiler: knowledgeCompiler,
          vault: knowledgeVault,
          now,
          ...(options.knowledgeOperations?.sources === undefined ? {} : { sources: options.knowledgeOperations.sources }),
          ...(options.knowledgeOperations?.outputs === undefined ? {} : { outputs: options.knowledgeOperations.outputs }),
          ...(options.knowledgeOperations?.backup === undefined ? {} : { backup: options.knowledgeOperations.backup }),
          ...(options.knowledgeOperations?.purgeBackups === undefined ? {} : { purgeBackups: options.knowledgeOperations.purgeBackups }),
          ...(options.knowledgeOperations?.runnerTimeoutMs === undefined ? {} : { runnerTimeoutMs: options.knowledgeOperations.runnerTimeoutMs }),
          ...(options.knowledgeOperations?.personalContext === undefined ? {} : { personalContext: options.knowledgeOperations.personalContext }),
          ...(options.knowledgeOperations?.retentionRequired === undefined ? {} : { retentionRequired: options.knowledgeOperations.retentionRequired }),
          admitExceptionNotice: admitTracked,
          recordExceptionNoticeRecovery: async (signature, details) => {
            const admission = await notices.recordRecovery(signature, details);
            recordExceptionNoticeHealth(admission);
            return admission;
          },
        });
  const obsidianMaterializer: ObsidianMaterializer | undefined =
    knowledgeVault === undefined || options.obsidian === undefined
      ? undefined
      : createObsidianMaterializer({ vault: knowledgeVault, now });
  let lastObsidianMaterialization: ObsidianMaterializationResult | undefined;
  let lastObsidianSignature: string | undefined;
  const obsidianSignature = (): string => {
    const roots = options.obsidian?.roots ?? ["CEO"];
    return roots
      .map((root) => `${root}:${knowledgeVault?.currentGeneration(root)?.id ?? ""}`)
      .join("|");
  };
  const schedulerJobs = entertainmentEmailDigest === undefined && knowledgeRuntime === undefined
    ? schedulerJobInventory
    : [
        ...schedulerJobInventory,
        ...(entertainmentEmailDigest === undefined ? [] : [entertainmentEmailDigestJobDefinition]),
        ...(knowledgeRuntime === undefined ? [] : knowledgeJobInventory),
      ];
  const configuredPrimarySchedulerJobs = entertainmentEmailDigest === undefined
    ? schedulerJobInventory
    : [...schedulerJobInventory, entertainmentEmailDigestJobDefinition];
  const primarySchedulerJobs = configuredPrimarySchedulerJobs.filter(
    (job) =>
      schedulerOwnership !== nativeScheduledReportOwner ||
      job.owner !== nativeScheduledReportOwner,
  );
  const runEntertainmentEmailDigest = async (): Promise<void> => {
    if (entertainmentEmailDigest === undefined) return;
    const result = await entertainmentEmailDigest.run();
    if (result.kind === "failed") {
      throw new Error(`Entertainment email digest failed (${result.failure.class}).`);
    }
    if (result.kind === "denied") {
      throw new Error("Entertainment email digest mailbox is not authorized.");
    }
  };
  const providerObservationCoordinator = createProviderObservationCoordinator({
    state,
    notices,
  });
  observeProvider = (input) =>
    // Provider health is durable before a notice is attempted. Normal
    // notification failures are typed admissions; persistence or validation
    // failures are allowed to surface instead of being mislabeled healthy.
    providerObservationCoordinator.observe(input).then(() => undefined);
  raiseMaterialBlocker = async (workItem, reason) => {
    // Signed by the Work Item, so the same item failing repeatedly groups into
    // one interruption and a recovery reopens it. The text carries the id and
    // the reason code only: a provider's message could hold a request URL, and
    // this goes straight to the CEO's phone.
    await admitTracked({
      kind: "material-blocker",
      text: `Work Item ${workItem.id} is blocked (${reason}).`,
      idempotencyKey: `material-blocker:${workItem.id}:${now()}`,
      signature: `work-item-blocked:${workItem.id}`,
    });
  };
  recoverMaterialBlocker = async (workItem) => {
    const admission = await notices.recordRecovery(
      `work-item-blocked:${workItem.id}`,
    );
    recordExceptionNoticeHealth(admission);
  };
  const morningBriefComposer = createMorningBriefComposer({
    state,
    listEvents: async (window) => {
      const result = await options.listCalendarEvents(window);
      await observeProvider?.(
        providerObservationFromRead(
          {
            provider: "google-calendar",
            accountReference: "google-calendar:real-ming",
          },
          // The observation identifies the calendar, not the brief's query
          // window, so an outage is grouped across daily scheduler runs.
          "calendar:primary",
          result,
          now(),
        ),
      );
      return result;
    },
    now,
  });
  const morningBrief = createMorningBriefRunner({
    state,
    listEvents: async (window) => {
      const result = await options.listCalendarEvents(window);
      await observeProvider?.(
        providerObservationFromRead(
          {
            provider: "google-calendar",
            accountReference: "google-calendar:real-ming",
          },
          "calendar:primary",
          result,
          now(),
        ),
      );
      return result;
    },
    admit: admitTracked,
    now,
  });
  const rollUpComposer = createExecutiveRollUpComposer({
    state,
    workspaceId,
    now,
  });
  const rollUp = createExecutiveRollUpRunner({
    state,
    workspaceId,
    admit: admitTracked,
    now,
  });
  const nativeScheduledReports: NativeScheduledReportService =
    createNativeScheduledReportService({
      state,
      morningBrief: morningBriefComposer,
      executiveRollUp: rollUpComposer,
      now,
    });
  const scheduler = createDailyOperationsScheduler({
    state,
    now,
    admitExceptionNotice: admitTracked,
    recordExceptionNoticeRecovery: async (signature, details) => {
      const admission = await notices.recordRecovery(signature, details);
      recordExceptionNoticeHealth(admission);
      return admission;
    },
    runners: {
      [releaseHeldJobName]: () => releaseHeldTracked(),
      [morningBriefJobName]: () => morningBrief.run(),
      [executiveRollUpJobName]: () => rollUp.run(),
      ...(entertainmentEmailDigest === undefined
        ? {}
        : { [entertainmentEmailDigestJobName]: runEntertainmentEmailDigest }),
      ...(knowledgeRuntime === undefined
        ? {}
        : Object.fromEntries(
            knowledgeJobInventory.map((definition) => [
              definition.job,
              () => knowledgeRuntime.runJob(definition.job),
            ]),
          )),
    },
    jobs: primarySchedulerJobs,
  });
  const dashboard: DashboardServer = await createDashboardServer({
    state,
    gateway,
    ...(options.portfolio === undefined ? {} : { portfolio: options.portfolio }),
    ...(options.repositoryCenters === undefined ? {} : { repositoryCenters: options.repositoryCenters }),
    ...(options.refreshRepositoryCenters === undefined ? {} : { refreshRepositoryCenters: options.refreshRepositoryCenters }),
    ...(projectEvidence === undefined ? {} : { projectEvidence }),
    ...(options.deploymentCandidateStore === undefined
      ? {}
      : {
          deploymentCandidates: options.deploymentCandidateStore,
          ...(deploymentPromotion === undefined ? {} : { deploymentPromotion }),
        }),
    schedulerJobs,
    ...(knowledgeRuntime === undefined ? {} : { knowledgeHealth: () => knowledgeRuntime.domainHealth }),
    ...(hermesCoordinator === undefined ? {} : { hermesHealth: () => hermesCoordinator.overview() }),
    ...(nativeHermesHealth === undefined ? {} : { nativeHermesHealth }),
    ...(options.nativeKnowledgeHealth === undefined
      ? {}
      : { nativeKnowledgeHealth: options.nativeKnowledgeHealth }),
    ...(options.nativeCronApiKey === undefined
      ? {}
      : {
          nativeCron: {
            apiKey: options.nativeCronApiKey,
            run: (request: NativeScheduledReportRequest) =>
              nativeScheduledReports.run(request),
          },
          // The MCP process holds no Google credential, so it asks here. This
          // process already reads the calendar for the morning brief; serving
          // the same read to the agent adds no second credential path.
          providerReads: {
            apiKey: options.nativeCronApiKey,
            ...(options.createCalendarEvent === undefined
              ? {}
              : {
                  createCalendarEvent: async (request: {
                    readonly calendarId: string;
                    readonly title: string;
                    readonly start: string;
                    readonly end: string;
                    readonly description?: string;
                    readonly location?: string;
                    readonly idempotencyKey: string;
                  }) => {
                    const written = await options.createCalendarEvent?.(request);
                    if (written === undefined || written.kind === "failed") {
                      return {
                        kind: "unavailable" as const,
                        reason:
                          written === undefined
                            ? "Creating calendar events is not configured."
                            : written.failure.message,
                      };
                    }
                    return {
                      kind: "ok" as const,
                      reference: written.effectReference,
                      deduplicated: written.deduplicated,
                    };
                  },
                }),
            ...(options.mailboxes === undefined ? {} : { mailboxes: options.mailboxes }),
            ...(options.searchMail === undefined
              ? {}
              : {
                  searchMail: async (request: {
                    readonly mailbox: string;
                    readonly query?: string;
                    readonly limit?: number;
                  }) => {
                    const read = await options.searchMail?.(request);
                    if (read === undefined || read.kind === "failed") {
                      return {
                        kind: "unavailable" as const,
                        reason:
                          read === undefined
                            ? "That mailbox is not configured."
                            : read.failure.message,
                      };
                    }
                    return {
                      kind: "ok" as const,
                      messages: read.value.map((message) => ({
                        id: message.id,
                        from: message.from,
                        subject: message.subject,
                        snippet: message.snippet,
                        receivedAt: message.receivedAt,
                        unread: message.unread,
                      })),
                      retrievedAt: read.provenance.retrievedAt,
                    };
                  },
                }),
            ...(options.readMail === undefined
              ? {}
              : {
                  readMail: async (request: {
                    readonly mailbox: string;
                    readonly messageId: string;
                  }) => {
                    const read = await options.readMail?.(request);
                    if (read === undefined || read.kind === "failed") {
                      return {
                        kind: "unavailable" as const,
                        reason:
                          read === undefined
                            ? "That mailbox is not configured."
                            : read.failure.message,
                      };
                    }
                    return {
                      kind: "ok" as const,
                      message: {
                        from: read.value.from,
                        to: read.value.to,
                        subject: read.value.subject,
                        receivedAt: read.value.receivedAt,
                        body: read.value.body,
                        convertedFromHtml: read.value.convertedFromHtml,
                        truncated: read.value.truncated,
                      },
                    };
                  },
                }),
            ...(options.draftMail === undefined
              ? {}
              : {
                  draftMail: async (request: {
                    readonly mailbox: string;
                    readonly to: readonly string[];
                    readonly subject: string;
                    readonly body: string;
                    readonly cc?: readonly string[];
                    readonly idempotencyKey: string;
                  }) => {
                    const written = await options.draftMail?.(request);
                    if (written === undefined || written.kind === "failed") {
                      return {
                        kind: "unavailable" as const,
                        reason:
                          written === undefined
                            ? "Drafting is not configured for that mailbox."
                            : written.failure.message,
                      };
                    }
                    return {
                      kind: "ok" as const,
                      reference: written.effectReference,
                      deduplicated: written.deduplicated,
                    };
                  },
                }),
            calendarEvents: async (request: {
              readonly from?: string;
              readonly to?: string;
            }) => {
              const read = await options.listCalendarEvents({
                ...(request.from === undefined ? {} : { timeMin: request.from }),
                ...(request.to === undefined ? {} : { timeMax: request.to }),
              });
              if (read.kind === "failed") {
                return {
                  kind: "unavailable" as const,
                  reason: read.failure.message,
                };
              }
              return {
                kind: "ok" as const,
                events: read.value.map((event) => ({
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
    credentials: [
      {
        actorId: "ceo:ming",
        workspaceId,
        accessToken: options.dashboardToken,
      },
    ],
    now,
    ...(options.dashboardHost === undefined ? {} : { host: options.dashboardHost }),
    ...(options.dashboardPort === undefined ? {} : { port: options.dashboardPort }),
  });

  // At one cycle a second, writing both components unconditionally meant about
  // 173,000 upserts a day into the same WAL database that holds every durable
  // Work Item, Approval and audit row -- to record that nothing had changed.
  // Health is written when it changes, plus a heartbeat, so the row still
  // proves the loop is alive without keeping the state disk hot for it.
  const healthHeartbeatMs = 300_000;
  const lastHealthWrite = new Map<string, { at: number; outcome: string }>();
  const recordHealthIfWorthWriting = (
    component: "telegram-ingress" | "daily-scheduler",
    outcome: "healthy" | "failed",
    checkedAt: string,
  ): void => {
    const previous = lastHealthWrite.get(component);
    const at = Date.parse(checkedAt);
    if (
      previous !== undefined &&
      previous.outcome === outcome &&
      Number.isFinite(at) &&
      at - previous.at < healthHeartbeatMs
    ) {
      return;
    }
    state.recordControlPlaneHealth({ component, outcome, checkedAt });
    lastHealthWrite.set(component, {
      at: Number.isFinite(at) ? at : 0,
      outcome,
    });
  };

  // Delivery recovery is an outbound-notification concern, not an ingress one.
  // Revision 5 ran it inside the polling loop; Revision 6 hands the consumer
  // away, so the retry has to keep an owner of its own or a durable failed
  // brief would sit unsent forever after cutover.
  const recoverPendingDeliveries = async (): Promise<void> => {
    const recovery = await frontDoor.retryPendingDeliveries();
    if (recovery.failed > 0 || recovery.uncertain > 0) {
      recordExceptionNoticeHealthOutcome("failed");
    } else if (recovery.sent > 0) {
      recordExceptionNoticeHealthOutcome("healthy");
    }
    if (recovery.failed > 0 || recovery.uncertain > 0) {
      throw new Error("Telegram delivery recovery remains unresolved.");
    }
  };

  const pollTelegram = async (): Promise<void> => {
      const cursor = state.telegramIngressCursor();
      const read = await options.telegram.read({ reference: `offset:${cursor + 1}` });
      if (read.kind === "failed") {
        await observeProvider?.({
          provider: "telegram",
          accountReference: "telegram:real-ming",
          sourceReference: "telegram:long-poll",
          status: statusForFailure(read.failure.class),
          failureClass: read.failure.class,
          retryable: read.failure.retryable,
          ...(read.failure.retryAfterMs === undefined ? {} : { retryAfterMs: read.failure.retryAfterMs }),
          observedAt: now(),
        });
        throw new Error("Telegram polling failed.");
      }
      await observeProvider?.({
        provider: "telegram",
        accountReference: "telegram:real-ming",
        sourceReference: "telegram:long-poll",
        status: "healthy",
        observedAt: now(),
      });
      const polled = await pollTelegramUpdates({
        updates: read.value,
        cursor: () => state.telegramIngressCursor(),
        advance: (updateId) => state.advanceTelegramIngressCursor(updateId, now()),
        receive: (update) => frontDoor.receiveUpdate(update),
      });
      // The failure count was being discarded, so an update the front door
      // could not handle held the cursor while the dashboard still rendered
      // "healthy". A dashboard reporting health it has not established is
      // worse than one reporting nothing: it is the only place the CEO would
      // look to find out the front door had stopped.
      if (polled.failed > 0) {
        throw new Error("A Telegram update could not be handled.");
      }
  };

  const supervisor = createControlPlaneSupervisor({
    ...(ownsTelegram
      ? {
          pollTelegram: async () => {
            await recoverPendingDeliveries();
            await pollTelegram();
          },
        }
      : {}),
    tickSchedule: async () => {
      if (!ownsTelegram) await recoverPendingDeliveries();
      const primary = await scheduler.tick();
      const knowledge = await knowledgeRuntime?.scheduler.tick();
      if (
        obsidianMaterializer !== undefined &&
        knowledge !== undefined &&
        knowledge.failed.length === 0 &&
        obsidianSignature() !== lastObsidianSignature
      ) {
        lastObsidianMaterialization = obsidianMaterializer.materialize({
          directory: options.obsidian!.directory,
          actorId: "ceo:ming",
          ...(options.obsidian?.roots === undefined ? {} : { roots: options.obsidian.roots }),
          generatedAt: now(),
        });
        lastObsidianSignature = obsidianSignature();
      }
      if (primary.failed.length > 0 || (knowledge?.failed.length ?? 0) > 0) {
        throw new Error("A scheduled operations job failed.");
      }
    },
    now,
    onCycle: (cycle) => {
      if (cycle.telegram.kind !== "stopped") {
        recordHealthIfWorthWriting(
          "telegram-ingress",
          cycle.telegram.kind === "ran" ? "healthy" : "failed",
          cycle.at,
        );
      }
      if (cycle.schedule.kind !== "stopped") {
        recordHealthIfWorthWriting(
          "daily-scheduler",
          cycle.schedule.kind === "ran" ? "healthy" : "failed",
          cycle.at,
        );
      }
    },
    ...(options.wait === undefined ? {} : { wait: options.wait }),
  });
  let closed = false;

  return {
    dashboardOrigin: dashboard.origin,
    telegramOwnership,
    schedulerOwnership,
    projectPortfolio: options.portfolio,
    projectEvidence,
    bindPortfolioProject(request) {
      if (projectEvidence === undefined) {
        throw new Error("This control plane was not configured with Project Evidence.");
      }
      projectEvidence.bind(request);
    },
    prepareDeploymentCandidate(input) {
      const result = buildDeploymentCandidate(input);
      if (result.kind !== "candidate" || options.deploymentCandidateStore === undefined) return result;
      return {
        kind: "candidate",
        candidate: options.deploymentCandidateStore.save(result.candidate),
      };
    },
    deploymentCandidate: (id) => options.deploymentCandidateStore?.candidate(id),
    requestDeploymentPromotionApproval: async (input) => {
      if (deploymentPromotion === undefined) {
        return { kind: "rejected", reasons: ["Deployment promotion is not configured."] };
      }
      return deploymentPromotion.requestApproval(input);
    },
    promoteDeploymentCandidate: async (input) => {
      if (deploymentPromotion === undefined) {
        return { kind: "rejected", reasons: ["Deployment promotion is not configured."] };
      }
      return deploymentPromotion.promote(input);
    },
    emailOperations,
    entertainmentEmailDigest,
    hermesOverview: () => hermesCoordinator?.overview(),
    materializeObsidian: () => lastObsidianMaterialization,
    runNativeScheduledReport: (request) => nativeScheduledReports.run(request),
    runCycle: () => supervisor.runCycle(),
    run: () => supervisor.run(),
    stop: () => supervisor.stop(),
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      supervisor.stop();
      await dashboard.close();
      options.deploymentCandidateStore?.close();
      options.deploymentPromotionStore?.close();
      knowledgeVault?.close();
      options.hermes?.sessions.close();
      state.close();
    },
  };
}
