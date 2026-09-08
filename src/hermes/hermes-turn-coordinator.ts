import { createHash } from "node:crypto";

import type { HermesProjectionBroker } from "../knowledge/hermes-projection.js";
import type { OperationsGateway } from "../operations/operations-gateway.js";
import type {
  ExecutiveRole,
  HermesAnswer,
  NormalizedCeoAction,
  WorkItem,
} from "../operations/contracts.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import type {
  HermesContextRequest,
  HermesContextResult,
  HermesRuntimeClient,
  HermesToolRequest,
  HermesToolResult,
  HermesTurnPlan,
} from "./contracts.js";
import {
  hermesTextDigest,
  type HermesSessionStore,
} from "./hermes-session-store.js";
import { HermesRuntimeError } from "./hermes-runtime-client.js";
import type {
  HermesTelegramTurnHandler,
  HermesTelegramTurnRequest,
} from "../telegram/telegram-front-door.js";
import { routeTrustDomain } from "../operations/executive-role-router.js";

export interface HermesConversationOverview {
  readonly status: "healthy" | "failed";
  readonly model: string | null;
  readonly sessionCount: number;
  readonly turnCount: number;
  readonly lastTurnAt: string | null;
  readonly lastIntent: "answer" | "clarification" | "research" | "work" | null;
  readonly lastWorkItemId: string | null;
  readonly lastFailure: string | null;
}

export interface HermesTurnCoordinator extends HermesTelegramTurnHandler {
  overview(): HermesConversationOverview;
  health(): Promise<HermesConversationOverview>;
}

export interface HermesTurnCoordinatorOptions {
  readonly runtime: HermesRuntimeClient;
  readonly sessions: HermesSessionStore;
  readonly gateway: OperationsGateway;
  readonly projection?: HermesProjectionBroker;
  readonly workItem?: (workItemId: string) => WorkItem | undefined;
  readonly now?: () => string;
  readonly model?: string;
  readonly maxContinuationRounds?: number;
  /** Optional capability executor. The caller remains responsible for policy. */
  readonly executeTool?: (
    request: HermesToolRequest,
    scope: { readonly workItem: WorkItem; readonly actorId: string; readonly workspaceId: string },
  ) => Promise<HermesToolResult>;
}

const defaultMaxContinuationRounds = 4;

function telegramReference(chatId: string): string {
  return `telegram-chat:${chatId}`;
}

function sessionIdFor(chatId: string): string {
  const digest = createHash("sha256").update(chatId, "utf8").digest("hex").slice(0, 24);
  return `hermes:real-ming:telegram:${digest}`;
}

function turnIdFor(request: HermesTelegramTurnRequest): string {
  return `telegram:${request.updateId}:${request.messageId}`;
}

function safeAnswer(plan: HermesTurnPlan, workItem?: WorkItem): string {
  if (plan.answer !== undefined && plan.answer.trim().length > 0) return plan.answer.trim();
  if (workItem !== undefined) {
    return `Hermes has proposed this as Work Item ${workItem.id} · ${workItem.accountableExecutive} · ${workItem.state}.`;
  }
  return "Hermes needs one clarification before it can continue.";
}

function deniedToolResult(requestId: string, reason: string): HermesToolResult {
  return { requestId, status: "denied", reason };
}

async function registerApproval(
  plan: HermesTurnPlan,
  workItem: WorkItem,
  gateway: OperationsGateway,
  turnId: string,
): Promise<HermesToolResult> {
  const proposal = plan.approvalRequest;
  if (proposal === undefined) {
    return deniedToolResult(`${turnId}:approval`, "Hermes did not provide an Approval proposal.");
  }
  const executive = plan.executive ?? workItem.accountableExecutive;
  const decision = await gateway.requestAction({
    workItemId: workItem.id,
    executive,
    trustDomain: routeTrustDomain(workItem.workstream, workItem.accountableExecutive),
    operation: "write",
    reversibility: "irreversible",
    riskClass: proposal.riskClass,
    scope: proposal.scope,
    target: proposal.target,
  });
  if (decision.kind === "approval-required") {
    return {
      requestId: `${turnId}:approval`,
      status: "completed",
      output: {
        state: "awaiting-approval",
        approvalId: decision.approvalId,
        scope: decision.scope,
        targetVersion: decision.target.version,
      },
    };
  }
  if (decision.kind === "permitted") {
    return {
      requestId: `${turnId}:approval`,
      status: "completed",
      output: { state: "permitted", basis: decision.basis },
    };
  }
  return deniedToolResult(`${turnId}:approval`, `Approval request denied (${decision.reason}).`);
}

