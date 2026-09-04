import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createControlPlaneSystemHarness,
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const everyCredential = [
  "REAL_MING_TELEGRAM_BOT_TOKEN",
  "REAL_MING_TELEGRAM_CEO_ID",
  "REAL_MING_NOTION_TOKEN",
  "REAL_MING_NOTION_MASTER_TASKS_ID",
  "REAL_MING_GOOGLE_CLIENT_ID",
  "REAL_MING_GOOGLE_CLIENT_SECRET",
  "REAL_MING_GOOGLE_REFRESH_TOKEN",
  "REAL_MING_DASHBOARD_TOKEN",
  "REAL_MING_VAULT_KEY",
  "REAL_MING_WORKER_SHARED_SECRET",
] as const;

// A value shaped like a real token, so a leak into a message or a source label
// is visible in the assertion rather than hidden behind a placeholder.
const secretShapedValue = "8123456789:AAH-real-ming-secret-material-do-not-log";

function environmentWithEveryCredential(): Record<string, string> {
  return Object.fromEntries(
    everyCredential.map((name) => [name, `${secretShapedValue}/${name}`]),
  );
}

describe("RM-15 control plane credential resolution", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-runtime-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegram: { ceoTelegramId: "100000001" },
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

  it("runs from environment variables alone, with no vault configured", async () => {
    // Day 31 moves this service to a host that has no Azure Key Vault. If the
    // runtime needed a vault to start, that migration would be a rewrite.
    const harness = startHarness();

    const resolved = await harness.resolveControlPlaneCredentials({
      environment: environmentWithEveryCredential(),
    });

    expect(resolved.ready).toBe(true);
    expect(resolved.missing).toEqual([]);
    expect([...resolved.resolvedFrom.values()]).toEqual(
      everyCredential.map(() => "environment"),
    );
  });

  it("fills only the gaps from the vault, leaving the environment authoritative", async () => {
    const harness = startHarness();
    const environment = environmentWithEveryCredential();
    delete environment.REAL_MING_NOTION_TOKEN;
    delete environment.REAL_MING_VAULT_KEY;

    const resolved = await harness.resolveControlPlaneCredentials({
      environment,
      vault: {
        secrets: {
          // The vault holds a stale copy of a credential the environment also
          // carries. The environment must win, or a redeploy that rotates a
          // token through the unit file would be silently reverted.
          "real-ming-telegram-bot-token": "stale-vault-copy",
          "real-ming-notion-token": "vault-notion-token",
          "real-ming-vault-key": "vault-derived-key",
        },
      },
    });

    expect(resolved.ready).toBe(true);
    expect(resolved.resolvedFrom.get("REAL_MING_TELEGRAM_BOT_TOKEN")).toBe(
      "environment",
    );
    expect(resolved.resolvedFrom.get("REAL_MING_NOTION_TOKEN")).toBe(
      "azure-key-vault",
    );
    expect(resolved.resolvedFrom.get("REAL_MING_VAULT_KEY")).toBe(
      "azure-key-vault",
    );
  });

  it("maps each variable to its lowercase hyphenated vault secret name", async () => {
    const harness = startHarness();

    const resolved = await harness.resolveControlPlaneCredentials({
      environment: {},
      vault: {
        secrets: Object.fromEntries(
          everyCredential.map((name) => [
            name.toLowerCase().replaceAll("_", "-"),
            `vault/${name}`,
          ]),
        ),
      },
    });

    expect(resolved.ready).toBe(true);
    expect(resolved.missing).toEqual([]);
  });

  it("reports what is missing by name and never by value", async () => {
    const harness = startHarness();
    const environment = environmentWithEveryCredential();
    delete environment.REAL_MING_GOOGLE_REFRESH_TOKEN;
    delete environment.REAL_MING_DASHBOARD_TOKEN;

    const resolved = await harness.resolveControlPlaneCredentials({
      environment,
    });

    expect(resolved.ready).toBe(false);
    expect(resolved.missing).toEqual([
      "REAL_MING_GOOGLE_REFRESH_TOKEN",
      "REAL_MING_DASHBOARD_TOKEN",
    ]);
    expect(JSON.stringify(resolved.report)).not.toContain(secretShapedValue);
    expect(resolved.report).toContain("REAL_MING_DASHBOARD_TOKEN");
  });

  it("never contacts the vault when the environment already carries everything", async () => {
    // A Key Vault outage must not take the control plane down. The strongest
    // form of that is not resilience but irrelevance: with a full environment
    // the vault is never asked, so a broken one cannot affect startup at all.
    // This is also what makes the day-31 host swap a redeploy, not a rewrite.
    const harness = startHarness();

    const resolved = await harness.resolveControlPlaneCredentials({
      environment: environmentWithEveryCredential(),
      vault: { failure: "unavailable" },
    });

    expect(resolved.ready).toBe(true);
    expect(resolved.vaultFailure).toBeNull();
    expect(resolved.report).not.toContain("unavailable");
    expect(JSON.stringify(resolved.report)).not.toContain(secretShapedValue);
  });

  it("stops asking a failed vault instead of retrying it for every credential", async () => {
    const harness = startHarness();
    let reads = 0;

    const resolved = await harness.resolveControlPlaneCredentials({
      environment: {},
      vault: {
        failure: "unavailable",
        onRead: () => {
          reads += 1;
        },
      },
    });

    expect(resolved.ready).toBe(false);
    expect(resolved.missing).toHaveLength(10);
    // One outage means every later read fails identically. Ten timeouts would
    // turn a brief vault blip into a startup that hangs.
    expect(reads).toBe(1);
  });

  it("names the vault failure rather than reporting the credential as absent", async () => {
    const harness = startHarness();
    const environment = environmentWithEveryCredential();
    delete environment.REAL_MING_NOTION_TOKEN;

    const resolved = await harness.resolveControlPlaneCredentials({
      environment,
      vault: { failure: "forbidden" },
    });

    expect(resolved.ready).toBe(false);
    expect(resolved.missing).toEqual(["REAL_MING_NOTION_TOKEN"]);
    // "Missing" and "the vault refused us" are different faults with different
    // fixes. Reporting a role-assignment problem as an absent secret would send
    // the CEO to re-paste a credential that is already there.
    expect(resolved.vaultFailure).toBe("forbidden");
    expect(resolved.report).toContain("forbidden");
  });

  it("treats a blank vault secret as absent rather than as a credential", async () => {
    const harness = startHarness();
    const environment = environmentWithEveryCredential();
    delete environment.REAL_MING_WORKER_SHARED_SECRET;

    const resolved = await harness.resolveControlPlaneCredentials({
      environment,
      vault: { secrets: { "real-ming-worker-shared-secret": "   " } },
    });

    expect(resolved.ready).toBe(false);
    expect(resolved.missing).toEqual(["REAL_MING_WORKER_SHARED_SECRET"]);
  });
});

