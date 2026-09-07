import {
  providerFailure,
  providerStalenessThresholdMs,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderFailureClass,
  type ProviderIdentity,
  type ProviderProvenance,
  type ProviderReadRequest,
  type ProviderReadResult,
  type ProviderWriteRequest,
  type ProviderWriteResult,
} from "../providers/adapter-contract.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import {
  createEphemeralTelegramDeliveryLedger,
  createTelegramProviderAdapter,
} from "../providers/telegram-provider-adapter.js";
import type { TelegramDeliveryLedger } from "../providers/telegram-provider-adapter.js";
import {
  createEphemeralNotionWriteLedger,
  createNotionProviderAdapter,
  type NotionWriteLedger,
  type NotionProviderAdapter,
} from "../providers/notion-provider-adapter.js";
import { readLegacyNotionTaskSources } from "../providers/notion-legacy-task-reader.js";
import { createNotionCutoverWorkspace } from "../providers/notion-cutover-workspace.js";
import { createCanvasAdapter, type CanvasAdapter } from "../providers/canvas-adapter.js";
import { createDuitSiniAdapter, type DuitSiniAdapter } from "../providers/duitsini-adapter.js";
import { createMicrosoft365Adapter, type Microsoft365Adapter } from "../providers/microsoft365-adapter.js";
import {
  createGoogleCalendarAdapter,
  type GoogleCalendarAdapter,
} from "../providers/google-calendar-adapter.js";
import {
  createGmailAdapter,
  type GmailAdapter,
} from "../providers/gmail-adapter.js";
import type { CutoverWorkspace } from "../migration/master-tasks-cutover.js";
import { legacyTaskSourceDefinitions, type LegacyTaskSource } from "../migration/task-migration-rehearsal.js";

import { createAzureKeyVaultReader } from "../providers/azure-key-vault-reader.js";
import {
  createAzureBlobBackupUploader,
  type AzureBlobBackupUploader,
} from "../providers/azure-blob-backup-uploader.js";
import {
  createGitHubRepositoryAdapter,
  type GitHubRepositoryAdapter,
} from "../providers/github-repository-adapter.js";
import {
  createGitLineageAdapter,
  type GitCommandRunner,
  type GitLineageAdapter,
} from "../providers/git-lineage-adapter.js";
import {
  createVercelDeploymentAdapter,
  type VercelDeploymentAdapter,
} from "../providers/vercel-deployment-adapter.js";
import {
  createGoogleAccessTokens,
  type GoogleAccessTokens,
} from "../runtime/google-access-token.js";
import {
  createGmailEmailAdapter,
  type EmailDraftLedger,
  type GmailEmailAdapter,
} from "../providers/email-provider-adapter.js";
import type { VaultSecretReader } from "../runtime/credential-resolver.js";
import type {
  AgentBrainEvidenceProvider,
  AgentBrainEvidenceReadResult,
} from "../evidence/evidence-broker.js";

export const contractSecretFixture = "provider-secret-must-never-be-reported";

export interface EmailProviderContractHarness {
  readonly adapter: GmailEmailAdapter;
  requests(): readonly string[];
  externalEffectCount(): number;
}

/** Controlled Gmail edge for RM-29 contract tests; it never contacts Gmail. */
export function createEmailProviderContractHarness(options: {
  readonly responses: readonly (Response | (() => Response | Promise<Response>))[];
  readonly accessToken?: string;
  readonly now?: () => string;
  readonly draftLedger?: EmailDraftLedger;
}): EmailProviderContractHarness {
  const requests: string[] = [];
  let responseIndex = 0;
  let externalEffects = 0;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    if ((init?.method ?? "GET") === "POST") externalEffects += 1;
    const next = options.responses[responseIndex++];
    if (next === undefined) return Response.json({ error: "controlled response exhausted" }, { status: 503 });
    return typeof next === "function" ? await next() : next;
  };
  const adapterOptions = {
    accessToken: options.accessToken ?? contractSecretFixture,
    workspaceId: "workspace:real-ming",
    accountReference: "gmail:real-ming",
    fetch: fetchImplementation,
    now: options.now ?? (() => "2026-09-02T15:00:00.000Z"),
    ...(options.draftLedger === undefined ? {} : { draftLedger: options.draftLedger }),
  };
  return {
    adapter: createGmailEmailAdapter(adapterOptions),
    requests: () => [...requests],
    externalEffectCount: () => externalEffects,
  };
}

export interface AgentBrainEvidenceContractHarness {
  readonly provider: AgentBrainEvidenceProvider;
  setResult(result: AgentBrainEvidenceReadResult): void;
  readCount(): number;
}

/** Controlled Agent Brain edge for broker contract tests; it has no write API. */
export function createAgentBrainEvidenceContractHarness(
  initial: AgentBrainEvidenceReadResult,
): AgentBrainEvidenceContractHarness {
  let result = initial;
  let reads = 0;
  return {
    provider: {
      read: async () => {
        reads += 1;
        return result;
      },
    },
    setResult: (next) => {
      result = next;
    },
    readCount: () => reads,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ContractScenario {
  /** Seconds Telegram may hold an empty getUpdates open. */
  readonly longPollSeconds?: number;
  readonly asOf?: string;
  readonly now?: string;
  readonly failure?: ProviderFailureClass;
  readonly emptyValue?: boolean;
  readonly telegramDeliveryLedger?: TelegramDeliveryLedger;
  readonly telegramUpdates?: readonly unknown[];
  readonly telegramThrowAfterEffect?: boolean;
  readonly telegramMalformedResponseAfterEffect?: boolean;
  readonly notionWriteLedger?: NotionWriteLedger | null;
}

export interface ContractAdapter extends ProviderAdapter<readonly unknown[]> {
  providerCallCount(): number;
  externalEffectCount(): number;
  providerRequests(): readonly unknown[];
}

function createTelegramContractAdapter(
  scenario: ContractScenario,
): ContractAdapter {
  const now = scenario.now ?? "2026-08-27T09:00:00.000Z";
  const asOf = scenario.asOf ?? now;
  let providerCalls = 0;
  let externalEffects = 0;
  const listRequests: URL[] = [];
  const providerRequests: unknown[] = [];

  const failureResponse = (
    failureClass: ProviderFailureClass,
  ): Response => {
    const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
      "authentication-failed": 401,
      "invalid-input": 400,
      "permission-denied": 403,
      "rate-limited": 429,
      "unsupported-capability": 400,
      unavailable: 503,
      "provider-error": 400,
    };
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: statusByClass[failureClass],
        description: rawProviderError(failureClass),
        ...(failureClass === "rate-limited"
          ? { parameters: { retry_after: 1 } }
          : {}),
      }),
      {
        status: statusByClass[failureClass],
        headers: { "content-type": "application/json" },
      },
    );
  };

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    providerCalls += 1;
    if (scenario.failure !== undefined) {
      return failureResponse(scenario.failure);
    }

    const url = String(input);
    if (url.endsWith("/getUpdates")) {
      providerRequests.push(
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      );
      const result =
        scenario.emptyValue === true
          ? []
          : scenario.telegramUpdates ?? [
              {
                update_id: 1,
                message: {
                  message_id: 1,
                  date: Math.floor(Date.parse(asOf) / 1000),
                  from: { id: 100000001 },
                  chat: { id: 100000001, type: "private" },
                  text: "Controlled contract update",
                },
              },
            ];
      return Response.json({ ok: true, result });
    }

    if (url.endsWith("/sendMessage")) {
      externalEffects += 1;
      providerRequests.push(
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      );
      if (scenario.telegramThrowAfterEffect === true) {
        throw new Error("Controlled ambiguous Telegram transport failure.");
      }
      if (scenario.telegramMalformedResponseAfterEffect === true) {
        return new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return Response.json({ ok: true, result: { message_id: 1 } });
    }

    return Response.json(
      { ok: false, error_code: 400 },
      { status: 400 },
    );
  };

  const adapter = createTelegramProviderAdapter({
    botToken: "controlled-contract-token",
    workspaceId: "workspace:real-ming",
    accountReference: "telegram:account:real-ming",
    deliveryLedger:
      scenario.telegramDeliveryLedger ??
      createEphemeralTelegramDeliveryLedger(),
    fetch: fetchImplementation,
    ...(scenario.longPollSeconds === undefined
      ? {}
      : { longPollSeconds: scenario.longPollSeconds }),
    now: () => now,
  });

  return {
    ...adapter,
    providerCallCount: () => providerCalls,
    externalEffectCount: () => externalEffects,
    providerRequests: () => providerRequests,
  };
}

