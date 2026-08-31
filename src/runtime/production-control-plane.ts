import { createAzureKeyVaultReader } from "../providers/azure-key-vault-reader.js";
import {
  createEphemeralCalendarWriteLedger,
  createGoogleCalendarAdapter,
} from "../providers/google-calendar-adapter.js";
import {
  createNotionMasterTasksStore,
  createNotionProviderAdapter,
  SqliteNotionWriteLedger,
} from "../providers/notion-provider-adapter.js";
import {
  createEphemeralTelegramDeliveryLedger,
  createTelegramProviderAdapter,
} from "../providers/telegram-provider-adapter.js";
import { providerFailure } from "../providers/adapter-contract.js";
import { createGoogleAccessTokens } from "./google-access-token.js";
import { resolveControlPlaneCredentials } from "./credential-resolver.js";
import {
  createDailyOperationsControlPlane,
  type DailyOperationsControlPlane,
} from "./daily-operations-control-plane.js";

function optional(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the deployment configuration and construct the real provider
 * adapters. This is the sole production composition root; tests substitute the
 * HTTP edge, not the modules being wired.
 */
export async function createProductionControlPlane(options: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly statePath: string;
  readonly notionLedgerPath: string;
  readonly vaultName?: string;
  readonly dashboardHost?: string;
  readonly dashboardPort?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly wait?: () => Promise<void>;
}): Promise<DailyOperationsControlPlane> {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const vaultName =
    optional(options.vaultName) ??
    optional(options.environment["REAL_MING_AZURE_KEY_VAULT_NAME"]);
  const resolved = await resolveControlPlaneCredentials({
    environment: options.environment,
    ...(vaultName === undefined
      ? {}
      : { vault: createAzureKeyVaultReader({ vaultName, fetch: request }) }),
  });
  if (!resolved.ready) {
    throw new Error(`Control plane cannot start.\n${resolved.report}`);
  }
  const required = (name: string): string => {
    const value = resolved.values.get(name);
    if (value === undefined) {
      throw new Error(`Control plane cannot start; ${name} is unresolved.`);
    }
    return value;
  };

  const telegram = createTelegramProviderAdapter({
    botToken: required("REAL_MING_TELEGRAM_BOT_TOKEN"),
    workspaceId: "workspace:real-ming",
    accountReference: "telegram:real-ming",
    deliveryLedger: createEphemeralTelegramDeliveryLedger(),
    fetch: request,
    now,
  });
  const notionLedger = new SqliteNotionWriteLedger(options.notionLedgerPath);
  const notion = createNotionProviderAdapter({
    token: required("REAL_MING_NOTION_TOKEN"),
    workspaceId: "workspace:real-ming",
    accountReference: "notion:real-ming",
    writeLedger: notionLedger,
    fetch: request,
    now,
  });
  const masterTasks = createNotionMasterTasksStore({
    adapter: notion,
    dataSourceId: required("REAL_MING_NOTION_MASTER_TASKS_ID"),
  });
  const googleTokens = createGoogleAccessTokens({
    clientId: required("REAL_MING_GOOGLE_CLIENT_ID"),
    clientSecret: required("REAL_MING_GOOGLE_CLIENT_SECRET"),
    refreshToken: required("REAL_MING_GOOGLE_REFRESH_TOKEN"),
    fetch: request,
    now: () => Date.parse(now()),
  });
  const calendarId =
    optional(options.environment["REAL_MING_GOOGLE_CALENDAR_ID"]) ?? "primary";

  try {
    const controlPlane = await createDailyOperationsControlPlane({
      statePath: options.statePath,
      masterTasks,
      telegram,
      ceoTelegramId: required("REAL_MING_TELEGRAM_CEO_ID"),
      ceoTelegramChatId: required("REAL_MING_TELEGRAM_CEO_ID"),
      auditPseudonymKey: required("REAL_MING_VAULT_KEY"),
      dashboardToken: required("REAL_MING_DASHBOARD_TOKEN"),
      ...(options.dashboardHost === undefined
        ? {}
        : { dashboardHost: options.dashboardHost }),
      ...(options.dashboardPort === undefined
        ? {}
        : { dashboardPort: options.dashboardPort }),
      listCalendarEvents: async (window) => {
        const token = await googleTokens.current();
        if (token.kind === "failed") {
          return {
            kind: "failed",
            failure: providerFailure(
              token.reason === "refused"
                ? "authentication-failed"
                : "unavailable",
              token.reason === "refused"
                ? "Google Calendar authorization was refused."
                : "Google Calendar authorization is temporarily unavailable.",
            ),
          };
        }
        return createGoogleCalendarAdapter({
          accessToken: token.accessToken,
          workspaceId: "workspace:real-ming",
          accountReference: "google-calendar:real-ming",
          writeLedger: createEphemeralCalendarWriteLedger(),
          fetch: request,
          now,
        }).listEvents(calendarId, window);
      },
      now,
      ...(options.wait === undefined ? {} : { wait: options.wait }),
    });
    return {
      dashboardOrigin: controlPlane.dashboardOrigin,
      runCycle: () => controlPlane.runCycle(),
      run: () => controlPlane.run(),
      stop: () => controlPlane.stop(),
      async close(): Promise<void> {
        try {
          await controlPlane.close();
        } finally {
          notionLedger.close();
        }
      },
    };
  } catch (error) {
    notionLedger.close();
    throw error;
  }
}
