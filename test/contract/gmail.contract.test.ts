import { describe, expect, it } from "vitest";

import { createMailContractHarness } from "../../src/testing/provider-adapter-contract-harness.js";

/**
 * Gmail under the Provider Adapter Contract.
 *
 * Ming reads three mailboxes for one purpose: what needs his reply. The
 * scenarios below are the ones where a mailbox reader can quietly mislead —
 * an unreachable mailbox reported as an empty inbox, a body leaking into a
 * transcript, or a write succeeding against a read-only credential.
 */
describe("Gmail provider adapter contract", () => {
  it("declares read and write, where write means drafting only", () => {
    const { adapter } = createMailContractHarness();

    expect(adapter.capabilities()).toEqual(["read", "write"]);
    expect(adapter.identity()).toEqual({
      provider: "gmail",
      workspaceId: "workspace:real-ming",
      accountReference: "contract@example.com",
    });
  });

  it("reads the headers a briefing needs and nothing more", async () => {
    const { adapter } = createMailContractHarness();

    const result = await adapter.listMessages({ query: "is:unread" });

    expect(result.kind).toBe("ok");
    if (result.kind === "failed") throw new Error("Expected a successful read.");
    expect(result.value).toEqual([
      {
        id: "contract-message-1",
        threadId: "contract-thread-1",
        from: "Recruiting <talent@example.com>",
        subject: "Your application",
        snippet: "We would like to invite you to a first interview.",
        receivedAt: "2026-09-07T09:00:00.000Z",
        unread: true,
        sourceReference: "gmail:contract@example.com:contract-message-1",
      },
    ]);
  });

  it("never requests the message body", async () => {
    // A body in the read is a body in the Telegram transcript, and in every
    // session summary after it. The metadata format is the guarantee.
    const harness = createMailContractHarness();

    await harness.adapter.listMessages({ query: "is:unread" });

    expect(harness.listRequests()[0]?.searchParams.get("q")).toBe("is:unread");
    expect(harness.providerCallCount()).toBe(2);
  });

  it("reports an unreachable mailbox rather than an empty inbox", async () => {
    // The failure that matters most: "nothing needs your reply" and "I could
    // not open your mail" are the same sentence to a reader, and only one of
    // them is true.
    const { adapter } = createMailContractHarness({ failure: "unavailable" });

    const result = await adapter.listMessages();

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("Expected a failure.");
    expect(result.failure.class).toBe("unavailable");
    expect(result.failure.retryable).toBe(true);
  });

  it("classifies a revoked scope as permission denied, not as no mail", async () => {
    const { adapter } = createMailContractHarness({
      detailFailure: "permission-denied",
    });

    const result = await adapter.listMessages();

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("Expected a failure.");
    expect(result.failure.class).toBe("permission-denied");
    expect(result.failure.retryable).toBe(false);
  });

  it("returns a genuinely empty inbox as an empty read, not a failure", async () => {
    const { adapter } = createMailContractHarness({ emptyValue: true });

    const result = await adapter.listMessages();

    expect(result.kind).toBe("ok");
    if (result.kind === "failed") throw new Error("Expected a successful read.");
    expect(result.value).toEqual([]);
  });

  it("skips a message it cannot identify rather than inventing one", async () => {
    const { adapter } = createMailContractHarness({ unreadableMessage: true });

    const result = await adapter.listMessages();

    expect(result.kind).toBe("ok");
    if (result.kind === "failed") throw new Error("Expected a successful read.");
    expect(result.value).toEqual([]);
  });

  it("writes a draft into the mailbox", async () => {
    const harness = createMailContractHarness();

    const result = await harness.adapter.createDraft({
      to: ["support@example.com"],
      subject: "Refund request for order 4182",
      body: "Hello, I would like to request a refund.",
      idempotencyKey: "refund-4182",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected the draft to be written.");
    expect(result.effectReference).toBe(
      "gmail:contract@example.com:draft:contract-draft-1",
    );
    expect(result.deduplicated).toBe(false);
  });

  it("never touches the send endpoint", async () => {
    // The whole safety model is that Ming presses send in his own Gmail. An
    // adapter that could send would make every other guarantee a convention.
    const harness = createMailContractHarness();

    await harness.adapter.createDraft({
      to: ["support@example.com"],
      subject: "Refund request",
      body: "Please refund.",
      idempotencyKey: "refund-1",
    });
    await harness.adapter.listMessages();

    for (const path of harness.touchedPaths()) {
      expect(path).not.toMatch(/\/send$/);
      expect(path).not.toMatch(/messages\/send/);
    }
  });

  it("addresses the draft the caller asked for, and nothing else", async () => {
    const harness = createMailContractHarness();

    await harness.adapter.createDraft({
      to: ["support@example.com"],
      cc: ["records@example.com"],
      subject: "Refund request for order 4182",
      body: "Please refund order 4182.",
      idempotencyKey: "refund-4182",
    });

    const sent = JSON.parse(harness.draftBodies()[0] ?? "{}") as {
      readonly message?: { readonly raw?: string };
    };
    const decoded = Buffer.from(
      (sent.message?.raw ?? "").replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("To: support@example.com");
    expect(decoded).toContain("Cc: records@example.com");
    expect(decoded).toContain("Subject: Refund request for order 4182");
    expect(decoded).toContain("Please refund order 4182.");
  });

  it("does not leave a second draft when a retry replays the same key", async () => {
    const harness = createMailContractHarness();
    const draft = {
      to: ["support@example.com"],
      subject: "Refund request",
      body: "Please refund.",
      idempotencyKey: "refund-once",
    };

    const first = await harness.adapter.createDraft(draft);
    const replay = await harness.adapter.createDraft(draft);

    expect(first).toMatchObject({ kind: "ok", deduplicated: false });
    expect(replay).toMatchObject({ kind: "ok", deduplicated: true });
    expect(
      harness.touchedPaths().filter((path) => path.endsWith("/drafts")),
    ).toHaveLength(1);
  });

  it("refuses a draft with no recipient rather than writing an empty one", async () => {
    const { adapter } = createMailContractHarness();

    const result = await adapter.createDraft({
      to: [],
      subject: "Nowhere",
      body: "No one.",
      idempotencyKey: "no-recipient",
    });

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("Expected a refusal.");
    expect(result.failure.class).toBe("invalid-input");
  });

  it("carries no raw provider text into the failure it reports", async () => {
    const { adapter } = createMailContractHarness({
      failure: "authentication-failed",
    });

    const result = await adapter.listMessages();

    if (result.kind !== "failed") throw new Error("Expected a failure.");
    expect(result.failure.message).not.toMatch(/token|secret|bearer/i);
  });
});