function createNotionContractAdapter(
  scenario: ContractScenario,
): ContractAdapter {
  const now = scenario.now ?? "2026-08-27T09:00:00.000Z";
  const asOf = scenario.asOf ?? now;
  let providerCalls = 0;
  let externalEffects = 0;
  const providerRequests: unknown[] = [];

  const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
    "authentication-failed": 401,
    "invalid-input": 404,
    "permission-denied": 403,
    "rate-limited": 429,
    "unsupported-capability": 400,
    unavailable: 503,
    "provider-error": 422,
  };

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    providerCalls += 1;
    if (scenario.failure !== undefined) {
      return Response.json(
        {
          object: "error",
          message: rawProviderError(scenario.failure),
        },
        {
          status: statusByClass[scenario.failure],
          ...(scenario.failure === "rate-limited"
            ? { headers: { "retry-after": "1" } }
            : {}),
        },
      );
    }

    const url = String(input);
    providerRequests.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.includes("/query")) {
      return Response.json({
        object: "list",
        results:
          scenario.emptyValue === true
            ? []
            : [{ id: "notion-page:1", last_edited_time: asOf }],
        has_more: false,
        next_cursor: null,
      });
    }
    if ((init?.method ?? "GET") === "PATCH") {
      externalEffects += 1;
      return Response.json({ object: "page", id: "notion-page:1" });
    }
    return Response.json({ object: "error", message: "Unsupported fixture request." }, { status: 422 });
  };

  const adapter = createNotionProviderAdapter({
    token: contractSecretFixture,
    workspaceId: "workspace:real-ming",
    accountReference: "notion:account:real-ming",
    ...(scenario.notionWriteLedger === null
      ? {}
      : {
          writeLedger:
            scenario.notionWriteLedger ?? createEphemeralNotionWriteLedger(),
        }),
    fetch: fetchImplementation,
    now: () => now,
  });

  return {
    ...adapter,
    providerCallCount: () => providerCalls,
    externalEffectCount: () => externalEffects,
    providerRequests: () => providerRequests,
  };
}

export interface NotionProvisioningContractHarness {
  readonly adapter: NotionProviderAdapter;
  databaseCreateCount(): number;
  viewCreateCount(): number;
  viewUpdateCount(): number;
  createdSchemaNames(): readonly string[];
  viewNames(): readonly string[];
  masterTaskPageCreateCount(): number;
  masterTaskPageUpdateCount(): number;
  simulateMasterTaskExternalEdit(workItemId: string, lastEditedTime: string): void;
}

