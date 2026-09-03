import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SqliteEmailDraftLedger } from "../../src/providers/email-provider-adapter.js";
import { createEmailProviderContractHarness } from "../../src/testing/provider-adapter-contract-harness.js";

const token = "controlled-email-access-token";
const now = "2026-09-02T15:00:00.000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Gmail email provider adapter contract", () => {
  it("normalizes message identity, headers, body and provenance", async () => {
    const fixture = createEmailProviderContractHarness({
      accessToken: token,
      now: () => now,
      responses: [
        response({ messages: [{ id: "m1", threadId: "t1" }] }),
        response({ id: "m1", threadId: "t1", internalDate: String(Date.parse("2026-09-02T14:30:00.000Z")), snippet: "snippet", labelIds: ["INBOX"], payload: { headers: [{ name: "From", value: "sender@example.test" }, { name: "To", value: "ceo@example.test, second@example.test" }, { name: "Subject", value: "Subject" }], body: { data: Buffer.from("Body").toString("base64url") } } }),
      ],
    });
    const result = await fixture.adapter.listMessages({ mailbox: "me", query: "is:unread" });
    expect(result).toMatchObject({ kind: "ok", identity: { provider: "gmail" }, provenance: { sourceReference: "gmail:me", asOf: "2026-09-02T14:30:00.000Z", freshness: "current" }, value: [{ id: "m1", from: "sender@example.test", to: ["ceo@example.test", "second@example.test"], subject: "Subject", body: "Body", sourceReference: "gmail:me:message:m1" }] });
    expect(fixture.requests()[0]).toContain("q=is%3Aunread");
  });

  it("classifies authentication failures and never reports the access token", async () => {
    const fixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, responses: [response({ error: "provider leaked token" }, 401)] });
    const result = await fixture.adapter.listMessages({ mailbox: "me" });
    expect(result).toMatchObject({ kind: "failed", failure: { class: "authentication-failed", retryable: false } });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("quarantines credential-shaped message content before it reaches the COO", async () => {
    const fixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, responses: [
      response({ messages: [{ id: "secret-message" }] }),
      response({ id: "secret-message", internalDate: String(Date.parse(now)), payload: { headers: [{ name: "Subject", value: "Credentials" }], body: { data: Buffer.from("api_key=sk-12345678901234567890").toString("base64url") } } }),
    ] });
    const result = await fixture.adapter.listMessages({ mailbox: "me" });
    expect(result).toMatchObject({ kind: "ok", value: [{ body: "[redacted]", subject: "[redacted]", snippet: "[redacted]" }] });
    expect(JSON.stringify(result)).not.toContain("sk-12345678901234567890");
  });

  it("creates a draft once and deduplicates the exact idempotency key", async () => {
    let calls = 0;
    const fixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, responses: [() => { calls += 1; return response({ id: "d1", message: { id: "dm1" } }); }] });
    const input = { mailbox: "me", to: ["recipient@example.test"], subject: "Draft", body: "Body", idempotencyKey: "draft-1" };
    const first = await fixture.adapter.createDraft(input);
    const second = await fixture.adapter.createDraft(input);
    expect(first).toMatchObject({ kind: "ok", deduplicated: false, effectReference: "gmail:me:draft:d1" });
    expect(second).toMatchObject({ kind: "ok", deduplicated: true, effectReference: "gmail:me:draft:d1" });
    expect(calls).toBe(1);
    await expect(fixture.adapter.createDraft({ ...input, body: "Changed" })).resolves.toMatchObject({ kind: "failed", failure: { class: "invalid-input" } });
  });

  it("does not expose a send capability", async () => {
    const fixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, responses: [] });
    await expect(fixture.adapter.write({ idempotencyKey: "send-1", reference: "me", payload: { to: "recipient@example.test", body: "Body" } })).resolves.toMatchObject({ kind: "failed", failure: { class: "unsupported-capability" } });
  });

  it("deduplicates a draft after the durable ledger is reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-email-ledger-"));
    const ledgerPath = join(directory, "drafts.sqlite");
    const input = { mailbox: "me", to: ["recipient@example.test"], subject: "Draft", body: "Body", idempotencyKey: "durable-draft-1" };
    try {
      const firstLedger = new SqliteEmailDraftLedger(ledgerPath);
      const firstFixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, draftLedger: firstLedger, responses: [response({ id: "d2", message: { id: "dm2" } })] });
      await expect(firstFixture.adapter.createDraft(input)).resolves.toMatchObject({ kind: "ok", deduplicated: false });
      expect(firstFixture.externalEffectCount()).toBe(1);
      firstLedger.close();

      const secondLedger = new SqliteEmailDraftLedger(ledgerPath);
      const secondFixture = createEmailProviderContractHarness({ accessToken: token, now: () => now, draftLedger: secondLedger, responses: [] });
      await expect(secondFixture.adapter.createDraft(input)).resolves.toMatchObject({ kind: "ok", deduplicated: true, effectReference: "gmail:me:draft:d2" });
      expect(secondFixture.externalEffectCount()).toBe(0);
      secondLedger.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
