import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  providerAdapterContractCases,
  type ProviderAdapterContractCase,
} from "../../src/testing/provider-adapter-contract-harness.js";
import {
  isRetryableFailure,
  providerFailure,
  type ProviderFailureClass,
} from "../../src/providers/adapter-contract.js";

const cases = providerAdapterContractCases();

describe("RM-05 Provider Adapter Contract Harness", () => {
  it("covers a read-only adapter and a read/write adapter", () => {
    expect(cases.map((entry) => entry.name)).toEqual([
      "read-only-reference",
      "read-write-reference",
    ]);
    expect(
      cases.map((entry) => entry.capabilities.includes("write")),
    ).toEqual([false, true]);
  });

  describe.each(cases)("$name", (contractCase: ProviderAdapterContractCase) => {
    it("discovers its capabilities and normalizes its identity", async () => {
      const adapter = contractCase.createAdapter({});

      expect(adapter.capabilities()).toEqual(contractCase.capabilities);
      expect(adapter.identity()).toMatchObject({
        provider: contractCase.provider,
        workspaceId: "workspace:real-ming",
      });
      expect(JSON.stringify(adapter.identity())).not.toContain(
        contractSecretFixture,
      );
    });

    it("returns normalized provenance and an as-of time on a successful read", async () => {
      const adapter = contractCase.createAdapter({
        asOf: "2026-08-27T08:00:00.000Z",
        now: "2026-08-27T09:00:00.000Z",
      });

      const result = await adapter.read({ reference: "record:1" });

      expect(result).toMatchObject({
        kind: "ok",
        provenance: {
          sourceIdentity: `${contractCase.provider}:workspace:real-ming`,
          sourceReference: "record:1",
          asOf: "2026-08-27T08:00:00.000Z",
          retrievedAt: "2026-08-27T09:00:00.000Z",
          freshness: "current",
        },
      });
    });

    it("signals stale data without presenting it as an empty healthy response", async () => {
      const adapter = contractCase.createAdapter({
        asOf: "2026-08-01T00:00:00.000Z",
        now: "2026-08-27T09:00:00.000Z",
      });

      const result = await adapter.read({ reference: "record:1" });

      expect(result.kind).toBe("stale");
      if (result.kind !== "stale") {
        throw new Error("Expected a stale read result.");
      }
      expect(result.value).toBeDefined();
      expect(result.provenance.freshness).toBe("stale");
      expect(result.provenance.asOf).toBe("2026-08-01T00:00:00.000Z");
    });

    it("rejects invalid input before contacting the provider", async () => {
      const adapter = contractCase.createAdapter({});

      const result = await adapter.read({ reference: "  " });

      expect(result).toMatchObject({
        kind: "failed",
        failure: { class: "invalid-input", retryable: false },
      });
      expect(adapter.providerCallCount()).toBe(0);
    });

    it.each([
      ["authentication-failed", false],
      ["permission-denied", false],
      ["rate-limited", true],
      ["unavailable", true],
      ["provider-error", true],
    ] as const)(
      "classifies %s as retryable=%s and redacts its message",
      async (failureClass, retryable) => {
        const adapter = contractCase.createAdapter({ failure: failureClass });

        const result = await adapter.read({ reference: "record:1" });

        expect(result).toMatchObject({
          kind: "failed",
          failure: { class: failureClass, retryable },
        });
        if (result.kind !== "failed") {
          throw new Error("Expected a failed read result.");
        }
        expect(isRetryableFailure(result.failure)).toBe(retryable);
        expect(JSON.stringify(result)).not.toContain(contractSecretFixture);
      },
    );

    it("reports a retry hint when the provider rate limits the call", async () => {
      const adapter = contractCase.createAdapter({ failure: "rate-limited" });

      const result = await adapter.read({ reference: "record:1" });

      if (result.kind !== "failed") {
        throw new Error("Expected a failed read result.");
      }
      expect(result.failure.retryAfterMs).toBeGreaterThan(0);
    });

    it("distinguishes unavailability from an empty successful read", async () => {
      const unavailable = await contractCase
        .createAdapter({ failure: "unavailable" })
        .read({ reference: "record:1" });
      const empty = await contractCase
        .createAdapter({ emptyValue: true })
        .read({ reference: "record:1" });

      expect(unavailable.kind).toBe("failed");
      expect(empty.kind).toBe("ok");
      if (empty.kind !== "ok") {
        throw new Error("Expected an ok read result.");
      }
      expect(empty.value).toEqual([]);
    });
  });
});

