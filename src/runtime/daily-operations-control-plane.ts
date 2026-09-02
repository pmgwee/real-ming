import type { CalendarEvent, CalendarWindow } from "../providers/google-calendar-adapter.js";
import type { ProviderReadResult } from "../providers/adapter-contract.js";
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
} from "../operations/daily-operations-scheduler.js";
import { createExceptionNoticeRhythm } from "../operations/exception-notice-rhythm.js";
import { createProviderObservationCoordinator } from "../operations/provider-observation-coordinator.js";
import { createExecutiveRollUpRunner } from "../operations/executive-roll-up.js";
import { createMorningBriefRunner } from "../operations/morning-brief.js";
import {
  createOperationsGateway,
  type MaterialBlockerReason,
} from "../operations/operations-gateway.js";
import { createPrivateWorkerVerifier } from "../workers/private-worker.js";
import { OperationsState } from "../operations/operations-state.js";
import type { DashboardServer } from "../dashboard/dashboard-server.js";
import { createDashboardServer } from "../dashboard/dashboard-server.js";
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

export interface DailyOperationsControlPlane {
  readonly dashboardOrigin: string;
  readonly projectPortfolio: ProjectPortfolio | undefined;
  readonly projectEvidence: ProjectEvidenceBroker | undefined;
  bindPortfolioProject(request: ProjectEvidenceBindingRequest): void;
  prepareDeploymentCandidate(input: DeploymentCandidateBuildInput): DeploymentCandidateBuildResult;
  deploymentCandidate(id: string): DeploymentCandidate | undefined;
  requestDeploymentPromotionApproval(input: DeploymentPromotionApprovalRequest): Promise<DeploymentPromotionApprovalResult>;
  promoteDeploymentCandidate(input: DeploymentPromotionRequest): Promise<DeploymentPromotionResult>;
  readonly emailOperations: EmailOperationsCoordinator | undefined;
  readonly entertainmentEmailDigest: EntertainmentEmailDigestRunner | undefined;
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
  readonly now?: () => string;
  readonly wait?: () => Promise<void>;
}): Promise<DailyOperationsControlPlane> {
  const now = options.now ?? (() => new Date().toISOString());
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
  const frontDoor = createTelegramFrontDoor({
    ceoTelegramId: options.ceoTelegramId,
    ceoTelegramChatId: options.ceoTelegramChatId,
    gateway,
    state,
    transport: createTelegramTransport(options.telegram),
    auditPseudonymKey: options.auditPseudonymKey,
    now,
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
  const schedulerJobs = entertainmentEmailDigest === undefined
    ? schedulerJobInventory
    : [...schedulerJobInventory, entertainmentEmailDigestJobDefinition];
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
          // The observation identifies the calendar, not the brief's query
          // window, so an outage is grouped across daily scheduler runs.
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
  const rollUp = createExecutiveRollUpRunner({
    state,
    workspaceId,
    admit: admitTracked,
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
    },
    jobs: schedulerJobs,
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

  const supervisor = createControlPlaneSupervisor({
    pollTelegram: async () => {
      const recovery = await frontDoor.retryPendingDeliveries();
      if (recovery.failed > 0 || recovery.uncertain > 0) {
        recordExceptionNoticeHealthOutcome("failed");
      } else if (recovery.sent > 0) {
        recordExceptionNoticeHealthOutcome("healthy");
      }
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
      if (recovery.failed > 0 || recovery.uncertain > 0) {
        throw new Error("Telegram delivery recovery remains unresolved.");
      }
    },
    tickSchedule: () => scheduler.tick(),
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
      state.close();
    },
  };
}
