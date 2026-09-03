import type {
  ProviderFailure,
  ProviderReadResult,
} from "./adapter-contract.js";

/**
 * The operational vocabulary deliberately differs from a provider's wire
 * failure classes.  In particular, authentication and permission failures
 * are both visible to the CEO as a missing-permission condition, while
 * invalid provider payloads are not confused with an invalid request.
 */
export const providerObservationStatuses = [
  "healthy",
  "stale",
  "unavailable",
  "missing-permission",
  "rate-limited",
  "unsupported",
  "invalid-data",
] as const;
export type ProviderObservationStatus =
  (typeof providerObservationStatuses)[number];

export interface ProviderObservationInput {
  readonly provider: string;
  readonly accountReference: string;
  readonly sourceReference: string;
  readonly workItemId?: string;
  readonly status: ProviderObservationStatus;
  readonly failureClass?: ProviderFailure["class"];
  readonly retryable?: boolean;
  readonly attempt?: number;
  readonly retryAfterMs?: number;
  readonly idempotencyKey?: string;
  readonly observedAt: string;
}

export function providerObservationFromRead<TValue>(
  identity: { readonly provider: string; readonly accountReference: string },
  sourceReference: string,
  result: ProviderReadResult<TValue>,
  observedAt: string,
  workItemId?: string,
  idempotencyKey?: string,
): ProviderObservationInput {
  if (result.kind === "ok") {
    return {
      provider: identity.provider,
      accountReference: identity.accountReference,
      sourceReference,
      status: "healthy",
      observedAt,
      ...(workItemId === undefined ? {} : { workItemId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
  }
  if (result.kind === "stale") {
    return {
      provider: identity.provider,
      accountReference: identity.accountReference,
      sourceReference,
      status: "stale",
      observedAt,
      ...(workItemId === undefined ? {} : { workItemId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
  }

  const status = statusForFailure(result.failure.class);
  return {
    provider: identity.provider,
    accountReference: identity.accountReference,
    sourceReference,
    status,
    failureClass: result.failure.class,
    retryable: result.failure.retryable,
    ...(result.failure.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: result.failure.retryAfterMs }),
    observedAt,
    ...(workItemId === undefined ? {} : { workItemId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

export function statusForFailure(
  failureClass: ProviderFailure["class"],
): Exclude<ProviderObservationStatus, "healthy" | "stale"> {
  switch (failureClass) {
    case "authentication-failed":
    case "permission-denied":
      return "missing-permission";
    case "rate-limited":
      return "rate-limited";
    case "unsupported-capability":
      return "unsupported";
    case "invalid-input":
    case "provider-error":
      return "invalid-data";
    case "unavailable":
      return "unavailable";
  }
}

export function providerObservationIsFailure(
  status: ProviderObservationStatus,
): boolean {
  return status !== "healthy" && status !== "stale";
}
