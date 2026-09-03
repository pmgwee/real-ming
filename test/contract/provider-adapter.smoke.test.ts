import { describe, expect, it } from "vitest";

import { liveSmokeGate } from "../../src/testing/provider-adapter-contract-harness.js";
import {
  createEphemeralTelegramDeliveryLedger,
  createTelegramProviderAdapter,
} from "../../src/providers/telegram-provider-adapter.js";
import { createGoogleCalendarAdapter } from "../../src/providers/google-calendar-adapter.js";
import { googleTokenEndpoint } from "../../src/config/google-oauth.js";

const requiredCredentials = ["REAL_MING_TELEGRAM_BOT_TOKEN"] as const;

const calendarCredentials = [
  "REAL_MING_GOOGLE_CLIENT_ID",
  "REAL_MING_GOOGLE_CLIENT_SECRET",
  "REAL_MING_GOOGLE_REFRESH_TOKEN",
] as const;

const gate = liveSmokeGate(process.env, requiredCredentials);
const calendarGate = liveSmokeGate(process.env, calendarCredentials);

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

describe("RM-12 Google Calendar live smoke gate", () => {
  it("stays closed unless the flag and every Google credential are present", () => {
    expect(liveSmokeGate({}, calendarCredentials)).toEqual({
      enabled: false,
      reason: "REAL_MING_LIVE_SMOKE is not set to 1.",
    });

    expect(
      liveSmokeGate(
        {
          REAL_MING_LIVE_SMOKE: "1",
          REAL_MING_GOOGLE_CLIENT_ID: "supplied-at-run-time",
        },
        calendarCredentials,
      ),
    ).toEqual({
      enabled: false,
      reason:
        "Missing securely supplied credentials: REAL_MING_GOOGLE_CLIENT_SECRET, REAL_MING_GOOGLE_REFRESH_TOKEN.",
    });
  });

  it.skipIf(calendarGate.enabled)("is closed in the default test run", () => {
    expect(calendarGate.enabled).toBe(false);
  });
});

describe.skipIf(!calendarGate.enabled)("RM-12 live Google Calendar read smoke", () => {
  it("reads one calendar without writing to it", async () => {
    const body = new URLSearchParams({
      client_id: process.env["REAL_MING_GOOGLE_CLIENT_ID"] ?? "",
      client_secret: process.env["REAL_MING_GOOGLE_CLIENT_SECRET"] ?? "",
      refresh_token: process.env["REAL_MING_GOOGLE_REFRESH_TOKEN"] ?? "",
      grant_type: "refresh_token",
    });
    const tokenResponse = await fetch(googleTokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(tokenResponse.ok).toBe(true);
    const token: unknown = await tokenResponse.json();
    const accessToken =
      typeof token === "object" &&
      token !== null &&
      typeof (token as Record<string, unknown>)["access_token"] === "string"
        ? ((token as Record<string, unknown>)["access_token"] as string)
        : "";
    expect(accessToken.length).toBeGreaterThan(0);

    const adapter = createGoogleCalendarAdapter({
      accessToken,
      workspaceId: "workspace:real-ming",
      accountReference: "google-calendar:account:real-ming",
    });

    const result = await adapter.listEvents("primary");

    expect(result.kind).not.toBe("failed");
    if (result.kind !== "failed") {
      expect(result.identity.provider).toBe("google-calendar");
      expect(result.provenance.asOf.length).toBeGreaterThan(0);
    }
  });
});