function contextResult(request: HermesContextRequest, workItem: WorkItem | undefined, projection: HermesProjectionBroker | undefined): HermesContextResult | HermesToolResult {
  if (projection === undefined || workItem === undefined) {
    return deniedToolResult(
      `context:${request.purpose}`,
      workItem === undefined
        ? "A scoped Work Item is required before context can be served."
        : "The Projection Broker is not configured for this control plane.",
    );
  }
  const executive: ExecutiveRole = request.executive ?? workItem.accountableExecutive;
  const served = projection.serve({
    workspaceId: workItem.workspaceId,
    executive,
    workItemId: request.workItemId ?? workItem.id,
    purpose: request.purpose,
    allowedTrustDomains: request.allowedTrustDomains,
  });
  if (served.kind === "denied") {
    return deniedToolResult(`context:${request.purpose}`, `Projection denied (${served.reason}).`);
  }
  return {
    requestPurpose: request.purpose,
    sourceIdentity: served.brief.sourceIdentity,
    sourceReference: served.brief.vaultPointer,
    text: served.brief.text,
    citations: served.brief.citations,
    freshness: served.brief.freshness,
  };
}

function requiresWorkItem(plan: HermesTurnPlan): boolean {
  return plan.intent === "research" || plan.intent === "work" || plan.contextRequests.length > 0 || plan.toolRequests.length > 0;
}

async function createWorkItemIfNeeded(
  request: HermesTelegramTurnRequest,
  plan: HermesTurnPlan,
  gateway: OperationsGateway,
  turnId: string,
): Promise<WorkItem | undefined> {
  if (!requiresWorkItem(plan)) return undefined;
  const proposal = plan.workItem;
  const intent = proposal?.intent ?? request.text.trim();
  const expectedEffect = proposal?.expectedEffect ?? {
    kind: plan.intent === "research" ? "hermes-research" : "hermes-work",
    value: plan.intent === "research" ? "Produce a bounded, cited answer." : "Complete the Hermes-directed workflow.",
  };
  const accountableExecutive = proposal?.accountableExecutive ?? plan.executive;
  const action: NormalizedCeoAction = {
    actorId: request.actorId,
    workspaceId: request.workspaceId,
    idempotencyKey: `hermes:${turnId}:work-item`,
    intent,
    expectedEffect,
    ...(accountableExecutive === undefined ? {} : { accountableExecutive }),
    ...(proposal?.workstream === undefined ? {} : { workstream: proposal.workstream }),
    ...(proposal?.collaboratingExecutives === undefined ? {} : { collaboratingExecutives: proposal.collaboratingExecutives }),
  };
  const acknowledgement = await gateway.acknowledgeCeoAction(action);
  return acknowledgement.workItem;
}

function publicOverview(
  sessions: HermesSessionStore,
  model: string | undefined,
  lastFailure: string | null,
): HermesConversationOverview {
  const views = sessions.sessions();
  const latest = views[0];
  const turns = sessions.recentTurns(1);
  const last = turns[0];
  return {
    status: lastFailure === null ? "healthy" : "failed",
    model: model?.trim() || null,
    sessionCount: views.length,
    turnCount: views.reduce((total, view) => total + view.turnCount, 0),
    lastTurnAt: last?.occurredAt ?? latest?.lastTurnAt ?? null,
    lastIntent: last?.mode ?? latest?.lastIntent ?? null,
    lastWorkItemId: last?.workItemId ?? latest?.lastWorkItemId ?? null,
    lastFailure,
  };
}