export function createNotionProvisioningContractHarness(options: {
  readonly failViewCreateOnceAt?: number;
  readonly driftViewFilterOnReplay?: boolean;
} = {}): NotionProvisioningContractHarness {
  const databaseId = "notion-database:master-tasks";
  const dataSourceId = "notion-data-source:master-tasks";
  let databaseExists = false;
  let databasesCreated = 0;
  let viewAttempts = 0;
  let viewsCreated = 0;
  let viewsUpdated = 0;
  let filterDriftInjected = false;
  let failedConfiguredAttempt = false;
  let schemaNames: readonly string[] = [];
  let createdSchema: Readonly<Record<string, unknown>> = {};
  const views: Array<{
    readonly id: string;
    readonly name: string;
    filter?: unknown;
  }> = [];
  const pages: Array<Record<string, unknown>> = [];
  let pagesCreated = 0;
  let pagesUpdated = 0;

  const databaseResponse = () => ({
    object: "database",
    id: databaseId,
    data_sources: [{ id: dataSourceId, name: "Master Tasks" }],
  });

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname.includes("/blocks/") && url.pathname.endsWith("/children")) {
      return Response.json({
        object: "list",
        results: databaseExists
          ? [
              {
                object: "block",
                id: databaseId,
                type: "child_database",
                child_database: { title: "Master Tasks" },
              },
            ]
          : [],
        has_more: false,
        next_cursor: null,
      });
    }

    if (url.pathname === "/v1/databases" && method === "POST") {
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const initial = body["initial_data_source"];
      const properties =
        typeof initial === "object" && initial !== null
          ? (initial as Record<string, unknown>)["properties"]
          : undefined;
      schemaNames =
        typeof properties === "object" && properties !== null
          ? Object.keys(properties)
          : [];
      createdSchema =
        typeof properties === "object" && properties !== null
          ? (properties as Readonly<Record<string, unknown>>)
          : {};
      databaseExists = true;
      databasesCreated += 1;
      return Response.json(databaseResponse());
    }

    if (url.pathname === `/v1/databases/${databaseId}` && method === "GET") {
      return Response.json(databaseResponse());
    }

    if (url.pathname === `/v1/data_sources/${dataSourceId}` && method === "GET") {
      return Response.json({
        object: "data_source",
        id: dataSourceId,
        properties: Object.fromEntries(
          Object.entries(createdSchema).map(([name, schema]) => {
            const type =
              typeof schema === "object" && schema !== null
                ? Object.keys(schema)[0]
                : undefined;
            return [name, { ...(schema as object), type }];
          }),
        ),
      });
    }

    if (decodeURIComponent(url.pathname) === `/v1/data_sources/${dataSourceId}/query` && method === "POST") {
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      const filter = body["filter"];
      const expected = isRecord(filter) && isRecord(filter["rich_text"])
        ? filter["rich_text"]["equals"]
        : undefined;
      const matching = expected === undefined
        ? pages
        : pages.filter((page) => JSON.stringify(page["properties"] ?? {}).includes(String(expected)));
      return Response.json({ object: "list", results: matching, has_more: false, next_cursor: null });
    }

    if (url.pathname === "/v1/pages" && method === "POST") {
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      const page = {
        object: "page",
        id: `notion-page:${pages.length + 1}`,
        created_time: "2026-08-29T02:00:00.000Z",
        last_edited_time: "2026-08-29T02:00:00.000Z",
        properties: body["properties"] ?? {},
      };
      pages.push(page);
      pagesCreated += 1;
      return Response.json(page);
    }

    if (url.pathname.startsWith("/v1/pages/") && method === "PATCH") {
      const id = decodeURIComponent(url.pathname.slice("/v1/pages/".length));
      const page = pages.find((candidate) => candidate["id"] === id);
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      if (page === undefined) return Response.json({ message: "Unknown page" }, { status: 404 });
      page["properties"] = body["properties"] ?? {};
      pagesUpdated += 1;
      return Response.json(page);
    }

    if (url.pathname === "/v1/views" && method === "GET") {
      return Response.json({
        object: "list",
        results: views.map((view) => ({ object: "view", id: view.id })),
        has_more: false,
        next_cursor: null,
      });
    }

    if (url.pathname.startsWith("/v1/views/") && method === "GET") {
      const id = url.pathname.slice("/v1/views/".length);
      const view = views.find((candidate) => candidate.id === id);
      if (
        view !== undefined &&
        options.driftViewFilterOnReplay === true &&
        !filterDriftInjected &&
        view.name === "CTO Work View"
      ) {
        view.filter = { property: "Accountable Executive", select: { equals: "CMO" } };
        filterDriftInjected = true;
      }
      return view === undefined
        ? Response.json(
            { object: "error", message: "Unknown controlled view." },
            { status: 404 },
          )
        : Response.json(view);
    }

    if (url.pathname.startsWith("/v1/views/") && method === "PATCH") {
      const id = url.pathname.slice("/v1/views/".length);
      const view = views.find((candidate) => candidate.id === id);
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      if (view === undefined) {
        return Response.json({ object: "error", message: "Unknown controlled view." }, { status: 404 });
      }
      view.filter = body["filter"];
      viewsUpdated += 1;
      return Response.json(view);
    }

    if (url.pathname === "/v1/views" && method === "POST") {
      viewAttempts += 1;
      if (
        options.failViewCreateOnceAt === viewAttempts &&
        !failedConfiguredAttempt
      ) {
        failedConfiguredAttempt = true;
        return Response.json(
          { object: "error", message: "Controlled Notion interruption." },
          { status: 503 },
        );
      }
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const name = body["name"];
      if (typeof name !== "string") {
        return Response.json(
          { object: "error", message: "View name is required." },
          { status: 422 },
        );
      }
      const view = {
        id: `notion-view:${views.length + 1}`,
        name,
        ...(body["filter"] === undefined ? {} : { filter: body["filter"] }),
      };
      views.push(view);
      viewsCreated += 1;
      return Response.json(view);
    }

    return Response.json(
      { object: "error", message: `Unsupported fixture request: ${method} ${url.pathname}` },
      { status: 422 },
    );
  };

  return {
    adapter: createNotionProviderAdapter({
      token: contractSecretFixture,
      workspaceId: "workspace:real-ming",
      accountReference: "notion:account:real-ming",
      writeLedger: createEphemeralNotionWriteLedger(),
      fetch: fetchImplementation,
      now: () => "2026-08-27T09:00:00.000Z",
    }),
    databaseCreateCount: () => databasesCreated,
    viewCreateCount: () => viewsCreated,
    viewUpdateCount: () => viewsUpdated,
    createdSchemaNames: () => schemaNames,
    viewNames: () => views.map((view) => view.name),
    masterTaskPageCreateCount: () => pagesCreated,
    masterTaskPageUpdateCount: () => pagesUpdated,
    simulateMasterTaskExternalEdit: (workItemId, lastEditedTime) => {
      const page = pages.find((candidate) => {
        const properties = candidate["properties"];
        if (!isRecord(properties)) return false;
        const property = properties["Work Item ID"];
        if (!isRecord(property)) return false;
        const richText = property["rich_text"];
        return Array.isArray(richText) &&
          richText.some(
            (entry) =>
              isRecord(entry) &&
              (entry["plain_text"] === workItemId ||
                (isRecord(entry["text"]) &&
                  entry["text"]["content"] === workItemId)),
          );
      });
      if (page === undefined) throw new Error("Controlled Master Tasks page not found.");
      page["last_edited_time"] = lastEditedTime;
    },
  };
}

export interface ProviderAdapterContractCase {
  readonly name: string;
  readonly provider: string;
  readonly capabilities: readonly ProviderCapability[];
  createAdapter(scenario: ContractScenario): ContractAdapter;
}

function rawProviderError(failureClass: ProviderFailureClass): string {
  return `provider rejected call using ${contractSecretFixture} (${failureClass})`;
}

function createContractAdapter(options: {
  readonly provider: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly scenario: ContractScenario;
}): ContractAdapter {
  const { provider, capabilities, scenario } = options;
  const now = scenario.now ?? "2026-08-27T09:00:00.000Z";
  const asOf = scenario.asOf ?? now;
  const identity: ProviderIdentity = {
    provider,
    workspaceId: "workspace:real-ming",
    accountReference: `${provider}:account:real-ming`,
  };
  const performedEffects = new Map<string, string>();
  const providerRequests: unknown[] = [];
  let providerCalls = 0;

  const provenanceFor = (reference: string): ProviderProvenance => ({
    sourceIdentity: `${provider}:workspace:real-ming`,
    sourceReference: reference,
    asOf,
    retrievedAt: now,
    freshness:
      Date.parse(now) - Date.parse(asOf) > providerStalenessThresholdMs
        ? "stale"
        : "current",
  });

  const scenarioFailure = () =>
    scenario.failure === undefined
      ? undefined
      : providerFailure(
          scenario.failure,
          rawProviderError(scenario.failure),
          [contractSecretFixture],
          scenario.failure === "rate-limited" ? 1000 : undefined,
        );

  return {
    identity: () => identity,
    capabilities: () => capabilities,
    providerCallCount: () => providerCalls,
    externalEffectCount: () => performedEffects.size,
    providerRequests: () => providerRequests,

    async read(
      request: ProviderReadRequest,
    ): Promise<ProviderReadResult<readonly string[]>> {
      if (!capabilities.includes("read")) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unsupported-capability",
            `${provider} does not support read`,
          ),
        };
      }
      if (request.reference.trim().length === 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A provider read requires a non-empty reference.",
          ),
        };
      }

      providerCalls += 1;
      const failure = scenarioFailure();
      if (failure !== undefined) {
        return { kind: "failed", failure };
      }

      const provenance = provenanceFor(request.reference);
      const value = scenario.emptyValue === true ? [] : [request.reference];

      return provenance.freshness === "stale"
        ? { kind: "stale", identity, provenance, value }
        : { kind: "ok", identity, provenance, value };
    },

    async write(request: ProviderWriteRequest): Promise<ProviderWriteResult> {
      if (!capabilities.includes("write")) {
        return {
          kind: "failed",
          failure: providerFailure(
            "unsupported-capability",
            `${provider} is read-only and cannot perform a write.`,
          ),
        };
      }
      if (
        request.idempotencyKey.trim().length === 0 ||
        request.reference.trim().length === 0
      ) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            "A provider write requires an idempotency key and a reference.",
          ),
        };
      }

      const sensitiveFields = detectSensitiveFields(request.payload);
      if (sensitiveFields.length > 0) {
        return {
          kind: "failed",
          failure: providerFailure(
            "invalid-input",
            `A provider write rejected Sensitive Secret fields: ${sensitiveFields.join(", ")}.`,
          ),
        };
      }

      const alreadyPerformed = performedEffects.has(request.idempotencyKey);
      if (alreadyPerformed) {
        return {
          kind: "ok",
          identity,
          provenance: provenanceFor(request.reference),
          effectReference: request.idempotencyKey,
          deduplicated: true,
        };
      }

      providerCalls += 1;
      const failure = scenarioFailure();
      if (failure !== undefined) {
        return { kind: "failed", failure };
      }

      performedEffects.set(request.idempotencyKey, request.reference);
      providerRequests.push(request.payload);
      return {
        kind: "ok",
        identity,
        provenance: provenanceFor(request.reference),
        effectReference: request.idempotencyKey,
        deduplicated: false,
      };
    },
  };
}

