import { randomUUID } from "node:crypto";

import type { OperationsGateway } from "./operations-gateway.js";
import { providerStalenessThresholdMs } from "../providers/adapter-contract.js";

/** The global monthly ceiling on metered platform spend, in MYR. */
export const globalMonthlyCostCap = "250.00";

export type CostQuality = "reported" | "estimated" | "derived";
export type CostFreshness = "current" | "stale" | "unavailable";

export interface CostObservationInput {
  readonly portfolioProjectId: string;
  readonly provider: string;
  readonly serviceOrModel: string;
  readonly period: string;
  readonly amount: string;
  readonly currency: string;
  readonly source: string;
  readonly asOf: string;
  readonly quality: CostQuality;
  /**
   * Present only so a Recurring Subscription can be recognised and turned away.
   * Metered consumption is the only thing this ledger holds.
   */
  readonly kind?: "metered" | "recurring-subscription";
}

export interface CostObservation {
  readonly id: string;
  readonly workspaceId: string;
  readonly portfolioProjectId: string;
  readonly provider: string;
  readonly serviceOrModel: string;
  readonly period: string;
  readonly amount: string;
  readonly currency: string;
  readonly source: string;
  readonly asOf: string;
  readonly quality: CostQuality;
  readonly freshness: "current" | "stale";
}

export type RecordCostObservationResult =
  | { readonly kind: "recorded"; readonly observation: CostObservation }
  | {
      readonly kind: "over-cap";
      readonly observation: CostObservation;
      readonly cap: string;
      readonly period: string;
      readonly total: string;
    }
  | {
      readonly kind: "excluded";
      readonly reason: "recurring-subscription";
      readonly sourceOfRecord: "duitsini";
    };

export interface CostGrouping {
  readonly key: string;
  readonly amount: string;
}

export interface CostGroupings {
  readonly byProject: readonly CostGrouping[];
  readonly byProvider: readonly CostGrouping[];
  readonly byServiceOrModel: readonly CostGrouping[];
  readonly total: string;
}

export type CostBudgetScope = "provider" | "project";

export interface CostBudget {
  readonly id: string;
  readonly scope: CostBudgetScope;
  readonly key: string;
  readonly amount: string;
  readonly state: "proposed" | "approved";
}

export type ModelSensitivity = "standard" | "high";

export interface ModelRoutingRequest {
  readonly sensitivity: ModelSensitivity;
  readonly requiredCapability: string;
  readonly period: string;
}

export type ModelRoutingResult =
  | {
      readonly kind: "routed";
      readonly model: string;
      readonly localOnly: boolean;
      readonly rawContextMinimized: boolean;
      readonly costDataFreshness: CostFreshness;
    }
  | { readonly kind: "refused"; readonly reason: "no-adequate-model" };

interface ModelOption {
  readonly model: string;
  readonly capabilities: readonly string[];
  readonly relativeCost: number;
  readonly localOnly: boolean;
}

/**
 * Ordered cheapest first, because the policy is adequacy rather than maximum
 * capability: routine work must not quietly buy the most expensive model.
 */
const modelOptions: readonly ModelOption[] = [
  {
    model: "lenovo-local",
    capabilities: ["summarize", "classify", "draft"],
    relativeCost: 0,
    localOnly: true,
  },
  {
    model: "claude-haiku-4-5",
    capabilities: ["summarize", "classify", "draft"],
    relativeCost: 1,
    localOnly: false,
  },
  {
    model: "claude-sonnet-5",
    capabilities: ["summarize", "classify", "draft", "reason"],
    relativeCost: 5,
    localOnly: false,
  },
  {
    model: "claude-opus-5",
    capabilities: ["summarize", "classify", "draft", "reason", "plan"],
    relativeCost: 15,
    localOnly: false,
  },
];

function addAmounts(left: string, right: string): string {
  return (Math.round((Number(left) + Number(right)) * 100) / 100).toFixed(2);
}

