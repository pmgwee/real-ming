import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { CostObservationInput } from "../../src/operations/metered-cost.js";

const now = "2026-09-03T07:00:00.000Z";

describe("RM-37 Metered Platform Cost and model routing", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function start(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm37-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    });
    harnesses.push(harness);
    return harness;
  }

  const observation: CostObservationInput = {
    portfolioProjectId: "project:duitsini",
    provider: "anthropic",
    serviceOrModel: "claude-opus-5",
    period: "2026-09",
    amount: "42.50",
    currency: "MYR",
    source: "anthropic:usage-export:2026-09-02",
    asOf: "2026-09-02T23:00:00.000Z",
    quality: "reported",
  };

  it("records every attribute a cost observation must carry", () => {
    const harness = start();

    const recorded = harness.recordCostObservation(observation);

    expect(recorded.kind).toBe("recorded");
    if (recorded.kind !== "recorded") return;
    expect(recorded.observation).toMatchObject({
      workspaceId: "workspace:real-ming",
      portfolioProjectId: "project:duitsini",
      provider: "anthropic",
      serviceOrModel: "claude-opus-5",
      period: "2026-09",
      amount: "42.50",
      currency: "MYR",
      source: "anthropic:usage-export:2026-09-02",
      asOf: "2026-09-02T23:00:00.000Z",
      quality: "reported",
      freshness: "current",
    });
  });

  it("groups observations by project, provider, model and period", () => {
    const harness = start();
    harness.recordCostObservation(observation);
    harness.recordCostObservation({
      ...observation,
      serviceOrModel: "claude-haiku-4-5",
      amount: "7.50",
    });
    harness.recordCostObservation({
      ...observation,
      portfolioProjectId: "project:real-ming",
      amount: "10.00",
    });

    const grouped = harness.costByGrouping("2026-09");

    expect(grouped.byProject).toEqual([
      { key: "project:duitsini", amount: "50.00" },
      { key: "project:real-ming", amount: "10.00" },
    ]);
    expect(grouped.byProvider).toEqual([{ key: "anthropic", amount: "60.00" }]);
    expect(grouped.byServiceOrModel).toEqual([
      { key: "claude-haiku-4-5", amount: "7.50" },
      { key: "claude-opus-5", amount: "52.50" },
    ]);
    expect(grouped.total).toBe("60.00");
  });

  it("enforces the global monthly cap", () => {
    const harness = start();
    harness.recordCostObservation({ ...observation, amount: "240.00" });

    const overCap = harness.recordCostObservation({
      ...observation,
      serviceOrModel: "claude-sonnet-5",
      amount: "20.00",
    });

    expect(overCap).toMatchObject({
      kind: "over-cap",
      cap: "250.00",
      period: "2026-09",
    });
    // The observation is still recorded; the cap reports, it does not hide spend.
    expect(harness.costByGrouping("2026-09").total).toBe("260.00");
  });

  it("keeps a provider or project budget a proposal until the CEO approves it", async () => {
    const harness = start();

    const proposed = harness.proposeCostBudget({
      scope: "provider",
      key: "anthropic",
      amount: "100.00",
    });
    expect(proposed.kind).toBe("proposed");
    if (proposed.kind !== "proposed") return;
    expect(harness.costBudget("provider", "anthropic")?.state).toBe("proposed");

    const requested = await harness.requestCostBudgetApproval(proposed.budget.id);
    if (requested.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });
    const confirmed = await harness.confirmCostBudget(proposed.budget.id);

    expect(confirmed.kind).toBe("approved");
    expect(harness.costBudget("provider", "anthropic")?.state).toBe("approved");
  });

  it("excludes Recurring Subscriptions and points at DuitSini instead", () => {
    const harness = start();

    const refused = harness.recordCostObservation({
      ...observation,
      provider: "openai",
      serviceOrModel: "ChatGPT Plus",
      kind: "recurring-subscription",
    });

    expect(refused).toMatchObject({
      kind: "excluded",
      reason: "recurring-subscription",
      sourceOfRecord: "duitsini",
    });
    expect(harness.costByGrouping("2026-09").total).toBe("0.00");
  });

  it("routes model work to an adequate option under sensitivity and capability", () => {
    const harness = start();

    const routine = harness.routeModelWork({
      sensitivity: "standard",
      requiredCapability: "summarize",
      period: "2026-09",
    });
    const sensitive = harness.routeModelWork({
      sensitivity: "high",
      requiredCapability: "summarize",
      period: "2026-09",
    });

    expect(routine.kind).toBe("routed");
    if (routine.kind !== "routed") return;
    // Adequate, not maximal: routine work does not buy the most expensive model.
    expect(routine.model).toBe("claude-haiku-4-5");

    expect(sensitive.kind).toBe("routed");
    if (sensitive.kind !== "routed") return;
    expect(sensitive.localOnly).toBe(true);
    expect(sensitive.rawContextMinimized).toBe(true);
  });

  it("refuses high-sensitivity work the local worker cannot do", () => {
    // "plan" exists only on a metered model. Routing there would send raw
    // high-sensitivity context off the laptop, so the answer is no rather than
    // a more capable provider.
    const harness = start();

    const refused = harness.routeModelWork({
      sensitivity: "high",
      requiredCapability: "plan",
      period: "2026-09",
    });

    expect(refused).toMatchObject({ kind: "refused", reason: "no-adequate-model" });
  });

  it("reports stale cost data rather than routing as though it were current", () => {
    const harness = start();
    harness.recordCostObservation({
      ...observation,
      asOf: "2026-07-01T23:00:00.000Z",
    });

    const routed = harness.routeModelWork({
      sensitivity: "standard",
      requiredCapability: "summarize",
      period: "2026-09",
    });

    expect(routed.kind).toBe("routed");
    if (routed.kind !== "routed") return;
    expect(routed.costDataFreshness).toBe("stale");
  });

  it("reports unavailable cost data when the period has no observation", () => {
    const harness = start();

    const routed = harness.routeModelWork({
      sensitivity: "standard",
      requiredCapability: "summarize",
      period: "2026-09",
    });

    expect(routed.kind).toBe("routed");
    if (routed.kind !== "routed") return;
    expect(routed.costDataFreshness).toBe("unavailable");
  });
});
