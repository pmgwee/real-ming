export type TelegramChatType =
  | "private"
  | "group"
  | "supergroup"
  | "channel"
  | "unknown";

export interface TelegramMessageUpdate {
  readonly updateId: number;
  readonly message: {
    readonly messageId: number;
    readonly senderId: string;
    readonly chatId: string;
    readonly chatType?: TelegramChatType;
    readonly text: string;
  };
}

export interface TelegramCallbackUpdate {
  readonly updateId: number;
  readonly callbackQuery: {
    readonly queryId: string;
    readonly senderId: string;
    readonly chatId: string;
    readonly chatType?: TelegramChatType;
    readonly data: string;
  };
}

export interface TelegramUnsupportedUpdate {
  readonly updateId: number;
  readonly unsupported: {
    readonly senderId: string;
    readonly chatId: string;
    readonly chatType?: TelegramChatType;
    readonly kind: "unsupported-message" | "unsupported-callback";
  };
}

export interface TelegramUnattributedUpdate {
  readonly updateId: number;
  readonly unattributed: {
    readonly kind: "unsupported-update";
  };
}

export type TelegramUpdate =
  | TelegramMessageUpdate
  | TelegramCallbackUpdate
  | TelegramUnsupportedUpdate
  | TelegramUnattributedUpdate;

export type TelegramReviewDecision =
  | "approve"
  | "request-changes"
  | "reject"
  | "cancel";

export type TelegramControlState =
  | "issued"
  | "awaiting-reason"
  | "applying"
  | "used"
  | "expired"
  | "invalidated";

export interface TelegramReviewControl {
  readonly id: string;
  readonly workItemId: string;
  readonly decision: TelegramReviewDecision;
  readonly targetVersion: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
  readonly usedAt: string | null;
  readonly claimedUpdateId: number | null;
  readonly state: TelegramControlState;
}

export interface TelegramInlineControl {
  readonly label: string;
  readonly decision: TelegramReviewDecision;
  readonly callbackData: string;
}

export interface PublishTelegramReviewControlsRequest {
  readonly workItemId: string;
}

export type TelegramNotificationKind =
  | "brief"
  | "approval"
  | "material-blocker"
  | "critical-incident"
  | "completed-outcome-report"
  | "recovery-notice"
  | "routine-progress";

export interface TelegramNotification {
  readonly kind: TelegramNotificationKind;
  readonly text: string;
  readonly idempotencyKey: string;
}

export type TelegramNotificationResult = {
  readonly kind: "sent" | "suppressed";
  readonly notificationKind: TelegramNotificationKind;
} | {
  readonly kind: "failed";
  readonly notificationKind: TelegramNotificationKind;
  readonly failure: import("../providers/adapter-contract.js").ProviderFailure;
};

import type { CeoCommandResult } from "../operations/contracts.js";

export type TelegramIngressResult =
  | {
      readonly kind: "denied";
      readonly reason: "ceo-identity-required" | "private-chat-required";
    }
  | {
      readonly kind: "handled";
      readonly response: CeoCommandResult;
    }
  | {
      readonly kind: "rejected";
      readonly reason: "sensitive-secret-rejected" | "unsupported-update";
    }
  | {
      readonly kind: "control-applied";
      readonly decision: TelegramReviewDecision;
      readonly workItem: import("../operations/contracts.js").WorkItem;
    }
  | {
      readonly kind: "control-awaiting-reason";
      readonly decision: "request-changes";
      readonly controlId: string;
      readonly workItemId: string;
    }
  | {
      readonly kind: "control-rejected";
      readonly reason:
        | "control-not-found"
        | "control-used"
        | "control-expired"
        | "target-changed";
    }
  | {
      readonly kind: "approval-applied";
      readonly approval: import("../operations/contracts.js").Approval;
    }
  | {
      readonly kind: "approval-rejected";
      readonly reason:
        | "approval-not-found"
        | "approval-not-pending"
        | "promotion-approval-required";
    };

export interface TelegramOutboundMessage {
  readonly chatId: string;
  readonly text: string;
  readonly controls?: readonly TelegramInlineControl[];
}

export interface TelegramSendRequest extends TelegramOutboundMessage {
  readonly idempotencyKey: string;
}

export interface TelegramTransport {
  send(message: TelegramSendRequest): Promise<TelegramTransportResult>;
}

export interface TelegramDeliveryRetrySummary {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly uncertain: number;
}

export type TelegramTransportResult =
  | { readonly kind: "sent"; readonly deduplicated: boolean }
  | {
      readonly kind: "failed";
      readonly failure: import("../providers/adapter-contract.js").ProviderFailure;
    };

export interface TelegramAuditEvent {
  readonly sequence: number;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly type:
    | "telegram.ingress-denied"
    | "telegram.ingress-rejected"
    | "telegram.ingress-accepted"
    | "telegram.ingress-replayed"
    | "telegram.review-controls-issued"
    | "telegram.review-control-awaiting-reason"
    | "telegram.review-control-claimed"
    | "telegram.review-control-applied"
    | "telegram.review-control-rejected"
    | "telegram.delivery-failed"
    | "telegram.delivery-deduplicated"
    | "telegram.notification-sent"
    | "telegram.notification-suppressed";
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}
