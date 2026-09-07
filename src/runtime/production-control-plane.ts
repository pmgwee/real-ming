import type { RetentionBackupPurgeResult } from "../operations/retention-policy.js";
import { createAzureKeyVaultReader } from "../providers/azure-key-vault-reader.js";
import { createGmailAdapter } from "../providers/gmail-adapter.js";
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
import type { GmailEmailAdapter } from "../providers/email-provider-adapter.js";
import { createGmailEmailAdapter, SqliteEmailDraftLedger } from "../providers/email-provider-adapter.js";
import type { EmailMailboxKind } from "../operations/email-operations.js";
import { resolveControlPlaneCredentials } from "./credential-resolver.js";
import {
  createDailyOperationsControlPlane,
  type DailyOperationsControlPlane,
  type TelegramOwnership,
} from "./daily-operations-control-plane.js";
import type { KnowledgeOperationalOutput } from "../knowledge/knowledge-compiler.js";
import type { KnowledgeSource } from "../knowledge/knowledge-operations.js";
import type { PersonalContextIngestion } from "../knowledge/personal-context-ingestion.js";
import { vaultRoots, type VaultRoot } from "../knowledge/knowledge-vault.js";
import { createHermesRuntimeClient } from "../hermes/hermes-runtime-client.js";
import { createHermesSessionStore } from "../hermes/hermes-session-store.js";
import { tracerCredentials } from "../config/tracer-secrets.js";

