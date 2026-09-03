export type ProviderCapability = "read" | "write";

export type ProviderFailureClass =
  | "authentication-failed"
  | "invalid-input"
  | "permission-denied"
  | "rate-limited"
  | "unsupported-capability"
  | "unavailable"
  | "provider-error";

export type ProviderFreshness = "current" | "stale";

export interface ProviderIdentity {
  readonly provider: string;
  readonly workspaceId: string;
  readonly accountReference: string;
}

export interface ProviderProvenance {
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly retrievedAt: string;
  readonly freshness: ProviderFreshness;
}

export interface ProviderFailure {
  readonly class: ProviderFailureClass;
  readonly retryable: boolean;
  readonly message: string;
  readonly retryAfterMs?: number;
}

export interface ProviderReadRequest {
  readonly reference: string;
}

export interface ProviderWriteRequest {
  readonly idempotencyKey: string;
  readonly reference: string;
  readonly payload: Readonly<Record<string, string>>;
}

export type ProviderReadResult<TValue> =
  | {
      readonly kind: "ok";
      readonly identity: ProviderIdentity;
      readonly provenance: ProviderProvenance;
      readonly value: TValue;
    }
  | {
      readonly kind: "stale";
      readonly identity: ProviderIdentity;
      readonly provenance: ProviderProvenance;
      readonly value: TValue;
    }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export type ProviderWriteResult =
  | {
      readonly kind: "ok";
      readonly identity: ProviderIdentity;
      readonly provenance: ProviderProvenance;
      readonly effectReference: string;
      readonly deduplicated: boolean;
    }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface ProviderAdapter<TValue = unknown> {
  identity(): ProviderIdentity;
  capabilities(): readonly ProviderCapability[];
  read(request: ProviderReadRequest): Promise<ProviderReadResult<TValue>>;
  write(request: ProviderWriteRequest): Promise<ProviderWriteResult>;
}

/**
 * Provider data older than this is reported as stale rather than current. It
 * lives here so no adapter can quietly drift to a different definition of
 * fresh from the one the contract harness asserts.
 */
export const providerStalenessThresholdMs = 24 * 60 * 60 * 1000;

const retryableFailureClasses: readonly ProviderFailureClass[] = [
  "rate-limited",
  "unavailable",
  "provider-error",
];

export function isRetryableFailure(failure: ProviderFailure): boolean {
  return retryableFailureClasses.includes(failure.class);
}

export function redactProviderMessage(
  message: string,
  secrets: readonly string[],
): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[redacted]"),
      message,
    );
}

export function providerFailure(
  failureClass: ProviderFailureClass,
  message: string,
  secrets: readonly string[] = [],
  retryAfterMs?: number,
): ProviderFailure {
  const failure: ProviderFailure = {
    class: failureClass,
    retryable: retryableFailureClasses.includes(failureClass),
    message: redactProviderMessage(message, secrets),
  };

  return retryAfterMs === undefined ? failure : { ...failure, retryAfterMs };
}
