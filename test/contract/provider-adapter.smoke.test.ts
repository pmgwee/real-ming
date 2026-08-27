import { describe, expect, it } from "vitest";

import { liveSmokeGate } from "../../src/testing/provider-adapter-contract-harness.js";

const requiredCredentials = ["REAL_MING_SMOKE_PROVIDER_TOKEN"] as const;

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
        "Missing securely supplied credentials: REAL_MING_SMOKE_PROVIDER_TOKEN.",
    });

    expect(
      liveSmokeGate(
        {
          REAL_MING_LIVE_SMOKE: "1",
          REAL_MING_SMOKE_PROVIDER_TOKEN: "   ",
        },
        requiredCredentials,
      ).enabled,
    ).toBe(false);

    expect(
      liveSmokeGate(
        {
          REAL_MING_LIVE_SMOKE: "1",
          REAL_MING_SMOKE_PROVIDER_TOKEN: "supplied-at-run-time",
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

describe.skipIf(!gate.enabled)("RM-05 live provider smoke", () => {
  it("reaches the live provider and reports normalized provenance", () => {
    throw new Error(
      "No live provider adapter is registered for smoke testing yet.",
    );
  });
});