export function providerAdapterContractCases(): readonly ProviderAdapterContractCase[] {
  return [
    {
      name: "read-only-reference",
      provider: "read-only-reference",
      capabilities: ["read"],
      createAdapter: (scenario) =>
        createContractAdapter({
          provider: "read-only-reference",
          capabilities: ["read"],
          scenario,
        }),
    },
    {
      name: "read-write-reference",
      provider: "read-write-reference",
      capabilities: ["read", "write"],
      createAdapter: (scenario) =>
        createContractAdapter({
          provider: "read-write-reference",
          capabilities: ["read", "write"],
          scenario,
        }),
    },
    {
      name: "telegram",
      provider: "telegram",
      capabilities: ["read", "write"],
      createAdapter: createTelegramContractAdapter,
    },
    {
      name: "notion",
      provider: "notion",
      capabilities: ["read", "write"],
      createAdapter: createNotionContractAdapter,
    },
  ];
}

export interface CalendarContractHarness {
  readonly adapter: GoogleCalendarAdapter;
  providerCallCount(): number;
  externalEffectCount(): number;
  listRequests(): readonly URL[];
}

export function createCalendarContractHarness(
  scenario: {
    readonly failure?: ProviderFailureClass;
    readonly emptyValue?: boolean;
    readonly asOf?: string;
    readonly now?: string;
    readonly omitAsOf?: boolean;
    readonly malformedBody?: boolean;
    readonly unreadableEvent?: boolean;
    /** Serve the event list across two pages, as a busy calendar does. */
    readonly paged?: boolean;
  } = {},
): CalendarContractHarness {
  const now = scenario.now ?? "2026-08-27T09:00:00.000Z";
  const asOf = scenario.asOf ?? now;
  let providerCalls = 0;
  let externalEffects = 0;
  const listRequests: URL[] = [];
  const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
    "authentication-failed": 401,
    "invalid-input": 404,
    "permission-denied": 403,
    "rate-limited": 429,
    "unsupported-capability": 400,
    unavailable: 503,
    "provider-error": 422,
  };

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    providerCalls += 1;
    if (scenario.failure !== undefined) {
      return Response.json(
        { error: { message: rawProviderError(scenario.failure) } },
        {
          status: statusByClass[scenario.failure],
          ...(scenario.failure === "rate-limited"
            ? { headers: { "retry-after": "1" } }
            : {}),
        },
      );
    }
    if ((init?.method ?? "GET") === "PATCH") {
      externalEffects += 1;
      return scenario.malformedBody === true
        ? new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : Response.json({ etag: '"contract-etag"', updated: now });
    }
    const url = new URL(String(input));
    if (scenario.malformedBody === true) {
      return new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (!url.pathname.endsWith("/events")) {
      return Response.json({ error: { message: "Unsupported" } }, { status: 404 });
    }
    listRequests.push(url);
    const event = (suffix: string) => ({
      ...(scenario.unreadableEvent === true
        ? {}
        : { id: `contract-event${suffix}` }),
      summary: "Contract event",
      status: "confirmed",
      updated: asOf,
      start: { dateTime: "2026-09-02T02:00:00.000Z" },
      end: { dateTime: "2026-09-02T03:00:00.000Z" },
    });
    if (scenario.emptyValue === true) {
      return Response.json({
        ...(scenario.omitAsOf === true ? {} : { updated: asOf }),
        items: [],
      });
    }
    if (scenario.paged === true && url.searchParams.get("pageToken") === null) {
      return Response.json({
        ...(scenario.omitAsOf === true ? {} : { updated: asOf }),
        items: [event("")],
        nextPageToken: "page-2",
      });
    }
    return Response.json({
      ...(scenario.omitAsOf === true ? {} : { updated: asOf }),
      items: [event(scenario.paged === true ? "-2" : "")],
    });
  };

  return {
    adapter: createGoogleCalendarAdapter({
      accessToken: contractSecretFixture,
      workspaceId: "workspace:real-ming",
      accountReference: "google-calendar:account:real-ming",
      fetch: fetchImplementation,
      now: () => now,
    }),
    providerCallCount: () => providerCalls,
    externalEffectCount: () => externalEffects,
    listRequests: () => listRequests,
  };
}

export interface CutoverWorkspaceContractHarness {
  readonly workspace: CutoverWorkspace;
  readonly sourceDataSourceIds: readonly string[];
  readonly masterTasksDatabaseId: string;
  readonly masterTasksDataSourceId: string;
  viewCreateCount(): number;
  viewUpdateCount(): number;
  renameCount(): number;
  lockedDatabases(): readonly string[];
  editSourcePage(dataSourceId: string, pageId: string): void;
}

/**
 * Controlled Notion for the cutover workspace. It models the two facts the
 * cutover depends on and nothing else: a page edit must change its payload
 * hash, and a retired database must come back renamed and locked.
 */