function grouped(
  observations: readonly CostObservation[],
  key: (observation: CostObservation) => string,
): readonly CostGrouping[] {
  const totals = new Map<string, string>();
  for (const observation of observations) {
    const identity = key(observation);
    totals.set(identity, addAmounts(totals.get(identity) ?? "0.00", observation.amount));
  }
  return [...totals.entries()]
    .map(([identity, amount]) => ({ key: identity, amount }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export interface MeteredCostLedger {
  record(input: CostObservationInput): RecordCostObservationResult;
  grouping(period: string): CostGroupings;
  proposeBudget(request: {
    readonly scope: CostBudgetScope;
    readonly key: string;
    readonly amount: string;
  }): { readonly kind: "proposed"; readonly budget: CostBudget };
  requestBudgetApproval(budgetId: string): Promise<
    | { readonly kind: "approval-required"; readonly approvalId: string }
    | { readonly kind: "refused"; readonly reason: "unknown-budget" }
  >;
  confirmBudget(budgetId: string): Promise<
    | { readonly kind: "approved"; readonly budget: CostBudget }
    | {
        readonly kind: "refused";
        readonly reason: "unknown-budget" | "approval-not-granted";
      }
  >;
  budget(scope: CostBudgetScope, key: string): CostBudget | undefined;
  route(request: ModelRoutingRequest): ModelRoutingResult;
}

export function createMeteredCostLedger(options: {
  readonly gateway: OperationsGateway;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly now: () => string;
}): MeteredCostLedger {
  const observations: CostObservation[] = [];
  const budgets = new Map<string, CostBudget>();
  const budgetWorkItems = new Map<string, string>();

  const forPeriod = (period: string): readonly CostObservation[] =>
    observations.filter((observation) => observation.period === period);

  const totalFor = (period: string): string =>
    forPeriod(period).reduce(
      (running, observation) => addAmounts(running, observation.amount),
      "0.00",
    );

  return {
    record(input): RecordCostObservationResult {
      // A paid agent-tool plan is a Recurring Subscription. Copying it here
      // would give it a second Source of Record and double-count the spend.
      if (input.kind === "recurring-subscription") {
        return {
          kind: "excluded",
          reason: "recurring-subscription",
          sourceOfRecord: "duitsini",
        };
      }
      const at = options.now();
      const observation: CostObservation = {
        id: randomUUID(),
        workspaceId: options.workspaceId,
        portfolioProjectId: input.portfolioProjectId,
        provider: input.provider,
        serviceOrModel: input.serviceOrModel,
        period: input.period,
        amount: input.amount,
        currency: input.currency,
        source: input.source,
        asOf: input.asOf,
        quality: input.quality,
        freshness:
          Date.parse(at) - Date.parse(input.asOf) > providerStalenessThresholdMs
            ? "stale"
            : "current",
      };
      observations.push(observation);

      const total = totalFor(input.period);
      // The cap reports; it does not hide. Dropping the observation would make
      // the overspend invisible, which is the opposite of what a cap is for.
      return Number(total) > Number(globalMonthlyCostCap)
        ? {
            kind: "over-cap",
            observation,
            cap: globalMonthlyCostCap,
            period: input.period,
            total,
          }
        : { kind: "recorded", observation };
    },

    grouping(period): CostGroupings {
      const scoped = forPeriod(period);
      return {
        byProject: grouped(scoped, (observation) => observation.portfolioProjectId),
        byProvider: grouped(scoped, (observation) => observation.provider),
        byServiceOrModel: grouped(scoped, (observation) => observation.serviceOrModel),
        total: totalFor(period),
      };
    },

    proposeBudget(request) {
      const budget: CostBudget = {
        id: randomUUID(),
        scope: request.scope,
        key: request.key,
        amount: request.amount,
        // Proposed, never live. A budget that took effect on an agent's say-so
        // would be the agent setting its own spending limit.
        state: "proposed",
      };
      budgets.set(budget.id, budget);
      return { kind: "proposed", budget };
    },

    async requestBudgetApproval(budgetId) {
      const budget = budgets.get(budgetId);
      if (budget === undefined) return { kind: "refused", reason: "unknown-budget" };
      const acknowledgement = await options.gateway.acknowledgeCeoAction({
        actorId: options.actorId,
        workspaceId: options.workspaceId,
        idempotencyKey: `cost-budget:${budget.id}`,
        intent: `Approve ${budget.scope} budget for ${budget.key}`,
        expectedEffect: {
          kind: "cost-budget",
          value: `${budget.scope}=${budget.key} amount=${budget.amount}`,
        },
        workstream: "Finance",
      });
      budgetWorkItems.set(budget.id, acknowledgement.workItem.id);
      const decision = await options.gateway.requestAction({
        workItemId: acknowledgement.workItem.id,
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "financial-record-change",
        target: {
          type: "cost-budget",
          identity: `${budget.scope}:${budget.key}`,
          version: budget.amount,
        },
      });
      return decision.kind === "approval-required"
        ? { kind: "approval-required", approvalId: decision.approvalId }
        : { kind: "refused", reason: "unknown-budget" };
    },

    async confirmBudget(budgetId) {
      const budget = budgets.get(budgetId);
      const workItemId = budgetWorkItems.get(budgetId);
      if (budget === undefined || workItemId === undefined) {
        return { kind: "refused", reason: "unknown-budget" };
      }
      const decision = await options.gateway.requestAction({
        workItemId,
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        reversibility: "reversible",
        riskClass: "medium",
        scope: "financial-record-change",
        target: {
          type: "cost-budget",
          identity: `${budget.scope}:${budget.key}`,
          version: budget.amount,
        },
      });
      if (decision.kind !== "permitted") {
        return { kind: "refused", reason: "approval-not-granted" };
      }
      const approved: CostBudget = { ...budget, state: "approved" };
      budgets.set(budget.id, approved);
      return { kind: "approved", budget: approved };
    },

    budget: (scope, key) =>
      [...budgets.values()].find(
        (candidate) => candidate.scope === scope && candidate.key === key,
      ),

    route(request): ModelRoutingResult {
      const scoped = forPeriod(request.period);
      const costDataFreshness: CostFreshness =
        scoped.length === 0
          ? "unavailable"
          : scoped.every((observation) => observation.freshness === "current")
            ? "current"
            : "stale";

      // High-sensitivity work stays on the local worker, so raw context never
      // reaches a metered provider in the first place.
      const candidates = modelOptions.filter(
        (option) =>
          option.capabilities.includes(request.requiredCapability) &&
          (request.sensitivity !== "high" || option.localOnly),
      );
      const chosen = candidates
        .filter((option) => request.sensitivity === "high" || !option.localOnly)
        .sort((left, right) => left.relativeCost - right.relativeCost)[0];
      if (chosen === undefined) {
        return { kind: "refused", reason: "no-adequate-model" };
      }
      return {
        kind: "routed",
        model: chosen.model,
        localOnly: chosen.localOnly,
        rawContextMinimized: request.sensitivity === "high",
        costDataFreshness,
      };
    },
  };
}
