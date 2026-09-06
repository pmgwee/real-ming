import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createControlPlaneSystemHarness } from "../../src/testing/real-ming-system-harness.js";

/**
 * Architecture Revision 6 moves the single Telegram consumer from the
 * Real-Ming ingress process to the native Hermes gateway (ADR-0020). Telegram
 * allows exactly one reliable polling owner, so the invariant does not relax
 * during the migration -- only its owner moves.
 *
 * These scenarios prove the retained Real-Ming composition can run with that
 * ownership handed over: it must poll nothing, interpret nothing, and still
 * keep its schedules, records and dashboard working. They are the rehearsal
 * that has to pass before the live cutover stops the old consumer.
 */
describe("RM-40 native-gateway composition mode", () => {
  it("starts no Telegram poller when the native gateway owns the transport", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-native-poll-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegramOwnership: "native-hermes-gateway",
      now: () => "2026-09-06T04:00:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9901,
        senderId: "100000001",
        chatId: "100000001",
        text: "/do Prepare the September operating plan",
      });

      const cycle = await harness.runCycle();

      expect(harness.telegramOwnership()).toBe("native-hermes-gateway");
      // Not "failed": a stopped consumer is the intended state, and a health
      // record claiming a failed ingress would page the CEO for a migration
      // that succeeded.
      expect(cycle.telegram.kind).toBe("stopped");
      expect(harness.telegramPollRequests()).toEqual([]);
      const overview = await harness.dashboardOverview();
      expect(overview.workItems).toEqual([]);
      // Scheduled deliveries keep their own owner until milestone 5 gives the
      // briefs to native cron, so outbound messages are expected here. What
      // must not exist is a reply: nothing consumed the CEO's message.
      expect(
        harness.telegramMessages().map((message) => message.text),
      ).not.toContainEqual(
        expect.stringContaining("Prepare the September operating plan"),
      );
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("leaves a role-prefixed message to Hermes instead of reinterpreting it", async () => {
    // The 5 September smoke found `CTO: ...` entering the legacy action parser
    // and never reaching the agent at all. In native mode there is no ingress
    // to reinterpret it, so the bypass cannot recur.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-native-role-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegramOwnership: "native-hermes-gateway",
      now: () => "2026-09-06T04:05:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9902,
        senderId: "100000001",
        chatId: "100000001",
        text: "CTO: explain this stack trace",
      });

      await harness.runCycle();

      const overview = await harness.dashboardOverview();
      expect(overview.workItems).toEqual([]);
      expect(harness.telegramPollRequests()).toEqual([]);
      expect(
        harness.telegramMessages().map((message) => message.text),
      ).not.toContainEqual(expect.stringContaining("stack trace"));
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps schedules, records and the dashboard working without owning Telegram", async () => {
    // The point of the mode: retained Real-Ming data and operations must not
    // depend on holding the transport, or the cutover would take the daily
    // operations down with the poller.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-native-retained-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegramOwnership: "native-hermes-gateway",
      now: () => "2026-09-06T04:10:00.000Z",
    });

    try {
      const cycle = await harness.runCycle();

      expect(cycle.schedule.kind).toBe("ran");
      await expect(harness.dashboardOverview()).resolves.toMatchObject({
        workItems: [],
      });
      expect(await harness.smoke()).toEqual({ kind: "passed" });
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not proxy conversation through the Real-Ming turn coordinator", async () => {
    // Revision 6 removes the mandatory JSON turn envelope. With the native
    // gateway owning conversation, Real-Ming must hold no Hermes conversation
    // of its own, or two systems would claim the same session.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-native-turn-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegramOwnership: "native-hermes-gateway",
      hermesEnabled: true,
      now: () => "2026-09-06T04:15:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9903,
        senderId: "100000001",
        chatId: "100000001",
        text: "What is the next step for my personal agent?",
      });

      await harness.runCycle();

      expect(harness.hermesOverview()).toBeUndefined();
      expect(
        harness.telegramMessages().map((message) => message.text),
      ).not.toContainEqual(expect.stringContaining("Controlled Hermes answered"));
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("still owns Telegram by default, so nothing changes until the cutover runs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-default-owner-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-09-06T04:20:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9904,
        senderId: "100000001",
        chatId: "100000001",
        text: "/do Prepare the September operating plan",
      });

      const cycle = await harness.runCycle();

      expect(harness.telegramOwnership()).toBe("real-ming-ingress");
      expect(cycle.telegram.kind).toBe("ran");
      expect(harness.telegramPollRequests()).not.toEqual([]);
      const overview = await harness.dashboardOverview();
      expect(overview.workItems).toEqual([
        expect.objectContaining({
          intent: "Prepare the September operating plan",
          accountableExecutive: "COO",
          state: "Captured",
        }),
      ]);
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
