import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { RequestedAction } from "../../src/operations/contracts.js";

const ceoTelegramId = "100000001";
const calendarId = "ming@example.invalid";

// Monday 31 August 2026 in Kuala Lumpur, expressed in UTC (KL is UTC+8).
const morning = "2026-08-30T23:45:00.000Z"; // 07:45 KL
const evening = "2026-08-31T13:45:00.000Z"; // 21:45 KL

/**
 * RM-16 is the Tracer 1 acceptance and recovery drill: one instruction walked
 * from the CEO's phone to a Work View, through a brief, an exact Approval, a
 * failure and its recovery, and back out again — proving the pieces built
 * separately in RM-07 to RM-15 actually compose.
 *
 * It is deliberately end to end. Each of the earlier tickets proved its own
 * seam in isolation; nothing until now proved that a Telegram message becomes
 * the same Work Item the brief reports, the Approval binds, and the roll-up
 * closes.
 */
describe("RM-16 Tracer 1 acceptance drill", () => {
  const harnesses: RealMingSystemHarness[] = [];
  let clock = morning;

  function startHarness(options: {
    readonly workerError?: string;
  } = {}): RealMingSystemHarness {
    clock = morning;
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => clock,
      telegram: { ceoTelegramId },
      calendar: { events: [] },
      morningBrief: { calendarId },
      ...(options.workerError === undefined
        ? {}
        : { controlledWorker: { executionError: options.workerError } }),
    });
    harnesses.push(harness);
    return harness;
  }

  /** The CEO's own words, arriving the way they really arrive. */
  async function instructFromTelegram(
    harness: RealMingSystemHarness,
    updateId: number,
    text: string,
  ) {
    const ingress = await harness.receiveTelegramUpdate({
      updateId,
      message: {
        messageId: updateId,
        senderId: ceoTelegramId,
        chatId: ceoTelegramId,
        text,
      },
    });
    if (ingress.kind !== "handled") {
      throw new Error(`Expected the CEO instruction to be accepted: ${ingress.kind}`);
    }
    return ingress;
  }

  function action(
    workItemId: string,
    overrides: Partial<RequestedAction> = {},
  ): RequestedAction {
    // No cast: a required field added to RequestedAction should break this
    // helper at compile time rather than produce a silently incomplete object.
    return {
      workItemId,
      executive: "COO",
      trustDomain: "Ming Creatives",
      operation: "read",
      reversibility: "reversible",
      riskClass: "low",
      ...overrides,
    };
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  it("walks the same Work Item through the complete scheduled and recovery tracer", async () => {
    const harness = startHarness();
    await instructFromTelegram(harness, 8001, "/do Promote the reviewed September release");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    expect(await harness.masterTasksView("COO Work View")).toContainEqual(
      expect.objectContaining({
        workItemId: workItem.id,
        accountableExecutive: workItem.accountableExecutive,
        lifecycle: workItem.state,
      }),
    );

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
      throw new Error("Expected an exact-artifact Approval requirement.");
    }

    const morningTick = await harness.tickDailyOperations();
    expect(morningTick.ran).toContain("morning-brief");
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.startsWith("Morning Brief") &&
          message.text.includes(workItem.intent),
      ),
    ).toBe(true);

    const approval = await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-31T21:00:00.000Z",
    });
    expect(await harness.requestAction(promotion)).toMatchObject({
      kind: "permitted",
      basis: "approval",
      approvalId: approval.id,
    });

    harness.setControlledWorkerExecutionError("PRIVATE_WORKER_RAW_FAILURE");
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.includes(workItem.id) &&
          message.text.includes("worker-execution-failed"),
      ),
    ).toBe(true);

    harness.setControlledWorkerExecutionError(undefined);
    const outcome = await harness.executeWorkItem(workItem.id);
    expect(outcome.workItem.state).toBe("Ready for CEO Review");
    expect(outcome.outcomeReport.workItemId).toBe(workItem.id);
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.startsWith("Recovered:") &&
          message.text.includes(workItem.id),
      ),
    ).toBe(true);

    clock = evening;
    const eveningTick = await harness.tickDailyOperations();
    expect(eveningTick.ran).toContain("executive-roll-up");
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.startsWith("Executive Roll-Up") &&
          message.text.includes(workItem.intent),
      ),
    ).toBe(true);

    const audit = harness.auditTrail(workItem.id);
    expect(
      audit.find((event) => event.type === "approval.granted")?.details,
    ).toMatchObject({
      actorId: "ceo:ming",
      targetIdentity: target.identity,
      targetVersion: target.version,
    });
    expect(
      audit.find(
        (event) =>
          event.type === "policy.permitted" && event.details.basis === "approval",
      )?.details,
    ).toMatchObject({
      approvalId: approval.id,
      targetIdentity: target.identity,
      targetVersion: target.version,
    });
    expect(audit.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "worker.effect-failed",
        "work-item.waiting-blocked",
        "worker.effect-recorded",
        "worker.effect-verified",
        "outcome-report.recorded",
      ]),
    );
    expect(JSON.stringify(harness.telegramMessages())).not.toContain(
      "PRIVATE_WORKER_RAW_FAILURE",
    );
  });

  it("carries one Telegram instruction into the matching Work View unchanged", async () => {
    // Criterion 1. The Work View is a projection, not a copy: the state and
    // Accountable Executive a CEO sees in Notion must be the ones the durable
    // Work Item actually holds, or the two systems have already diverged.
    const harness = startHarness();

    await instructFromTelegram(harness, 8101, "/do Draft the September content plan");

    const workItems = harness.workItems();
    expect(workItems).toHaveLength(1);
    const workItem = workItems[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    const executiveView = await harness.masterTasksView("COO Work View");
    const projection = executiveView.find(
      (record) => record.workItemId === workItem.id,
    );

    expect(projection).toMatchObject({
      workItemId: workItem.id,
      accountableExecutive: workItem.accountableExecutive,
      lifecycle: workItem.state,
    });
    // One record, not two. The unfiltered CEO view is a superset of the
    // executive view by construction, so its merely containing the projection
    // proves nothing; what matters is that no second record was created for
    // the same Work Item.
    const everything = await harness.masterTasksView("CEO All Work");
    expect(
      everything.filter((record) => record.workItemId === workItem.id),
    ).toHaveLength(1);
  });

  it("refuses to carry a Sensitive Secret into a Work Item at all", async () => {
    // Criterion 5, at the front door. A credential pasted into Telegram must
    // not become durable state: once captured it would reach the Work View,
    // the brief and the audit trail, and no later redaction could recall it.
    const harness = startHarness();

    const ingress = await harness.receiveTelegramUpdate({
      updateId: 8102,
      message: {
        messageId: 8102,
        senderId: ceoTelegramId,
        chatId: ceoTelegramId,
        text: "/do Store 8123456789:AAH-real-ming-bot-token-material for later",
      },
    });

    expect(ingress).toEqual({
      kind: "rejected",
      reason: "sensitive-secret-rejected",
    });
    expect(harness.workItems()).toHaveLength(0);
    expect(await harness.masterTasksView("CEO All Work")).toEqual([]);
  });

  it("shows the Work Item in the brief while it waits, and in the roll-up once it lands", async () => {
    // Criterion 2. The earlier version of this test asserted the item was NOT
    // in the roll-up's verified outcomes -- which was true unconditionally,
    // because nothing had completed and that list is empty until an Outcome
    // Report exists. It would have passed against a roll-up that never
    // reported anything at all. The proof has to be a transition: absent while
    // the work is outstanding, present once it lands.
    const harness = startHarness();
    await instructFromTelegram(harness, 8201, "/do Publish the September plan");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

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
      throw new Error(`Expected an Approval requirement, got ${requested.kind}.`);
    }

    const beforeBrief = harness.telegramMessages().length;
    const morningTick = await harness.tickDailyOperations();
    expect(morningTick.ran).toContain("morning-brief");
    expect(
      harness.telegramMessages().slice(beforeBrief).some(
        (message) =>
          message.text.startsWith("Morning Brief") &&
          message.text.includes(workItem.intent),
      ),
    ).toBe(true);

    // The CEO grants the Approval the brief was waiting on. Work awaiting an
    // Approval cannot execute without one -- which is the whole point of the
    // gate, and is what makes this one continuous instruction rather than two
    // unrelated scenarios.
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-31T23:00:00.000Z",
    });
    await harness.executeWorkItem(workItem.id);
    expect(harness.outcomeReport(workItem.id)).toBeDefined();

    clock = evening;
    const beforeRollUp = harness.telegramMessages().length;
    const eveningTick = await harness.tickDailyOperations();
    expect(eveningTick.ran).toContain("executive-roll-up");
    expect(
      harness.telegramMessages().slice(beforeRollUp).some(
        (message) =>
          message.text.startsWith("Executive Roll-Up") &&
          message.text.includes(workItem.intent),
      ),
    ).toBe(true);
  });

  it("binds one Approval to the exact artifact and records the whole decision", async () => {
    // Criterion 3. An Approval that survives a change of version is not an
    // Approval, it is a standing permission the CEO never granted. The audit
    // trail has to carry both the decision and what it was decided about.
    const harness = startHarness();
    await instructFromTelegram(harness, 8301, "/do Promote the release");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

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
      expiresAt: "2026-08-31T21:00:00.000Z",
    });
    expect(approval.state).toBe("granted");
    expect(approval).toMatchObject({
      workItemId: workItem.id,
      actorId: "ceo:ming",
      scope: "code-promotion",
      targetType: target.type,
      targetIdentity: target.identity,
      targetVersion: target.version,
      riskClass: "high",
      requestedAt: expect.any(String),
      decidedAt: expect.any(String),
      expiresAt: "2026-08-31T21:00:00.000Z",
      state: "granted",
    });

    // The exact artifact is permitted.
    expect((await harness.requestAction(promotion)).kind).toBe("permitted");

    const audit = harness.auditTrail(workItem.id);
    // Scoped to the granted event, not the whole trail. Searching the trail
    // proved nothing: the sibling approval.requested event carries the same
    // strings, so approval.granted could have recorded an empty decision and
    // every assertion would still have passed.
    const granted = audit.find((event) => event.type === "approval.granted");
    expect(granted).toBeDefined();
    expect(granted?.details).toMatchObject({
      actorId: "ceo:ming",
      targetIdentity: "pmgwee/duitsini#42",
      targetVersion: "commit:9f1c2ab",
      expiresAt: "2026-08-31T21:00:00.000Z",
    });
    const permitted = audit.find(
      (event) =>
        event.type === "policy.permitted" && event.details.basis === "approval",
    );
    expect(permitted?.details).toMatchObject({
      approvalId: approval.id,
      targetIdentity: target.identity,
      targetVersion: target.version,
    });

    await harness.executeWorkItem(workItem.id);
    const completedAudit = harness.auditTrail(workItem.id);
    expect(completedAudit.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "worker.effect-recorded",
        "worker.effect-verified",
        "outcome-report.recorded",
      ]),
    );
  });

  it("blocks on a controlled failure, groups the notice, then recovers", async () => {
    // Criterion 4. A failure has to leave three traces: the Work Item in
    // Waiting/Blocked so it cannot be mistaken for finished, one Exception
    // Notice rather than one per retry, and a recovery notice so the CEO
    // learns it cleared without having to go looking.
    const harness = startHarness({ workerError: "The private worker is unreachable." });
    await instructFromTelegram(harness, 8401, "/do Reconcile the ledger");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    // The gateway blocks the Work Item durably and then rethrows, so the
    // caller learns the work failed while the state already says so. Both
    // halves matter: a throw alone would leave it looking in-flight forever.
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");

    const firstBlockMessages = harness.telegramMessages().filter(
      (message) => message.text.includes(`Work Item ${workItem.id} is blocked`),
    );
    expect(firstBlockMessages).toHaveLength(1);

    // A second attempt while the worker is still unavailable is the same
    // incident, so it stays grouped rather than interrupting the CEO twice.
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );
    expect(
      harness.telegramMessages().filter(
        (message) => message.text.includes(`Work Item ${workItem.id} is blocked`),
      ),
    ).toHaveLength(1);

    // Reconnect the worker and retry the same Work Item. Recovery is automatic:
    // it is not a manually raised, unrelated incident or a scheduler retry.
    harness.setControlledWorkerExecutionError(undefined);
    const recovered = await harness.executeWorkItem(workItem.id);
    expect(recovered.workItem.state).toBe("Ready for CEO Review");
    expect(recovered.outcomeReport.workItemId).toBe(workItem.id);
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.startsWith("Recovered:") &&
          message.text.includes(`work-item-blocked:${workItem.id}`),
      ),
    ).toBe(true);
    expect(
      harness
        .dashboardOverview({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        })
        .controlPlane.find((component) => component.component === "exception-notice")
        ?.lastOutcome,
    ).toBe("healthy");

    // Both halves are recorded: what failed, and what that did to the Work
    // Item. Either alone would leave the trail ambiguous later.
    const types = harness.auditTrail(workItem.id).map((event) => event.type);
    expect(types.filter((type) => type === "worker.effect-failed")).toHaveLength(2);
    expect(types).toContain("work-item.waiting-blocked");
    expect(types).toContain("outcome-report.recorded");
  });

  it("raises the material blocker even when the Notion projection fails", async () => {
    const harness = startHarness({ workerError: "The private worker is unreachable." });
    await instructFromTelegram(harness, 8402, "/do Reconcile the projection outage");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    harness.failNextMasterTasksUpsert("Notion is unavailable.");
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    expect(await harness.masterTasksView("COO Work View")).toContainEqual(
      expect.objectContaining({
        workItemId: workItem.id,
        lifecycle: "Waiting/Blocked",
      }),
    );
    expect(
      harness.telegramMessages().some((message) => message.text.includes(workItem.id)),
    ).toBe(true);
  });

  it("surfaces persistent Master Tasks projection failure as dashboard health", async () => {
    const harness = startHarness({ workerError: "The private worker is unreachable." });
    await instructFromTelegram(harness, 8404, "/do Reconcile persistent projection outage");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    harness.setMasterTasksUpsertFailure("Notion remains unavailable.");
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();
    expect(
      harness
        .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
        .controlPlane.find((component) => component.component === "master-tasks-projection")
        ?.lastOutcome,
    ).toBe("failed");
    expect(
      harness.telegramMessages().some((message) => message.text.includes(workItem.id)),
    ).toBe(true);
  });

  it("raises a material blocker when effect verification fails", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => morning,
      telegram: { ceoTelegramId },
      controlledVerifier: { result: "error" },
    });
    harnesses.push(harness);
    await instructFromTelegram(harness, 8403, "/do Verify the controlled effect");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work could not be verified.",
    );
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.includes(workItem.id) &&
          message.text.includes("effect-verification-failed"),
      ),
    ).toBe(true);
  });

  it("reports a failed Exception Notice honestly and preserves its durable retry", async () => {
    const harness = startHarness();
    harness.setTelegramDeliveryFailure({
      class: "unavailable",
      retryable: true,
      message: "Controlled Telegram outage.",
    });
    const admission = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item controlled-id is blocked.",
      idempotencyKey: "rm16:failed-notice",
      signature: "work-item-blocked:controlled-id",
    });

    expect(admission.kind).toBe("failed");
    expect(harness.telegramMessages()).toEqual([]);
    expect(
      harness
        .dashboardOverview({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        })
        .controlPlane.find((component) => component.component === "exception-notice")
        ?.lastOutcome,
    ).toBe("failed");
    harness.setTelegramDeliveryFailure(undefined);
    expect(await harness.retryPendingTelegramDeliveries()).toMatchObject({ sent: 1 });
    expect(harness.telegramMessages()).toHaveLength(1);
    expect(
      harness
        .dashboardOverview({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        })
        .controlPlane.find((component) => component.component === "exception-notice")
        ?.lastOutcome,
    ).toBe("healthy");
  });

  it("does not send a stale blocker or recovery after a failed notice is cleared", async () => {
    const harness = startHarness();
    await instructFromTelegram(harness, 8451, "/do Recover while Telegram is down");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    harness.setControlledWorkerExecutionError("PRIVATE_WORKER_RAW_FAILURE");
    harness.setTelegramDeliveryFailure({
      class: "unavailable",
      retryable: true,
      message: "Controlled Telegram outage.",
    });
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();

    // The worker recovers before Telegram does. Recovery must cancel the
    // undelivered blocker rather than queueing a misleading recovery notice.
    harness.setControlledWorkerExecutionError(undefined);
    const recovered = await harness.executeWorkItem(workItem.id);
    expect(recovered.workItem.state).toBe("Ready for CEO Review");

    harness.setTelegramDeliveryFailure(undefined);
    await harness.retryPendingTelegramDeliveries();
    expect(harness.telegramMessages()).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("is blocked") }),
    );
    expect(harness.telegramMessages()).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("Recovered:") }),
    );
  });

  it("holds and groups a do-not-disturb blocker, then clears it without waking the CEO", async () => {
    clock = "2026-08-30T16:00:00.000Z"; // 00:00 KL, inside do-not-disturb
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => clock,
      telegram: { ceoTelegramId },
    });
    harnesses.push(harness);

    const first = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item dnd-item is blocked.",
      idempotencyKey: "rm16:dnd:first",
      signature: "work-item-blocked:dnd-item",
    });
    const second = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item dnd-item is blocked.",
      idempotencyKey: "rm16:dnd:second",
      signature: "work-item-blocked:dnd-item",
    });
    expect(first.kind).toBe("held");
    expect(second).toMatchObject({ kind: "grouped", occurrences: 2 });
    expect(await harness.recordExceptionNoticeRecovery("work-item-blocked:dnd-item")).toMatchObject({
      kind: "recovered-without-delivery",
    });
    expect(await harness.releaseHeldExceptionNotices()).toMatchObject({ released: 0 });
    expect(harness.telegramMessages()).toEqual([]);
  });

  it("releases a held notice back to retryable state when Telegram fails at wake-up", async () => {
    clock = "2026-08-30T16:00:00.000Z"; // 00:00 KL, inside do-not-disturb
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => clock,
      telegram: { ceoTelegramId },
    });
    harnesses.push(harness);

    const signature = "work-item-blocked:dnd-retry-item";
    expect(
      await harness.admitExceptionNotice({
        kind: "material-blocker",
        text: "Work Item dnd-retry-item is blocked.",
        idempotencyKey: "rm16:dnd-retry:first",
        signature,
      }),
    ).toMatchObject({ kind: "held" });
    clock = "2026-08-30T23:00:00.000Z"; // 07:00 KL, release window
    harness.setTelegramDeliveryFailure({
      class: "invalid-input",
      retryable: false,
      message: "Controlled wake-up failure.",
    });
    expect(await harness.releaseHeldExceptionNotices()).toMatchObject({ failed: 1 });

    harness.setTelegramDeliveryFailure(undefined);
    expect(
      await harness.admitExceptionNotice({
        kind: "material-blocker",
        text: "Work Item dnd-retry-item is blocked again.",
        idempotencyKey: "rm16:dnd-retry:second",
        signature,
      }),
    ).toMatchObject({ kind: "delivered" });
  });

  it("sends recovery after an uncertain Telegram delivery under the explicit conservative policy", async () => {
    const harness = startHarness();
    harness.setTelegramCrashAfterDelivery("Controlled timeout after send.");
    const signature = "work-item-blocked:uncertain-item";
    expect(
      await harness.admitExceptionNotice({
        kind: "material-blocker",
        text: "Work Item uncertain-item is blocked.",
        idempotencyKey: "rm16:uncertain:first",
        signature,
      }),
    ).toMatchObject({ kind: "failed" });
    expect(harness.telegramMessages()).toHaveLength(1);

    harness.setTelegramCrashAfterDelivery(undefined);
    expect(await harness.recordExceptionNoticeRecovery(signature)).toMatchObject({
      kind: "delivered",
    });
    expect(
      harness.telegramMessages().some((message) => message.text.startsWith("Recovered:")),
    ).toBe(true);
  });

  it("reopens a terminally failed notice group for a fresh occurrence", async () => {
    const harness = startHarness();
    harness.setTelegramDeliveryFailure({
      class: "invalid-input",
      retryable: false,
      message: "Controlled permanent failure.",
    });
    const first = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item terminal-item is blocked.",
      idempotencyKey: "rm16:terminal:first",
      signature: "work-item-blocked:terminal-item",
    });
    const second = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item terminal-item is blocked.",
      idempotencyKey: "rm16:terminal:second",
      signature: "work-item-blocked:terminal-item",
    });
    expect(first.kind).toBe("failed");
    expect(second.kind).toBe("failed");
  });

  it("does not strand a notice group when outbound validation fails before the outbox", async () => {
    const harness = startHarness();
    const first = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Sensitive token 8123456789:AAH-invalid-material must not leave the process.",
      idempotencyKey: "rm16:validation:first",
      signature: "work-item-blocked:validation-item",
    });
    const second = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item validation-item is blocked.",
      idempotencyKey: "rm16:validation:second",
      signature: "work-item-blocked:validation-item",
    });
    expect(first.kind).toBe("failed");
    expect(second.kind).toBe("delivered");
  });

  it("keeps grouped pending delivery unhealthy until its retry succeeds", async () => {
    const harness = startHarness();
    harness.setTelegramDeliveryFailure({
      class: "unavailable",
      retryable: true,
      message: "Controlled Telegram outage.",
    });
    const first = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item grouped-item is blocked.",
      idempotencyKey: "rm16:grouped:first",
      signature: "work-item-blocked:grouped-item",
    });
    const grouped = await harness.admitExceptionNotice({
      kind: "material-blocker",
      text: "Work Item grouped-item is blocked.",
      idempotencyKey: "rm16:grouped:second",
      signature: "work-item-blocked:grouped-item",
    });
    expect(first.kind).toBe("failed");
    expect(grouped).toMatchObject({ kind: "grouped", deliveryState: "pending" });
    expect(
      harness
        .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
        .controlPlane.find((component) => component.component === "exception-notice")
        ?.lastOutcome,
    ).toBe("failed");
    harness.setTelegramDeliveryFailure(undefined);
    await harness.retryPendingTelegramDeliveries();
    expect(
      harness
        .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
        .controlPlane.find((component) => component.component === "exception-notice")
        ?.lastOutcome,
    ).toBe("healthy");
  });

  it("rejects a Telegram bot token embedded in its canonical API URL", async () => {
    const harness = startHarness();
    const result = await harness.notifyTelegram({
      kind: "material-blocker",
      text: "Provider failed at https://api.telegram.org/bot8123456789:AAH-real-ming-bot-token-material/sendMessage",
      idempotencyKey: "rm16:secret-url",
    });

    expect(result.kind).toBe("failed");
    expect(harness.telegramMessages()).toEqual([]);
  });

  it("reports real work in the daily documents without carrying provider material", async () => {
    // Criterion 5, at the reporting boundary. The earlier version asserted
    // absence over a document whose every section read "none" -- it would have
    // passed against a brief that returned nothing at all, and it checked for
    // strings the document types cannot express. Absence only means something
    // once the document has content, so this drives a real Work Item through
    // to a verified outcome first.
    const harness = startHarness();
    await instructFromTelegram(harness, 8501, "/do Publish the September plan");
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");
    await harness.executeWorkItem(workItem.id);

    const brief = await harness.runMorningBrief();
    clock = evening;
    const rollUp = await harness.runExecutiveRollUp();

    // The documents genuinely report this work.
    expect(rollUp.rollUp.verifiedOutcomes).toContainEqual(
      expect.objectContaining({ workItemId: workItem.id }),
    );

    const documents = JSON.stringify([brief.brief, rollUp.rollUp]);
    // What they must not carry: the controlled worker's own evidence payload,
    // which stands in for whatever a real provider would return. The Outcome
    // Report holds it; the roll-up must reference the report rather than
    // inline it, or every provider response would reach the CEO's phone.
    const report = harness.outcomeReport(workItem.id);
    expect(report).toBeDefined();
    expect(JSON.stringify(report?.verification ?? {})).toContain("controlled");
    expect(documents).not.toContain("controlled-effect-reference");
    expect(documents).not.toMatch(/[0-9]{8,10}:[A-Za-z0-9_-]{30,}/);
  });

  it("consolidates two Trust Domains without projecting raw Finance failure context", async () => {
    const rawFinanceContext = "FINANCE_RAW_CONTEXT_DO_NOT_PROJECT";
    const harness = startHarness({ workerError: rawFinanceContext });
    await instructFromTelegram(harness, 8502, "/cmo Prepare the public content plan");
    await instructFromTelegram(harness, 8503, "/cfo Reconcile the private finance ledger");
    const finance = harness.workItems().find(
      (item) => item.accountableExecutive === "Personal CFO",
    );
    if (finance === undefined) throw new Error("Expected one Finance Work Item.");
    await expect(harness.executeWorkItem(finance.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );

    const brief = await harness.runMorningBrief();
    clock = evening;
    const rollUp = await harness.runExecutiveRollUp();
    expect(brief.brief.overdueOrBlocked).toContainEqual(
      expect.objectContaining({ workItemId: finance.id }),
    );
    expect(rollUp.rollUp.outstandingRisks).toContainEqual(
      expect.objectContaining({ workItemId: finance.id }),
    );
    const documents = JSON.stringify([brief.brief, rollUp.rollUp]);
    expect(documents).toContain("Prepare the public content plan");
    expect(documents).not.toContain(rawFinanceContext);
  });
});

