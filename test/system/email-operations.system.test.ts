import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEphemeralEmailDraftLedger,
  type EmailDraft,
  type EmailMessage,
  type GmailEmailAdapter,
} from "../../src/providers/email-provider-adapter.js";
import { createRealMingSystemHarness, type RealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";
import { createProductionControlPlane } from "../../src/runtime/production-control-plane.js";
import { tracerCredentials } from "../../src/config/tracer-secrets.js";

const now = "2026-09-02T14:00:00.000Z";

describe("RM-29 personal and opportunity email read-and-draft", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  const message: EmailMessage = {
    id: "message-opportunity-1",
    threadId: "thread-opportunity-1",
    mailbox: "personal@example.test",
    from: "recruiter@example.test",
    to: ["personal@example.test"],
    subject: "Interview scheduling",
    snippet: "Please choose an interview time.",
    body: "Private message body that must never cross the projection boundary.",
    receivedAt: "2026-09-02T13:30:00.000Z",
    labels: ["INBOX"],
    sourceReference: "gmail:personal@example.test:message:message-opportunity-1",
  };

  function adapter(overrides: Partial<GmailEmailAdapter> = {}): GmailEmailAdapter {
    const ledger = createEphemeralEmailDraftLedger();
    const identity = { provider: "gmail", workspaceId: "workspace:real-ming", accountReference: "gmail:real-ming" } as const;
    const provenance = { sourceIdentity: "gmail", sourceReference: "gmail:personal@example.test", asOf: message.receivedAt, retrievedAt: now, freshness: "current" as const };
    return {
      identity: () => identity,
      capabilities: () => ["read", "write"],
      read: async () => ({ kind: "ok", identity, provenance, value: [message] }),
      write: async () => ({ kind: "failed", failure: { class: "unsupported-capability", retryable: false, message: "send unavailable" } }),
      listMessages: async () => ({ kind: "ok", identity, provenance, value: [message] }),
      createDraft: async (input) => {
        const prior = ledger.receipt(input.idempotencyKey);
        const effectReference = "gmail:personal@example.test:draft:draft-1";
        if (prior !== undefined) return { kind: "ok", identity, provenance: { ...provenance, sourceReference: effectReference }, effectReference, deduplicated: true, draft: { id: "draft-1", messageId: "draft-message-1", to: input.to, cc: input.cc ?? [], subject: input.subject, body: input.body, sourceReference: effectReference } satisfies EmailDraft };
        ledger.record(input.idempotencyKey, { payloadDigest: "draft-payload", effectReference });
        return { kind: "ok", identity, provenance: { ...provenance, sourceReference: effectReference }, effectReference, deduplicated: false, draft: { id: "draft-1", messageId: "draft-message-1", to: input.to, cc: input.cc ?? [], subject: input.subject, body: input.body, sourceReference: effectReference } satisfies EmailDraft };
      },
      ...overrides,
    };
  }

  async function start(emailAdapter: GmailEmailAdapter = adapter()): Promise<RealMingSystemHarness> {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm29-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({ statePath: join(directory, "state.sqlite"), now: () => now, emailAdapter });
    harnesses.push(harness);
    return harness;
  }

  it("reads only for the COO with provenance and exposes a bounded Approved Projection", async () => {
    const harness = await start();
    const read = await harness.readEmailMailbox({ mailbox: message.mailbox, mailboxKind: "opportunity" });
    expect(read).toMatchObject({ kind: "ok", mailbox: message.mailbox, mailboxKind: "opportunity", sourceIdentity: "gmail", sourceReference: "gmail:personal@example.test", asOf: message.receivedAt, freshness: "current", messages: [{ id: message.id, body: message.body }] });
    await expect(harness.readEmailMailbox({ mailbox: "restricted@example.test", mailboxKind: "opportunity" })).resolves.toMatchObject({ kind: "denied", reason: "mailbox-not-authorized" });
    if (read.kind !== "ok") return;
    const projection = harness.emailProjection({ message: read.messages[0]!, mailboxKind: "opportunity", workItemId: "work-item:email", asOf: read.asOf, freshness: read.freshness, actionability: "actionable" });
    expect(projection).toMatchObject({ kind: "approved-projection", subject: message.subject, sender: message.from, sourceReference: message.sourceReference });
    expect(JSON.stringify(projection)).not.toContain(message.body);
  });

  it("captures one bounded COO Work Item without copying the raw message", async () => {
    const harness = await start();
    const first = await harness.captureEmailActionable({ message, mailboxKind: "opportunity", summary: "Choose an interview time with the recruiter.", workstream: "Career Job", idempotencyKey: "email-action:message-opportunity-1" });
    const replay = await harness.captureEmailActionable({ message, mailboxKind: "opportunity", summary: "Choose an interview time with the recruiter.", workstream: "Career Job", idempotencyKey: "email-action:message-opportunity-1" });
    expect(first.kind).toBe("work-item");
    expect(replay.kind).toBe("work-item");
    if (first.kind !== "work-item" || replay.kind !== "work-item") return;
    expect(first.workItem.id).toBe(replay.workItem.id);
    expect(first.workItem.intent).not.toContain(message.body);
    expect(harness.auditTrail(first.workItem.id).every((event) => JSON.stringify(event).indexOf(message.body) === -1)).toBe(true);
    await expect(harness.captureEmailActionable({ message: { ...message, mailbox: "restricted@example.test" }, mailboxKind: "opportunity", summary: "Should be denied.", workstream: "Career Job", idempotencyKey: "email-action:restricted" })).resolves.toMatchObject({ kind: "denied", reason: "mailbox-not-authorized" });
    await expect(harness.captureEmailActionable({ message, mailboxKind: "opportunity", summary: "api_key=sk-12345678901234567890", workstream: "Career Job", idempotencyKey: "email-action:sensitive-summary" })).rejects.toThrow("non-sensitive summary");
  });

  it("creates idempotent drafts and refuses every unsanctioned send or changed target", async () => {
    const harness = await start();
    const draft = await harness.createEmailDraft({ mailbox: message.mailbox, mailboxKind: "opportunity", to: [message.from], subject: "Re: Interview scheduling", body: "I can attend at 10:00.", idempotencyKey: "draft:message-opportunity-1" });
    expect(draft.kind).toBe("drafted");
    if (draft.kind !== "drafted") return;
    await expect(harness.createEmailDraft({ mailbox: message.mailbox, mailboxKind: "opportunity", to: [message.from], subject: "Re: Interview scheduling", body: "I can attend at 10:00.", idempotencyKey: "draft:message-opportunity-1" })).resolves.toMatchObject({ kind: "drafted", draft: { id: draft.draft.id } });
    await expect(harness.createEmailDraft({ mailbox: "restricted@example.test", mailboxKind: "opportunity", to: [message.from], subject: "Re: Interview scheduling", body: "I can attend at 10:00.", idempotencyKey: "draft:restricted" })).resolves.toMatchObject({ kind: "denied", reason: "mailbox-not-authorized" });
    await expect(harness.sendEmailDraft({ draft: draft.draft, to: draft.draft.to, subject: draft.draft.subject, body: draft.draft.body })).resolves.toMatchObject({ kind: "denied", reason: "send-requires-separate-authorized-capability" });
    await expect(harness.sendEmailDraft({ draft: draft.draft, to: ["other@example.test"], subject: draft.draft.subject, body: draft.draft.body })).resolves.toMatchObject({ kind: "denied", reason: "recipient-or-content-changed" });
  });

  it("preserves a degraded mailbox result without exposing provider text", async () => {
    const degraded = await start({
      ...adapter(),
      listMessages: async () => ({ kind: "failed", failure: { class: "unavailable", retryable: true, message: "provider unavailable with token=redacted" } }),
    });
    await expect(degraded.readEmailMailbox({ mailbox: message.mailbox, mailboxKind: "personal" })).resolves.toMatchObject({ kind: "failed", failure: { class: "unavailable", retryable: true, message: "provider unavailable with token=redacted" } });
  });

  it("wires the optional Gmail coordinator at the production composition root", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm29-production-"));
    directories.push(directory);
    const environment = Object.fromEntries(tracerCredentials.map((credential) => [credential.name, `controlled-${credential.name.toLowerCase()}`]));
    const controlPlane = await createProductionControlPlane({
      environment,
      statePath: join(directory, "state.sqlite"),
      notionLedgerPath: join(directory, "notion-ledger.sqlite"),
      emailAdapter: adapter(),
      emailMailboxBindings: { personal: message.mailbox, opportunity: message.mailbox },
      fetch: async () => { throw new Error("unexpected provider call"); },
      dashboardPort: 0,
      now: () => now,
    });
    try {
      expect(controlPlane.emailOperations).toBeDefined();
      await expect(controlPlane.emailOperations!.readMailbox({ mailbox: message.mailbox, mailboxKind: "personal" })).resolves.toMatchObject({ kind: "ok", messages: [{ id: message.id }] });
    } finally {
      await controlPlane.close();
    }
  });
});
