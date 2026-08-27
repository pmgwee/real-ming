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

export const contractSecretFixture = "provider-secret-must-never-be-reported";

const stalenessThresholdMs = 24 * 60 * 60 * 1000;

export interface ContractScenario {
  readonly asOf?: string;
  readonly now?: string;
  readonly failure?: ProviderFailureClass;
  readonly emptyValue?: boolean;
}

export interface ContractAdapter extends ProviderAdapter<readonly string[]> {
  providerCallCount(): number;
  externalEffectCount(): number;
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
