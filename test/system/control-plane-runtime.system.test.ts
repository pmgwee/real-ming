import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
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
});
