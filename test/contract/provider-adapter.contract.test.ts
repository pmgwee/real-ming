import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contractSecretFixture,
  createLegacyTaskReaderContractHarness,
  createNotionProvisioningContractHarness,
  providerAdapterContractCases,
  type ProviderAdapterContractCase,
} from "../../src/testing/provider-adapter-contract-harness.js";
import {
  isRetryableFailure,
  providerFailure,
  type ProviderFailureClass,
} from "../../src/providers/adapter-contract.js";
import { createEphemeralTelegramDeliveryLedger } from "../../src/providers/telegram-provider-adapter.js";
import {
  createNotionMasterTasksStore,
  SqliteNotionWriteLedger,
} from "../../src/providers/notion-provider-adapter.js";
import type { MasterTaskRecord } from "../../src/master-tasks/master-tasks.js";
import type {
  TelegramDeliveryLedger,
  TelegramDeliveryLedgerReceipt,
} from "../../src/providers/telegram-provider-adapter.js";

const cases = providerAdapterContractCases();

describe("RM-05 Provider Adapter Contract Harness", () => {
  it("covers reference adapters plus the Telegram and Notion read/write adapters", () => {
    expect(cases.map((entry) => entry.name)).toEqual([
      "read-only-reference",
      "read-write-reference",
      "telegram",
      "notion",
    ]);
    expect(
      cases.map((entry) => entry.capabilities.includes("write")),
    ).toEqual([false, true, true, true]);
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
  const writeCases = cases.filter((entry) =>
    entry.capabilities.includes("write"),
  );

  describe.each(writeCases)("$name", (contractCase) => {
    it("performs one external effect and returns normalized provenance", async () => {
      const adapter = contractCase.createAdapter({
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
      const adapter = contractCase.createAdapter({});
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
      const adapter = contractCase.createAdapter({ failure: "unavailable" });

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
      const adapter = contractCase.createAdapter({});

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
      const adapter = contractCase.createAdapter({});

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
});

describe("RM-07 Telegram review controls", () => {
  it("claims a Telegram effect before concurrent provider calls", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({});
    const request = {
      idempotencyKey: "telegram:concurrent-effect",
      reference: "100000001",
      payload: { text: "Deliver this concurrent effect once" },
    } as const;

    const results = await Promise.all([
      adapter.write(request),
      adapter.write(request),
    ]);

    expect(adapter.externalEffectCount()).toBe(1);
    expect(results.filter((result) => result.kind === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "failed")).toMatchObject([
      {
        kind: "failed",
        failure: {
          class: "provider-error",
          message: expect.stringContaining("already in flight"),
        },
      },
    ]);
  });

  it("keeps an ambiguous Telegram effect claimed instead of retrying it", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({
      telegramThrowAfterEffect: true,
    });
    const request = {
      idempotencyKey: "telegram:ambiguous-effect",
      reference: "100000001",
      payload: { text: "Deliver this ambiguous effect once" },
    } as const;

    await expect(adapter.write(request)).resolves.toMatchObject({
      kind: "failed",
      failure: {
        class: "provider-error",
        retryable: false,
        message: expect.stringContaining("uncertain"),
      },
    });
    await expect(adapter.write(request)).resolves.toMatchObject({
      kind: "failed",
      failure: { class: "provider-error", retryable: false },
    });
    expect(adapter.externalEffectCount()).toBe(1);
  });

  it("keeps a Telegram effect claimed when its success response is unreadable", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({
      telegramMalformedResponseAfterEffect: true,
    });
    const request = {
      idempotencyKey: "telegram:malformed-success-effect",
      reference: "100000001",
      payload: { text: "Do not replay an unreadable success" },
    } as const;

    await expect(adapter.write(request)).resolves.toMatchObject({
      kind: "failed",
      failure: {
        class: "provider-error",
        retryable: false,
        message: expect.stringContaining("uncertain"),
      },
    });
    await expect(adapter.write(request)).resolves.toMatchObject({
      kind: "failed",
      failure: { class: "provider-error", retryable: false },
    });
    expect(adapter.externalEffectCount()).toBe(1);
  });

  it("keeps supported and identifiable unsupported updates in one polling batch", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({
      telegramUpdates: [
        {
          update_id: 51,
          message: {
            message_id: 501,
            date: 1_787_866_800,
            from: { id: 100000001 },
            chat: { id: 100000001, type: "private" },
            text: "/do Record the brief",
          },
        },
        {
          update_id: 52,
          message: {
            message_id: 502,
            date: 1_787_866_801,
            from: { id: 200000002 },
            chat: { id: 200000002, type: "private" },
            photo: [{ file_id: "must-not-persist" }],
          },
        },
        {
          update_id: 53,
          edited_message: {
            message_id: 503,
            from: { id: 200000002 },
            chat: { id: -100123, type: "supergroup" },
            text: "must-not-enter-agent-context",
          },
        },
        {
          update_id: 54,
          callback_query: {
            id: "inline-callback",
            from: { id: 200000002 },
            inline_message_id: "opaque-inline-reference",
            data: "rm-review:unknown",
          },
        },
      ],
    });

    const result = await adapter.read({ reference: "offset:51" });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected a normalized Telegram read.");
    }
    expect(result.value).toEqual([
      expect.objectContaining({
        updateId: 51,
        message: expect.objectContaining({ chatType: "private" }),
      }),
      {
        updateId: 52,
        unsupported: {
          senderId: "200000002",
          chatId: "200000002",
          chatType: "private",
          kind: "unsupported-message",
        },
      },
      {
        updateId: 53,
        unsupported: {
          senderId: "200000002",
          chatId: "-100123",
          chatType: "supergroup",
          kind: "unsupported-message",
        },
      },
      {
        updateId: 54,
        unattributed: { kind: "unsupported-update" },
      },
    ]);
    expect(JSON.stringify(result.value)).not.toContain("must-not-persist");
  });

  it("does not duplicate a Telegram effect when the adapter is reconstructed", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const ledger = createEphemeralTelegramDeliveryLedger();
    const request = {
      idempotencyKey: "telegram:restart-safe-effect",
      reference: "100000001",
      payload: { text: "Deliver this once across reconstruction" },
    } as const;

    const first = telegramCase.createAdapter({
      telegramDeliveryLedger: ledger,
    });
    await expect(first.write(request)).resolves.toMatchObject({
      kind: "ok",
      deduplicated: false,
    });

    const reconstructed = telegramCase.createAdapter({
      telegramDeliveryLedger: ledger,
    });
    await expect(reconstructed.write(request)).resolves.toMatchObject({
      kind: "ok",
      deduplicated: true,
    });
    expect(first.externalEffectCount() + reconstructed.externalEffectCount()).toBe(1);
  });

  it("does not replay an in-flight Telegram effect after adapter reconstruction", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    let inFlight: TelegramDeliveryLedgerReceipt | undefined;
    const ledger: TelegramDeliveryLedger = {
      claim: (_idempotencyKey, receipt) => {
        if (inFlight === undefined) {
          inFlight = receipt;
          return "claimed";
        }
        return inFlight.reference === receipt.reference &&
          inFlight.payloadDigest === receipt.payloadDigest
          ? "in-flight"
          : "conflict";
      },
      complete: () => {
        // Simulate interruption after Telegram accepted the effect but before
        // the durable ledger could mark it complete.
      },
      release: () => {
        inFlight = undefined;
      },
    };
    const request = {
      idempotencyKey: "telegram:interrupted-effect",
      reference: "100000001",
      payload: { text: "Do not repeat an uncertain provider effect" },
    } as const;

    const first = telegramCase.createAdapter({ telegramDeliveryLedger: ledger });
    await expect(first.write(request)).resolves.toMatchObject({ kind: "ok" });

    const reconstructed = telegramCase.createAdapter({
      telegramDeliveryLedger: ledger,
    });
    await expect(reconstructed.write(request)).resolves.toMatchObject({
      kind: "failed",
      failure: {
        class: "provider-error",
        retryable: false,
        message: expect.stringContaining("already in flight"),
      },
    });
    expect(first.externalEffectCount() + reconstructed.externalEffectCount()).toBe(1);
  });

  it("advances Telegram polling from the requested durable offset", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({});

    await expect(adapter.read({ reference: "offset:42" })).resolves.toMatchObject({
      kind: "ok",
    });
    expect(adapter.providerRequests()).toEqual([
      {
        offset: 42,
        allowed_updates: ["message", "callback_query"],
      },
    ]);
  });

  it("renders one-time review controls as an inline keyboard", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({});

    const result = await adapter.write({
      idempotencyKey: "telegram:review:work-item:outcome-report",
      reference: "100000001",
      payload: {
        text: "Review this exact Outcome Report",
        controls: JSON.stringify([
          {
            label: "Approve",
            callbackData: "rm-review:00000000-0000-4000-8000-000000000001",
          },
          {
            label: "Request changes",
            callbackData: "rm-review:00000000-0000-4000-8000-000000000002",
          },
        ]),
      },
    });

    expect(result).toMatchObject({ kind: "ok", deduplicated: false });
    expect(adapter.providerRequests()).toEqual([
      {
        chat_id: "100000001",
        text: "Review this exact Outcome Report",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Approve",
                callback_data:
                  "rm-review:00000000-0000-4000-8000-000000000001",
              },
              {
                text: "Request changes",
                callback_data:
                  "rm-review:00000000-0000-4000-8000-000000000002",
              },
            ],
          ],
        },
      },
    ]);
  });

  it("rejects a Sensitive Secret embedded in inline review controls", async () => {
    const telegramCase = cases.find((entry) => entry.name === "telegram");
    if (telegramCase === undefined) {
      throw new Error("Expected the Telegram contract case.");
    }
    const adapter = telegramCase.createAdapter({});
    const sensitive = `sk-${"c".repeat(20)}`;

    const result = await adapter.write({
      idempotencyKey: "telegram:review:sensitive-control",
      reference: "100000001",
      payload: {
        text: "Review this exact Outcome Report",
        controls: JSON.stringify([
          { label: "Approve", callbackData: sensitive },
        ]),
      },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    expect(adapter.externalEffectCount()).toBe(0);
    expect(adapter.providerCallCount()).toBe(0);
  });
});

