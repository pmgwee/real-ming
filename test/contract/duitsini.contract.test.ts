import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createDuitSiniContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-34 DuitSini provider contract", () => {
  it("reads one record with a datable provenance", async () => {
    const harness = createDuitSiniContractHarness();

    const record = await harness.adapter.readRecord({ id: "subscription:1" });

    expect(record.kind).toBe("ok");
    if (record.kind !== "ok") return;
    expect(record.value.paymentMethodLabel).toBe("Visa ending 4242");
    expect(record.provenance.asOf).toBe("2026-09-03T03:30:00.000Z");
  });

  it("performs one external change and deduplicates a retry", async () => {
    const harness = createDuitSiniContractHarness();
    const change = {
      id: "subscription:1",
      label: "Netflix Standard",
      idempotencyKey: "duitsini:change:1",
    };

    const first = await harness.adapter.changeRecordMetadata(change);
    const retry = await harness.adapter.changeRecordMetadata(change);

    expect(first).toMatchObject({ kind: "ok", deduplicated: false });
    expect(retry).toMatchObject({ kind: "ok", deduplicated: true });
    // The shipped adapter must not issue a second live change on a retry.
    expect(harness.externalChangeCount()).toBe(1);
  });

  it("refuses an idempotency key reused for a different change", async () => {
    const harness = createDuitSiniContractHarness();
    await harness.adapter.changeRecordMetadata({
      id: "subscription:1",
      label: "Netflix Standard",
      idempotencyKey: "duitsini:change:1",
    });

    const reused = await harness.adapter.changeRecordMetadata({
      id: "subscription:1",
      label: "Something else",
      idempotencyKey: "duitsini:change:1",
    });

    expect(reused).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(harness.externalChangeCount()).toBe(1);
  });

  it("has no money movement method and an inert generic write", async () => {
    const harness = createDuitSiniContractHarness();
    const before = harness.externalChangeCount();

    const generic = await harness.adapter.write({
      reference: "subscription:1",
      idempotencyKey: "k",
      payload: {},
    });

    expect(generic).toMatchObject({
      kind: "failed",
      failure: { class: "unsupported-capability" },
    });
    expect(harness.externalChangeCount()).toBe(before);
    for (const method of ["payBill", "transfer", "chargeCard", "bankLogin", "moveMoney"]) {
      expect(method in harness.adapter).toBe(false);
    }
    expect(JSON.stringify(generic)).not.toContain(contractSecretFixture);
  });
});
