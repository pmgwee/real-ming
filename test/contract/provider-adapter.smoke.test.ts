import { describe, expect, it } from "vitest";

import { liveSmokeGate } from "../../src/testing/provider-adapter-contract-harness.js";
import {
  createEphemeralTelegramDeliveryLedger,
  createTelegramProviderAdapter,
} from "../../src/providers/telegram-provider-adapter.js";

const requiredCredentials = ["REAL_MING_TELEGRAM_BOT_TOKEN"] as const;

const gate = liveSmokeGate(process.env, requiredCredentials);

describe("RM-05 live smoke gate", () => {
  it("stays closed unless an explicit flag and credentials are both present", () => {
    expect(liveSmokeGate({}, requiredCredentials)).toEqual({
      enabled: false,
      reason: "REAL_MING_LIVE_SMOKE is not set to 1.",
    });

    expect(
      liveSmokeGate({ REAL_MING_LIVE_SMOKE: "1" }, requiredCredentials),
    ).toEqual({
      enabled: false,
      reason:
        "Missing securely supplied credentials: REAL_MING_TELEGRAM_BOT_TOKEN.",
    });

    expect(
      liveSmokeGate(
        {
          REAL_MING_LIVE_SMOKE: "1",
          REAL_MING_TELEGRAM_BOT_TOKEN: "   ",
        },
        requiredCredentials,
      ).enabled,
    ).toBe(false);

    expect(
      liveSmokeGate(
        {
          REAL_MING_LIVE_SMOKE: "1",
          REAL_MING_TELEGRAM_BOT_TOKEN: "supplied-at-run-time",
        },
        requiredCredentials,
      ).enabled,
    ).toBe(true);
  });

  it.skipIf(gate.enabled)("is closed in the default test run", () => {
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("REAL_MING_LIVE_SMOKE is not set to 1.");
  });
});

describe.skipIf(!gate.enabled)("RM-07 live Telegram read smoke", () => {
  it("reaches Telegram only behind the explicit live-smoke gate", async () => {
    const botToken = process.env["REAL_MING_TELEGRAM_BOT_TOKEN"];
    if (botToken === undefined || botToken.trim().length === 0) {
      throw new Error("The live Telegram credential is not supplied.");
    }
    const adapter = createTelegramProviderAdapter({
      botToken,
      workspaceId: "workspace:real-ming",
      accountReference: "telegram:bot:real-ming",
      deliveryLedger: createEphemeralTelegramDeliveryLedger(),
    });

    const result = await adapter.read({ reference: "live-smoke:get-updates" });

    expect(result.kind).not.toBe("failed");
  });
});
