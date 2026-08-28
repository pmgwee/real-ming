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

export const contractSecretFixture = "provider-secret-must-never-be-reported";

const stalenessThresholdMs = 24 * 60 * 60 * 1000;

export interface ContractScenario {
  readonly asOf?: string;
  readonly now?: string;
  readonly failure?: ProviderFailureClass;
  readonly emptyValue?: boolean;
  readonly telegramDeliveryLedger?: TelegramDeliveryLedger;
  readonly telegramUpdates?: readonly unknown[];
  readonly telegramThrowAfterEffect?: boolean;
  readonly telegramMalformedResponseAfterEffect?: boolean;
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
  ];
}

export interface LiveSmokeGate {
  readonly enabled: boolean;
  readonly reason: string;
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
