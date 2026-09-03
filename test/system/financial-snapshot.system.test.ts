import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const now = "2026-09-03T06:00:00.000Z";

describe("RM-36 immutable Financial Snapshot successor", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function start(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm36-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    });
    harnesses.push(harness);
    return harness;
  }

  const inputs = {
    period: "2026-09",
    sourceExports: [
      "moomoo:export:2026-09-02.csv",
      "money-manager:export:2026-09-02.xlsx",
    ],
    reconciliationReference: "reconciliation:2026-09-02",
    workbook: "net-worth=104200.00;cash=8200.00",
  };

  async function prepared(harness: RealMingSystemHarness) {
    return harness.prepareFinancialSnapshot(inputs);
  }

  it("creates a successor and preserves the predecessor workbook", async () => {
    const harness = start();
    const first = await prepared(harness);
    expect(first.kind).toBe("prepared");
    if (first.kind !== "prepared") return;

    const successor = await harness.prepareFinancialSnapshot({
      ...inputs,
      workbook: "net-worth=104900.00;cash=8200.00",
      supersedes: first.snapshot.id,
    });

    expect(successor.kind).toBe("prepared");
    if (successor.kind !== "prepared") return;
    expect(successor.snapshot.version).toBe(2);
    expect(successor.snapshot.supersedes).toBe(first.snapshot.id);
    // The original is still readable, byte for byte.
    const original = harness.financialSnapshot(first.snapshot.id);
    expect(original?.workbook).toBe(inputs.workbook);
    expect(original?.state).toBe("superseded");
    expect(harness.financialSnapshots()).toHaveLength(2);
  });

  it("lets the CTO prepare without declaring the result validated", async () => {
    const harness = start();

    const first = await prepared(harness);

    expect(first.kind).toBe("prepared");
    if (first.kind !== "prepared") return;
    expect(first.snapshot.preparedBy).toBe("CTO");
    expect(first.snapshot.validatedBy).toBeNull();
    expect(first.snapshot.state).toBe("prepared");
  });

  it("refuses to present an unvalidated snapshot to the CEO", async () => {
    const harness = start();
    const first = await prepared(harness);
    if (first.kind !== "prepared") throw new Error("expected prepared");

    const presented = await harness.requestFinancialSnapshotApproval(
      first.snapshot.id,
    );

    expect(presented).toMatchObject({
      kind: "refused",
      reason: "not-validated-by-personal-cfo",
    });
  });

  it("requires the Personal CFO to validate before CEO Approval is sought", async () => {
    const harness = start();
    const first = await prepared(harness);
    if (first.kind !== "prepared") throw new Error("expected prepared");

    const validated = harness.validateFinancialSnapshot({
      snapshotId: first.snapshot.id,
      reconciliationReference: inputs.reconciliationReference,
    });
    expect(validated.kind).toBe("validated");
    const presented = await harness.requestFinancialSnapshotApproval(
      first.snapshot.id,
    );

    expect(presented.kind).toBe("approval-required");
    expect(harness.financialSnapshot(first.snapshot.id)?.validatedBy).toBe(
      "Personal CFO",
    );
  });

  it("binds CEO Approval to the exact digest and invalidates it on any later change", async () => {
    const harness = start();
    const first = await prepared(harness);
    if (first.kind !== "prepared") throw new Error("expected prepared");
    harness.validateFinancialSnapshot({
      snapshotId: first.snapshot.id,
      reconciliationReference: inputs.reconciliationReference,
    });
    const presented = await harness.requestFinancialSnapshotApproval(
      first.snapshot.id,
    );
    if (presented.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: presented.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const completed = await harness.completeFinancialSnapshot(first.snapshot.id);
    expect(completed.kind).toBe("approved");
    if (completed.kind !== "approved") return;
    expect(completed.snapshot.digest).toBe(first.snapshot.digest);

    // A successor is a different artifact; the earlier Approval does not travel.
    const successor = await harness.prepareFinancialSnapshot({
      ...inputs,
      workbook: "net-worth=999999.00;cash=8200.00",
      supersedes: first.snapshot.id,
    });
    if (successor.kind !== "prepared") throw new Error("expected prepared");
    harness.validateFinancialSnapshot({
      snapshotId: successor.snapshot.id,
      reconciliationReference: inputs.reconciliationReference,
    });
    const again = await harness.requestFinancialSnapshotApproval(
      successor.snapshot.id,
    );

    expect(again.kind).toBe("approval-required");
    expect(successor.snapshot.digest).not.toBe(first.snapshot.digest);
  });

  it("links every input, the validation, the Approval and the predecessor", async () => {
    const harness = start();
    const first = await prepared(harness);
    if (first.kind !== "prepared") throw new Error("expected prepared");
    harness.validateFinancialSnapshot({
      snapshotId: first.snapshot.id,
      reconciliationReference: inputs.reconciliationReference,
    });
    const presented = await harness.requestFinancialSnapshotApproval(
      first.snapshot.id,
    );
    if (presented.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: presented.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });
    const completed = await harness.completeFinancialSnapshot(first.snapshot.id);
    if (completed.kind !== "approved") throw new Error("expected approved");

    const report = harness.outcomeReport(completed.workItem.id);
    const value = report?.completedEffect.value ?? "";
    expect(value).toContain("moomoo:export:2026-09-02.csv");
    expect(value).toContain("money-manager:export:2026-09-02.xlsx");
    expect(value).toContain("reconciliation:2026-09-02");
    expect(value).toContain("Personal CFO");
    expect(value).toContain("supersedes=none");
    // The Approval is linked by the exact digest it was granted against, which
    // is the binding itself rather than an id copied into a string.
    expect(value).toContain(first.snapshot.digest);
    const approval = harness
      .approvals(completed.workItem.id)
      .find((granted) => granted.id === presented.approvalId);
    expect(approval?.targetVersion).toBe(first.snapshot.digest);
    expect(approval?.targetIdentity).toBe(first.snapshot.id);
    // The workbook figures themselves stay in Finance.
    expect(value).not.toContain("104200.00");
  });
});