describe("RM-05 read-only adapter writes", () => {
  const readOnlyCase = cases[0] as ProviderAdapterContractCase;

  it("rejects an unsupported write locally before contacting the provider", async () => {
    const adapter = readOnlyCase.createAdapter({});

    const result = await adapter.write({
      idempotencyKey: "effect:1",
      reference: "record:1",
      payload: { note: "attempted write" },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "unsupported-capability", retryable: false },
    });
    expect(adapter.providerCallCount()).toBe(0);
  });
});

describe("RM-05 read/write adapter effects", () => {
  const readWriteCase = cases[1] as ProviderAdapterContractCase;

  it("performs one external effect and returns normalized provenance", async () => {
    const adapter = readWriteCase.createAdapter({
      now: "2026-08-27T09:00:00.000Z",
    });

    const result = await adapter.write({
      idempotencyKey: "effect:1",
      reference: "record:1",
      payload: { note: "one bounded effect" },
    });

    expect(result).toMatchObject({
      kind: "ok",
      deduplicated: false,
      effectReference: "effect:1",
      provenance: { retrievedAt: "2026-08-27T09:00:00.000Z" },
    });
    expect(adapter.externalEffectCount()).toBe(1);
  });

  it("does not duplicate an external effect when a write is retried", async () => {
    const adapter = readWriteCase.createAdapter({});
    const request = {
      idempotencyKey: "effect:1",
      reference: "record:1",
      payload: { note: "one bounded effect" },
    };

    const first = await adapter.write(request);
    const retried = await adapter.write(request);

    expect(first).toMatchObject({ kind: "ok", deduplicated: false });
    expect(retried).toMatchObject({
      kind: "ok",
      deduplicated: true,
      effectReference: "effect:1",
    });
    expect(adapter.externalEffectCount()).toBe(1);
  });

  it("does not record an external effect when the write fails", async () => {
    const adapter = readWriteCase.createAdapter({ failure: "unavailable" });

    const result = await adapter.write({
      idempotencyKey: "effect:1",
      reference: "record:1",
      payload: { note: "one bounded effect" },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "unavailable", retryable: true },
    });
    expect(adapter.externalEffectCount()).toBe(0);
  });

  it("rejects a write payload carrying a Sensitive Secret before any effect", async () => {
    const adapter = readWriteCase.createAdapter({});

    const result = await adapter.write({
      idempotencyKey: "effect:1",
      reference: "record:1",
      payload: { transactionPassword: contractSecretFixture },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain(contractSecretFixture);
    expect(adapter.externalEffectCount()).toBe(0);
    expect(adapter.providerCallCount()).toBe(0);
  });

  it("rejects an invalid idempotency key before contacting the provider", async () => {
    const adapter = readWriteCase.createAdapter({});

    const result = await adapter.write({
      idempotencyKey: "",
      reference: "record:1",
      payload: { note: "one bounded effect" },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(adapter.providerCallCount()).toBe(0);
  });
});

describe("RM-05 failure classification", () => {
  it.each([
    ["authentication-failed", false],
    ["invalid-input", false],
    ["permission-denied", false],
    ["unsupported-capability", false],
    ["rate-limited", true],
    ["unavailable", true],
    ["provider-error", true],
  ] as const)("treats %s as retryable=%s", (failureClass, retryable) => {
    expect(
      isRetryableFailure({
        class: failureClass as ProviderFailureClass,
        retryable,
        message: "redacted",
      }),
    ).toBe(retryable);
  });

  it.each([
    ["authentication-failed", false],
    ["invalid-input", false],
    ["permission-denied", false],
    ["unsupported-capability", false],
    ["rate-limited", true],
    ["unavailable", true],
    ["provider-error", true],
  ] as const)(
    "lets the %s class outrank a mis-reported retryable field",
    (failureClass, retryable) => {
      expect(
        isRetryableFailure({
          class: failureClass as ProviderFailureClass,
          retryable: !retryable,
          message: "redacted",
        }),
      ).toBe(retryable);
    },
  );

  it("redacts every supplied secret from a provider message", () => {
    const failure = providerFailure(
      "provider-error",
      `denied token=${contractSecretFixture} and cookie=${contractSecretFixture}`,
      [contractSecretFixture],
    );

    expect(failure.message).not.toContain(contractSecretFixture);
    expect(failure.message).toBe(
      "denied token=[redacted] and cookie=[redacted]",
    );
    expect(failure.retryable).toBe(true);
  });
});