export function createCutoverWorkspaceContractHarness(options: {
  readonly lockedBeforeCutover?: string;
  readonly rejectViewCreateWith?: {
    readonly code: string;
    readonly message: string;
  };
} = {}): CutoverWorkspaceContractHarness {
  const masterTasksDatabaseId = "notion-database:master-tasks";
  const masterTasksDataSourceId = "notion-data-source:master-tasks";
  const sourceDataSourceIds = [
    "notion-data-source:legacy-1",
    "notion-data-source:legacy-2",
  ] as const;
  const databaseIdFor = (dataSourceId: string): string =>
    dataSourceId.replace("data-source", "database");

  const titles = new Map<string, string>(
    sourceDataSourceIds.map((id, index) => [id, `(Legacy ${index + 1}) Task To Do List`]),
  );
  const locked = new Set<string>(
    options.lockedBeforeCutover === undefined
      ? []
      : [databaseIdFor(options.lockedBeforeCutover)],
  );
  const pages = new Map<string, Record<string, unknown>[]>(
    sourceDataSourceIds.map((id, index) => [
      id,
      [
        {
          object: "page",
          id: `${id}:page-${index + 1}`,
          last_edited_time: "2026-08-29T03:00:00.000Z",
          properties: {
            Name: { type: "title", title: [{ plain_text: `Legacy task ${index + 1}` }] },
            Status: { type: "status", status: { name: "Pending" } },
          },
        },
      ],
    ]),
  );
  const views: Array<{
    id: string;
    name: string;
    parentDatabaseId?: string;
    filter?: unknown;
  }> = [];
  let viewsCreated = 0;
  let viewsUpdated = 0;
  let renames = 0;

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(url.pathname);
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (path.startsWith("/v1/data_sources/") && path.endsWith("/query")) {
      const id = path.slice("/v1/data_sources/".length, -"/query".length);
      return Response.json({
        object: "list",
        results: pages.get(id) ?? [],
        has_more: false,
        next_cursor: null,
      });
    }

    if (path.startsWith("/v1/data_sources/") && method === "GET") {
      const id = path.slice("/v1/data_sources/".length);
      return Response.json({
        object: "data_source",
        id,
        title: [{ plain_text: titles.get(id) ?? id }],
        parent: { type: "database_id", database_id: databaseIdFor(id) },
      });
    }

    if (path === `/v1/databases/${masterTasksDatabaseId}` && method === "GET") {
      return Response.json({
        object: "database",
        id: masterTasksDatabaseId,
        data_sources: [{ id: masterTasksDataSourceId, name: "Master Tasks" }],
      });
    }

    if (path.startsWith("/v1/databases/") && method === "GET") {
      const id = path.slice("/v1/databases/".length);
      return Response.json({
        object: "database",
        id,
        is_locked: locked.has(id),
        data_sources: [{ id: id.replace("database", "data-source") }],
      });
    }

    if (path.startsWith("/v1/databases/") && method === "PATCH") {
      const id = path.slice("/v1/databases/".length);
      const title = body["title"];
      if (Array.isArray(title)) {
        const first = title[0];
        const text = isRecord(first) ? first["text"] : undefined;
        if (isRecord(text) && typeof text["content"] === "string") {
          titles.set(id.replace("database", "data-source"), text["content"]);
          renames += 1;
        }
      }
      if (body["is_locked"] === true) locked.add(id);
      return Response.json({ object: "database", id, is_locked: locked.has(id) });
    }

    if (path === "/v1/views" && method === "GET") {
      if (!url.searchParams.has("data_source_id")) {
        return Response.json(
          {
            object: "error",
            status: 400,
            code: "validation_error",
            message: "At least one of database_id or data_source_id must be provided.",
          },
          { status: 400 },
        );
      }
      // Notion returns identity only here. A caller that expects names in the
      // listing silently matches nothing and creates a duplicate every run.
      return Response.json({
        object: "list",
        results: views.map((view) => ({ object: "view", id: view.id })),
        has_more: false,
        next_cursor: null,
      });
    }

    if (path.startsWith("/v1/views/") && method === "GET") {
      const id = path.slice("/v1/views/".length);
      const view = views.find((candidate) => candidate.id === id);
      return view === undefined
        ? Response.json({ object: "error", message: "Unknown view." }, { status: 404 })
        : Response.json({
            object: "view",
            id: view.id,
            name: view.name,
            type: "table",
            data_source_id: masterTasksDataSourceId,
            parent: { type: "database_id", database_id: view.parentDatabaseId },
            filter: view.filter,
          });
    }

    if (path === "/v1/views" && method === "POST") {
      if (options.rejectViewCreateWith !== undefined) {
        return Response.json(
          {
            object: "error",
            status: 400,
            code: options.rejectViewCreateWith.code,
            message: options.rejectViewCreateWith.message,
          },
          { status: 400 },
        );
      }
      const name = body["name"];
      const createDatabase = body["create_database"];
      const parentPageId =
        isRecord(createDatabase) && isRecord(createDatabase["parent"])
          ? createDatabase["parent"]["page_id"]
          : undefined;
      if (typeof name !== "string" || body["type"] !== "table" || typeof parentPageId !== "string") {
        return Response.json(
          {
            object: "error",
            status: 400,
            code: "validation_error",
            message:
              "body failed validation: body.type and body.create_database.parent.page_id are required.",
          },
          { status: 400 },
        );
      }
      const view = {
        id: `notion-view:${views.length + 1}`,
        name,
        parentDatabaseId: `notion-database:view-${views.length + 1}`,
        filter: body["filter"],
      };
      views.push(view);
      viewsCreated += 1;
      return Response.json({ object: "view", id: view.id, name: view.name });
    }

    if (path.startsWith("/v1/views/") && method === "PATCH") {
      const id = path.slice("/v1/views/".length);
      const view = views.find((candidate) => candidate.id === id);
      if (view === undefined) {
        return Response.json({ message: "Unknown view." }, { status: 404 });
      }
      view.filter = body["filter"];
      viewsUpdated += 1;
      return Response.json(view);
    }

    return Response.json(
      { message: `Unsupported fixture request: ${method} ${path}` },
      { status: 422 },
    );
  };

  return {
    workspace: createNotionCutoverWorkspace({
      token: contractSecretFixture,
      databaseId: masterTasksDatabaseId,
      linkedViewParentPageId: "notion-page:master-tasks-parent",
      sourceDataSourceIds,
      fetch: fetchImplementation,
    }),
    sourceDataSourceIds,
    masterTasksDatabaseId,
    masterTasksDataSourceId,
    viewCreateCount: () => viewsCreated,
    viewUpdateCount: () => viewsUpdated,
    renameCount: () => renames,
    lockedDatabases: () => [...locked],
    editSourcePage: (dataSourceId, pageId) => {
      const page = (pages.get(dataSourceId) ?? []).find(
        (candidate) => candidate["id"] === pageId,
      );
      if (page === undefined) throw new Error("Unknown controlled page.");
      page["properties"] = {
        Name: { type: "title", title: [{ plain_text: "Edited legacy task" }] },
        Status: { type: "status", status: { name: "To Do" } },
      };
    },
  };
}

export interface AcademicContractHarness {
  readonly canvas: CanvasAdapter;
  readonly microsoft365: Microsoft365Adapter;
  networkCallCount(): number;
}

/**
 * Controlled Canvas and Microsoft 365. Every request increments one counter, so
 * a test can prove that a refused submission or send never reached the network
 * rather than only that it returned a failure.
 */
export function createAcademicContractHarness(): AcademicContractHarness {
  let networkCalls = 0;
  const fetchImplementation = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    networkCalls += 1;
    const url = new URL(String(input));
    if (url.pathname.endsWith("/files")) {
      return Response.json([
        { id: 1, display_name: "brief.pdf", updated_at: "2026-09-01T02:00:00.000Z" },
      ]);
    }
    if (url.pathname.endsWith("/discussion_topics")) {
      return Response.json([
        { id: 2, title: "Deadline moved", message: "Moved to 12 September.", posted_at: "2026-09-02T02:00:00.000Z" },
      ]);
    }
    if (url.pathname.includes("/drive/root/children")) {
      return Response.json({
        value: [
          { id: "f1", name: "notes.docx", lastModifiedDateTime: "2026-09-02T01:00:00.000Z" },
          { id: "f2", name: "api_key=sk-live-abcdefghijklmnop", lastModifiedDateTime: "2026-09-02T01:30:00.000Z" },
        ],
      });
    }
    if (url.pathname.includes("/channels/messages")) {
      return Response.json({
        value: [
          {
            id: "t1",
            body: { content: "Please confirm the moved deadline." },
            from: { user: { displayName: "Supervisor" } },
            createdDateTime: "2026-09-02T03:00:00.000Z",
          },
        ],
      });
    }
    if (url.pathname.endsWith("/messages")) {
      return Response.json({
        value: [
          {
            id: "m1",
            subject: "Assignment 3",
            body: { content: "Confirm the new deadline." },
            from: { emailAddress: { address: "supervisor@university.test" } },
            receivedDateTime: "2026-09-02T03:30:00.000Z",
          },
        ],
      });
    }
    return Response.json({ value: [] });
  };

  return {
    canvas: createCanvasAdapter({
      accessToken: contractSecretFixture,
      baseUrl: "https://canvas.test",
      workspaceId: "workspace:real-ming",
      accountReference: "canvas:real-ming",
      fetch: fetchImplementation,
      now: () => "2026-09-03T01:00:00.000Z",
    }),
    microsoft365: createMicrosoft365Adapter({
      accessToken: contractSecretFixture,
      workspaceId: "workspace:real-ming",
      accountReference: "m365:real-ming",
      baseUrl: "https://graph.test/v1.0",
      fetch: fetchImplementation,
      now: () => "2026-09-03T01:00:00.000Z",
    }),
    networkCallCount: () => networkCalls,
  };
}