describe("RM-16 a blocked Work Item must reach the CEO", () => {
  const harnesses: RealMingSystemHarness[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
  });

  it("raises an Exception Notice when work blocks, without waiting for the brief", async () => {
    // CONTEXT.md counts a material blocker among the four things that may
    // interrupt the CEO directly. Nothing raised one: the only callers of the
    // Exception Notice rhythm were the 07:30 brief and the 21:30 roll-up, so a
    // Work Item that blocked at 08:00 sat silent for the rest of the day while
    // the CEO had no reason to go looking for it.
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => "2026-08-31T02:00:00.000Z", // 10:00 KL, outside do-not-disturb
      telegram: { ceoTelegramId },
      controlledWorker: { executionError: "The private worker is unreachable." },
    });
    harnesses.push(harness);

    await harness.receiveTelegramUpdate({
      updateId: 8601,
      message: {
        messageId: 8601,
        senderId: ceoTelegramId,
        chatId: ceoTelegramId,
        text: "/do Reconcile the ledger",
      },
    });
    const workItem = harness.workItems()[0];
    if (workItem === undefined) throw new Error("Expected one Work Item.");

    const before = harness.telegramMessages().length;
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );

    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    const raised = harness.telegramMessages().slice(before);
    // Named, or the CEO cannot act on it.
    expect(raised.some((message) => message.text.includes(workItem.id))).toBe(true);
    // The provider's own words never reach the CEO's phone: they can carry a
    // request URL, and Telegram's contains the bot token.
    expect(
      raised.every((message) => !message.text.includes("Controlled work")),
    ).toBe(true);
  });
});
