import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dailyOccurrence, isDoNotDisturb } from "../../src/operations/daily-schedule.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

// 21:30 on Saturday 29 August 2026 in Kuala Lumpur is 13:30 UTC.
const saturdayEvening = "2026-08-29T13:30:00.000Z";
// 21:30 on Monday 31 August 2026.
const weekdayEvening = "2026-08-31T13:30:00.000Z";
// 23:30 Kuala Lumpur, inside do-not-disturb.
const deepNight = "2026-08-31T15:30:00.000Z";

describe("RM-14 Executive Roll-Up and notification rhythm", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(
    options: { readonly clock?: () => string; readonly executionError?: string } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm14-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: options.clock ?? (() => weekdayEvening),
      telegram: { ceoTelegramId: "100000001" },
      calendar: { events: [] },
      morningBrief: { calendarId: "ming@example.invalid" },
      ...(options.executionError === undefined
        ? {}
        : { controlledWorker: { executionError: options.executionError } }),
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    idempotencyKey: string,
    intent: string,
    workstream: "Academic" | "MicroSaaS" | "Finance" = "Academic",
  ) {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey,
      intent,
      expectedEffect: { kind: "note", value: `note:${idempotencyKey}` },
      workstream,
    });
    return acknowledgement.workItem;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("anchors the roll-up to 21:30 Asia/Kuala_Lumpur", () => {
    expect(
      dailyOccurrence({
        now: weekdayEvening,
        hour: 21,
        minute: 30,
        job: "executive-roll-up",
      }),
    ).toEqual({
      occurrenceDate: "2026-08-31",
      scheduledAt: "2026-08-31T13:30:00.000Z",
      idempotencyKey: "executive-roll-up:2026-08-31",
    });
  });

  it("guards both ends of the do-not-disturb window", () => {
    // KL is UTC+8, so 22:59 KL is 14:59 UTC.
    expect(isDoNotDisturb("2026-08-31T14:59:00.000Z")).toBe(false);
    expect(isDoNotDisturb("2026-08-31T15:00:00.000Z")).toBe(true);
    expect(isDoNotDisturb("2026-08-31T16:00:00.000Z")).toBe(true);
    expect(isDoNotDisturb("2026-08-31T22:59:00.000Z")).toBe(true);
    expect(isDoNotDisturb("2026-08-31T23:00:00.000Z")).toBe(false);
  });

  it("reports only the operating day's verified outcomes", async () => {
    let clock = weekdayEvening;
    const harness = startHarness({ clock: () => clock });
    const yesterday = await captureWorkItem(
      harness,
      "rm14:yesterday",
      "Work finished yesterday",
    );
    await harness.executeWorkItem(yesterday.id);
    expect(
      (await harness.runExecutiveRollUp()).rollUp.verifiedOutcomes.length,
    ).toBeGreaterThan(0);

    // Tomorrow evening. Replaying every outcome ever produced would grow this
    // Telegram message without bound.
    clock = "2026-09-01T13:30:00.000Z";

    const tomorrow = await harness.runExecutiveRollUp();
    expect(tomorrow.rollUp.occurrenceDate).toBe("2026-09-01");
    expect(tomorrow.rollUp.verifiedOutcomes).toEqual([]);
  });

  it("bounds a recorded blocker reason before it crosses into the account", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness, "rm14:long", "Long blocker");
    await harness.executeWorkItem(workItem.id);
    await harness.reviewWorkItem({
      workItemId: workItem.id,
      actorId: "ceo:ming",
      decision: "request-changes",
      reason: "x".repeat(600),
    });

    const result = await harness.runExecutiveRollUp();

    // A reason is written by a worker, not the CEO. It is projected, not
    // pasted, so an unbounded string cannot ride into the message.
    const risk = result.rollUp.outstandingRisks.find(
      (entry) => entry.workItemId === workItem.id,
    );
    expect(risk?.label.length).toBeLessThan(300);
    expect(risk?.label).toContain("…");
  });

  it("holds a brief raised inside do-not-disturb, like any other notice", async () => {
    // Do-not-disturb has to apply to the front door, not only to the Roll-Up.
    const harness = startHarness({ clock: () => deepNight });

    const result = await harness.runMorningBrief();

    expect(result.admission.kind).toBe("held");
    expect(harness.telegramMessages()).toHaveLength(0);
  });

  it("consolidates verified outcomes, risks, changes requested, Approvals and next priorities", async () => {
    const harness = startHarness();
    const completed = await captureWorkItem(
      harness,
      "rm14:verified",
      "Publish the launch note",
      "MicroSaaS",
    );
    await harness.executeWorkItem(completed.id);
    const changes = await captureWorkItem(
      harness,
      "rm14:changes",
      "Revise the abstract",
    );
    await harness.executeWorkItem(changes.id);
    await harness.reviewWorkItem({
      workItemId: changes.id,
      actorId: "ceo:ming",
      decision: "request-changes",
      reason: "Tighten the argument",
    });
    const awaiting = await captureWorkItem(
      harness,
      "rm14:approval",
      "Promote the candidate",
      "MicroSaaS",
    );
    const decision = await harness.requestAction({
      workItemId: awaiting.id,
      executive: "CTO",
      trustDomain: "Ming Creatives",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: { type: "commit", identity: "abc123", version: "1" },
    });
    const next = await captureWorkItem(
      harness,
      "rm14:next",
      "Reconcile the ledger",
      "Finance",
    );

    const result = await harness.runExecutiveRollUp();

    expect(result.rollUp.occurrenceDate).toBe("2026-08-31");
    // Asserted through the builder: the test supplies no hour or minute, so
    // moving the roll-up off 21:30 fails here.
    expect(result.rollUp.scheduledAt).toBe("2026-08-31T13:30:00.000Z");
    expect(result.rollUp.text).toContain("21:30 Asia/Kuala_Lumpur");
    expect(
      result.rollUp.verifiedOutcomes.map((entry) => entry.workItemId),
    ).toContain(completed.id);
    expect(
      result.rollUp.changesRequested.map((entry) => entry.workItemId),
    ).toContain(changes.id);
    expect(
      result.rollUp.outstandingRisks.map((entry) => entry.workItemId),
    ).toContain(changes.id);
    expect(
      result.rollUp.outstandingRisks.map((entry) => entry.label).join(" "),
    ).toContain("Tighten the argument");
    if (decision.kind !== "approval-required") throw new Error("expected approval");
    expect(
      result.rollUp.pendingApprovals.map((entry) => entry.evidence),
    ).toContain(decision.approvalId);
    expect(
      result.rollUp.nextPriorities.map((entry) => entry.workItemId),
    ).toContain(next.id);
    expect(result.admission.kind).toBe("delivered");
    expect(result.delivery?.kind).toBe("sent");
    expect(harness.telegramMessages()[0]?.text).toContain("Executive Roll-Up");
  });

  it("lets the COO consolidate every Workstream without Approval authority", async () => {
    const harness = startHarness();
    const cto = await captureWorkItem(
      harness,
      "rm14:cto",
      "Ship the runner",
      "MicroSaaS",
    );
    const cfo = await captureWorkItem(
      harness,
      "rm14:cfo",
      "Reconcile the ledger",
      "Finance",
    );

    const result = await harness.runExecutiveRollUp();

    expect(result.rollUp.consolidatedBy).toBe("COO");
    // Consolidation is reporting, never authority over a peer's work.
    expect(result.rollUp.grantsApprovalAuthority).toBe(false);
    const consolidated = result.rollUp.nextPriorities.map((e) => e.workItemId);
    expect(consolidated).toContain(cto.id);
    expect(consolidated).toContain(cfo.id);
    // Only Approved Projections cross the domain boundary. The expected effect
    // value is raw context and must never appear in the consolidated account.
    expect(result.rollUp.text).not.toContain("note:rm14:cto");
    expect(result.rollUp.text).not.toContain("note:rm14:cfo");
  });

  it("holds routine notifications during do-not-disturb and lets critical ones through", async () => {
    expect(isDoNotDisturb(deepNight)).toBe(true);
    expect(isDoNotDisturb(weekdayEvening)).toBe(false);
    const harness = startHarness({ clock: () => deepNight });

    const routine = await harness.admitExceptionNotice({
      kind: "completed-outcome-report",
      text: "An Outcome Report is ready",
      idempotencyKey: "rm14:routine",
    });
    const incident = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "The private worker is unreachable",
      idempotencyKey: "rm14:incident",
    });
    const urgentApproval = await harness.admitExceptionNotice({
      kind: "approval",
      text: "Approval expires at 06:00",
      idempotencyKey: "rm14:urgent",
      urgentDeadline: true,
    });
    const ordinaryApproval = await harness.admitExceptionNotice({
      kind: "approval",
      text: "Approval can wait",
      idempotencyKey: "rm14:ordinary",
    });

    expect(routine.kind).toBe("held");
    expect(ordinaryApproval.kind).toBe("held");
    expect(incident.kind).toBe("delivered");
    expect(urgentApproval.kind).toBe("delivered");
    if (routine.kind !== "held") return;
    // A held notice is deferred to the end of the window, never dropped.
    expect(routine.releaseAt).toBe("2026-08-31T23:00:00.000Z");
  });

  it("delivers a held notice once the do-not-disturb window ends", async () => {
    // "Held" must mean deferred. If nothing ever releases it, do-not-disturb
    // is a silent drop with a nicer name.
    let clock = deepNight;
    const harness = startHarness({ clock: () => clock });

    const held = await harness.admitExceptionNotice({
      kind: "completed-outcome-report",
      text: "An Outcome Report is ready",
      idempotencyKey: "rm14:deferred",
    });
    expect(held.kind).toBe("held");
    expect(harness.telegramMessages()).toHaveLength(0);

    // Still inside the window: nothing is released early.
    clock = "2026-08-31T20:00:00.000Z";
    expect((await harness.releaseHeldExceptionNotices()).released).toBe(0);
    expect(harness.telegramMessages()).toHaveLength(0);

    // 07:00 Kuala Lumpur the next morning.
    clock = "2026-08-31T23:00:00.000Z";
    const released = await harness.releaseHeldExceptionNotices();

    expect(released.released).toBe(1);
    expect(harness.telegramMessages()).toHaveLength(1);
    expect(harness.telegramMessages()[0]?.text).toContain("Outcome Report");

    // Releasing again delivers nothing a second time.
    expect((await harness.releaseHeldExceptionNotices()).released).toBe(0);
    expect(harness.telegramMessages()).toHaveLength(1);
  });

  it("runs a lighter weekend without skipping a critical responsibility", async () => {
    const harness = startHarness({ clock: () => saturdayEvening });

    const reporting = await harness.admitExceptionNotice({
      kind: "completed-outcome-report",
      text: "An Outcome Report is ready",
      idempotencyKey: "rm14:weekend-report",
    });
    const incident = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "Scheduler heartbeat missed",
      idempotencyKey: "rm14:weekend-incident",
    });
    const rollUp = await harness.runExecutiveRollUp();

    expect(reporting.kind).toBe("suppressed");
    if (reporting.kind !== "suppressed") return;
    expect(reporting.reason).toBe("weekend-rhythm");

    // The control: the identical notice is delivered on a weekday, so the
    // weekend rule is doing the work rather than the front door's allowlist.
    const weekday = startHarness();
    const onMonday = await weekday.admitExceptionNotice({
      kind: "completed-outcome-report",
      text: "An Outcome Report is ready",
      idempotencyKey: "rm14:weekday-report",
    });
    expect(onMonday.kind).toBe("delivered");
    expect(incident.kind).toBe("delivered");
    // The roll-up itself is a critical responsibility and still runs.
    expect(rollUp.rollUp.weekend).toBe(true);
    expect(rollUp.delivery?.kind).toBe("sent");
  });

  it("groups a repeated identical error and produces exactly one recovery notice", async () => {
    const harness = startHarness();

    const first = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "Notion write failed",
      idempotencyKey: "rm14:error:1",
      signature: "notion-write-failed",
    });
    const second = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "Notion write failed",
      idempotencyKey: "rm14:error:2",
      signature: "notion-write-failed",
    });
    const third = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "Notion write failed",
      idempotencyKey: "rm14:error:3",
      signature: "notion-write-failed",
    });

    expect(first.kind).toBe("delivered");
    expect(second.kind).toBe("grouped");
    expect(third.kind).toBe("grouped");
    if (third.kind !== "grouped") return;
    expect(third.occurrences).toBe(3);

    const recovery = await harness.recordExceptionNoticeRecovery(
      "notion-write-failed",
    );
    const secondRecovery = await harness.recordExceptionNoticeRecovery(
      "notion-write-failed",
    );

    expect(recovery.kind).toBe("delivered");
    expect(secondRecovery.kind).toBe("already-recovered");
    // One notice for the failure, one for the recovery. Not five.
    expect(harness.telegramMessages()).toHaveLength(2);

    // A fresh occurrence after recovery is a new incident, not a replay.
    const afterRecovery = await harness.admitExceptionNotice({
      kind: "critical-incident",
      text: "Notion write failed",
      idempotencyKey: "rm14:error:4",
      signature: "notion-write-failed",
    });
    expect(afterRecovery.kind).toBe("delivered");
  });

  it("delivers one roll-up per occurrence and a corrected one when the day changes", async () => {
    const harness = startHarness();
    const first = await harness.runExecutiveRollUp();
    const replay = await harness.runExecutiveRollUp();

    expect(replay.rollUp.idempotencyKey).toBe(first.rollUp.idempotencyKey);
    expect(harness.telegramMessages()).toHaveLength(1);

    await captureWorkItem(harness, "rm14:late", "Work that arrived later");
    const corrected = await harness.runExecutiveRollUp();

    expect(corrected.delivery?.kind).toBe("sent");
    expect(harness.telegramMessages()).toHaveLength(2);
  });
});