export interface DuitSiniContractHarness {
  readonly adapter: DuitSiniAdapter;
  externalChangeCount(): number;
}

/**
 * Controlled DuitSini. Only PATCH increments the counter, so a test can prove
 * a retry issued no second live change rather than only that it returned
 * deduplicated.
 */
export function createDuitSiniContractHarness(): DuitSiniContractHarness {
  let externalChanges = 0;
  const record = {
    id: "subscription:1",
    kind: "recurring-subscription",
    label: "Netflix",
    renewalSchedule: "monthly on the 4th",
    paymentMethodLabel: "Visa ending 4242",
    updatedAt: "2026-09-03T03:30:00.000Z",
  };
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (method === "PATCH") {
      externalChanges += 1;
      return Response.json({ ...record, updatedAt: "2026-09-03T04:00:00.000Z" });
    }
    if (String(input).endsWith("/records")) return Response.json([record]);
    return Response.json(record);
  };
  return {
    adapter: createDuitSiniAdapter({
      accessToken: contractSecretFixture,
      baseUrl: "https://duitsini.test",
      workspaceId: "workspace:real-ming",
      accountReference: "duitsini:real-ming",
      fetch: fetchImplementation,
      now: () => "2026-09-03T04:00:00.000Z",
    }),
    externalChangeCount: () => externalChanges,
  };
}

export interface LiveSmokeGate {
  readonly enabled: boolean;
  readonly reason: string;
}

export interface LegacyTaskReaderContractHarness {
  readSources(): Promise<readonly LegacyTaskSource[]>;
  mutationCount(): number;
}

export function createLegacyTaskReaderContractHarness(): LegacyTaskReaderContractHarness {
  let mutations = 0;
  const providerTitles = new Map<string, string>([
    ["(IP Content Creation) Task To Do List", "(IP Content Creation) Task To Do List "],
    ["(MicroSaaS) Task To Do List", "(MicroSaas) Task To Do List "],
    ["(Academic) Task To Do List", "(Academic) Task To Do List "],
    ["(Job x Life) Task To Do List", "(Job xLife) Task To Do List "],
    ["(Finance) Task To Do List", "(Finance) Task To Do List "],
  ]);
  const ids = new Map<string, string>(
    legacyTaskSourceDefinitions.map((definition, index) => [
      definition.name,
      `legacy-source-${index + 1}`,
    ]),
  );
  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/v1/search" && method === "POST") {
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      const query = String(body["query"] ?? "");
      const id = ids.get(query);
      return Response.json({
        results: id === undefined ? [] : [{
          object: "data_source",
          id,
          title: [{ plain_text: providerTitles.get(query) ?? query }],
        }],
      });
    }
    if (url.pathname.includes("/data_sources/") && url.pathname.endsWith("/query") && method === "POST") {
      const id = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
      const body = typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
      const archived = body["is_archived"] === true;
      const page = (suffix: string, pageArchived: boolean) => ({
        object: "page",
        id: `${id}-task-${suffix}`,
        archived: pageArchived,
        last_edited_time: "2026-08-29T03:00:00.000Z",
        properties: {
          Name: { type: "title", title: [{ plain_text: `Task for ${id}` }] },
          Status: { type: "status", status: { name: "Done" } },
          "Date Created": { type: "created_time", created_time: "2026-08-29T03:00:00.000Z" },
          Date: { type: "date", date: { start: "2026-09-01" } },
          Legacy: { type: "rich_text", rich_text: [{ plain_text: "preserve me" }] },
        },
      });
      return Response.json({
        results: [
          page("overlap", archived),
          page(archived ? "archived-only" : "active-only", archived),
        ],
        has_more: false,
        next_cursor: null,
      });
    }
    mutations += 1;
    return Response.json({ message: "Unexpected request" }, { status: 422 });
  };
  return {
    readSources: () => readLegacyNotionTaskSources({
      token: contractSecretFixture,
      fetch: fetchImplementation,
    }),
    mutationCount: () => mutations,
  };
}

export function liveSmokeGate(
  environment: Readonly<Record<string, string | undefined>>,
  requiredCredentials: readonly string[],
): LiveSmokeGate {
  if (environment["REAL_MING_LIVE_SMOKE"] !== "1") {
    return {
      enabled: false,
      reason: "REAL_MING_LIVE_SMOKE is not set to 1.",
    };
  }

  const missing = requiredCredentials.filter(
    (name) => (environment[name] ?? "").trim().length === 0,
  );

  return missing.length > 0
    ? {
        enabled: false,
        reason: `Missing securely supplied credentials: ${missing.join(", ")}.`,
      }
    : { enabled: true, reason: "Explicit flag and credentials are present." };
}

/** The bearer token the controlled metadata service issues. */
export const harnessBearerToken = "harness-imds-bearer-token";

export interface KeyVaultContractHarness {
  readonly reader: VaultSecretReader;
  tokenRequestCount(): number;
  requestedUrls(): readonly string[];
}

/**
 * A controlled Azure Key Vault and instance metadata service. No network call
 * and no credential: the identity token is issued by the fixture, so these
 * tests prove the adapter's behaviour without an Azure subscription.
 */
export function createKeyVaultContractHarness(scenario: {
  readonly secrets: Readonly<Record<string, string>>;
  readonly tokenStatus?: number;
  readonly tokenFailure?: "unreachable";
  readonly secretStatus?: number;
  /** Body served on a failing secret read, to prove it is never echoed. */
  readonly errorBody?: string;
}): KeyVaultContractHarness {
  let tokenRequests = 0;
  const requested: string[] = [];

  const controlledFetch = (async (
    input: RequestInfo | URL,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);

    if (url.includes("169.254.169.254")) {
      tokenRequests += 1;
      if (scenario.tokenFailure === "unreachable") {
        throw new Error("connect EHOSTUNREACH 169.254.169.254:80");
      }
      const status = scenario.tokenStatus ?? 200;
      if (status !== 200) return new Response("", { status });
      return new Response(
        JSON.stringify({ access_token: harnessBearerToken }),
        { status: 200 },
      );
    }

    const status = scenario.secretStatus ?? 200;
    if (status !== 200) {
      return new Response(scenario.errorBody ?? "", { status });
    }
    const name = new URL(url).pathname.split("/").pop() ?? "";
    const value = scenario.secrets[name];
    return value === undefined
      ? new Response("", { status: 404 })
      : new Response(JSON.stringify({ value }), { status: 200 });
  }) as typeof fetch;

  return {
    reader: createAzureKeyVaultReader({
      vaultName: "real-ming-vault",
      fetch: controlledFetch,
    }),
    tokenRequestCount: () => tokenRequests,
    requestedUrls: () => requested,
  };
}