describe("RM-15 Telegram ingress across a restart", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  const ceoTelegramId = "100000001";

  function startHarness(options?: {
    readonly statePath?: string;
    readonly ingressFailureFor?: number;
  }): RealMingSystemHarness {
    let path = options?.statePath;
    if (path === undefined) {
      const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-ingress-"));
      directories.push(directory);
      path = join(directory, "state.sqlite");
    }
    const failFor = options?.ingressFailureFor;
    const harness = createRealMingSystemHarness({
      statePath: path,
      telegram:
        failFor === undefined
          ? { ceoTelegramId }
          : { ceoTelegramId, ingressFailureFor: failFor },
    });
    harnesses.push(harness);
    return harness;
  }

  function update(updateId: number, text: string) {
    return {
      updateId,
      message: {
        messageId: updateId,
        senderId: ceoTelegramId,
        chatId: ceoTelegramId,
        text,
      },
    };
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts from no cursor and advances past what it processed", async () => {
    const harness = startHarness();

    const polled = await harness.pollTelegramUpdates([
      update(9001, "Draft the September plan"),
      update(9002, "Book the dentist"),
    ]);

    expect(polled.processed).toBe(2);
    expect(polled.skipped).toBe(0);
    expect(harness.telegramIngressCursor()).toBe(9002);
  });

  it("does not replay a message the CEO already sent when the service restarts", async () => {
    // Telegram redelivers every update until the offset moves. If the cursor
    // lived in memory, a restart would re-run the CEO's instructions -- the
    // same duplicate-execution fault the scheduler already guards against.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-ingress-"));
    directories.push(directory);
    const statePath = join(directory, "state.sqlite");

    const before = startHarness({ statePath });
    await before.pollTelegramUpdates([
      update(9101, "Draft the September plan"),
      update(9102, "Book the dentist"),
    ]);
    const handledBefore = before.telegramAuditTrail().length;
    before.close();
    harnesses.splice(harnesses.indexOf(before), 1);

    const after = startHarness({ statePath });
    expect(after.telegramIngressCursor()).toBe(9102);

    const polled = await after.pollTelegramUpdates([
      update(9101, "Draft the September plan"),
      update(9102, "Book the dentist"),
      update(9103, "Renew the parking permit"),
    ]);

    expect(polled.skipped).toBe(2);
    expect(polled.processed).toBe(1);
    // Exactly one more handling event: the new update was processed and the
    // two the CEO already sent were not run a second time.
    expect(after.telegramAuditTrail().length).toBe(handledBefore + 1);
  });

  it("holds the cursor when an update fails so the message is not lost", async () => {
    // Advancing past an update that was never handled would drop a CEO
    // instruction silently. Telegram will redeliver it only while the offset
    // stays behind it.
    const harness = startHarness({ ingressFailureFor: 9202 });

    const polled = await harness.pollTelegramUpdates([
      update(9201, "Draft the September plan"),
      update(9202, "This one throws"),
      update(9203, "Renew the parking permit"),
    ]);

    expect(polled.processed).toBe(1);
    expect(polled.failed).toBe(1);
    expect(harness.telegramIngressCursor()).toBe(9201);
  });

  it("ignores an update older than the cursor even when Telegram resends it", async () => {
    const harness = startHarness();
    await harness.pollTelegramUpdates([update(9301, "Draft the September plan")]);

    const polled = await harness.pollTelegramUpdates([
      update(9299, "A stale redelivery"),
    ]);

    expect(polled.processed).toBe(0);
    expect(polled.skipped).toBe(1);
    expect(harness.telegramIngressCursor()).toBe(9301);
  });
});