describe("RM-09 Notion Master Tasks provisioning", () => {
  it("upserts one stable Notion page for a Work Item and reads the edited record back", async () => {
    const harness = createNotionProvisioningContractHarness();
    const provisioned = await harness.adapter.provisionMasterTasks({
      parentPageId: "parent:real-ming-operations",
      idempotencyKey: "rm09:provision:v1",
    });
    if (provisioned.kind !== "ok") throw new Error("Expected successful provisioning.");
    const store = createNotionMasterTasksStore({
      adapter: harness.adapter,
      dataSourceId: provisioned.value.dataSourceId,
    });
    const record: MasterTaskRecord = {
      id: "work-item:rm09",
      workItemId: "work-item:rm09",
      workspaceId: "workspace:real-ming",
      title: "Review runway",
      intent: "Review runway",
      source: "Operations Gateway",
      sourceReference: "telegram:update:1",
      trustDomain: "Finance",
      workstream: "Finance",
      accountableExecutive: "Personal CFO",
      collaboratingExecutives: ["COO"],
      lifecycle: "Captured",
      priority: null,
      commitmentValue: null,
      commitmentProvenance: null,
      riskClass: null,
      approvalRequired: false,
      approvalReference: null,
      portfolioProject: null,
      evidenceReferences: [],
      outcomeReportReference: null,
      createdAt: "2026-08-29T02:00:00.000Z",
      updatedAt: "2026-08-29T02:00:00.000Z",
    };

    await expect(store.upsert(record)).resolves.toEqual(record);
    await expect(store.upsert(record)).resolves.toEqual(record);
    const edited = { ...record, priority: "High" as const };
    await expect(store.upsert(edited)).resolves.toEqual(edited);
    expect(harness.masterTaskPageCreateCount()).toBe(1);
    expect(harness.masterTaskPageUpdateCount()).toBe(1);
    await expect(store.records()).resolves.toContainEqual(
      expect.objectContaining({
        workItemId: record.workItemId,
        priority: "High",
        accountableExecutive: "Personal CFO",
      }),
    );
  });

  it("serializes Master Tasks fields by their Notion types and blocks direct lifecycle writes", async () => {
    const notionCase = cases.find((entry) => entry.name === "notion");
    if (notionCase === undefined) throw new Error("Expected the Notion contract case.");
    const adapter = notionCase.createAdapter({});

    await expect(adapter.write({
      idempotencyKey: "rm09:typed-write",
      reference: "notion-page:1",
      payload: {
        Title: "Review runway",
        Priority: "High",
        "Approval Required": "true",
        "Collaborating Executives": JSON.stringify(["COO", "Personal CFO"]),
      },
    })).resolves.toMatchObject({ kind: "ok" });
    expect(adapter.providerRequests()).toContainEqual(expect.objectContaining({
      method: "PATCH",
      body: {
        properties: {
          Title: { title: [{ type: "text", text: { content: "Review runway" } }] },
          Priority: { select: { name: "High" } },
          "Approval Required": { checkbox: true },
          "Collaborating Executives": {
            multi_select: [{ name: "COO" }, { name: "Personal CFO" }],
          },
        },
      },
    }));

    const callsBeforeRejectedWrite = adapter.providerCallCount();
    await expect(adapter.write({
      idempotencyKey: "rm09:direct-lifecycle",
      reference: "notion-page:1",
      payload: { Lifecycle: "Completed" },
    })).resolves.toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input" },
    });
    expect(adapter.providerCallCount()).toBe(callsBeforeRejectedWrite);
  });

  it("fails closed before a production write when no durable ledger is supplied", async () => {
    const notionCase = cases.find((entry) => entry.name === "notion");
    if (notionCase === undefined) throw new Error("Expected the Notion contract case.");
    const adapter = notionCase.createAdapter({ notionWriteLedger: null });

    await expect(adapter.write({
      idempotencyKey: "rm09:no-ledger",
      reference: "notion-page:1",
      payload: { Priority: "High" },
    })).resolves.toMatchObject({
      kind: "failed",
      failure: { class: "unsupported-capability", retryable: false },
    });
    expect(adapter.providerCallCount()).toBe(0);
    expect(adapter.externalEffectCount()).toBe(0);
  });

  it("deduplicates a Notion write after process reconstruction with the SQLite ledger", async () => {
    const notionCase = cases.find((entry) => entry.name === "notion");
    if (notionCase === undefined) throw new Error("Expected the Notion contract case.");
    const directory = mkdtempSync(join(tmpdir(), "real-ming-notion-ledger-"));
    const path = join(directory, "ledger.sqlite");
    const request = {
      idempotencyKey: "rm09:durable-write",
      reference: "notion-page:1",
      payload: { Priority: "High" },
    } as const;
    try {
      const firstLedger = new SqliteNotionWriteLedger(path);
      const first = notionCase.createAdapter({ notionWriteLedger: firstLedger });
      await expect(first.write(request)).resolves.toMatchObject({
        kind: "ok", deduplicated: false,
      });
      firstLedger.close();

      const secondLedger = new SqliteNotionWriteLedger(path);
      const second = notionCase.createAdapter({ notionWriteLedger: secondLedger });
      await expect(second.write(request)).resolves.toMatchObject({
        kind: "ok", deduplicated: true,
      });
      expect(second.providerCallCount()).toBe(0);
      secondLedger.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates the canonical schema and exactly six views over one data source", async () => {
    const harness = createNotionProvisioningContractHarness();

    const result = await harness.adapter.provisionMasterTasks({
      parentPageId: "parent:real-ming-operations",
      idempotencyKey: "rm09:provision:v1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      value: {
        dataSourceName: "Master Tasks",
        views: [
          { name: "CEO All Work", accountableExecutive: null },
          { name: "COO Work View", accountableExecutive: "COO" },
          {
            name: "Personal CFO Work View",
            accountableExecutive: "Personal CFO",
          },
          { name: "CAO Work View", accountableExecutive: "CAO" },
          { name: "CTO Work View", accountableExecutive: "CTO" },
          { name: "CMO Work View", accountableExecutive: "CMO" },
        ],
      },
    });
    if (result.kind !== "ok") {
      throw new Error("Expected successful Notion provisioning.");
    }
    expect(new Set(result.value.views.map((view) => view.dataSourceId))).toEqual(
      new Set([result.value.dataSourceId]),
    );
    expect(harness.databaseCreateCount()).toBe(1);
    expect(harness.viewCreateCount()).toBe(6);
    expect(harness.createdSchemaNames()).toEqual(
      result.value.schema.map((property) => property.name),
    );
  });

  it("reconciles the desired resources on replay without creating duplicates", async () => {
    const harness = createNotionProvisioningContractHarness();
    const request = {
      parentPageId: "parent:real-ming-operations",
      idempotencyKey: "rm09:provision:v1",
    } as const;

    const first = await harness.adapter.provisionMasterTasks(request);
    const replay = await harness.adapter.provisionMasterTasks(request);

    expect(first).toEqual(replay);
    expect(harness.databaseCreateCount()).toBe(1);
    expect(harness.viewCreateCount()).toBe(6);
  });

  it("repairs a same-name Work View whose accountable-Executive filter drifted", async () => {
    const harness = createNotionProvisioningContractHarness({
      driftViewFilterOnReplay: true,
    });
    const request = {
      parentPageId: "parent:real-ming-operations",
      idempotencyKey: "rm09:provision:v1",
    } as const;

    await expect(harness.adapter.provisionMasterTasks(request)).resolves.toMatchObject({ kind: "ok" });
    await expect(harness.adapter.provisionMasterTasks(request)).resolves.toMatchObject({ kind: "ok" });
    expect(harness.viewCreateCount()).toBe(6);
    expect(harness.viewUpdateCount()).toBe(1);
  });

  it("resumes an interrupted partial run and creates only the missing views", async () => {
    const harness = createNotionProvisioningContractHarness({
      failViewCreateOnceAt: 3,
    });
    const request = {
      parentPageId: "parent:real-ming-operations",
      idempotencyKey: "rm09:provision:v1",
    } as const;

    await expect(harness.adapter.provisionMasterTasks(request)).resolves.toMatchObject({
      kind: "failed",
      failure: { class: "unavailable", retryable: true },
    });
    await expect(harness.adapter.provisionMasterTasks(request)).resolves.toMatchObject({
      kind: "ok",
      value: { views: expect.arrayContaining([expect.any(Object)]) },
    });
    expect(harness.databaseCreateCount()).toBe(1);
    expect(harness.viewCreateCount()).toBe(6);
    expect(harness.viewNames()).toEqual([
      "CEO All Work",
      "COO Work View",
      "Personal CFO Work View",
      "CAO Work View",
      "CTO Work View",
      "CMO Work View",
    ]);
  });
});

