import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { FinancialExportSource } from "../../src/operations/financial-reconciliation.js";

const now = "2026-09-03T05:00:00.000Z";

describe("RM-35 Moomoo and Money Manager reconciliation", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const moomoo: FinancialExportSource = {
    kind: "moomoo-holdings",
    sourceReference: "moomoo:export:2026-09-02.csv",
    asOf: "2026-09-02T16:00:00.000Z",
    rows: [
      { identity: "TSLA", quantity: "10", value: "3200.00", currency: "USD" },
      { identity: "VOO", quantity: "5", value: "2600.00", currency: "USD" },
    ],
  };

  const moneyManager: FinancialExportSource = {
    kind: "money-manager-activity",
    sourceReference: "money-manager:export:2026-09-02.xlsx",
    asOf: "2026-09-02T16:30:00.000Z",
    rows: [
      { identity: "TSLA", quantity: "10", value: "3200.00", currency: "USD" },
      { identity: "VOO", quantity: "5", value: "2550.00", currency: "USD" },
      { identity: "BTC", quantity: "0.1", value: "6000.00", currency: "USD" },
    ],
  };

  function start(
    sources: readonly FinancialExportSource[] = [moomoo, moneyManager],
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm35-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      financialExports: { sources },
    });
    harnesses.push(harness);
    return harness;
  }

  it("ingests both exports with their source and as-of time", async () => {
    const harness = start();

    const result = await harness.reconcileFinancialExports();

    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;
    expect(result.sources).toEqual([
      {
        kind: "moomoo-holdings",
        sourceReference: "moomoo:export:2026-09-02.csv",
        asOf: "2026-09-02T16:00:00.000Z",
        rowCount: 2,
        freshness: "current",
      },
      {
        kind: "money-manager-activity",
        sourceReference: "money-manager:export:2026-09-02.xlsx",
        asOf: "2026-09-02T16:30:00.000Z",
        rowCount: 3,
        freshness: "current",
      },
    ]);
  });

  it("reports conflicting and missing lines instead of assuming completeness", async () => {
    const harness = start();

    const result = await harness.reconcileFinancialExports();

    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;
    // VOO values disagree; BTC exists only in Money Manager. Neither is silently
    // resolved, because only Ming knows which side is right.
    expect(result.conflicts).toEqual([
      {
        identity: "VOO",
        field: "value",
        moomoo: "2600.00",
        moneyManager: "2550.00",
      },
    ]);
    expect(result.missing).toEqual([
      { identity: "BTC", absentFrom: "moomoo-holdings" },
    ]);
    expect(result.agreed.map((line) => line.identity)).toEqual(["TSLA"]);
  });

  it("labels a stale export rather than reconciling it as current", async () => {
    const harness = start([
      { ...moomoo, asOf: "2026-07-01T16:00:00.000Z" },
      moneyManager,
    ]);

    const result = await harness.reconcileFinancialExports();

    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;
    expect(result.sources[0]?.freshness).toBe("stale");
    expect(result.staleSources).toEqual(["moomoo:export:2026-09-02.csv"]);
  });

  it("reports an unsupported export rather than guessing at its shape", async () => {
    const harness = start([
      moomoo,
      moneyManager,
      {
        kind: "unsupported",
        sourceReference: "moomoo:opend:live-feed",
        asOf: now,
        rows: [],
      },
    ]);

    const result = await harness.reconcileFinancialExports();

    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;
    expect(result.unsupported).toEqual(["moomoo:opend:live-feed"]);
  });

  it("reports a missing export instead of reconciling one side alone", async () => {
    const harness = start([moomoo]);

    const result = await harness.reconcileFinancialExports();

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "money-manager-activity-missing",
    });
  });

  it("introduces no brokerage, OpenD, or Money Movement capability", async () => {
    const harness = start();
    const result = await harness.reconcileFinancialExports();
    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;

    const decision = await harness.requestAction({
      workItemId: result.workItem.id,
      executive: "Personal CFO",
      trustDomain: "Finance",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      capability: "brokerage-trading",
    });

    expect(decision).toMatchObject({
      kind: "denied",
      reason: "capability-not-grantable",
    });
  });

  it("keeps raw rows in Finance and gives the CEO a reviewable projection", async () => {
    const harness = start();

    const result = await harness.reconcileFinancialExports();

    expect(result.kind).toBe("reconciled");
    if (result.kind !== "reconciled") return;
    expect(result.workItem.workstream).toBe("Finance");
    expect(result.workItem.accountableExecutive).toBe("Personal CFO");
    expect(result.ceoProjection).toMatchObject({
      kind: "approved-projection",
      agreedCount: 1,
      conflictCount: 1,
      missingCount: 1,
    });
    // The projection counts and cites; it never carries the holdings.
    const serialized = JSON.stringify(result.ceoProjection);
    expect(serialized).not.toContain("3200.00");
    expect(serialized).not.toContain("TSLA");
    expect(result.ceoProjection.evidence).toEqual([
      "moomoo:export:2026-09-02.csv",
      "money-manager:export:2026-09-02.xlsx",
    ]);
    expect(
      JSON.stringify(
        harness.dashboardOverview({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        }),
      ),
    ).not.toContain("3200.00");
  });
});
