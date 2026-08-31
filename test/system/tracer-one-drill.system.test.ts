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

    const brief = await harness.runMorningBrief();
    expect(brief.brief.pendingApprovals).toContainEqual(
      expect.objectContaining({ workItemId: workItem.id }),
    );

    clock = evening;
    const waiting = await harness.runExecutiveRollUp();
    expect(waiting.rollUp.verifiedOutcomes).not.toContainEqual(
      expect.objectContaining({ workItemId: workItem.id }),
    );

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

    const landed = await harness.runExecutiveRollUp();
    expect(landed.rollUp.verifiedOutcomes).toContainEqual(
      expect.objectContaining({ workItemId: workItem.id }),
    );
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

    // The exact artifact is permitted.
    expect((await harness.requestAction(promotion)).kind).toBe("permitted");

    // A different version of the same artifact is not.
    const moved = await harness.requestAction(
      action(workItem.id, {
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target: { ...target, version: "commit:deadbee" },
      }),
    );
    expect(moved.kind).toBe("approval-required");
    expect(harness.approval(approval.id)?.state).toBe("invalidated");

    const audit = harness.auditTrail(workItem.id);
    // Scoped to the granted event, not the whole trail. Searching the trail
    // proved nothing: the sibling approval.requested event carries the same
    // strings, so approval.granted could have recorded an empty decision and
    // every assertion would still have passed.
    const granted = audit.find((event) => event.type === "approval.granted");
    expect(granted).toBeDefined();
    expect(granted?.details).toMatchObject({
      targetIdentity: "pmgwee/duitsini#42",
      targetVersion: "commit:9f1c2ab",
    });
    expect(audit.map((event) => event.type)).toContain("approval.invalidated");
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

    const signature = "worker-unreachable";
    const first = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "The private worker is unreachable",
      idempotencyKey: "rm16:incident:1",
      signature,
    });
    expect(first.kind).toBe("delivered");

    // The same fault recurring must not become a second interruption.
    const repeat = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "The private worker is unreachable",
      idempotencyKey: "rm16:incident:2",
      signature,
    });
    expect(repeat.kind).toBe("grouped");

    // Retry behaviour, which criterion 4 names and nothing here asserted. A
    // scheduled job that failed must be attempted again on the next tick --
    // only a successful occurrence is allowed to short-circuit, or a transient
    // fault would silently cancel that day's brief or roll-up for good.
    await harness.failNextScheduledRun("morning-brief");
    const failedTick = await harness.tickDailyOperations();
    expect(failedTick.failed).toContain("morning-brief");

    const retryTick = await harness.tickDailyOperations();
    expect(retryTick.ran).toContain("morning-brief");
    expect(retryTick.alreadyRun).not.toContain("morning-brief");

    const recovery = await harness.recordExceptionNoticeRecovery(signature);
    expect(recovery.kind).toBe("delivered");

    // Once recovered, the next occurrence is new news again rather than being
    // swallowed by a group that no longer describes anything.
    const afterRecovery = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "The private worker is unreachable",
      idempotencyKey: "rm16:incident:3",
      signature,
    });
    expect(afterRecovery.kind).toBe("delivered");

    // Both halves are recorded: what failed, and what that did to the Work
    // Item. Either alone would leave the trail ambiguous later.
    const types = harness.auditTrail(workItem.id).map((event) => event.type);
    expect(types).toContain("worker.effect-failed");
    expect(types).toContain("work-item.waiting-blocked");
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
