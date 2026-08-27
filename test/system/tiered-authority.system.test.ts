import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type {
  ApprovalScope,
  RequestedAction,
} from "../../src/operations/contracts.js";

describe("RM-04 tiered authority and exact Approvals", () => {
  const harnesses: RealMingSystemHarness[] = [];
  let clock = "2026-08-27T09:00:00.000Z";

  function startHarness(): RealMingSystemHarness {
    clock = "2026-08-27T09:00:00.000Z";
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => clock,
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    idempotencyKey: string,
  ) {
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey,
      text: "Perform one bounded authority-checked action",
      expectedEffect: {
        kind: "record-note",
        value: `Authority outcome for ${idempotencyKey}`,
      },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    return acknowledgement.workItem;
  }

  function action(
    workItemId: string,
    overrides: Partial<RequestedAction> = {},
  ): RequestedAction {
    return {
      workItemId,
      executive: "CTO",
      trustDomain: "Ming Creatives",
      operation: "read",
      reversibility: "reversible",
      riskClass: "low",
      ...overrides,
    } as RequestedAction;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it.each([
    "read",
    "monitor",
    "classify",
    "summarize",
    "draft",
  ] as const)("permits %s work on the automatic baseline", async (operation) => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, `telegram:baseline:${operation}`);

    const decision = await harness.requestAction(
      action(workItem.id, { operation }),
    );

    expect(decision).toMatchObject({
      kind: "permitted",
      basis: "automatic-baseline",
    });
    expect(harness.workItem(workItem.id)?.state).toBe("Captured");
    expect(harness.auditTrail(workItem.id).at(-1)).toMatchObject({
      type: "policy.permitted",
      details: { basis: "automatic-baseline", operation },
    });
  });

  it("stops a reversible low-risk write without a matching Standing Authority", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:standing:missing");

    const decision = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        scope: "financial-record-change",
        target: {
          type: "duitsini-subscription",
          identity: "subscription:netflix",
          version: "sha256:aaa",
        },
      }),
    );

    expect(decision.kind).toBe("approval-required");
    expect(harness.workItem(workItem.id)?.state).toBe("Awaiting Approval");
  });

  it("permits a reversible low-risk write under a matching unexpired Standing Authority", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:standing:granted");

    const standingAuthority = await harness.grantStandingAuthority({
      actorId: "ceo:ming",
      executive: "Personal CFO",
      trustDomain: "Finance",
      targetType: "duitsini-subscription",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    const decision = await harness.requestAction(
      action(workItem.id, {
        executive: "Personal CFO",
        trustDomain: "Finance",
        operation: "write",
        scope: "financial-record-change",
        target: {
          type: "duitsini-subscription",
          identity: "subscription:netflix",
          version: "sha256:aaa",
        },
      }),
    );

    expect(decision).toMatchObject({
      kind: "permitted",
      basis: "standing-authority",
      standingAuthorityId: standingAuthority.id,
    });
    expect(harness.workItem(workItem.id)?.state).toBe("Captured");
  });

  it.each([
    [
      "expired",
      { expiresAt: "2026-08-01T00:00:00.000Z" },
      "standing-authority-expired",
    ],
    [
      "another Executive Role",
      { executive: "CMO" as const },
      "standing-authority-required",
    ],
    [
      "another Trust Domain",
      { trustDomain: "Academic" as const },
      "standing-authority-required",
    ],
    [
      "another target type",
      { targetType: "notion-page" },
      "standing-authority-required",
    ],
  ])(
    "does not let a Standing Authority for %s permit the write",
    async (_label, grantOverrides, expectedReason) => {
      const harness = startHarness();
      const workItem = await captureWorkItem(
        harness,
        `telegram:standing:${expectedReason}:${_label}`,
      );

      await harness.grantStandingAuthority({
        actorId: "ceo:ming",
        executive: "Personal CFO",
        trustDomain: "Finance",
        targetType: "duitsini-subscription",
        expiresAt: "2026-12-31T00:00:00.000Z",
        ...grantOverrides,
      });

      const decision = await harness.requestAction(
        action(workItem.id, {
          executive: "Personal CFO",
          trustDomain: "Finance",
          operation: "write",
          scope: "financial-record-change",
          target: {
            type: "duitsini-subscription",
            identity: "subscription:netflix",
            version: "sha256:aaa",
          },
        }),
      );

      expect(decision).toMatchObject({
        kind: "approval-required",
        reason: expectedReason,
      });
      expect(harness.workItem(workItem.id)?.state).toBe("Awaiting Approval");
    },
  );

  it("stops a consequential action at Awaiting Approval with an exact, expiring target record", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:request");

    const decision = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target: {
          type: "pull-request",
          identity: "pmgwee/duitsini#42",
          version: "commit:9f1c2ab",
        },
      }),
    );

    expect(decision).toMatchObject({
      kind: "approval-required",
      scope: "code-promotion",
      target: {
        type: "pull-request",
        identity: "pmgwee/duitsini#42",
        version: "commit:9f1c2ab",
      },
      riskClass: "high",
    });
    expect(harness.workItem(workItem.id)?.state).toBe("Awaiting Approval");

    if (decision.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }
    const pending = harness.approval(decision.approvalId);
    expect(pending).toMatchObject({
      workItemId: workItem.id,
      scope: "code-promotion",
      targetType: "pull-request",
      targetIdentity: "pmgwee/duitsini#42",
      targetVersion: "commit:9f1c2ab",
      riskClass: "high",
      requestedAt: "2026-08-27T09:00:00.000Z",
      state: "requested",
    });

    expect(harness.auditTrail(workItem.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.triaged",
      "work-item.planned",
      "work-item.awaiting-approval",
      "approval.requested",
    ]);
  });

  it("lets the CEO grant an Approval and then permits the exact target", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:grant");
    const promotion = action(workItem.id, {
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: {
        type: "pull-request",
        identity: "pmgwee/duitsini#42",
        version: "commit:9f1c2ab",
      },
    });

    const requested = await harness.requestAction(promotion);
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }

    const approval = await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    expect(approval).toMatchObject({
      state: "granted",
      actorId: "ceo:ming",
      decidedAt: "2026-08-27T09:00:00.000Z",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    const permitted = await harness.requestAction(promotion);
    expect(permitted).toMatchObject({
      kind: "permitted",
      basis: "approval",
      approvalId: approval.id,
    });
  });

  it("refuses to grant an Approval to anyone other than the CEO", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:non-ceo");
    const requested = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "external-communication",
        target: {
          type: "email",
          identity: "thread:opportunity-42",
          version: "sha256:body-v1",
        },
      }),
    );
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }

    await expect(
      harness.grantApproval({
        approvalId: requested.approvalId,
        actorId: "executive:CTO",
        expiresAt: "2026-08-27T21:00:00.000Z",
      }),
    ).rejects.toThrow("Only the CEO may grant an Approval.");
    expect(harness.approval(requested.approvalId)?.state).toBe("requested");
  });

  it("invalidates an Approval when its target version changes", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:stale");
    const target = {
      type: "pull-request",
      identity: "pmgwee/duitsini#42",
      version: "commit:9f1c2ab",
    } as const;
    const promotion = action(workItem.id, {
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target,
    });

    const requested = await harness.requestAction(promotion);
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }
    const approval = await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    const movedTarget = await harness.requestAction({
      ...promotion,
      target: { ...target, version: "commit:deadbee" },
    });

    expect(movedTarget.kind).toBe("approval-required");
    expect(harness.approval(approval.id)?.state).toBe("invalidated");
    expect(
      harness
        .auditTrail(workItem.id)
        .filter((event) => event.type === "approval.invalidated"),
    ).toMatchObject([
      {
        details: {
          approvalId: approval.id,
          reason: "target-changed",
          approvedVersion: "commit:9f1c2ab",
          requestedVersion: "commit:deadbee",
        },
      },
    ]);
  });

  it("stops honouring an Approval after it expires", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:expired");
    const promotion = action(workItem.id, {
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: {
        type: "pull-request",
        identity: "pmgwee/duitsini#42",
        version: "commit:9f1c2ab",
      },
    });

    const requested = await harness.requestAction(promotion);
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }
    const approval = await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T10:00:00.000Z",
    });

    clock = "2026-08-27T11:00:00.000Z";
    const afterExpiry = await harness.requestAction(promotion);

    expect(afterExpiry).toMatchObject({
      kind: "approval-required",
      reason: "approval-expired",
    });
    expect(harness.approval(approval.id)?.state).toBe("expired");
  });

  const scopes: readonly ApprovalScope[] = [
    "code-promotion",
    "database-migration",
    "production-data-change",
    "external-communication",
    "destructive-action",
    "permission-change",
    "purchase",
    "financial-record-change",
  ];

  it("keeps every Approval scope separate for the same exact target", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:scopes");
    const target = {
      type: "pull-request",
      identity: "pmgwee/duitsini#42",
      version: "commit:9f1c2ab",
    } as const;

    const requested = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target,
      }),
    );
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    for (const scope of scopes.filter((entry) => entry !== "code-promotion")) {
      const other = await harness.requestAction(
        action(workItem.id, {
          operation: "write",
          reversibility: "irreversible",
          riskClass: "high",
          scope,
          target,
        }),
      );

      expect(other).toMatchObject({ kind: "approval-required", scope });
    }
  });

  it.each(["money-movement", "brokerage-trading"] as const)(
    "denies %s with no grantable capability",
    async (capability) => {
      const harness = startHarness();
      const workItem = await captureWorkItem(
        harness,
        `telegram:prohibited:${capability}`,
      );

      const decision = await harness.requestAction(
        action(workItem.id, {
          executive: "Personal CFO",
          trustDomain: "Finance",
          operation: "write",
          reversibility: "irreversible",
          riskClass: "high",
          capability,
          target: {
            type: "bank-transfer",
            identity: "transfer:rm-500",
            version: "sha256:bbb",
          },
        }),
      );

      expect(decision).toMatchObject({
        kind: "denied",
        reason: "capability-not-grantable",
      });
      expect(harness.workItem(workItem.id)?.state).toBe("Captured");
      expect(harness.approvals(workItem.id)).toEqual([]);
      expect(harness.auditTrail(workItem.id).at(-1)).toMatchObject({
        type: "policy.denied",
        details: { reason: "capability-not-grantable", capability },
      });
    },
  );

  it("rejects a Sensitive Secret before it reaches agent context or audit", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:secret:rejected");
    const secret = "brokerage-transaction-password-must-never-persist";

    const decision = await harness.requestAction(
      action(workItem.id, {
        operation: "draft",
        payload: {
          summary: "Draft the reconciliation note",
          transactionPassword: secret,
        },
      }),
    );

    expect(decision).toMatchObject({
      kind: "denied",
      reason: "sensitive-secret-rejected",
      sensitiveFields: ["transactionPassword"],
    });
    expect(JSON.stringify(decision)).not.toContain(secret);

    const durableEvidence = JSON.stringify({
      workItem: harness.workItem(workItem.id),
      audit: harness.auditTrail(workItem.id),
      approvals: harness.approvals(workItem.id),
    });
    expect(durableEvidence).not.toContain(secret);
    expect(durableEvidence).toContain("transactionPassword");
    expect(harness.auditTrail(workItem.id).at(-1)).toMatchObject({
      type: "policy.denied",
      details: { reason: "sensitive-secret-rejected" },
    });
  });

  it.each([
    ["password", "hunter2-not-a-real-password"],
    ["apiKey", "sk-live-not-a-real-key-000111222333"],
    ["recoveryCode", "AAAA-BBBB-CCCC-DDDD"],
    ["cardNumber", "4111111111111111"],
    ["passportNumber", "A01234567"],
  ])("rejects the Sensitive Secret field %s", async (field, value) => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, `telegram:secret:${field}`);

    const decision = await harness.requestAction(
      action(workItem.id, { operation: "read", payload: { [field]: value } }),
    );

    expect(decision).toMatchObject({
      kind: "denied",
      reason: "sensitive-secret-rejected",
    });
    expect(
      JSON.stringify(harness.auditTrail(workItem.id)),
    ).not.toContain(value);
  });

  it("lets approved work leave Awaiting Approval and reach CEO review", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:execute");
    const requested = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target: {
          type: "pull-request",
          identity: "pmgwee/duitsini#42",
          version: "commit:9f1c2ab",
        },
      }),
    );
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }

    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Awaiting Approval Work cannot execute without an Approval.",
    );

    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    const executed = await harness.executeWorkItem(workItem.id);
    expect(executed.workItem.state).toBe("Ready for CEO Review");
    expect(harness.auditTrail(workItem.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.triaged",
      "work-item.planned",
      "work-item.awaiting-approval",
      "approval.requested",
      "work-item.transition-rejected",
      "approval.granted",
      "work-item.executing",
      "worker.effect-recorded",
      "work-item.verifying",
      "worker.effect-verified",
      "outcome-report.recorded",
      "work-item.ready-for-ceo-review",
    ]);
  });

  it("does not let a granted Approval of another scope unlock execution", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:bundling");
    const target = {
      type: "pull-request",
      identity: "pmgwee/duitsini#42",
      version: "commit:9f1c2ab",
    } as const;

    const purchase = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "purchase",
        target,
      }),
    );
    if (purchase.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }
    await harness.grantApproval({
      approvalId: purchase.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-27T21:00:00.000Z",
    });

    const promotion = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target,
      }),
    );
    expect(promotion.kind).toBe("approval-required");

    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Awaiting Approval Work cannot execute without an Approval.",
    );
    expect(harness.workItem(workItem.id)?.state).toBe("Awaiting Approval");
  });

  it("orders Approval records by request order under one frozen clock", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "telegram:approval:ordering");
    const requestedIds: string[] = [];

    for (const scope of ["purchase", "code-promotion", "destructive-action"] as const) {
      const decision = await harness.requestAction(
        action(workItem.id, {
          operation: "write",
          reversibility: "irreversible",
          riskClass: "high",
          scope,
          target: {
            type: "pull-request",
            identity: "pmgwee/duitsini#42",
            version: "commit:9f1c2ab",
          },
        }),
      );
      if (decision.kind !== "approval-required") {
        throw new Error("Expected an Approval requirement.");
      }
      requestedIds.push(decision.approvalId);
    }

    expect(harness.approvals(workItem.id).map((entry) => entry.id)).toEqual(
      requestedIds,
    );
  });
});
