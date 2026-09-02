import { createHash } from "node:crypto";

import type {
  EmailApprovedProjection,
  EmailCaptureResult,
  EmailMailboxKind,
  EmailOperationsCoordinator,
} from "./email-operations.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import type { ExceptionNotice, ExceptionNoticeAdmission } from "./exception-notice-rhythm.js";
import { operatingDayOf } from "./daily-schedule.js";

export const entertainmentEmailDigestJob = "entertainment-email-digest";

export interface EntertainmentEmailDigest {
  readonly mailbox: string;
  readonly mailboxKind: EmailMailboxKind;
  readonly asOf: string;
  readonly freshness: "current" | "stale";
  readonly routineMessageIds: readonly string[];
  readonly actionableProjections: readonly EmailApprovedProjection[];
  readonly idempotencyKey: string;
  /** Metadata only; no subject, snippet, recipient, or body is copied here. */
  readonly text: string;
}

export type EntertainmentEmailDigestRunResult =
  | { readonly kind: "digest"; readonly digest: EntertainmentEmailDigest; readonly admission: ExceptionNoticeAdmission }
  | { readonly kind: "failed"; readonly failure: ProviderFailure }
  | { readonly kind: "denied"; readonly reason: "mailbox-not-authorized" };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function actionableByLabel(message: { readonly labels: readonly string[] }): boolean {
  return message.labels.some((label) => ["ACTIONABLE", "IMPORTANT", "STARRED"].includes(label.toUpperCase()));
}

export interface EntertainmentEmailDigestRunner {
  run(): Promise<EntertainmentEmailDigestRunResult>;
}

export function createEntertainmentEmailDigestRunner(options: {
  readonly coordinator: EmailOperationsCoordinator;
  readonly mailbox: string;
  readonly admit: (notice: ExceptionNotice) => Promise<ExceptionNoticeAdmission>;
  readonly now: () => string;
  readonly isActionable?: (message: Parameters<EmailOperationsCoordinator["projection"]>[0]["message"]) => boolean;
}): EntertainmentEmailDigestRunner {
  const isActionable = options.isActionable ?? actionableByLabel;
  return {
    async run(): Promise<EntertainmentEmailDigestRunResult> {
      const read = await options.coordinator.readMailbox({ mailbox: options.mailbox, mailboxKind: "entertainment" });
      if (read.kind === "failed") return { kind: "failed", failure: read.failure };
      if (read.kind === "denied") return read;

      const actionableProjections: EmailApprovedProjection[] = [];
      const routineMessageIds: string[] = [];
      for (const message of read.messages) {
        if (!isActionable(message)) {
          routineMessageIds.push(message.id);
          continue;
        }
        // The source subject is Entertainment-domain content. Keep it inside
        // the approved projection and use only a metadata-only Work Item
        // intent, so global Work Items and dashboard logs stay redacted.
        const summary = `Entertainment/application message ${message.id} requires review.`;
        const captured: EmailCaptureResult = await options.coordinator.captureActionable({
          message,
          mailboxKind: "entertainment",
          summary,
          workstream: "Personal Life",
          idempotencyKey: `${entertainmentEmailDigestJob}:${message.id}`,
        });
        if (captured.kind === "denied") return captured;
        actionableProjections.push(options.coordinator.projection({
          message,
          mailboxKind: "entertainment",
          workItemId: captured.workItem.id,
          asOf: read.asOf,
          freshness: read.freshness,
          actionability: "actionable",
        }));
      }

      const operatingDay = operatingDayOf(Date.parse(options.now()));
      const idempotencyKey = `${entertainmentEmailDigestJob}:${digest({ operatingDay, mailbox: read.mailbox, messageIds: read.messages.map((message) => message.id).sort(), actionableIds: actionableProjections.map((projection) => projection.messageId).sort() })}`;
      const digestOutput: EntertainmentEmailDigest = {
        mailbox: read.mailbox,
        mailboxKind: read.mailboxKind,
        asOf: read.asOf,
        freshness: read.freshness,
        routineMessageIds,
        actionableProjections,
        idempotencyKey,
        text: `Entertainment/application digest — mailbox=${read.mailbox}; as-of=${read.asOf}; freshness=${read.freshness}; routine-messages=${routineMessageIds.length}; actionable-exceptions=${actionableProjections.length}.`,
      };
      const admission = await options.admit({
        kind: "entertainment-digest",
        text: digestOutput.text,
        idempotencyKey,
      });
      return { kind: "digest", digest: digestOutput, admission };
    },
  };
}
