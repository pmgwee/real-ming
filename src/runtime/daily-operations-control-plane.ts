import type { CalendarEvent, CalendarWindow } from "../providers/google-calendar-adapter.js";
import type { ProviderReadResult } from "../providers/adapter-contract.js";
import type { TelegramProviderAdapter } from "../providers/telegram-provider-adapter.js";
import { createTelegramTransport } from "../providers/telegram-provider-adapter.js";
import type { MasterTasksStore } from "../master-tasks/master-tasks.js";
import { MasterTasksProjection } from "../master-tasks/master-tasks.js";
import type {
  ControlledWorker,
  EffectVerifier,
  QuestionResponder,
  WorkerReceipt,
} from "../operations/contracts.js";
import { createCommandClassifier } from "../operations/command-classifier.js";
import { createDailyOperationsScheduler } from "../operations/daily-operations-scheduler.js";
import {
  executiveRollUpJobName,
  morningBriefJobName,
  releaseHeldJobName,
} from "../operations/daily-operations-scheduler.js";
import { createExceptionNoticeRhythm } from "../operations/exception-notice-rhythm.js";
import { createExecutiveRollUpRunner } from "../operations/executive-roll-up.js";
import { createMorningBriefRunner } from "../operations/morning-brief.js";
import { createOperationsGateway } from "../operations/operations-gateway.js";
import { OperationsState } from "../operations/operations-state.js";
import type { DashboardServer } from "../dashboard/dashboard-server.js";
import { createDashboardServer } from "../dashboard/dashboard-server.js";
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

const refusingResponder: QuestionResponder = {
  async answer(): Promise<string> {
    throw new Error("The cloud control plane has no question responder yet.");
  },
};

export interface DailyOperationsControlPlane {
  readonly dashboardOrigin: string;
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
  const projection = new MasterTasksProjection(state, options.masterTasks);
  const gateway = createOperationsGateway({
    state,
    worker: refusingWorker,
    verifier: refusingVerifier,
    questionResponder: refusingResponder,
    commandClassifier: createCommandClassifier(),
    workItemChanged: (workItem) => projection.sync(workItem).then(() => undefined),
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
  const notices = createExceptionNoticeRhythm({
    state,
    notify: (notification) => frontDoor.notify(notification),
    now,
  });
  const morningBrief = createMorningBriefRunner({
    state,
    listEvents: options.listCalendarEvents,
    admit: (notice) => notices.admit(notice),
    now,
  });
  const rollUp = createExecutiveRollUpRunner({
    state,
    workspaceId,
    admit: (notice) => notices.admit(notice),
    now,
  });
  const scheduler = createDailyOperationsScheduler({
    state,
    now,
    runners: {
      [releaseHeldJobName]: () => notices.releaseHeld(),
      [morningBriefJobName]: () => morningBrief.run(),
      [executiveRollUpJobName]: () => rollUp.run(),
    },
  });
  const dashboard: DashboardServer = await createDashboardServer({
    state,
    gateway,
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

  const supervisor = createControlPlaneSupervisor({
    pollTelegram: async () => {
      const recovery = await frontDoor.retryPendingDeliveries();
      const cursor = state.telegramIngressCursor();
      const read = await options.telegram.read({ reference: `offset:${cursor + 1}` });
      if (read.kind === "failed") {
        throw new Error("Telegram polling failed.");
      }
      await pollTelegramUpdates({
        updates: read.value,
        cursor: () => state.telegramIngressCursor(),
        advance: (updateId) => state.advanceTelegramIngressCursor(updateId, now()),
        receive: (update) => frontDoor.receiveUpdate(update),
      });
      if (recovery.failed > 0 || recovery.uncertain > 0) {
        throw new Error("Telegram delivery recovery remains unresolved.");
      }
    },
    tickSchedule: () => scheduler.tick(),
    now,
    onCycle: (cycle) => {
      if (cycle.telegram.kind !== "stopped") {
        state.recordControlPlaneHealth({
          component: "telegram-ingress",
          outcome: cycle.telegram.kind === "ran" ? "healthy" : "failed",
          checkedAt: cycle.at,
        });
      }
      if (cycle.schedule.kind !== "stopped") {
        state.recordControlPlaneHealth({
          component: "daily-scheduler",
          outcome: cycle.schedule.kind === "ran" ? "healthy" : "failed",
          checkedAt: cycle.at,
        });
      }
    },
    ...(options.wait === undefined ? {} : { wait: options.wait }),
  });
  let closed = false;

  return {
    dashboardOrigin: dashboard.origin,
    runCycle: () => supervisor.runCycle(),
    run: () => supervisor.run(),
    stop: () => supervisor.stop(),
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      supervisor.stop();
      await dashboard.close();
      state.close();
    },
  };
}
