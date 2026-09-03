import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const afterBrief = "2026-08-30T23:45:00.000Z"; // 07:45 Asia/Kuala_Lumpur
const afterRollUp = "2026-08-31T13:45:00.000Z"; // 21:45 Asia/Kuala_Lumpur

describe("RM-23 scheduler heartbeats and exceptions", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function start(
    clock: () => string,
    schedulerRunnerTimeoutMs?: number,
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm23-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: clock,
      telegram: { ceoTelegramId: "100000001" },
      calendar: { events: [] },
      morningBrief: { calendarId: "ming@example.invalid" },
      ...(schedulerRunnerTimeoutMs === undefined ? {} : { schedulerRunnerTimeoutMs }),
    });
    harnesses.push(harness);
    return harness;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("inventories each active schedule with heartbeat and ownership metadata", () => {
    const harness = start(() => afterBrief);
    const jobs = harness
      .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
      .scheduler;

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: "morning-brief",
          provider: "internal",
          expectedCadence: "daily",
          criticality: "critical",
          accountableExecutive: "COO",
          lastSchedulerHeartbeat: null,
          lastSuccess: null,
          nextExpectedRun: expect.any(String),
          durationMs: null,
          failureStreak: 0,
          evidenceLink: "scheduler-definition:morning-brief",
        }),
        expect.objectContaining({
          job: "executive-roll-up",
          criticality: "routine",
          accountableExecutive: "COO",
        }),
      ]),
    );
  });

  it("notifies once for a failed critical heartbeat and once on recovery", async () => {
    let clock = afterBrief;
    const harness = start(() => clock);
    await harness.failNextScheduledRun("morning-brief");

    const failed = await harness.tickDailyOperations();
    expect(failed.failed).toContain("morning-brief");
    expect(
      harness.telegramMessages().filter((message) => message.text.includes("morning-brief")),
    ).toHaveLength(1);
    expect(harness.telegramMessages().some((message) => message.text.includes("morning-brief"))).toBe(true);

    clock = "2026-08-31T00:00:00.000Z";
    const recovered = await harness.tickDailyOperations();
    expect(recovered.ran).toContain("morning-brief");
    expect(
      harness.telegramMessages().filter((message) => message.text.includes("morning-brief")),
    ).toHaveLength(2);
    expect(
      harness.telegramMessages().some(
        (message) => message.text.includes("morning-brief") && message.text.includes("recovered"),
      ),
    ).toBe(true);

    const health = harness
      .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
      .scheduler.find((job) => job.job === "morning-brief");
    expect(health).toMatchObject({
      lastOutcome: "succeeded",
      failureStreak: 0,
      lastSuccess: expect.any(String),
      lastSchedulerHeartbeat: expect.any(String),
      durationMs: expect.any(Number),
    });
  });

  it("reports a critical occurrence missed before the first scheduler heartbeat", async () => {
    const harness = start(() => afterBrief);

    await harness.tickDailyOperations();

    expect(
      harness.telegramMessages().filter(
        (message) =>
          message.text.includes("morning-brief") &&
          message.text.toLowerCase().includes("missed"),
      ),
    ).toHaveLength(1);
  });

  it("reports a claimed occurrence left unfinished by a crashed process", async () => {
    let clock = afterBrief;
    const harness = start(() => clock);

    harness.claimScheduledRunWithoutCompletion("morning-brief");
    clock = "2026-08-31T23:45:00.000Z";
    await harness.tickDailyOperations();

    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.includes("morning-brief") &&
          message.text.toLowerCase().includes("missed"),
      ),
    ).toBe(true);
  });

  it("preserves and notifies a stale current occurrence before retrying after restart", async () => {
    let clock = afterBrief;
    const harness = start(() => clock, 5);

    harness.claimScheduledRunWithoutCompletion("morning-brief");
    clock = "2026-08-31T00:00:00.000Z"; // 08:00 KL, same operating day
    await harness.tickDailyOperations();

    const health = harness
      .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
      .scheduler.find((job) => job.job === "morning-brief");
    expect(health?.failureHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ occurrenceDate: "2026-08-31" }),
      ]),
    );
  });

  it("surfaces notice persistence failures instead of claiming the heartbeat was handled", async () => {
    const harness = start(() => afterBrief);
    harness.setExceptionNoticeAdmissionFailure("controlled notice persistence failure");

    await expect(harness.tickDailyOperations()).rejects.toThrow(
      "controlled notice persistence failure",
    );
  });

  it("waits for two consecutive routine failures, groups them, and recovers once", async () => {
    let clock = afterRollUp;
    const harness = start(() => clock);
    await harness.failNextScheduledRun("executive-roll-up");
    const first = await harness.tickDailyOperations();
    expect(first.failed).toContain("executive-roll-up");
    expect(harness.telegramMessages().some((message) => message.text.includes("executive-roll-up"))).toBe(false);

    clock = "2026-09-01T13:45:00.000Z";
    await harness.failNextScheduledRun("executive-roll-up");
    const second = await harness.tickDailyOperations();
    expect(second.failed).toContain("executive-roll-up");
    expect(
      harness.telegramMessages().filter((message) =>
        message.text.includes("Scheduler heartbeat") &&
        message.text.includes("executive-roll-up"),
      ),
    ).toHaveLength(1);

    const rollUp = await harness.runExecutiveRollUp();
    expect(rollUp.rollUp.schedulerExceptions).toEqual([
      expect.objectContaining({ job: "executive-roll-up" }),
    ]);

    const third = await harness.tickDailyOperations();
    expect(third.ran).toContain("executive-roll-up");
    expect(
      harness.telegramMessages().filter((message) =>
        message.text.includes("Scheduler heartbeat failed:") &&
        message.text.includes("executive-roll-up"),
      ),
    ).toHaveLength(1);
    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.includes("Scheduler recovered") &&
          message.text.includes("executive-roll-up"),
      ),
    ).toBe(true);

    const health = harness
      .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
      .scheduler.find((job) => job.job === "executive-roll-up");
    expect(health?.failureStreak).toBe(0);
    expect(health?.failureHistory).toHaveLength(2);
    const recoveredRollUp = await harness.runExecutiveRollUp();
    expect(recoveredRollUp.rollUp.schedulerExceptions).toEqual([
      expect.objectContaining({
        job: "executive-roll-up",
        label: expect.stringContaining("recovered"),
      }),
    ]);
  });

  it("times out a hung critical runner and surfaces its heartbeat failure", async () => {
    const harness = start(() => afterBrief, 5);
    harness.hangNextScheduledRun("morning-brief");

    const tick = await harness.tickDailyOperations();

    expect(tick.failed).toContain("morning-brief");
    expect(
      harness.telegramMessages().some(
        (message) => message.text.includes("morning-brief"),
      ),
    ).toBe(true);
    expect(
      harness
        .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
        .scheduler.find((job) => job.job === "morning-brief")?.lastOutcome,
    ).toBe("failed");
    const retry = await harness.tickDailyOperations();
    expect(retry.alreadyRun).toContain("morning-brief");
    expect(retry.failed).not.toContain("morning-brief");
  });

  it("raises a critical notice for a missed occurrence after a known heartbeat", async () => {
    let clock = afterBrief;
    const harness = start(() => clock);
    await harness.tickDailyOperations();

    // The next operating day is missed while the always-on host is down. The
    // following day's tick must report that gap before running today's brief.
    clock = "2026-09-01T23:45:00.000Z"; // 07:45 KL on 2 September
    await harness.tickDailyOperations();

    expect(
      harness.telegramMessages().some(
        (message) =>
          message.text.includes("morning-brief") &&
          message.text.toLowerCase().includes("missed"),
      ),
    ).toBe(true);
  });
});
