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
import { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type { PortfolioProjectInput } from "../portfolio/project-portfolio.js";
import type { AgentBrainEvidenceProvider } from "../evidence/evidence-broker.js";
import type { ProjectEvidenceBindingRequest } from "../evidence/evidence-broker.js";
import type { ControlledWorker, EffectVerifier } from "../operations/contracts.js";
import type { GitHubRepositoryAdapter } from "../providers/github-repository-adapter.js";
import type { GitLineageAdapter } from "../providers/git-lineage-adapter.js";
import type { VercelDeploymentAdapter } from "../providers/vercel-deployment-adapter.js";
import { buildRepositoryCenterView, type RepositoryCenterView } from "../portfolio/repository-center.js";
import {
  deploymentCandidateStatePath,
  SqliteDeploymentCandidateStore,
} from "../portfolio/deployment-candidate.js";
import {
  deploymentPromotionStatePath,
  SqliteDeploymentPromotionStore,
} from "../portfolio/deployment-promotion.js";
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
  readonly portfolioPath?: string;
  /** CEO-provided catalogue records; provider-owned records are never copied. */
  readonly portfolioProjects?: readonly PortfolioProjectInput[];
  /** Optional read-only adapters. When supplied, their observations feed the authenticated dashboard. */
  readonly repositoryCenterAdapters?: ReadonlyMap<string, {
    readonly github: GitHubRepositoryAdapter;
    readonly git: GitLineageAdapter;
    readonly vercel?: VercelDeploymentAdapter;
    /** Local checkout path for Git; distinct from the GitHub owner/name reference. */
    readonly gitReference: string;
  }>;
  /** Optional read-only Agent Brain adapter; no provider write capability is accepted. */
  readonly evidenceProvider?: AgentBrainEvidenceProvider;
  /** Optional private-worker adapter; omitted while the Lenovo is offline. */
  readonly privateWorker?: ControlledWorker;
  /** Optional verifier paired with a supplied private-worker adapter. */
  readonly effectVerifier?: EffectVerifier;
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
    // Long polling. Short polling at one cycle a second is roughly 86,000
    // requests a day for a mailbox that is empty almost all of them, and
    // sustained request rates are what earn a rate limit -- which would stop
    // the CEO's messages arriving at all, the one thing this service exists
    // to guarantee. Telegram holds the connection instead and answers the
    // moment a message lands, so this is both cheaper and faster.
    longPollSeconds: 20,
    now,
  });
  const notionLedger = new SqliteNotionWriteLedger(options.notionLedgerPath);
  const portfolio = new ProjectPortfolio(
    options.portfolioPath ?? options.statePath,
    now,
  );
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
  const deploymentCandidateStore = new SqliteDeploymentCandidateStore(
    deploymentCandidateStatePath(options.statePath),
  );
  const deploymentPromotionStore = new SqliteDeploymentPromotionStore(
    deploymentPromotionStatePath(options.statePath),
  );

  try {
    for (const project of options.portfolioProjects ?? []) {
      portfolio.upsert(project);
    }
    const refreshRepositoryCenters = async (): Promise<ReadonlyMap<string, RepositoryCenterView>> => {
      const repositoryCenters = new Map<string, RepositoryCenterView>();
      for (const [projectId, adapters] of options.repositoryCenterAdapters ?? []) {
        const project = portfolio.project(projectId);
        if (project === undefined) {
          throw new Error(`Repository Center project ${projectId} was not found.`);
        }
        const reference = project.repository ?? "";
        const [github, git, vercel] = await Promise.all([
          adapters.github.read({ reference }),
          adapters.git.read({ reference: adapters.gitReference }),
          adapters.vercel === undefined
            ? Promise.resolve(undefined)
            : adapters.vercel.read({ reference: project.deploymentIdentifiers.vercel ?? "" }),
        ]);
        repositoryCenters.set(
          projectId,
          buildRepositoryCenterView({
            project,
            github,
            git,
            ...(vercel === undefined ? {} : { vercel }),
            gitSourceReference: adapters.gitReference,
            now: now(),
          }),
        );
      }
      return repositoryCenters;
    };
    const controlPlane = await createDailyOperationsControlPlane({
      statePath: options.statePath,
      masterTasks,
      portfolio,
      deploymentCandidateStore,
      deploymentPromotionStore,
      ...(options.repositoryCenterAdapters === undefined
        ? {}
        : { refreshRepositoryCenters }),
      ...(options.evidenceProvider === undefined
        ? {}
        : { evidenceProvider: options.evidenceProvider }),
      ...(options.privateWorker === undefined
        ? {}
        : { privateWorker: options.privateWorker }),
      ...(options.effectVerifier === undefined
        ? {}
        : { effectVerifier: options.effectVerifier }),
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
      projectPortfolio: controlPlane.projectPortfolio,
      projectEvidence: controlPlane.projectEvidence,
      bindPortfolioProject: (request: ProjectEvidenceBindingRequest) =>
        controlPlane.bindPortfolioProject(request),
      prepareDeploymentCandidate: (input) =>
        controlPlane.prepareDeploymentCandidate(input),
      deploymentCandidate: (id) => controlPlane.deploymentCandidate(id),
      requestDeploymentPromotionApproval: (input) =>
        controlPlane.requestDeploymentPromotionApproval(input),
      promoteDeploymentCandidate: (input) =>
        controlPlane.promoteDeploymentCandidate(input),
      runCycle: () => controlPlane.runCycle(),
      run: () => controlPlane.run(),
      stop: () => controlPlane.stop(),
      async close(): Promise<void> {
        try {
          await controlPlane.close();
        } finally {
          portfolio.close();
          notionLedger.close();
        }
      },
    };
  } catch (error) {
    portfolio.close();
    deploymentCandidateStore.close();
    deploymentPromotionStore.close();
    notionLedger.close();
    throw error;
  }
}
