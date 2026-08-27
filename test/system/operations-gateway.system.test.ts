import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-01 Operations Gateway", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const temporaryDirectories: string[] = [];

  async function startHarness(
    overrides: Omit<
      Parameters<typeof createRealMingSystemHarness>[0],
      "statePath"
    > = {},
  ): Promise<{ harness: RealMingSystemHarness; statePath: string }> {
    const directory = await mkdtemp(join(tmpdir(), "real-ming-rm-01-"));
    const statePath = join(directory, "operations.sqlite");
    const harness = createRealMingSystemHarness({ statePath, ...overrides });
    temporaryDirectories.push(directory);
    harnesses.push(harness);
    return { harness, statePath };
  }

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }

    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records one CEO action as one durable, verified Work Item with an Outcome Report and audit trail", async () => {
    const { harness, statePath } = await startHarness();

    const result = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:update-task:2026-08-27T09:00:00+08:00",
      intent: "Update the Daily Operations tracer status",
      expectedEffect: {
        kind: "record-note",
        value: "Daily Operations tracer started",
      },
    });

    expect(result.workItem).toMatchObject({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      state: "Ready for CEO Review",
    });
    expect(result.outcomeReport).toMatchObject({
      workItemId: result.workItem.id,
      requestedIntent: "Update the Daily Operations tracer status",
      verification: {
        status: "verified",
      },
      remainingRisks: [],
      requiredDecisions: ["CEO review required before completion."],
    });
    expect(harness.controlledEffects()).toEqual([
      {
        workItemId: result.workItem.id,
        executive: "COO",
        authority: "accountable",
        idempotencyKey:
          "workspace:real-ming:telegram:update-task:2026-08-27T09:00:00+08:00:effect",
        kind: "record-note",
        value: "Daily Operations tracer started",
      },
    ]);
    expect(harness.auditTrail(result.workItem.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.executing",
      "worker.effect-recorded",
      "work-item.verifying",
      "worker.effect-verified",
      "outcome-report.recorded",
      "work-item.ready-for-ceo-review",
    ]);

    harness.close();
    harnesses.splice(harnesses.indexOf(harness), 1);

    const reopenedHarness = createRealMingSystemHarness({
      statePath,
    });
    harnesses.push(reopenedHarness);

    expect(reopenedHarness.workItem(result.workItem.id)).toEqual(result.workItem);
    expect(reopenedHarness.outcomeReport(result.workItem.id)).toEqual(
      result.outcomeReport,
    );
    expect(reopenedHarness.auditTrail(result.workItem.id)).toHaveLength(7);
  });

  it("returns the existing result when the same command idempotency key is repeated", async () => {
    const { harness } = await startHarness();

    const action = {
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:duplicate-safe-command",
      intent: "Record this effect once",
      expectedEffect: {
        kind: "record-note",
        value: "One controlled effect",
      },
    } as const;

    const first = await harness.submitCeoAction(action);
    const repeated = await harness.submitCeoAction(action);

    expect(repeated).toEqual(first);
    expect(harness.workItems()).toEqual([first.workItem]);
    expect(harness.controlledEffects()).toHaveLength(1);
    expect(harness.auditTrail(first.workItem.id)).toHaveLength(7);
  });

  it("does not complete a Work Item when the expected worker effect cannot be verified", async () => {
    const sensitiveSecret = "verification-secret-must-not-persist";

    const { harness } = await startHarness({
      controlledVerifier: {
        result: "error",
        errorMessage: `Verifier rejected ${sensitiveSecret}`,
      },
    });

    await expect(
      harness.submitCeoAction({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:unverified-effect",
        intent: "Attempt one controlled effect",
        expectedEffect: {
          kind: "record-note",
          value: "Effect requiring verification",
        },
      }),
    ).rejects.toThrow("Controlled work could not be verified.");

    const [workItem] = harness.workItems();
    expect(workItem).toMatchObject({ state: "Waiting/Blocked" });
    expect(harness.outcomeReport(workItem!.id)).toBeUndefined();
    const durableEvidence = JSON.stringify({
      workItem,
      audit: harness.auditTrail(workItem!.id),
    });
    expect(durableEvidence).not.toContain(sensitiveSecret);
    expect(harness.auditTrail(workItem!.id).map((event) => event.type)).toEqual(
      [
        "work-item.captured",
        "work-item.executing",
        "worker.effect-recorded",
        "work-item.verifying",
        "worker.effect-verification-failed",
        "work-item.waiting-blocked",
      ],
    );
  });

  it("keeps worker failures and audit evidence free of Sensitive Secrets", async () => {
    const sensitiveSecret = "sensitive-error-fixture-must-never-persist";

    const { harness } = await startHarness({
      controlledWorker: {
        executionError: `Provider rejected ${sensitiveSecret}`,
      },
    });

    let observedError: unknown;
    try {
      await harness.submitCeoAction({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:secret-safe-failure",
        intent: "Exercise the controlled worker failure path",
        expectedEffect: {
          kind: "record-note",
          value: "This effect will fail safely",
        },
      });
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toEqual(
      new Error("Controlled work failed before verification."),
    );
    expect(String(observedError)).not.toContain(sensitiveSecret);

    const [workItem] = harness.workItems();
    expect(workItem).toMatchObject({ state: "Waiting/Blocked" });
    const durableEvidence = JSON.stringify({
      workItem,
      audit: harness.auditTrail(workItem!.id),
    });
    expect(durableEvidence).not.toContain(sensitiveSecret);
    expect(harness.auditTrail(workItem!.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.executing",
      "worker.effect-failed",
      "work-item.waiting-blocked",
    ]);
  });

  it("does not persist untrusted worker evidence payloads", async () => {
    const sensitiveSecret = "receipt-secret-must-not-persist";

    const { harness } = await startHarness({
      controlledWorker: {
        receiptEvidence: {
          debug: `Untrusted provider payload ${sensitiveSecret}`,
        },
      },
    });

    const result = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:untrusted-worker-evidence",
      intent: "Keep untrusted evidence out of durable state",
      expectedEffect: {
        kind: "record-note",
        value: "Verified controlled effect",
      },
    });

    expect(JSON.stringify(harness.controlledReceipts())).toContain(
      sensitiveSecret,
    );
    const durableEvidence = JSON.stringify({
      workItem: result.workItem,
      outcomeReport: result.outcomeReport,
      audit: harness.auditTrail(result.workItem.id),
    });
    expect(durableEvidence).not.toContain(sensitiveSecret);
  });

  it("does not persist untrusted verifier evidence payloads", async () => {
    const sensitiveSecret = "verifier-evidence-secret-must-not-persist";
    const { harness } = await startHarness({
      controlledVerifier: {
        result: "verify",
        evidence: {
          debug: `Untrusted verifier payload ${sensitiveSecret}`,
        },
      },
    });

    const result = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:untrusted-verifier-evidence",
      intent: "Keep verifier payloads out of durable state",
      expectedEffect: {
        kind: "record-note",
        value: "Independently verified controlled effect",
      },
    });

    expect(JSON.stringify(harness.controlledVerificationResults())).toContain(
      sensitiveSecret,
    );
    const durableEvidence = JSON.stringify({
      outcomeReport: result.outcomeReport,
      audit: harness.auditTrail(result.workItem.id),
    });
    expect(durableEvidence).not.toContain(sensitiveSecret);
    expect(result.outcomeReport.verification).toEqual({
      status: "verified",
      evidence: {
        kind: "controlled-effect-reference",
        reference:
          "workspace:real-ming:telegram:untrusted-verifier-evidence:effect",
      },
    });
  });
});
