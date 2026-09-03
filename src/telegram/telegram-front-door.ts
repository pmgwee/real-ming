import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import type { ExecutiveRole } from "../operations/contracts.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import { providerFailure } from "../providers/adapter-contract.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import type {
  PublishTelegramReviewControlsRequest,
  TelegramDeliveryRetrySummary,
  TelegramIngressResult,
  TelegramInlineControl,
  TelegramNotification,
  TelegramNotificationResult,
  TelegramReviewControl,
  TelegramTransport,
  TelegramTransportResult,
  TelegramUpdate,
} from "./contracts.js";

export class TelegramDeliveryError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super("Telegram could not deliver the governed message.");
    this.name = "TelegramDeliveryError";
  }
}

export interface TelegramFrontDoor {
  receiveUpdate(update: TelegramUpdate): Promise<TelegramIngressResult>;
  publishReviewControls(
    request: PublishTelegramReviewControlsRequest,
  ): Promise<readonly TelegramInlineControl[]>;
  notify(notification: TelegramNotification): Promise<TelegramNotificationResult>;
  retryPendingDeliveries(): Promise<TelegramDeliveryRetrySummary>;
}

function matchesIdentity(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const controlLabels = {
  approve: "Approve",
  "request-changes": "Request changes",
  reject: "Reject",
  cancel: "Cancel",
} as const;

const allowedNotificationKinds: ReadonlySet<TelegramNotification["kind"]> =
  new Set([
    "brief",
    "approval",
    "material-blocker",
    "critical-incident",
    "completed-outcome-report",
    "recovery-notice",
    "entertainment-digest",
  ]);

function callbackData(controlId: string): string {
  return `rm-review:${controlId}`;
}

function controlIdFromCallback(data: string): string | undefined {
  const prefix = "rm-review:";
  return data.startsWith(prefix) && data.length > prefix.length
    ? data.slice(prefix.length)
    : undefined;
}

function parseChangeReason(
  text: string,
): { readonly controlId: string; readonly reason: string } | undefined {
  const match = /^\/changes\s+(\S+)\s+(.+)$/su.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  const controlId = match[1]?.trim() ?? "";
  const reason = match[2]?.trim() ?? "";
  return controlId.length === 0 || reason.length === 0
    ? undefined
    : { controlId, reason };
}

function parsePromotionApproval(text: string): string | undefined {
  const match = /^\/approve-promotion\s+(\S+)$/su.exec(text.trim());
  return match?.[1];
}

function outboundDigest(message: {
  readonly chatId: string;
  readonly text: string;
  readonly controls?: readonly TelegramInlineControl[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        chatId: message.chatId,
        text: message.text,
        controls: message.controls ?? [],
      }),
    )
    .digest("hex");
}

function canonicalIsoTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : undefined;
}

const reviewControlTtlMs = 15 * 60 * 1000;
const reviewControlExpiryPolicy = "high-risk-exact-target-15m";

function expectedReviewState(
  decision: "approve" | "request-changes" | "reject" | "cancel",
): "Completed" | "Changes Requested" | "Cancelled" {
  return decision === "approve"
    ? "Completed"
    : decision === "request-changes"
      ? "Changes Requested"
      : "Cancelled";
}

const uncertainDeliveryFailure: ProviderFailure = {
  class: "provider-error",
  retryable: false,
  message:
    "Telegram delivery status is uncertain; reconcile it before any retry.",
};

interface ParsedTelegramAction {
  readonly text: string;
  readonly addressedExecutive?: ExecutiveRole;
}

const actionPrefixes: Readonly<Record<string, ExecutiveRole | undefined>> = {
  "/do": undefined,
  "/coo": "COO",
  "/cto": "CTO",
  "/cfo": "Personal CFO",
  "/cao": "CAO",
  "/cmo": "CMO",
};

const executiveAddresses: Readonly<Record<string, ExecutiveRole>> = {
  coo: "COO",
  cto: "CTO",
  cfo: "Personal CFO",
  "personal cfo": "Personal CFO",
  cao: "CAO",
  cmo: "CMO",
};

