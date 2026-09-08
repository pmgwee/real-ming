import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-40 native Hermes cron scheduler ownership", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function start(now = "2026-09-06T01:00:00.000Z"): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-native-cron-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      telegram: { ceoTelegramId: "100000001" },
      calendar: { events: [], asOf: "2026-09-06T00:00:00.000Z" },
      morningBrief: { calendarId: "primary" },
    });
    harnesses.push(harness);
    return harness;
  }

  it("composes through the existing domain builder and replays the exact text", async () => {
    const harness = start();
    const first = await harness.runNativeScheduledReport({
      job: "morning-brief",
      runId: "hermes-cron-run-1",
    });
    expect(first).toMatchObject({
      kind: "composed",
      job: "morning-brief",
      occurrenceDate: "2026-09-06",
      runId: "hermes-cron-run-1",
      replayed: false,
    });
    if (first.kind !== "composed") throw new Error("Expected a composed report.");
    expect(first.text).toContain("Morning Brief — 2026-09-06");

    const replay = await harness.runNativeScheduledReport({
      job: "morning-brief",
      runId: "hermes-cron-run-1-retry",
    });
    expect(replay).toMatchObject({
      kind: "composed",
      replayed: true,
      payloadDigest: first.payloadDigest,
      text: first.text,
    });
    expect(harness.telegramMessages()).toEqual([]);
  });

  it("does not duplicate a report already delivered by the old scheduler owner", async () => {
    const harness = start("2026-09-06T02:00:00.000Z");
    const old = await harness.tickDailyOperations();
    expect(old.ran).toContain("morning-brief");

    const native = await harness.runNativeScheduledReport({
      job: "morning-brief",
    });
    expect(native).toEqual({
      kind: "skipped",
      reason:
        "The morning-brief occurrence was already completed by the previous scheduler owner.",
    });
  });

  it("rejects a report requested for a different Kuala Lumpur operating date", async () => {
    const result = await start().runNativeScheduledReport({
      job: "executive-roll-up",
      occurrenceDate: "2026-09-05",
    });
    expect(result).toEqual({
      kind: "failed",
      reason:
        "The requested occurrence 2026-09-05 is not today's Asia/Kuala_Lumpur date 2026-09-06.",
    });
  });
});
