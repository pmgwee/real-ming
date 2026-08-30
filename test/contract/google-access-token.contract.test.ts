import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createGoogleAccessTokenContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-15 Google access token contract", () => {
  it("exchanges the refresh token for an access token", async () => {
    const harness = createGoogleAccessTokenContractHarness();

    const result = await harness.tokens.current();

    expect(result.kind).toBe("ok");
    expect(harness.exchangeCount()).toBe(1);
  });

  it("holds the token rather than exchanging on every calendar read", async () => {
    const harness = createGoogleAccessTokenContractHarness();

    await harness.tokens.current();
    await harness.tokens.current();
    await harness.tokens.current();

    expect(harness.exchangeCount()).toBe(1);
  });

  it("renews before the token expires, not after it has already failed", async () => {
    const harness = createGoogleAccessTokenContractHarness({ expiresIn: 3600 });

    await harness.tokens.current();
    // Inside the renewal margin: the held token would still be accepted, but
    // renewing now avoids a request that expires in flight.
    harness.advance(3_600_000 - 30_000);
    await harness.tokens.current();

    expect(harness.exchangeCount()).toBe(2);
  });

  it("separates a revoked refresh token from an outage", async () => {
    // Revocation needs the CEO to re-consent; an outage needs a retry. Treating
    // them alike would either spin forever or raise a false alarm.
    const revoked = createGoogleAccessTokenContractHarness({ status: 400 });
    const down = createGoogleAccessTokenContractHarness({ unreachable: true });

    expect(await revoked.tokens.current()).toEqual({
      kind: "failed",
      reason: "refused",
    });
    expect(await down.tokens.current()).toEqual({
      kind: "failed",
      reason: "unavailable",
    });
  });

  it("never puts the client secret or refresh token in a failure", async () => {
    const harness = createGoogleAccessTokenContractHarness({
      status: 400,
      errorBody: `invalid_grant for ${contractSecretFixture}`,
    });

    const result = await harness.tokens.current();

    expect(JSON.stringify(result)).not.toContain(contractSecretFixture);
  });
});
