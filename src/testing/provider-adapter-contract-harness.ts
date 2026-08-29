import {
  providerFailure,
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
import { legacyTaskSourceDefinitions, type LegacyTaskSource } from "../migration/task-migration-rehearsal.js";

export const contractSecretFixture = "provider-secret-must-never-be-reported";

const stalenessThresholdMs = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ContractScenario {
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
      Date.parse(now) - Date.parse(asOf) > stalenessThresholdMs
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