describe("RM-15 control plane supervisor", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-sup-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegram: { ceoTelegramId: "100000001" },
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

  it("keeps the schedule running when Telegram polling fails", async () => {
    // The two loops share a process but must not share a fate. A Telegram
    // outage that stopped the scheduler would silently cancel the morning
    // brief and the roll-up -- the CEO would notice only by their absence.
    const harness = startHarness();
    const supervisor = harness.superviseControlPlane({
      pollTelegram: async () => {
        throw new Error("Telegram is unreachable.");
      },
    });

    const cycle = await supervisor.runCycle();

    expect(cycle.telegram.kind).toBe("failed");
    expect(cycle.schedule.kind).toBe("ran");
    expect(supervisor.running()).toBe(true);
  });

  it("keeps Telegram answering when a scheduled job throws", async () => {
    const harness = startHarness();
    const supervisor = harness.superviseControlPlane({
      tickSchedule: async () => {
        throw new Error("The roll-up failed.");
      },
    });

    const cycle = await supervisor.runCycle();

    expect(cycle.schedule.kind).toBe("failed");
    expect(cycle.telegram.kind).toBe("ran");
    expect(supervisor.running()).toBe(true);
  });

  it("reports a cycle failure without putting the cause in the record", async () => {
    // Cycle records are written to the service journal on every pass. An
    // exception message can carry a URL with a token in it.
    const harness = startHarness();
    const supervisor = harness.superviseControlPlane({
      pollTelegram: async () => {
        throw new Error(
          "getUpdates failed for https://api.telegram.org/bot8123:SECRET/getUpdates",
        );
      },
    });

    const cycle = await supervisor.runCycle();

    expect(JSON.stringify(cycle)).not.toContain("SECRET");
    expect(JSON.stringify(cycle)).not.toContain("api.telegram.org");
  });

  it("stops cleanly and refuses to run another cycle", async () => {
    const harness = startHarness();
    const supervisor = harness.superviseControlPlane({});

    await supervisor.runCycle();
    supervisor.stop();

    expect(supervisor.running()).toBe(false);
    const afterStop = await supervisor.runCycle();
    expect(afterStop.telegram.kind).toBe("stopped");
    expect(afterStop.schedule.kind).toBe("stopped");
  });

  it("keeps both loops alive until the process is asked to stop", async () => {
    const harness = startHarness();
    let telegramPolls = 0;
    let scheduleTicks = 0;
    let supervisor: ReturnType<typeof harness.superviseControlPlane>;
    supervisor = harness.superviseControlPlane({
      pollTelegram: async () => {
        telegramPolls += 1;
      },
      tickSchedule: async () => {
        scheduleTicks += 1;
      },
      wait: async () => {
        if (telegramPolls === 3) supervisor.stop();
      },
    });

    await supervisor.run();

    expect(telegramPolls).toBe(3);
    expect(scheduleTicks).toBe(3);
    expect(supervisor.running()).toBe(false);
  });
});

