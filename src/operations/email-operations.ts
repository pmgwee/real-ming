import { createHash } from "node:crypto";

import type { WorkItem, Workstream } from "./contracts.js";
import type { OperationsGateway } from "./operations-gateway.js";
import type { GmailEmailAdapter, EmailDraft, EmailMessage } from "../providers/email-provider-adapter.js";
import type { ProviderFailure, ProviderReadResult } from "../providers/adapter-contract.js";
import { detectSensitiveFields } from "./sensitive-secret.js";

export type EmailMailboxKind = "personal" | "opportunity" | "entertainment";

export interface EmailReadRequest {
  readonly mailbox: string;
  readonly mailboxKind: EmailMailboxKind;
  readonly query?: string;
}

export type EmailReadResult =
  | { readonly kind: "ok" | "stale"; readonly mailbox: string; readonly mailboxKind: EmailMailboxKind; readonly messages: readonly EmailMessage[]; readonly sourceIdentity: string; readonly sourceReference: string; readonly asOf: string; readonly freshness: "current" | "stale" }
  | { readonly kind: "denied"; readonly reason: "mailbox-not-authorized" }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface EmailApprovedProjection {
  readonly kind: "approved-projection";
  readonly id: string;
  readonly messageId: string;
  readonly mailboxKind: EmailMailboxKind;
  readonly workItemId: string;
  readonly executive: "COO";
  readonly subject: string;
  readonly sender: string;
  readonly receivedAt: string;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly freshness: "current" | "stale";
  readonly actionability: "actionable" | "informational";
}

export type EmailCaptureResult =
  | { readonly kind: "work-item"; readonly workItem: WorkItem }
  | { readonly kind: "denied"; readonly reason: "mailbox-not-authorized" };

export type EmailDraftResult =
  | { readonly kind: "drafted"; readonly draft: EmailDraft }
  | { readonly kind: "denied"; readonly reason: "mailbox-not-authorized" | "entertainment-digest-only" }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export type EmailSendResult =
  | { readonly kind: "denied"; readonly reason: "send-requires-separate-authorized-capability" | "recipient-or-content-changed" }
  | { readonly kind: "failed"; readonly failure: ProviderFailure };

export interface EmailOperationsCoordinator {
  readMailbox(request: EmailReadRequest): Promise<EmailReadResult>;
  captureActionable(input: {
    readonly message: EmailMessage;
    readonly mailboxKind: EmailMailboxKind;
    readonly summary: string;
    readonly workstream: Extract<Workstream, "Personal Life" | "Career Job">;
    readonly idempotencyKey: string;
  }): Promise<EmailCaptureResult>;
  createDraft(input: {
    readonly mailbox: string;
    readonly mailboxKind: EmailMailboxKind;
    readonly to: readonly string[];
    readonly cc?: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<EmailDraftResult>;
  sendDraft(input: {
    readonly draft: EmailDraft;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
  }): Promise<EmailSendResult>;
  projection(input: {
    readonly message: EmailMessage;
    readonly mailboxKind: EmailMailboxKind;
    readonly workItemId: string;
    readonly asOf: string;
    readonly freshness: "current" | "stale";
    readonly actionability: "actionable" | "informational";
  }): EmailApprovedProjection;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function sourceReferenceBelongsToMailbox(sourceReference: string, mailbox: string): boolean {
  const prefix = `gmail:${mailbox}`;
  return sourceReference === prefix || sourceReference.startsWith(`${prefix}:`);
}

export function createEmailOperationsCoordinator(options: {
  readonly adapter: GmailEmailAdapter;
  readonly gateway: OperationsGateway;
  readonly mailboxBindings: Readonly<Record<EmailMailboxKind, string>>;
}): EmailOperationsCoordinator {
  return {
    async readMailbox(request): Promise<EmailReadResult> {
      if (request.mailbox !== options.mailboxBindings[request.mailboxKind]) return { kind: "denied", reason: "mailbox-not-authorized" };
      const result = await options.adapter.listMessages({ mailbox: request.mailbox, ...(request.query === undefined ? {} : { query: request.query }) });
      if (result.kind === "failed") return result;
      if (
        !sourceReferenceBelongsToMailbox(result.provenance.sourceReference, request.mailbox) ||
        result.value.some(
          (message) =>
            message.mailbox !== request.mailbox ||
            !sourceReferenceBelongsToMailbox(message.sourceReference, request.mailbox),
        )
      ) {
        return { kind: "failed", failure: { class: "provider-error", retryable: false, message: "Gmail returned a message outside the requested mailbox." } };
      }
      return { kind: result.kind, mailbox: request.mailbox, mailboxKind: request.mailboxKind, messages: result.value, sourceIdentity: result.provenance.sourceIdentity, sourceReference: result.provenance.sourceReference, asOf: result.provenance.asOf, freshness: result.provenance.freshness };
    },

    async captureActionable(input) {
      if (input.message.mailbox !== options.mailboxBindings[input.mailboxKind]) {
        return { kind: "denied", reason: "mailbox-not-authorized" };
      }
      const summary = input.summary.replace(/\s+/gu, " ").trim();
      if (summary.length === 0 || summary.length > 240 || detectSensitiveFields({ summary }).length > 0) throw new Error("An actionable email Work Item requires a bounded, non-sensitive summary.");
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: "agent:coo",
        workspaceId: "workspace:real-ming",
        idempotencyKey: input.idempotencyKey,
        intent: summary,
        expectedEffect: { kind: "email-actionable", value: input.message.sourceReference },
        accountableExecutive: "COO",
        workstream: input.workstream,
      });
      return { kind: "work-item", workItem: acknowledgement.workItem };
    },

    async createDraft(input): Promise<EmailDraftResult> {
      if (input.mailboxKind === "entertainment") {
        return { kind: "denied", reason: "entertainment-digest-only" };
      }
      if (input.mailbox !== options.mailboxBindings[input.mailboxKind]) {
        return { kind: "denied", reason: "mailbox-not-authorized" };
      }
      const result = await options.adapter.createDraft(input);
      return result.kind === "ok" && result.draft !== undefined ? { kind: "drafted", draft: result.draft } : result.kind === "failed" ? result : { kind: "failed", failure: { class: "provider-error", retryable: false, message: "Gmail returned no draft." } };
    },

    async sendDraft(input): Promise<EmailSendResult> {
      const expected = digest({ draftId: input.draft.id, to: input.draft.to, subject: input.draft.subject, body: input.draft.body });
      const actual = digest({ draftId: input.draft.id, to: input.to, subject: input.subject, body: input.body });
      if (expected !== actual) return { kind: "denied", reason: "recipient-or-content-changed" };
      // RM-29 deliberately has no send capability. External communication is
      // a later, separately approved action and cannot be smuggled through a
      // draft-only adapter.
      return { kind: "denied", reason: "send-requires-separate-authorized-capability" };
    },

    projection(input): EmailApprovedProjection {
      return {
        kind: "approved-projection",
        id: `email-projection:${digest({ message: input.message.id, workItem: input.workItemId, executive: "COO" })}`,
        messageId: input.message.id,
        mailboxKind: input.mailboxKind,
        workItemId: input.workItemId,
        executive: "COO",
        subject: input.message.subject,
        sender: input.message.from,
        receivedAt: input.message.receivedAt,
        sourceReference: input.message.sourceReference,
        asOf: input.asOf,
        freshness: input.freshness,
        actionability: input.actionability,
      };
    },
  };
}
