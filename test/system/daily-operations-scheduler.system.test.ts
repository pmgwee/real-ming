import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const calendarId = "ming@example.invalid";

// Monday 31 August 2026 in Kuala Lumpur, expressed in UTC (KL is UTC+8).
const beforeBrief = "2026-08-30T22:00:00.000Z"; // 06:00 KL
const afterBrief = "2026-08-30T23:45:00.000Z"; // 07:45 KL
const afterRollUp = "2026-08-31T13:45:00.000Z"; // 21:45 KL
const nextMorning = "2026-08-31T23:45:00.000Z"; // 07:45 KL, 1 September

describe("RM-15 Daily Operations scheduler", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(options: {
    readonly clock: () => string;
    readonly statePath?: string;
  }): RealMingSystemHarness {
    const statePath =
      options.statePath ??
      join(mkdtempSync(join(tmpdir(), "real-ming-rm15-")), "state.sqlite");
    if (options.statePath === undefined) directories.push(join(statePath, ".."));
    const harness = createRealMingSystemHarness({
      statePath,
      now: options.clock,
      telegram: { ceoTelegramId: "100000001" },
      calendar: { events: [] },
      morningBrief: { calendarId },
    });
    harnesses.push(harness);
    return harness;
  }

  function temporaryStatePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-"));
    directories.push(directory);
    return join(directory, "state.sqlite");
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("runs nothing before an occurrence is due", async () => {
    const harness = startHarness({ clock: () => beforeBrief });

    const tick = await harness.tickDailyOperations();

    expect(tick.ran).toEqual([]);
    expect(harness.telegramMessages()).toHaveLength(0);
  });

  it("runs each occurrence once, however often it ticks", async () => {
    let clock = afterBrief;
    const harness = startHarness({ clock: () => clock });

    const first = await harness.tickDailyOperations();
    const second = await harness.tickDailyOperations();

    expect(first.ran).toContain("morning-brief");
    expect(second.ran).toEqual([]);
    expect(
      harness
        .telegramMessages()
        .filter((message) => message.text.includes("Morning Brief")),
    ).toHaveLength(1);

    clock = afterRollUp;
    const evening = await harness.tickDailyOperations();
    expect(evening.ran).toContain("executive-roll-up");
    expect(await harness.tickDailyOperations()).toMatchObject({ ran: [] });
    expect(
      harness
        .telegramMessages()
        .filter((message) => message.text.includes("Executive Roll-Up")),
    ).toHaveLength(1);

    clock = nextMorning;
    const tomorrow = await harness.tickDailyOperations();
    // A new operating day is a new occurrence, not a replay.
    expect(tomorrow.ran).toContain("morning-brief");
  });

  it("does not repeat a completed occurrence after a restart", async () => {
    const statePath = temporaryStatePath();
    const before = startHarness({ clock: () => afterBrief, statePath });
    const first = await before.tickDailyOperations();
    expect(first.ran).toContain("morning-brief");
    before.close();
    harnesses.length = 0;

    // A fresh process on the same durable state.
    const after = startHarness({ clock: () => afterBrief, statePath });
    const replay = await after.tickDailyOperations();

    expect(replay.ran).toEqual([]);
  });

  it("keeps Work Items, Approvals, held notices and audit across a restart", async () => {
    const statePath = temporaryStatePath();
    const before = startHarness({ clock: () => afterBrief, statePath });
    const acknowledgement = await before.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm15:durable",
      intent: "Survive a restart",
      expectedEffect: { kind: "note", value: "note:rm15" },
      workstream: "Academic",
    });
    const decision = await before.requestAction({
      workItemId: acknowledgement.workItem.id,
      executive: "CAO",
      trustDomain: "Academic",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: { type: "commit", identity: "abc123", version: "1" },
    });
    if (decision.kind !== "approval-required") throw new Error("expected approval");
    const auditLength = before.auditTrail(acknowledgement.workItem.id).length;
    before.close();
    harnesses.length = 0;

    const after = startHarness({ clock: () => afterBrief, statePath });

    expect(after.workItem(acknowledgement.workItem.id)?.intent).toBe(
      "Survive a restart",
    );
    expect(after.approval(decision.approvalId)?.state).toBe("requested");
    expect(after.auditTrail(acknowledgement.workItem.id)).toHaveLength(
      auditLength,
    );
  });

  it("releases notices held overnight on the first tick after the window", async () => {
    const statePath = temporaryStatePath();
    // 23:30 Kuala Lumpur, inside do-not-disturb.
    const held = startHarness({
      clock: () => "2026-08-31T15:30:00.000Z",
      statePath,
    });
    const admission = await held.admitExceptionNotice({
      kind: "completed-outcome-report",
      text: "An Outcome Report is ready",
      idempotencyKey: "rm15:held",
    });
    expect(admission.kind).toBe("held");
    expect(held.telegramMessages()).toHaveLength(0);
    held.close();
    harnesses.length = 0;

    // A restarted process, the next morning, past 07:00.
    const morning = startHarness({ clock: () => nextMorning, statePath });
    const tick = await morning.tickDailyOperations();

    expect(tick.ran).toContain("release-held-exception-notices");
    expect(
      morning
        .telegramMessages()
        .some((message) => message.text.includes("Outcome Report")),
    ).toBe(true);
  });

  it("reports scheduler health in the dashboard without exposing a secret", async () => {
    let clock = afterBrief;
    const harness = startHarness({ clock: () => clock });
    await harness.tickDailyOperations();
    clock = afterRollUp;
    await harness.tickDailyOperations();

    const overview = harness.dashboardOverview({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
    });

    const jobs = overview.scheduler.map((job) => job.job);
    expect(jobs).toContain("morning-brief");
    expect(jobs).toContain("executive-roll-up");
    const brief = overview.scheduler.find((job) => job.job === "morning-brief");
    expect(brief?.lastOccurrenceDate).toBe("2026-08-31");
    expect(brief?.lastOutcome).toBe("succeeded");
    expect(brief?.nextScheduledAt).toBe("2026-08-31T23:30:00.000Z");
    expect(JSON.stringify(overview.scheduler)).not.toContain("100000001");
  });

  it("records a failed run without stopping the other jobs", async () => {
    const harness = startHarness({
      clock: () => afterRollUp,
      // A brief with no calendar configured cannot read its source.
    });
    await harness.failNextScheduledRun("morning-brief");

    const tick = await harness.tickDailyOperations();

    expect(tick.ran).toContain("executive-roll-up");
    expect(tick.failed).toContain("morning-brief");
    const overview = harness.dashboardOverview({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
    });
    expect(
      overview.scheduler.find((job) => job.job === "morning-brief")?.lastOutcome,
    ).toBe("failed");
  });
});