describe("RM-15 production-equivalent control plane composition", () => {
  it("shows secret-safe control-plane failure and recovery health", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-health-"));
    let now = "2026-08-30T22:00:00.000Z";
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
    });
    try {
      harness.failNextTelegramPoll();
      expect((await harness.runCycle()).telegram.kind).toBe("failed");
      now = "2026-08-30T22:01:00.000Z";
      expect((await harness.runCycle()).telegram.kind).toBe("ran");
      const overview = await harness.dashboardOverview();
      const telegram = overview.controlPlane.find(
        (component) => component.component === "telegram-ingress",
      );

      expect(telegram).toEqual(
        expect.objectContaining({
          lastOutcome: "healthy",
          consecutiveFailures: 0,
          lastRecoveredAt: "2026-08-30T22:01:00.000Z",
        }),
      );
      expect(JSON.stringify(overview.controlPlane)).not.toContain(
        "controlled failure",
      );
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the container and systemd deployment package under automated checks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-deploy-check-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });
    try {
      expect(await harness.deploymentPreflight(process.cwd())).toEqual({
        kind: "passed",
        failures: [],
      });
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("turns one Telegram command into the same Work Item shown by the dashboard", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-composed-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-30T22:00:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9401,
        senderId: "100000001",
        chatId: "100000001",
        text: "/do Prepare the September operating plan",
      });

      const cycle = await harness.runCycle();
      const overview = await harness.dashboardOverview();

      expect(cycle.telegram.kind).toBe("ran");
      expect(overview.workItems).toEqual([
        expect.objectContaining({
          intent: "Prepare the September operating plan",
          accountableExecutive: "COO",
          state: "Captured",
        }),
      ]);
      expect(harness.telegramMessages()).toHaveLength(1);
      expect(await harness.smoke()).toEqual({ kind: "passed" });
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores durable work and audit state from a live SQLite backup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-backup-"));
    const statePath = join(directory, "state.sqlite");
    const backupPath = join(directory, "backup.sqlite");
    const before = await createControlPlaneSystemHarness({
      statePath,
      now: () => "2026-08-30T22:00:00.000Z",
    });

    try {
      before.queueTelegramUpdate({
        updateId: 9501,
        senderId: "100000001",
        chatId: "100000001",
        text: "/do Preserve this Work Item",
      });
      await before.runCycle();
      await before.backup(backupPath);
    } finally {
      await before.close();
    }

    const restored = await createControlPlaneSystemHarness({
      statePath: backupPath,
      now: () => "2026-08-30T22:05:00.000Z",
    });
    try {
      const overview = await restored.dashboardOverview();
      expect(overview.workItems).toEqual([
        expect.objectContaining({ intent: "Preserve this Work Item" }),
      ]);
      expect(overview.auditEvents.length).toBeGreaterThan(0);
    } finally {
      await restored.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backs up operations state and the Notion idempotency ledger as one set", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-backup-set-"));
    const sourceStatePath = join(directory, "source-state.sqlite");
    const sourceLedgerPath = join(directory, "source-notion-ledger.sqlite");
    const harness = await createControlPlaneSystemHarness({
      statePath: sourceStatePath,
      notionLedgerPath: sourceLedgerPath,
      now: () => "2026-08-30T22:00:00.000Z",
    });

    try {
      harness.queueTelegramUpdate({
        updateId: 9551,
        senderId: "100000001",
        chatId: "100000001",
        text: "/do Preserve the entire production recovery set",
      });
      await harness.runCycle();
      const backup = await harness.backupSet(join(directory, "backups"));

      expect(backup.manifest.files.map((file) => file.role)).toEqual([
        "operations-state",
        "notion-write-ledger",
      ]);
      expect(backup.manifest.files.every((file) => file.sha256.length === 64)).toBe(true);
      expect(
        (await harness.dashboardOverview()).controlPlane.find(
          (component) => component.component === "state-backup",
        ),
      ).toEqual(
        expect.objectContaining({
          lastOutcome: "healthy",
          lastCheckedAt: "2026-08-30T22:00:00.000Z",
        }),
      );

      await expect(
        harness.backupSet(join(directory, "failed-backups"), {
          failUpload: true,
        }),
      ).rejects.toThrow("Remote state backup failed");
      expect(
        (await harness.dashboardOverview()).controlPlane.find(
          (component) => component.component === "state-backup",
        )?.lastOutcome,
      ).toBe("failed");

      const restored = await createControlPlaneSystemHarness({
        statePath: backup.statePath,
        notionLedgerPath: backup.notionLedgerPath,
        now: () => "2026-08-30T22:05:00.000Z",
      });
      try {
        const overview = await restored.dashboardOverview();
        expect(overview.workItems[0]?.intent).toBe(
          "Preserve the entire production recovery set",
        );
      } finally {
        await restored.close();
      }
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not duplicate a Telegram command after the process restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-restart-"));
    const statePath = join(directory, "state.sqlite");
    const update = {
      updateId: 9601,
      senderId: "100000001",
      chatId: "100000001",
      text: "/do Survive the control-plane restart",
    } as const;
    const before = await createControlPlaneSystemHarness({
      statePath,
      now: () => "2026-08-30T22:00:00.000Z",
    });
    before.queueTelegramUpdate(update);
    await before.runCycle();
    await before.close();

    const after = await createControlPlaneSystemHarness({
      statePath,
      now: () => "2026-08-30T22:05:00.000Z",
    });
    try {
      after.queueTelegramUpdate(update);
      await after.runCycle();
      const overview = await after.dashboardOverview();

      expect(overview.workItems).toHaveLength(1);
      expect(overview.workItems[0]?.intent).toBe(
        "Survive the control-plane restart",
      );
      expect(after.telegramMessages()).toHaveLength(0);
    } finally {
      await after.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("routes an ordinary production Telegram turn through the configured Hermes API edge", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-hermes-production-"));
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      hermesEnabled: true,
      now: () => "2026-09-04T12:00:00.000Z",
    });
    try {
      harness.queueTelegramUpdate({
        updateId: 9801,
        senderId: "100000001",
        chatId: "100000001",
        text: "What is the next step for my personal agent?",
      });
      await harness.runCycle();
      expect(harness.telegramMessages()).toContainEqual({
        chatId: "100000001",
        text: "Controlled Hermes answered: What is the next step for my personal agent?",
      });
      expect(harness.hermesOverview()).toMatchObject({
        status: "healthy",
        model: "gpt-5.6-sol",
        sessionCount: 1,
        turnCount: 1,
        lastIntent: "answer",
      });
      await expect(harness.dashboardOverview()).resolves.toMatchObject({
        hermes: expect.objectContaining({ sessionCount: 1, turnCount: 1 }),
      });
    } finally {
      await harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retries a durable failed notification after the process restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-delivery-"));
    const statePath = join(directory, "state.sqlite");
    const before = await createControlPlaneSystemHarness({
      statePath,
      telegramSendFailures: 1,
      now: () => "2026-08-30T22:00:00.000Z",
    });
    before.queueTelegramUpdate({
      updateId: 9701,
      senderId: "100000001",
      chatId: "100000001",
      text: "/do Retry my durable acknowledgement",
    });
    await before.runCycle();
    expect(before.telegramMessages()).toHaveLength(0);
    await before.close();

    const after = await createControlPlaneSystemHarness({
      statePath,
      now: () => "2026-08-30T22:05:00.000Z",
    });
    try {
      await after.runCycle();
      expect(after.telegramMessages()).toHaveLength(1);
    } finally {
      await after.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports Telegram unhealthy while durable notification retries still fail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-retry-health-"));
    const statePath = join(directory, "state.sqlite");
    const before = await createControlPlaneSystemHarness({
      statePath,
      telegramSendFailures: 1,
      now: () => "2026-08-30T22:00:00.000Z",
    });
    before.queueTelegramUpdate({
      updateId: 9751,
      senderId: "100000001",
      chatId: "100000001",
      text: "/do Keep failed delivery recovery visible",
    });
    await before.runCycle();
    await before.close();

    const after = await createControlPlaneSystemHarness({
      statePath,
      telegramSendFailures: 1,
      now: () => "2026-08-30T22:05:00.000Z",
    });
    try {
      expect((await after.runCycle()).telegram.kind).toBe("failed");
      const telegram = (await after.dashboardOverview()).controlPlane.find(
        (component) => component.component === "telegram-ingress",
      );
      expect(telegram?.lastOutcome).toBe("failed");
    } finally {
      await after.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("RM-15 an ordinary question must not wedge the front door", () => {
  const directories: string[] = [];
  const open: { close(): Promise<void> }[] = [];

  function temporaryStatePath(): string {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-wedge-"));
    directories.push(directory);
    return join(directory, "state.sqlite");
  }

  afterEach(async () => {
    for (const harness of open.splice(0)) await harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("answers a question rather than falling silent", async () => {
    // The command classifier routes anything starting "what/when/who/how..."
    // to the question responder. The cloud control plane has no responder
    // until RM-21, but "not yet" must be said out loud: silence is
    // indistinguishable from the service being dead.
    const harness = await createControlPlaneSystemHarness({
      statePath: temporaryStatePath(),
      now: () => "2026-08-30T22:00:00.000Z",
    });
    open.push(harness);

    harness.queueTelegramUpdate({
      updateId: 9701,
      senderId: "100000001",
      chatId: "100000001",
      text: "What is on my plate today?",
    });
    await harness.runCycle();

    expect(harness.telegramMessages().length).toBeGreaterThan(0);
  });

  it("advances past a question so later messages still arrive", async () => {
    // Telegram redelivers every update until the offset moves. A question that
    // never clears the cursor blocks every message the CEO sends afterwards
    // until Telegram's retention drops it, roughly a day later.
    const harness = await createControlPlaneSystemHarness({
      statePath: temporaryStatePath(),
      now: () => "2026-08-30T22:00:00.000Z",
    });
    open.push(harness);

    harness.queueTelegramUpdate({
      updateId: 9801,
      senderId: "100000001",
      chatId: "100000001",
      text: "What is on my plate today?",
    });
    await harness.runCycle();

    harness.queueTelegramUpdate({
      updateId: 9802,
      senderId: "100000001",
      chatId: "100000001",
      text: "/do Renew the parking permit",
    });
    await harness.runCycle();

    const overview = await harness.dashboardOverview();
    expect(
      overview.workItems.some((item) =>
        item.intent.includes("Renew the parking permit"),
      ),
    ).toBe(true);
  });

});

describe("RM-15 health writes are cheap without being late", () => {
  const directories: string[] = [];
  const open: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    for (const harness of open.splice(0)) await harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports a failure on the cycle it happens, not on a later heartbeat", async () => {
    // Health is no longer written on every cycle, because at one cycle a
    // second that was ~173,000 upserts a day into the database holding every
    // durable Work Item. The saving must never cost latency on the one
    // transition the CEO needs to see.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-health-"));
    directories.push(directory);
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-30T22:00:00.000Z",
    });
    open.push(harness);

    await harness.runCycle();
    const healthy = (await harness.dashboardOverview()).controlPlane?.find(
      (component) => component.component === "telegram-ingress",
    );
    expect(healthy?.lastOutcome).toBe("healthy");

    harness.failNextTelegramPoll();
    await harness.runCycle();

    const failed = (await harness.dashboardOverview()).controlPlane?.find(
      (component) => component.component === "telegram-ingress",
    );
    expect(failed?.lastOutcome).toBe("failed");
  });
});

describe("RM-15 bookkeeping must not kill the loops", () => {
  const directories: string[] = [];
  const harnesses: RealMingSystemHarness[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("survives a failing health write when both loops succeeded", async () => {
    // The health record is written outside the per-loop isolation. A full disk
    // or a SQLITE_BUSY there used to propagate out of run() and exit the
    // process -- taking down a control plane whose loops had both just worked.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-book-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegram: { ceoTelegramId: "100000001" },
    });
    harnesses.push(harness);

    const supervisor = harness.superviseControlPlane({
      onCycle: () => {
        throw new Error("The health recorder failed.");
      },
    });

    const cycle = await supervisor.runCycle();

    expect(cycle.telegram.kind).toBe("ran");
    expect(cycle.schedule.kind).toBe("ran");
    expect(supervisor.running()).toBe(true);
  });
});

describe("RM-15 the deployed control plane long-polls Telegram", () => {
  const directories: string[] = [];
  const open: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    for (const harness of open.splice(0)) await harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("asks Telegram to hold the connection rather than polling every second", async () => {
    // The adapter supporting long polling is not the same as the deployed
    // composition using it. Without this the service issues roughly 86,000
    // getUpdates a day, almost all empty, and a sustained request rate is what
    // earns a rate limit -- which stops the CEO's messages arriving at all.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-poll-"));
    directories.push(directory);
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-30T22:00:00.000Z",
    });
    open.push(harness);

    await harness.runCycle();

    expect(harness.telegramPollRequests()).toEqual([
      expect.objectContaining({ timeout: 20 }),
    ]);
  });
});

describe("RM-15 backup without an off-host destination", () => {
  const directories: string[] = [];
  const open: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    for (const harness of open.splice(0)) await harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes a complete backup set with no storage account configured", async () => {
    // Off-host backup is an enhancement, not a requirement: no acceptance
    // criterion asks for it, it is Azure-specific, and the day-31 host will
    // not have it. Requiring a storage account to take any backup at all made
    // the durable local copy hostage to a cloud resource that need not exist.
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm15-local-"));
    directories.push(directory);
    const harness = await createControlPlaneSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-30T22:00:00.000Z",
    });
    open.push(harness);
    await harness.runCycle();

    const set = await harness.backupSet(join(directory, "backups"), {
      localOnly: true,
    });

    expect(existsSync(set.statePath)).toBe(true);
    expect(existsSync(set.notionLedgerPath)).toBe(true);
    expect(set.manifest.files.map((file) => file.role).sort()).toEqual([
      "notion-write-ledger",
      "operations-state",
    ]);
    for (const file of set.manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