export const harnessGoogleAccessToken = "harness-google-access-token";

export interface GoogleAccessTokenContractHarness {
  readonly tokens: GoogleAccessTokens;
  exchangeCount(): number;
  advance(ms: number): void;
}

/**
 * A controlled Google token endpoint. The refresh token never leaves the
 * fixture, so these tests prove the exchange without a Google account.
 */
export function createGoogleAccessTokenContractHarness(
  scenario: {
    readonly status?: number;
    readonly unreachable?: boolean;
    readonly expiresIn?: number;
    readonly errorBody?: string;
  } = {},
): GoogleAccessTokenContractHarness {
  let exchanges = 0;
  let clock = 1_700_000_000_000;

  const controlledFetch = (async (): Promise<Response> => {
    exchanges += 1;
    if (scenario.unreachable === true) {
      throw new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com");
    }
    const status = scenario.status ?? 200;
    if (status !== 200) {
      return new Response(scenario.errorBody ?? "", { status });
    }
    return new Response(
      JSON.stringify({
        access_token: `${harnessGoogleAccessToken}-${exchanges}`,
        expires_in: scenario.expiresIn ?? 3600,
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  return {
    tokens: createGoogleAccessTokens({
      clientId: "harness-client-id",
      clientSecret: contractSecretFixture,
      refreshToken: contractSecretFixture,
      fetch: controlledFetch,
      now: () => clock,
    }),
    exchangeCount: () => exchanges,
    advance: (ms) => {
      clock += ms;
    },
  };
}

export interface AzureBlobBackupContractHarness {
  readonly uploader: AzureBlobBackupUploader;
  tokenRequestCount(): number;
  uploads(): readonly {
    readonly url: string;
    readonly authorization: string;
    readonly blobType: string;
    readonly content: string;
  }[];
}

export function createAzureBlobBackupContractHarness(
  scenario: {
    readonly tokenStatus?: number;
    readonly uploadStatus?: number;
    readonly errorBody?: string;
    /** The connection fails outright, as a lost route to storage would. */
    readonly unreachable?: boolean;
  } = {},
): AzureBlobBackupContractHarness {
  let tokenRequests = 0;
  const uploads: {
    url: string;
    authorization: string;
    blobType: string;
    content: string;
  }[] = [];
  const controlledFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    if (scenario.unreachable === true) {
      throw new Error("connect EHOSTUNREACH blob.core.windows.net");
    }
    const url = String(input);
    if (url.includes("169.254.169.254")) {
      tokenRequests += 1;
      const status = scenario.tokenStatus ?? 200;
      return status === 200
        ? Response.json({ access_token: harnessBearerToken })
        : new Response(scenario.errorBody ?? "", { status });
    }
    const content =
      init?.body instanceof Blob
        ? await init.body.text()
        : new TextDecoder().decode(init?.body as Uint8Array);
    uploads.push({
      url,
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      blobType: new Headers(init?.headers).get("x-ms-blob-type") ?? "",
      content,
    });
    const status = scenario.uploadStatus ?? 201;
    return new Response(scenario.errorBody ?? "", { status });
  }) as typeof fetch;

  return {
    uploader: createAzureBlobBackupUploader({
      accountName: "realmingbackup",
      containerName: "state",
      fetch: controlledFetch,
      now: () => "Sun, 31 Aug 2026 00:00:00 GMT",
    }),
    tokenRequestCount: () => tokenRequests,
    uploads: () => [...uploads],
  };
}

export interface GitHubRepositoryContractHarness {
  readonly adapter: GitHubRepositoryAdapter;
  requests(): readonly string[];
}

/** Controlled GitHub API edge for RM-25. It never contacts github.com. */
export function createGitHubRepositoryContractHarness(options: {
  readonly failure?: ProviderFailureClass;
  readonly stale?: boolean;
} = {}): GitHubRepositoryContractHarness {
  const requests: string[] = [];
  const now = "2026-09-02T09:00:00.000Z";
  const asOf = options.stale ? "2026-08-30T09:00:00.000Z" : now;
  const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
    "authentication-failed": 401,
    "invalid-input": 404,
    "permission-denied": 403,
    "rate-limited": 429,
    "unsupported-capability": 400,
    unavailable: 503,
    "provider-error": 500,
  };
  const fetchImplementation = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (options.failure !== undefined) {
      return Response.json({ message: `controlled provider error ${contractSecretFixture}` }, { status: statusByClass[options.failure] });
    }
    if (/\/repos\/pmgwee\/subscription-agent$/.test(url)) {
      return Response.json({
        full_name: "pmgwee/subscription-agent",
        html_url: "https://github.com/pmgwee/subscription-agent",
        default_branch: "main",
        updated_at: asOf,
        pushed_at: asOf,
      });
    }
    if (url.includes("/branches?")) {
      return Response.json([
        { name: "main", protected: true, commit: { sha: "sha-main" } },
        { name: "feat/rm-25", protected: false, commit: { sha: "sha-work" } },
      ]);
    }
    if (url.includes("/pulls?")) {
      return Response.json([{
        number: 99,
        title: "Repository center",
        state: "open",
        draft: false,
        html_url: "https://github.com/pmgwee/subscription-agent/pull/99",
        head: { ref: "feat/rm-25", sha: "sha-work" },
        base: { ref: "main", sha: "sha-main" },
        review_decision: "APPROVED",
        updated_at: asOf,
      }]);
    }
    if (url.includes("/releases?")) {
      return Response.json([{ tag_name: "v1.2.0", target_commitish: "sha-main", html_url: "https://github.com/pmgwee/subscription-agent/releases/tag/v1.2.0", published_at: asOf }]);
    }
    if (url.includes("/issues?")) {
      return Response.json([{ number: 7, title: "incident", html_url: "https://github.com/pmgwee/subscription-agent/issues/7", created_at: asOf }]);
    }
    if (url.includes("/check-runs")) {
      const sha = url.includes("sha-work") ? "sha-work" : "sha-main";
      return Response.json({ check_runs: [{ name: "check", status: "completed", conclusion: "success", html_url: "https://github.com/check/1" }], head_sha: sha });
    }
    if (url.includes("/pulls/99/reviews")) {
      return Response.json([{ user: { login: "reviewer" }, state: "APPROVED", commit_id: "sha-work", submitted_at: asOf }]);
    }
    return Response.json({ message: "unsupported controlled GitHub request" }, { status: 422 });
  };
  return {
    adapter: createGitHubRepositoryAdapter({
      token: contractSecretFixture,
      workspaceId: "workspace:real-ming",
      accountReference: "github:account:real-ming",
      fetch: fetchImplementation,
      now: () => now,
    }),
    requests: () => [...requests],
  };
}

export interface GitLineageContractHarness {
  readonly adapter: GitLineageAdapter;
  commands(): readonly (readonly string[])[];
}

/** Controlled git command edge for RM-25; the runner is argument-only. */
export function createGitLineageContractHarness(options: { readonly failure?: boolean } = {}): GitLineageContractHarness {
  const commands: (readonly string[])[] = [];
  const runner: GitCommandRunner = async (args) => {
    commands.push([...args]);
    if (options.failure === true) return { stdout: "", stderr: "controlled worker offline", exitCode: 1 };
    const command = args.slice(2).join(" ");
    if (command.startsWith("status ")) return { stdout: "## feat/rm-25...origin/feat/rm-25\n M src/example.ts\n", stderr: "", exitCode: 0 };
    if (command === "rev-parse HEAD") return { stdout: "sha-work\n", stderr: "", exitCode: 0 };
    if (command.startsWith("for-each-ref") && command.endsWith("refs/heads")) return { stdout: "main\tsha-main\nfeat/rm-25\tsha-work\n", stderr: "", exitCode: 0 };
    if (command.startsWith("for-each-ref") && command.endsWith("refs/tags")) return { stdout: "v1.2.0\tsha-main\n", stderr: "", exitCode: 0 };
    if (command.startsWith("rev-list")) {
      return command.endsWith("main")
        ? { stdout: "0\t0\n", stderr: "", exitCode: 0 }
        : { stdout: "1\t2\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "unsupported controlled git command", exitCode: 1 };
  };
  return {
    adapter: createGitLineageAdapter({
      workspaceId: "workspace:real-ming",
      accountReference: "git:account:real-ming",
      productionBranch: "main",
      deploymentAssociations: [{ provider: "github", reference: "pmgwee/subscription-agent", commitSha: "sha-main" }],
      runner,
      now: () => "2026-09-02T09:00:00.000Z",
    }),
    commands: () => commands.map((args) => [...args]),
  };
}

export interface VercelDeploymentContractHarness {
  readonly adapter: VercelDeploymentAdapter;
  requests(): readonly string[];
}

/** Controlled Vercel API edge for RM-26. It never contacts vercel.com. */
export function createVercelDeploymentContractHarness(options: {
  readonly failure?: ProviderFailureClass;
  readonly stale?: boolean;
  readonly missing?: boolean;
} = {}): VercelDeploymentContractHarness {
  const requests: string[] = [];
  const now = "2026-09-02T09:00:00.000Z";
  const asOf = options.stale ? "2026-08-30T09:00:00.000Z" : now;
  const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
    "authentication-failed": 401,
    "invalid-input": 404,
    "permission-denied": 403,
    "rate-limited": 429,
    "unsupported-capability": 400,
    unavailable: 503,
    "provider-error": 500,
  };
  const fetchImplementation: typeof fetch = async (input, _init): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (options.failure !== undefined) {
      return Response.json({ error: { message: `controlled Vercel error ${contractSecretFixture}` } }, { status: statusByClass[options.failure] });
    }
    if (options.missing === true) return Response.json({ deployments: [] });
    const asOfMs = Date.parse(asOf);
    return Response.json({ deployments: [
      { uid: "vercel-preview", state: "READY", target: null, url: "preview.duitsini.test", meta: { githubCommitSha: "sha-work", githubCommitRef: "feat/rm-25", githubPrId: 99 }, createdAt: asOfMs, readyAt: asOfMs },
      { uid: "vercel-production", state: "READY", target: "production", url: "duitsini.test", meta: { githubCommitSha: "sha-main" }, createdAt: asOfMs, readyAt: asOfMs },
      { uid: "vercel-failed", state: "ERROR", target: "production", url: "failed.duitsini.test", meta: { githubCommitSha: "sha-mismatch" }, createdAt: asOfMs },
      { uid: "vercel-cancelled", state: "CANCELED", target: "preview", url: "cancelled.duitsini.test", meta: {}, createdAt: asOfMs },
    ] });
  };
  return {
    adapter: createVercelDeploymentAdapter({
      token: contractSecretFixture,
      workspaceId: "workspace:real-ming",
      accountReference: "vercel:account:real-ming",
      fetch: fetchImplementation,
      now: () => now,
    }),
    requests: () => [...requests],
  };
}


export interface MailContractHarness {
  readonly adapter: GmailAdapter;
  providerCallCount(): number;
  listRequests(): readonly URL[];
  /** Every path the adapter touched, so "it never sends" is provable. */
  touchedPaths(): readonly string[];
  draftBodies(): readonly string[];
}

/**
 * Gmail answers a search in two steps: a list of identifiers, then one
 * metadata read per identifier. Serving both here means the adapter's
 * header extraction is exercised rather than bypassed.
 */
export function createMailContractHarness(
  scenario: {
    readonly failure?: ProviderFailureClass;
    readonly emptyValue?: boolean;
    readonly asOf?: string;
    readonly now?: string;
    readonly unreadableMessage?: boolean;
    /** Fail only the per-message read, as a revoked scope does mid-page. */
    readonly detailFailure?: ProviderFailureClass;
    readonly draftFailure?: ProviderFailureClass;
  } = {},
): MailContractHarness {
  const now = scenario.now ?? "2026-09-07T09:00:00.000Z";
  const asOf = scenario.asOf ?? now;
  let providerCalls = 0;
  const listRequests: URL[] = [];
  const touched: string[] = [];
  const draftBodies: string[] = [];
  const statusByClass: Readonly<Record<ProviderFailureClass, number>> = {
    "authentication-failed": 401,
    "invalid-input": 404,
    "permission-denied": 403,
    "rate-limited": 429,
    "unsupported-capability": 400,
    unavailable: 503,
    "provider-error": 422,
  };

  const fetchImplementation = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    providerCalls += 1;
    const url = new URL(String(input));
    touched.push(url.pathname);
    const isDetail = /\/messages\/[^/]+$/.test(url.pathname);

    if (url.pathname.endsWith("/drafts")) {
      if (typeof init?.body === "string") draftBodies.push(init.body);
      return scenario.draftFailure === undefined
        ? Response.json({ id: "contract-draft-1" })
        : Response.json(
            { error: { message: rawProviderError(scenario.draftFailure) } },
            { status: statusByClass[scenario.draftFailure] },
          );
    }

    if (scenario.failure !== undefined) {
      return Response.json(
        { error: { message: rawProviderError(scenario.failure) } },
        {
          status: statusByClass[scenario.failure],
          ...(scenario.failure === "rate-limited"
            ? { headers: { "retry-after": "1" } }
            : {}),
        },
      );
    }
    if (isDetail) {
      if (scenario.detailFailure !== undefined) {
        return Response.json(
          { error: { message: rawProviderError(scenario.detailFailure) } },
          { status: statusByClass[scenario.detailFailure] },
        );
      }
      return Response.json({
        ...(scenario.unreadableMessage === true
          ? {}
          : { id: "contract-message-1" }),
        threadId: "contract-thread-1",
        snippet: "We would like to invite you to a first interview.",
        labelIds: ["INBOX", "UNREAD"],
        internalDate: String(Date.parse(asOf)),
        payload: {
          headers: [
            { name: "From", value: "Recruiting <talent@example.com>" },
            { name: "Subject", value: "Your application" },
            { name: "Date", value: asOf },
          ],
        },
      });
    }
    listRequests.push(url);
    return Response.json(
      scenario.emptyValue === true
        ? {}
        : { messages: [{ id: "contract-message-1" }] },
    );
  };

  return {
    adapter: createGmailAdapter({
      accessToken: "contract-mail-access-token",
      workspaceId: "workspace:real-ming",
      mailbox: "contract@example.com",
      fetch: fetchImplementation as unknown as typeof fetch,
      now: () => now,
    }),
    providerCallCount: () => providerCalls,
    listRequests: () => [...listRequests],
    touchedPaths: () => [...touched],
    draftBodies: () => [...draftBodies],
  };
}