function optional(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalObsidianRoots(value: string | undefined): readonly VaultRoot[] | undefined {
  const raw = optional(value);
  if (raw === undefined) return undefined;
  const roots = [...new Set(raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
  if (roots.length === 0 || roots.some((root) => !vaultRoots.includes(root as VaultRoot))) {
    throw new Error("REAL_MING_OBSIDIAN_ROOTS must be a comma-separated list of valid vault roots.");
  }
  return roots as VaultRoot[];
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
  /** Optional Gmail adapter supplied only after CEO mailbox authorization. */
  readonly emailAdapter?: GmailEmailAdapter;
  /** Optional already-authorized Gmail access token; no token is requested by default. */
  readonly emailAccessToken?: string;
  readonly emailDraftLedgerPath?: string;
  readonly emailMailboxBindings?: Readonly<Record<EmailMailboxKind, string>>;
  readonly vaultName?: string;
  readonly dashboardHost?: string;
  readonly dashboardPort?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => string;
  readonly wait?: () => Promise<void>;
  /** Optional production Knowledge Compiler sources/outputs. Adapters must be supplied through approved evidence boundaries. */
  readonly knowledgeOperations?: {
    readonly statePath?: string;
    readonly encryptionKey?: string;
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
   * Revision 5 behaviour unless REAL_MING_TELEGRAM_OWNERSHIP says otherwise.
   */
  readonly telegramOwnership?: TelegramOwnership;
  /** Which process owns scheduled brief/roll-up trigger and delivery. */
  readonly schedulerOwnership?: "real-ming" | "native-hermes-cron";
  /** Opt-in Hermes API-server binding. Hermes owns OAuth and model/tool reasoning. */
  readonly hermes?: {
    readonly enabled?: boolean;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly sessionKeyPrefix?: string;
    readonly model?: string;
    readonly provider?: string;
    readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
    readonly sessionsPath?: string;
  };
  readonly obsidian?: {
    readonly directory?: string;
    readonly roots?: readonly VaultRoot[];
  };
}): Promise<DailyOperationsControlPlane> {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const emailAccessToken = optional(options.emailAccessToken);
  const emailConfigured = emailAccessToken !== undefined || options.emailAdapter !== undefined;
  if (emailConfigured && (options.emailMailboxBindings === undefined || options.emailMailboxBindings.personal.trim().length === 0 || options.emailMailboxBindings.opportunity.trim().length === 0 || options.emailMailboxBindings.entertainment.trim().length === 0)) {
    throw new Error("Email operations require explicit personal, opportunity, and entertainment mailbox bindings.");
  }
  const hermesEnabled = options.hermes?.enabled ??
    (optional(options.environment["REAL_MING_HERMES_ENABLED"]) ?? "").toLowerCase() === "true";
  const credentialInventory = hermesEnabled && options.hermes?.apiKey === undefined
    ? [
        ...tracerCredentials,
        {
          name: "REAL_MING_HERMES_API_KEY",
          owner: "CEO",
          purpose: "Authenticate the private Hermes API server; Hermes retains the Codex OAuth session.",
          environment: "control-plane" as const,
          revocation: "Rotate Hermes API_SERVER_KEY and restart both services.",
        },
      ]
    : tracerCredentials;
  const vaultName =
    optional(options.vaultName) ??
    optional(options.environment["REAL_MING_AZURE_KEY_VAULT_NAME"]);
  const vault =
    vaultName === undefined
      ? undefined
      : createAzureKeyVaultReader({ vaultName, fetch: request });
  const resolved = await resolveControlPlaneCredentials({
    environment: options.environment,
    credentials: credentialInventory,
    ...(vault === undefined ? {} : { vault }),
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
  const productionKnowledgeOperations = options.knowledgeOperations === undefined
    ? undefined
    : {
        encryptionKey: options.knowledgeOperations.encryptionKey ?? required("REAL_MING_VAULT_KEY"),
        ...(options.knowledgeOperations.statePath === undefined ? {} : { statePath: options.knowledgeOperations.statePath }),
        ...(options.knowledgeOperations.sources === undefined ? {} : { sources: options.knowledgeOperations.sources }),
        ...(options.knowledgeOperations.outputs === undefined ? {} : { outputs: options.knowledgeOperations.outputs }),
        ...(options.knowledgeOperations.backup === undefined ? {} : { backup: options.knowledgeOperations.backup }),
        ...(options.knowledgeOperations.purgeBackups === undefined ? {} : { purgeBackups: options.knowledgeOperations.purgeBackups }),
        ...(options.knowledgeOperations.runnerTimeoutMs === undefined ? {} : { runnerTimeoutMs: options.knowledgeOperations.runnerTimeoutMs }),
        ...(options.knowledgeOperations.personalContext === undefined ? {} : { personalContext: options.knowledgeOperations.personalContext }),
        retentionRequired: options.knowledgeOperations.retentionRequired ?? true,
      };

  // Hermes's authenticated API_SERVER gateway listens on 8642 by default.
  // Port 9119 belongs to Hermes's desktop/dashboard backend, which does not
  // expose the API_SERVER session contract used by this adapter.
  const hermesBaseUrl = optional(options.hermes?.baseUrl) ?? optional(options.environment["REAL_MING_HERMES_BASE_URL"]) ?? "http://127.0.0.1:8642";
  const hermesApiKey = optional(options.hermes?.apiKey) ?? resolved.values.get("REAL_MING_HERMES_API_KEY");
  if (hermesEnabled && hermesApiKey === undefined) {
    throw new Error("Hermes is enabled but REAL_MING_HERMES_API_KEY is unresolved.");
  }
  const hermesSessionsPath = options.hermes?.sessionsPath ??
    optional(options.environment["REAL_MING_HERMES_SESSIONS_PATH"]) ?? `${options.statePath}.hermes.sqlite`;
  const hermesModel = options.hermes?.model ?? optional(options.environment["REAL_MING_HERMES_MODEL"]);
  const hermesProvider = options.hermes?.provider ?? optional(options.environment["REAL_MING_HERMES_PROVIDER"]);
  const hermesReasoning = options.hermes?.reasoningEffort ?? optional(options.environment["REAL_MING_HERMES_REASONING"]);
  const hermes = hermesEnabled && hermesBaseUrl !== undefined && hermesApiKey !== undefined
    ? {
        runtime: createHermesRuntimeClient({
          baseUrl: hermesBaseUrl,
          sharedSecret: hermesApiKey,
          fetch: request,
          ...(options.hermes?.sessionKeyPrefix === undefined ? {} : { sessionKeyPrefix: options.hermes.sessionKeyPrefix }),
          ...(hermesModel === undefined ? {} : { model: hermesModel }),
          ...(hermesProvider === undefined ? {} : { provider: hermesProvider }),
          ...(hermesReasoning === undefined ? {} : { reasoningEffort: hermesReasoning as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" }),
        }),
        sessions: createHermesSessionStore(hermesSessionsPath),
        ...(hermesModel === undefined ? {} : { model: hermesModel }),
      }
    : undefined;
  // A typo here would silently start a second Telegram consumer beside the
  // native gateway, which is the one failure mode the cutover exists to avoid.
  // So an unrecognised value refuses to start rather than defaulting.
  const configuredOwnership = optional(options.environment["REAL_MING_TELEGRAM_OWNERSHIP"]);
  if (
    configuredOwnership !== undefined &&
    configuredOwnership !== "real-ming-ingress" &&
    configuredOwnership !== "native-hermes-gateway"
  ) {
    throw new Error(
      "REAL_MING_TELEGRAM_OWNERSHIP must be 'real-ming-ingress' or 'native-hermes-gateway'.",
    );
  }
  const telegramOwnership: TelegramOwnership =
    options.telegramOwnership ?? (configuredOwnership as TelegramOwnership | undefined) ?? "real-ming-ingress";
  const configuredSchedulerOwnership = optional(
    options.environment["REAL_MING_SCHEDULER_OWNERSHIP"],
  );
  if (
    configuredSchedulerOwnership !== undefined &&
    configuredSchedulerOwnership !== "real-ming" &&
    configuredSchedulerOwnership !== "native-hermes-cron"
  ) {
    throw new Error(
      "REAL_MING_SCHEDULER_OWNERSHIP must be 'real-ming' or 'native-hermes-cron'.",
    );
  }
  const schedulerOwnership =
    options.schedulerOwnership ??
    (configuredSchedulerOwnership as
      | "real-ming"
      | "native-hermes-cron"
      | undefined) ??
    "real-ming";
  const obsidianDirectory = options.obsidian?.directory ?? optional(options.environment["REAL_MING_OBSIDIAN_DIRECTORY"]);
  const obsidianRoots = options.obsidian?.roots ?? optionalObsidianRoots(options.environment["REAL_MING_OBSIDIAN_ROOTS"]);
  const obsidian = obsidianDirectory === undefined
    ? undefined
    : {
        directory: obsidianDirectory,
        ...(obsidianRoots === undefined ? {} : { roots: obsidianRoots }),
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

  /**
   * One refresh token per mailbox, so a credential can only ever read the
   * inbox it was minted for. A malformed map is refused rather than silently
   * leaving the agent with no mailboxes and no explanation.
   */
  const mailRefreshTokens = await (async (): Promise<
    Readonly<Record<string, string>>
  > => {
    const raw = optional(options.environment["REAL_MING_MAIL_REFRESH_TOKENS"]);
    // Mailbox tokens are a secret, so the environment is only the override;
    // the vault is where they actually live.
    const fromVault =
      raw !== undefined || vault === undefined
        ? undefined
        : await vault.read("real-ming-mail-refresh-tokens");
    const source =
      raw ?? (fromVault?.kind === "found" ? fromVault.value : undefined);
    if (source === undefined || source.trim() === "") return {};
    try {
      const parsed: unknown = JSON.parse(source);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("not an object");
      }
      return parsed as Readonly<Record<string, string>>;
    } catch {
      throw new Error(
        "REAL_MING_MAIL_REFRESH_TOKENS is not a JSON object of mailbox to refresh token.",
      );
    }
  })();
  const mailboxes = Object.keys(mailRefreshTokens);
  const mailTokens = new Map(
    mailboxes.map((mailbox) => [
      mailbox,
      createGoogleAccessTokens({
        clientId: required("REAL_MING_GOOGLE_CLIENT_ID"),
        clientSecret: required("REAL_MING_GOOGLE_CLIENT_SECRET"),
        refreshToken: mailRefreshTokens[mailbox] ?? "",
        fetch: request,
        now: () => Date.parse(now()),
      }),
    ]),
  );
  const mailAdapterFor = async (mailbox: string) => {
    const tokens = mailTokens.get(mailbox);
    if (tokens === undefined) return undefined;
    const token = await tokens.current();
    if (token.kind === "failed") return undefined;
    return createGmailAdapter({
      accessToken: token.accessToken,
      workspaceId: "workspace:real-ming",
      mailbox,
      fetch: request,
      now,
    });
  };
  const deploymentCandidateStore = new SqliteDeploymentCandidateStore(
    deploymentCandidateStatePath(options.statePath),
  );
  const deploymentPromotionStore = new SqliteDeploymentPromotionStore(
    deploymentPromotionStatePath(options.statePath),
  );
  const emailLedger = emailAccessToken === undefined
    ? undefined
    : new SqliteEmailDraftLedger(options.emailDraftLedgerPath ?? `${options.statePath}.email-drafts.sqlite`);
  const emailAdapter = options.emailAdapter ?? (emailAccessToken === undefined
    ? undefined
    : createGmailEmailAdapter({
        accessToken: emailAccessToken,
        workspaceId: "workspace:real-ming",
        accountReference: "gmail:real-ming",
        ...(emailLedger === undefined ? {} : { draftLedger: emailLedger }),
        fetch: request,
        now,
      }));

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
      ...(emailAdapter === undefined ? {} : { emailAdapter }),
      ...(options.emailMailboxBindings === undefined ? {} : { emailMailboxBindings: options.emailMailboxBindings }),
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
      telegramOwnership,
      schedulerOwnership,
      ...(hermesApiKey === undefined ? {} : { nativeCronApiKey: hermesApiKey }),
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
      createCalendarEvent: async (event) => {
        const token = await googleTokens.current();
        if (token.kind === "failed") {
          return {
            kind: "failed",
            failure: providerFailure(
              token.reason === "refused"
                ? "authentication-failed"
                : "unavailable",
              "Google Calendar authorization is unavailable.",
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
        }).createEvent(event);
      },
      ...(mailboxes.length === 0
        ? {}
        : {
            mailboxes,
            searchMail: async (search: {
              readonly mailbox: string;
              readonly query?: string;
              readonly limit?: number;
            }) => {
              const adapter = await mailAdapterFor(search.mailbox);
              if (adapter === undefined) {
                return {
                  kind: "failed" as const,
                  failure: providerFailure(
                    "authentication-failed",
                    `Authorization for ${search.mailbox} is unavailable.`,
                  ),
                };
              }
              return adapter.listMessages({
                ...(search.query === undefined ? {} : { query: search.query }),
                ...(search.limit === undefined ? {} : { limit: search.limit }),
              });
            },
            readMail: async (request: {
              readonly mailbox: string;
              readonly messageId: string;
            }) => {
              const adapter = await mailAdapterFor(request.mailbox);
              if (adapter === undefined) {
                return {
                  kind: "failed" as const,
                  failure: providerFailure(
                    "authentication-failed",
                    `Authorization for ${request.mailbox} is unavailable.`,
                  ),
                };
              }
              return adapter.readMessage(request.messageId);
            },
            draftMail: async (draft: {
              readonly mailbox: string;
              readonly to: readonly string[];
              readonly subject: string;
              readonly body: string;
              readonly cc?: readonly string[];
              readonly idempotencyKey: string;
            }) => {
              const adapter = await mailAdapterFor(draft.mailbox);
              if (adapter === undefined) {
                return {
                  kind: "failed" as const,
                  failure: providerFailure(
                    "authentication-failed",
                    `Authorization for ${draft.mailbox} is unavailable.`,
                  ),
                };
              }
              return adapter.createDraft({
                to: draft.to,
                subject: draft.subject,
                body: draft.body,
                ...(draft.cc === undefined ? {} : { cc: draft.cc }),
                idempotencyKey: draft.idempotencyKey,
              });
            },
          }),
      now,
      ...(productionKnowledgeOperations === undefined
        ? {}
        : { knowledgeOperations: productionKnowledgeOperations }),
      ...(hermes === undefined ? {} : { hermes }),
      ...(obsidian === undefined ? {} : { obsidian }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
    });
    return {
      dashboardOrigin: controlPlane.dashboardOrigin,
      telegramOwnership: controlPlane.telegramOwnership,
      schedulerOwnership: controlPlane.schedulerOwnership,
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
      emailOperations: controlPlane.emailOperations,
      entertainmentEmailDigest: controlPlane.entertainmentEmailDigest,
      hermesOverview: controlPlane.hermesOverview,
      materializeObsidian: controlPlane.materializeObsidian,
      runNativeScheduledReport: (request) => controlPlane.runNativeScheduledReport(request),
      runCycle: () => controlPlane.runCycle(),
      run: () => controlPlane.run(),
      stop: () => controlPlane.stop(),
      async close(): Promise<void> {
        try {
          await controlPlane.close();
        } finally {
          emailLedger?.close();
          portfolio.close();
          notionLedger.close();
        }
      },
    };
  } catch (error) {
    portfolio.close();
    deploymentCandidateStore.close();
    deploymentPromotionStore.close();
    emailLedger?.close();
    notionLedger.close();
    hermes?.sessions.close();
    throw error;
  }
}