export function createHermesTurnCoordinator(options: HermesTurnCoordinatorOptions): HermesTurnCoordinator {
  const now = options.now ?? (() => new Date().toISOString());
  const maxRounds = options.maxContinuationRounds ?? defaultMaxContinuationRounds;
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 8) throw new Error("Hermes continuation rounds must be between 1 and 8.");
  let lastFailure: string | null = null;

  const handle = async (request: HermesTelegramTurnRequest): Promise<HermesAnswer> => {
    const turnId = turnIdFor(request);
    const existing = options.sessions.turn(turnId);
    if (existing !== undefined) {
      const replayWorkItem = existing.workItemId === undefined || options.workItem === undefined
        ? undefined
        : options.workItem(existing.workItemId);
      return {
        kind: "hermes-answer",
        answer: existing.answer ?? "Hermes completed this turn without a user-facing answer.",
        intent: existing.mode,
        sessionId: existing.sessionId,
        turnId: existing.turnId,
        ...(replayWorkItem === undefined ? {} : { workItem: replayWorkItem }),
      };
    }

    if (detectSensitiveFields({ text: request.text }).length > 0) {
      const answer = "Sensitive Secrets cannot be accepted through Telegram.";
      const sessionId = options.sessions.sessionForTelegram(telegramReference(request.chatId)) ?? sessionIdFor(request.chatId);
      options.sessions.bindTelegramSession(telegramReference(request.chatId), sessionId, now());
      options.sessions.recordTurn({
        sessionId,
        turnId,
        updateId: request.updateId,
        textDigest: hermesTextDigest(request.text),
        mode: "clarification",
        answer,
        occurredAt: now(),
      });
      return { kind: "hermes-answer", answer, intent: "clarification", sessionId, turnId };
    }

    const reference = telegramReference(request.chatId);
    const sessionId = options.sessions.sessionForTelegram(reference) ?? sessionIdFor(request.chatId);
    options.sessions.bindTelegramSession(reference, sessionId, now());
    let workItem: WorkItem | undefined;
    let plan: HermesTurnPlan | undefined;
    let context: HermesContextResult[] = [];
    let toolResults: HermesToolResult[] = [];
    let approvalResult: HermesToolResult | undefined;
    try {
      for (let round = 0; round < maxRounds; round += 1) {
        const response = await options.runtime.turn({
          sessionId,
          turnId,
          actorId: request.actorId,
          workspaceId: request.workspaceId,
          text: request.text,
          ...(workItem === undefined ? {} : { workItemId: workItem.id }),
          ...(context.length === 0 ? {} : { context }),
          ...(toolResults.length === 0 ? {} : { toolResults }),
        });
        plan = response.plan;
        const candidate = await createWorkItemIfNeeded(request, plan, options.gateway, turnId);
        if (candidate !== undefined) workItem = workItem ?? candidate;
        context = [];
        toolResults = [];
        for (const contextRequest of plan.contextRequests) {
          const result = contextResult(contextRequest, workItem, options.projection);
          if ("requestPurpose" in result) context.push(result);
          else toolResults.push(result);
        }
        if (plan.approvalRequest !== undefined && approvalResult === undefined && workItem !== undefined) {
          approvalResult = await registerApproval(plan, workItem, options.gateway, turnId);
          toolResults.push(approvalResult);
          // requestAction may have advanced the durable Work Item to
          // Awaiting Approval. Refresh the object returned to Telegram so its
          // status never contradicts the state shown in the dashboard.
          workItem = options.workItem?.(workItem.id) ?? workItem;
        }
        for (const toolRequest of plan.toolRequests) {
          if (options.executeTool !== undefined && workItem !== undefined && !toolRequest.requiresApproval) {
            toolResults.push(await options.executeTool(toolRequest, {
              workItem,
              actorId: request.actorId,
              workspaceId: request.workspaceId,
            }));
          } else {
            toolResults.push(deniedToolResult(
              toolRequest.id,
              toolRequest.requiresApproval
                ? "Real-Ming requires an exact Approval before this tool can run."
                : "This Hermes capability has no governed executor in the current deployment.",
            ));
          }
        }
        if (context.length === 0 && toolResults.length === 0) break;
      }
      if (plan === undefined) throw new Error("Hermes returned no plan.");
      const answer = safeAnswer(plan, workItem);
      if (detectSensitiveFields({ answer }).length > 0) throw new Error("Hermes returned a Sensitive Secret.");
      options.sessions.recordTurn({
        sessionId,
        turnId,
        updateId: request.updateId,
        textDigest: hermesTextDigest(request.text),
        mode: plan.intent,
        answer,
        ...(plan.executive === undefined ? {} : { role: plan.executive }),
        ...(workItem === undefined ? {} : { workItemId: workItem.id }),
        occurredAt: now(),
      });
      lastFailure = null;
      return {
        kind: "hermes-answer",
        answer,
        intent: plan.intent,
        sessionId,
        turnId,
        ...(workItem === undefined ? {} : { workItem }),
      };
    } catch (error) {
      const answer = "Hermes is temporarily unavailable. The request was not executed; please retry shortly.";
      // The dashboard is an operator surface, not a provider log sink. Keep
      // only the typed failure class; raw errors may contain URLs, headers or
      // accidental credential material even when the adapter tried to redact.
      lastFailure = error instanceof HermesRuntimeError
        ? error.failure.class
        : "provider-error";
      options.sessions.recordTurn({
        sessionId,
        turnId,
        updateId: request.updateId,
        textDigest: hermesTextDigest(request.text),
        mode: "clarification",
        answer,
        ...(workItem === undefined ? {} : { workItemId: workItem.id }),
        occurredAt: now(),
      });
      return { kind: "hermes-answer", answer, intent: "clarification", sessionId, turnId };
    }
  };

  return Object.assign(handle, {
    overview: () => publicOverview(options.sessions, options.model, lastFailure),
    health: async () => {
      const result = await options.runtime.health();
      lastFailure = result.status === "healthy" ? null : result.failure ?? "Hermes health failed.";
      return publicOverview(options.sessions, result.model ?? options.model, lastFailure);
    },
  });
}