describe("RM-10 legacy Notion task reader", () => {
  it("discovers and preserves all five sources without a provider mutation", async () => {
    const harness = createLegacyTaskReaderContractHarness();
    const sources = await harness.readSources();

    expect(sources).toHaveLength(5);
    expect(sources.map(({ name }) => name)).toEqual([
      "(IP Content Creation) Task To Do List",
      "(MicroSaaS) Task To Do List",
      "(Academic) Task To Do List",
      "(Job x Life) Task To Do List",
      "(Finance) Task To Do List",
    ]);
    expect(sources.map(({ workstream }) => workstream)).toEqual([
      "Content Creation",
      "MicroSaaS",
      "Academic",
      null,
      "Finance",
    ]);
    expect(sources.every(({ records }) => records.length === 3)).toBe(true);
    expect(sources[0]?.records[0]?.sourcePayload).toMatchObject({
      object: "page",
      properties: { Legacy: expect.any(Object) },
    });
    expect(sources[0]?.records.every(({ commitment }) => commitment === "2026-09-01")).toBe(true);
    expect(sources[0]?.records).toContainEqual(expect.objectContaining({
      sourcePayload: expect.objectContaining({ archived: true }),
    }));
    expect(
      sources[0]?.records.filter(({ id }) => id.endsWith("task-overlap")),
    ).toHaveLength(1);
    expect(harness.mutationCount()).toBe(0);
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