function parseTelegramAction(text: string): ParsedTelegramAction | undefined {
  const trimmed = text.trim();
  const addressSeparator = trimmed.indexOf(":");
  if (addressSeparator !== -1) {
    const address = trimmed.slice(0, addressSeparator).trim().toLowerCase();
    const addressedExecutive = executiveAddresses[address];
    const actionText = trimmed.slice(addressSeparator + 1).trim();
    if (addressedExecutive !== undefined && actionText.length > 0) {
      return { text: actionText, addressedExecutive };
    }
  }

  const separator = trimmed.indexOf(" ");
  const prefix = (separator === -1 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
  if (!Object.hasOwn(actionPrefixes, prefix)) {
    return undefined;
  }

  const actionText = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
  if (actionText.length === 0) {
    return undefined;
  }

  const addressedExecutive = actionPrefixes[prefix];
  return addressedExecutive === undefined
    ? { text: actionText }
    : { text: actionText, addressedExecutive };
}

export function createTelegramFrontDoor(options: {
  readonly ceoTelegramId: string;
  readonly ceoTelegramChatId: string;
  readonly gateway: OperationsGateway;
  readonly state: OperationsState;
  readonly transport: TelegramTransport;
  readonly auditPseudonymKey: string;
  readonly now?: () => string;
  readonly afterReviewApplied?: () => void;
  readonly afterReviewControlClaimed?: () => void;
  readonly afterReplyDelivered?: () => void;
}): TelegramFrontDoor {
  const now = options.now ?? (() => new Date().toISOString());
  const ceoOwnership = {
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
  } as const;
  if (options.auditPseudonymKey.length < 16) {
    throw new Error("Telegram audit pseudonymization requires a secret key.");
  }
  const deniedActorId = (senderId: string): string =>
    `external:telegram:${createHmac("sha256", options.auditPseudonymKey)
      .update(senderId)
      .digest("hex")
      .slice(0, 24)}`;

  const recordIngress = (
    updateId: number,
    result: TelegramIngressResult,
    ownership: { readonly actorId: string; readonly workspaceId: string } =
      ceoOwnership,
  ): TelegramIngressResult =>
    options.state.recordTelegramIngressResult(
      updateId,
      ownership,
      result,
      now(),
    );

  const sendDurably = async (
    message: Parameters<TelegramTransport["send"]>[0],
  ): Promise<TelegramTransportResult> => {
    const sensitiveFields = detectSensitiveFields({ text: message.text });
    if (sensitiveFields.length > 0) {
      const failure = providerFailure(
        "invalid-input",
        "Telegram rejected an outbound message containing a Sensitive Secret.",
      );
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: failure.class,
          retryable: failure.retryable,
          reason: "sensitive-secret-rejected",
        },
      );
      return { kind: "failed", failure };
    }

    const payloadDigest = outboundDigest(message);
    const { idempotencyKey, ...outbound } = message;
    const claimed = options.state.claimTelegramDelivery(
      message.idempotencyKey,
      ceoOwnership,
      outbound,
      payloadDigest,
      now(),
    );
    if (claimed.kind === "conflict") {
      const failure = providerFailure(
        "invalid-input",
        "A Telegram idempotency key was reused for a different payload.",
      );
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: failure.class,
          retryable: failure.retryable,
        },
      );
      return { kind: "failed", failure };
    }
    if (claimed.kind === "sent") {
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-deduplicated",
        now(),
        { idempotencyKey: message.idempotencyKey },
      );
      return { kind: "sent", deduplicated: true };
    }
    if (claimed.kind === "uncertain") {
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: uncertainDeliveryFailure.class,
          retryable: uncertainDeliveryFailure.retryable,
          reason: "delivery-status-uncertain",
        },
      );
      return { kind: "failed", failure: uncertainDeliveryFailure };
    }
    if (claimed.kind === "deferred") {
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: claimed.failure.class,
          retryable: claimed.failure.retryable,
          retryAfterMs: claimed.failure.retryAfterMs,
          reason: "retry-deferred",
        },
      );
      return { kind: "failed", failure: claimed.failure };
    }
    if (claimed.kind === "terminal-failure") {
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: claimed.failure.class,
          retryable: claimed.failure.retryable,
          reason: "retry-policy-exhausted",
        },
      );
      return { kind: "failed", failure: claimed.failure };
    }

    let result: TelegramTransportResult;
    try {
      result = await options.transport.send(message);
    } catch {
      options.state.failTelegramDelivery(
        idempotencyKey,
        payloadDigest,
        uncertainDeliveryFailure,
        now(),
        "uncertain",
      );
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey,
          failureClass: uncertainDeliveryFailure.class,
          retryable: uncertainDeliveryFailure.retryable,
          reason: "delivery-status-uncertain",
        },
      );
      return { kind: "failed", failure: uncertainDeliveryFailure };
    }
    if (result.kind === "failed") {
      options.state.failTelegramDelivery(
        idempotencyKey,
        payloadDigest,
        result.failure,
        now(),
      );
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.delivery-failed",
        now(),
        {
          idempotencyKey: message.idempotencyKey,
          failureClass: result.failure.class,
          retryable: result.failure.retryable,
          ...(result.failure.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: result.failure.retryAfterMs }),
        },
      );
      return result;
    }

    options.state.completeTelegramDelivery(
      idempotencyKey,
      ceoOwnership,
      payloadDigest,
      now(),
    );
    return result;
  };

  const reasonPrompt = (controlId: string): string =>
    `Reply with /changes ${controlId} followed by the specific change required.`;

  const replayIngressDelivery = async (
    update: TelegramUpdate,
    result: TelegramIngressResult,
  ): Promise<void> => {
    if (result.kind === "denied") {
      return;
    }

    if (result.kind === "rejected") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text:
          result.reason === "unsupported-update"
            ? "This Telegram update type is not supported."
            : "Sensitive Secrets cannot be accepted through Telegram.",
        idempotencyKey: `telegram:reply:update:${update.updateId}:rejected`,
      });
      return;
    }

    if (result.kind === "handled") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text:
          result.response.kind === "information-answer"
            ? result.response.answer
            : result.response.kind === "clarification"
              ? result.response.question
              : `Acknowledged as Work Item ${result.response.workItem.id} · ${result.response.workItem.accountableExecutive} · ${result.response.workItem.state}.`,
        idempotencyKey: `telegram:reply:update:${update.updateId}`,
      });
      return;
    }

    if (result.kind === "control-awaiting-reason") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: reasonPrompt(result.controlId),
        idempotencyKey: `telegram:review:${result.controlId}:reason-prompt`,
      });
      return;
    }

    if (result.kind === "control-rejected") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: `This review control cannot be used (${result.reason}).`,
        idempotencyKey:
          "callbackQuery" in update
            ? `telegram:callback:${update.updateId}:rejected`
            : `telegram:changes:${update.updateId}:rejected`,
      });
      return;
    }

    if (result.kind === "approval-rejected") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: `This promotion Approval cannot be used (${result.reason}).`,
        idempotencyKey: `telegram:approval:${update.updateId}:rejected`,
      });
      return;
    }

    if (result.kind === "approval-applied") {
      await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: `Approve Promotion · Approval ${result.approval.id} · ${result.approval.targetVersion} granted.`,
        idempotencyKey: `telegram:approval:${update.updateId}:applied`,
      });
      return;
    }

    await sendDurably({
      chatId: options.ceoTelegramChatId,
      text: `${controlLabels[result.decision]} · Work Item ${result.workItem.id} · ${result.workItem.state}.`,
      idempotencyKey:
        "callbackQuery" in update
          ? `telegram:callback:${update.updateId}:applied`
          : `telegram:changes:${update.updateId}:applied`,
    });
  };

  const rejectControl = async (
    updateId: number,
    reason: Extract<TelegramIngressResult, { kind: "control-rejected" }>["reason"],
    idempotencyKey: string,
  ): Promise<TelegramIngressResult> => {
    options.state.recordTelegramAudit(
      ceoOwnership,
      "telegram.review-control-rejected",
      now(),
      { updateId, reason },
    );
    await sendDurably({
      chatId: options.ceoTelegramChatId,
      text: `This review control cannot be used (${reason}).`,
      idempotencyKey,
    });
    return { kind: "control-rejected", reason };
  };

  const rejectIngress = async (
    updateId: number,
    reason: Extract<TelegramIngressResult, { kind: "rejected" }>["reason"],
  ): Promise<TelegramIngressResult> => {
    options.state.recordTelegramAudit(
      ceoOwnership,
      "telegram.ingress-rejected",
      now(),
      { updateId, reason },
    );
    const result = { kind: "rejected" as const, reason };
    await sendDurably({
      chatId: options.ceoTelegramChatId,
      text:
        reason === "unsupported-update"
          ? "This Telegram update type is not supported."
          : "Sensitive Secrets cannot be accepted through Telegram.",
      idempotencyKey: `telegram:reply:update:${updateId}:rejected`,
    });
    return recordIngress(updateId, result);
  };

  const rejectPromotionApproval = async (
    updateId: number,
    reason: Extract<TelegramIngressResult, { kind: "approval-rejected" }>['reason'],
  ): Promise<TelegramIngressResult> => {
    const result = { kind: "approval-rejected" as const, reason };
    await sendDurably({
      chatId: options.ceoTelegramChatId,
      text: `This promotion Approval cannot be used (${reason}).`,
      idempotencyKey: `telegram:approval:${updateId}:rejected`,
    });
    return recordIngress(updateId, result);
  };

  const applyReviewControl = async (optionsForControl: {
    readonly control: TelegramReviewControl;
    readonly updateId: number;
    readonly expectedSourceState: "issued" | "awaiting-reason";
    readonly reason?: string;
    readonly deliveryPrefix: "callback" | "changes";
  }): Promise<TelegramIngressResult> => {
    const { control, updateId, expectedSourceState, reason, deliveryPrefix } =
      optionsForControl;
    const occurredAt = now();
    const recoveringUsedControl =
      control.state === "used" && control.claimedUpdateId === updateId;
    let newlyClaimed = false;
    if (
      control.decision === "request-changes" &&
      !recoveringUsedControl &&
      reason === undefined
    ) {
      throw new Error("Telegram Request Changes requires an actionable reason.");
    }
    if (!recoveringUsedControl) {
      const claim = options.state.claimTelegramReviewControl(
        control.id,
        expectedSourceState,
        updateId,
        occurredAt,
      );
      if (claim === "unavailable") {
        return recordIngress(
          updateId,
          await rejectControl(
            updateId,
            "control-used",
            `telegram:${deliveryPrefix}:${updateId}:rejected`,
          ),
        );
      }
      newlyClaimed = claim === "claimed";
    }
    if (newlyClaimed) {
      options.afterReviewControlClaimed?.();
    }

    const current = options.state.telegramReviewControl(control.id);
    const workItem = options.state.workItem(control.workItemId);
    const outcomeReport = options.state.outcomeReport(control.workItemId);
    if (
      (current?.state !== "applying" && current?.state !== "used") ||
      current.claimedUpdateId !== updateId ||
      outcomeReport?.id !== control.targetVersion ||
      workItem === undefined
    ) {
      if (current?.state === "applying") {
        options.state.markTelegramReviewControl(
          control.id,
          "invalidated",
          occurredAt,
          "target-changed",
          "applying",
          updateId,
        );
      }
      return recordIngress(
        updateId,
        await rejectControl(
          updateId,
          "target-changed",
          `telegram:${deliveryPrefix}:${updateId}:rejected`,
        ),
      );
    }

    const expectedState = expectedReviewState(control.decision);
    let reviewed = workItem;
    if (
      current.state === "applying" &&
      workItem.state === "Ready for CEO Review" &&
      Date.parse(occurredAt) >= Date.parse(control.expiresAt)
    ) {
      options.state.markTelegramReviewControl(
        control.id,
        "expired",
        occurredAt,
        "control-expired",
        "applying",
        updateId,
      );
      return recordIngress(
        updateId,
        await rejectControl(
          updateId,
          "control-expired",
          `telegram:${deliveryPrefix}:${updateId}:rejected`,
        ),
      );
    }
    if (recoveringUsedControl && workItem.state !== expectedState) {
      return recordIngress(
        updateId,
        await rejectControl(
          updateId,
          "target-changed",
          `telegram:${deliveryPrefix}:${updateId}:rejected`,
        ),
      );
    }
    if (workItem.state !== expectedState) {
      if (workItem.state !== "Ready for CEO Review") {
        options.state.markTelegramReviewControl(
          control.id,
          "invalidated",
          occurredAt,
          "target-changed",
          "applying",
          updateId,
        );
        return recordIngress(
          updateId,
          await rejectControl(
            updateId,
            "target-changed",
            `telegram:${deliveryPrefix}:${updateId}:rejected`,
          ),
        );
      }

      reviewed = await options.gateway.reviewWorkItem(
        control.decision === "approve"
          ? {
              workItemId: control.workItemId,
              actorId: ceoOwnership.actorId,
              decision: "complete",
            }
          : control.decision === "request-changes"
            ? {
                workItemId: control.workItemId,
                actorId: ceoOwnership.actorId,
                decision: "request-changes",
                reason: reason as string,
              }
            : {
                workItemId: control.workItemId,
                actorId: ceoOwnership.actorId,
                decision: control.decision,
                reason:
                  control.decision === "reject"
                    ? "Rejected by the CEO from Telegram."
                    : "Cancelled by the CEO from Telegram.",
              },
      );
      options.afterReviewApplied?.();
    }

    if (!recoveringUsedControl) {
      if (
        !options.state.markTelegramReviewControl(
          control.id,
          "used",
          occurredAt,
          undefined,
          "applying",
          updateId,
        )
      ) {
        throw new Error("Telegram review control changed during review.");
      }
    }
    await sendDurably({
      chatId: options.ceoTelegramChatId,
      text: `${controlLabels[control.decision]} · Work Item ${reviewed.id} · ${reviewed.state}.`,
      idempotencyKey: `telegram:${deliveryPrefix}:${updateId}:applied`,
    });
    return recordIngress(updateId, {
      kind: "control-applied",
      decision: control.decision,
      workItem: reviewed,
    });
  };

  return {
    async retryPendingDeliveries() {
      const pending = options.state.pendingTelegramDeliveries(now());
      let sent = 0;
      let failed = 0;
      for (const delivery of pending) {
        const result = await sendDurably({
          ...delivery.message,
          idempotencyKey: delivery.idempotencyKey,
        });
        if (result.kind === "sent") {
          sent += 1;
        } else {
          failed += 1;
        }
      }
      return {
        attempted: pending.length,
        sent,
        failed,
        uncertain: options.state.telegramUncertainDeliveryCount(),
      };
    },

    async notify(notification) {
      if (!allowedNotificationKinds.has(notification.kind)) {
        options.state.recordTelegramAudit(
          ceoOwnership,
          "telegram.notification-suppressed",
          now(),
          {
            notificationKind: notification.kind,
            idempotencyKey: notification.idempotencyKey,
          },
        );
        return {
          kind: "suppressed",
          notificationKind: notification.kind,
        };
      }

      const delivery = await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: notification.text,
        idempotencyKey: notification.idempotencyKey,
      });
      if (delivery.kind === "failed") {
        return {
          kind: "failed",
          notificationKind: notification.kind,
          failure: delivery.failure,
        };
      }
      if (!delivery.deduplicated) {
        options.state.recordTelegramAudit(
          ceoOwnership,
          "telegram.notification-sent",
          now(),
          {
            notificationKind: notification.kind,
            idempotencyKey: notification.idempotencyKey,
          },
        );
      }
      return { kind: "sent", notificationKind: notification.kind };
    },

    async publishReviewControls(request) {
      const issuedAt = now();
      const issuedAtMs = canonicalIsoTimestamp(issuedAt);
      if (issuedAtMs === undefined) {
        throw new Error("Telegram review controls require a canonical clock.");
      }
      const expiresAt = new Date(issuedAtMs + reviewControlTtlMs).toISOString();
      const workItem = options.state.workItem(request.workItemId);
      const outcomeReport = options.state.outcomeReport(request.workItemId);
      if (
        workItem?.state !== "Ready for CEO Review" ||
        outcomeReport === undefined
      ) {
        throw new Error(
          "Telegram review controls require Review-Ready Work with an Outcome Report.",
        );
      }

      const controls = options.state.issueTelegramReviewControls(
        workItem.id,
        outcomeReport.id,
        expiresAt,
        issuedAt,
        reviewControlExpiryPolicy,
      );
      const inlineControls = controls.map((control) => ({
        label: controlLabels[control.decision],
        decision: control.decision,
        callbackData: callbackData(control.id),
      }));
      const delivery = await sendDurably({
        chatId: options.ceoTelegramChatId,
        text: `Outcome Report ${outcomeReport.id} · ${workItem.accountableExecutive} · Ready for CEO Review.`,
        controls: inlineControls,
        idempotencyKey: `telegram:review:${workItem.id}:${outcomeReport.id}`,
      });
      if (delivery.kind === "failed") {
        throw new TelegramDeliveryError(delivery.failure);
      }
      return inlineControls;
    },

    async receiveUpdate(update) {
      if ("unattributed" in update) {
        const ownership = {
          actorId: "external:telegram:unattributed",
          workspaceId: ceoOwnership.workspaceId,
        } as const;
        options.state.recordTelegramAudit(
          ownership,
          "telegram.ingress-denied",
          now(),
          {
            updateId: update.updateId,
            reason: "ceo-identity-required",
          },
        );
        return recordIngress(
          update.updateId,
          { kind: "denied", reason: "ceo-identity-required" },
          ownership,
        );
      }
      const inbound =
        "message" in update
          ? update.message
          : "callbackQuery" in update
            ? update.callbackQuery
            : update.unsupported;
      const senderId = inbound.senderId;
      if (!matchesIdentity(senderId, options.ceoTelegramId)) {
        const deniedOwnership = {
          actorId: deniedActorId(senderId),
          workspaceId: ceoOwnership.workspaceId,
        } as const;
        options.state.recordTelegramAudit(
          deniedOwnership,
          "telegram.ingress-denied",
          now(),
          {
            updateId: update.updateId,
            reason: "ceo-identity-required",
          },
        );
        return recordIngress(
          update.updateId,
          { kind: "denied", reason: "ceo-identity-required" },
          deniedOwnership,
        );
      }

      const chatId = inbound.chatId;
      if (
        !matchesIdentity(chatId, options.ceoTelegramChatId) ||
        inbound.chatType !== "private"
      ) {
        options.state.recordTelegramAudit(
          ceoOwnership,
          "telegram.ingress-denied",
          now(),
          {
            updateId: update.updateId,
            reason: "private-chat-required",
          },
        );
        return recordIngress(update.updateId, {
          kind: "denied",
          reason: "private-chat-required",
        });
      }

      const replayed = options.state.telegramIngressResult(update.updateId);
      if (replayed !== undefined) {
        options.state.recordTelegramAudit(
          ceoOwnership,
          "telegram.ingress-replayed",
          now(),
          { updateId: update.updateId, resultKind: replayed.kind },
        );
        await replayIngressDelivery(update, replayed);
        return replayed;
      }

      if ("unsupported" in update) {
        return rejectIngress(update.updateId, "unsupported-update");
      }

      if (
        "message" in update &&
        detectSensitiveFields({ text: update.message.text }).length > 0
      ) {
        return rejectIngress(update.updateId, "sensitive-secret-rejected");
      }

      if ("message" in update) {
        const approvalId = parsePromotionApproval(update.message.text);
        if (approvalId !== undefined) {
          const approval = options.state.approval(approvalId);
          if (approval === undefined) {
            return rejectPromotionApproval(update.updateId, "approval-not-found");
          }
          if (approval.scope !== "code-promotion" || approval.targetType !== "deployment-candidate") {
            return rejectPromotionApproval(update.updateId, "promotion-approval-required");
          }
          if (approval.state !== "requested") {
            return rejectPromotionApproval(update.updateId, "approval-not-pending");
          }
          const issuedAt = canonicalIsoTimestamp(now());
          if (issuedAt === undefined) {
            return rejectPromotionApproval(update.updateId, "approval-not-pending");
          }
          const granted = await options.gateway.grantApproval({
            approvalId,
            actorId: ceoOwnership.actorId,
            expiresAt: new Date(issuedAt + reviewControlTtlMs).toISOString(),
          });
          const result = { kind: "approval-applied" as const, approval: granted };
          await sendDurably({
            chatId: options.ceoTelegramChatId,
            text: `Approve Promotion · Approval ${granted.id} · ${granted.targetVersion} granted.`,
            idempotencyKey: `telegram:approval:${update.updateId}:applied`,
          });
          return recordIngress(update.updateId, result);
        }
      }

      if ("callbackQuery" in update) {
        const id = controlIdFromCallback(update.callbackQuery.data);
        const control =
          id === undefined
            ? undefined
            : options.state.telegramReviewControl(id);
        if (control === undefined) {
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "control-not-found",
              `telegram:callback:${update.updateId}:rejected`,
            ),
          );
        }
        if (
          (control.state === "applying" || control.state === "used") &&
          control.claimedUpdateId === update.updateId &&
          control.decision !== "request-changes"
        ) {
          return applyReviewControl({
            control,
            updateId: update.updateId,
            expectedSourceState: "issued",
            deliveryPrefix: "callback",
          });
        }
        if (
          control.state === "awaiting-reason" &&
          control.decision === "request-changes"
        ) {
          const occurredAt = now();
          if (Date.parse(occurredAt) >= Date.parse(control.expiresAt)) {
            options.state.markTelegramReviewControl(
              control.id,
              "expired",
              occurredAt,
              "control-expired",
              "awaiting-reason",
            );
            return recordIngress(
              update.updateId,
              await rejectControl(
                update.updateId,
                "control-expired",
                `telegram:callback:${update.updateId}:rejected`,
              ),
            );
          }
          const workItem = options.state.workItem(control.workItemId);
          const outcomeReport = options.state.outcomeReport(control.workItemId);
          if (
            workItem?.state !== "Ready for CEO Review" ||
            outcomeReport?.id !== control.targetVersion
          ) {
            options.state.markTelegramReviewControl(
              control.id,
              "invalidated",
              occurredAt,
              "target-changed",
              "awaiting-reason",
            );
            return recordIngress(
              update.updateId,
              await rejectControl(
                update.updateId,
                "target-changed",
                `telegram:callback:${update.updateId}:rejected`,
              ),
            );
          }
          await sendDurably({
            chatId: options.ceoTelegramChatId,
            text: reasonPrompt(control.id),
            idempotencyKey: `telegram:review:${control.id}:reason-prompt`,
          });
          return recordIngress(update.updateId, {
            kind: "control-awaiting-reason",
            decision: "request-changes",
            controlId: control.id,
            workItemId: control.workItemId,
          });
        }
        if (control.state !== "issued") {
          const reason =
            control.state === "used"
              ? "control-used"
              : control.state === "expired"
                ? "control-expired"
                : control.state === "applying"
                  ? "control-used"
                  : "target-changed";
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              reason,
              `telegram:callback:${update.updateId}:rejected`,
            ),
          );
        }

        const occurredAt = now();
        if (Date.parse(occurredAt) >= Date.parse(control.expiresAt)) {
          options.state.markTelegramReviewControl(
            control.id,
            "expired",
            occurredAt,
            "control-expired",
          );
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "control-expired",
              `telegram:callback:${update.updateId}:rejected`,
            ),
          );
        }

        const workItem = options.state.workItem(control.workItemId);
        const outcomeReport = options.state.outcomeReport(control.workItemId);
        if (
          workItem?.state !== "Ready for CEO Review" ||
          outcomeReport?.id !== control.targetVersion
        ) {
          options.state.markTelegramReviewControl(
            control.id,
            "invalidated",
            occurredAt,
            "target-changed",
          );
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "target-changed",
              `telegram:callback:${update.updateId}:rejected`,
            ),
          );
        }

        if (control.decision === "request-changes") {
          if (
            !options.state.markTelegramReviewControl(
              control.id,
              "awaiting-reason",
              occurredAt,
            )
          ) {
            return recordIngress(
              update.updateId,
              await rejectControl(
                update.updateId,
                "control-used",
                `telegram:callback:${update.updateId}:rejected`,
              ),
            );
          }
          await sendDurably({
            chatId: options.ceoTelegramChatId,
            text: reasonPrompt(control.id),
            idempotencyKey: `telegram:review:${control.id}:reason-prompt`,
          });
          return recordIngress(update.updateId, {
            kind: "control-awaiting-reason",
            decision: "request-changes",
            controlId: control.id,
            workItemId: control.workItemId,
          });
        }

        return applyReviewControl({
          control,
          updateId: update.updateId,
          expectedSourceState: "issued",
          deliveryPrefix: "callback",
        });
      }

      const changeReason = parseChangeReason(update.message.text);
      if (changeReason !== undefined) {
        const control = options.state.telegramReviewControl(
          changeReason.controlId,
        );
        if (
          control === undefined ||
          control.decision !== "request-changes"
        ) {
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              control === undefined ? "control-not-found" : "control-used",
              `telegram:changes:${update.updateId}:rejected`,
            ),
          );
        }
        if (
          (control.state === "applying" || control.state === "used") &&
          control.claimedUpdateId === update.updateId
        ) {
          return applyReviewControl({
            control,
            updateId: update.updateId,
            expectedSourceState: "awaiting-reason",
            reason: changeReason.reason,
            deliveryPrefix: "changes",
          });
        }
        if (control.state !== "awaiting-reason") {
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "control-used",
              `telegram:changes:${update.updateId}:rejected`,
            ),
          );
        }

        const occurredAt = now();
        if (Date.parse(occurredAt) >= Date.parse(control.expiresAt)) {
          options.state.markTelegramReviewControl(
            control.id,
            "expired",
            occurredAt,
            "control-expired",
            "awaiting-reason",
          );
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "control-expired",
              `telegram:changes:${update.updateId}:rejected`,
            ),
          );
        }
        const workItem = options.state.workItem(control.workItemId);
        const outcomeReport = options.state.outcomeReport(control.workItemId);
        if (
          workItem?.state !== "Ready for CEO Review" ||
          outcomeReport?.id !== control.targetVersion
        ) {
          options.state.markTelegramReviewControl(
            control.id,
            "invalidated",
            occurredAt,
            "target-changed",
            "awaiting-reason",
          );
          return recordIngress(
            update.updateId,
            await rejectControl(
              update.updateId,
              "target-changed",
              `telegram:changes:${update.updateId}:rejected`,
            ),
          );
        }

        return applyReviewControl({
          control,
          updateId: update.updateId,
          expectedSourceState: "awaiting-reason",
          reason: changeReason.reason,
          deliveryPrefix: "changes",
        });
      }

      const action = parseTelegramAction(update.message.text);
      const response = await options.gateway.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: `telegram:update:${update.updateId}:message:${update.message.messageId}`,
        text: action?.text ?? update.message.text,
        ...(action === undefined
          ? {}
          : {
              expectedEffect: {
                kind: "telegram-request",
                value: action.text,
              },
              ...(action.addressedExecutive === undefined
                ? {}
                : { addressedExecutive: action.addressedExecutive }),
            }),
      });

      const responseText =
        response.kind === "information-answer"
          ? response.answer
          : response.kind === "clarification"
            ? response.question
            : undefined;
      if (
        responseText !== undefined &&
        detectSensitiveFields({ text: responseText }).length > 0
      ) {
        return rejectIngress(update.updateId, "sensitive-secret-rejected");
      }

      const recordedResult = recordIngress(update.updateId, {
        kind: "handled",
        response,
      });
      options.state.recordTelegramAudit(
        ceoOwnership,
        "telegram.ingress-accepted",
        now(),
        {
          updateId: update.updateId,
          responseKind: response.kind,
        },
      );
      await replayIngressDelivery(update, recordedResult);
      options.afterReplyDelivered?.();

      return recordedResult;
    },
  };
}
