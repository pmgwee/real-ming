import { describe, expect, it } from "vitest";

import {
  createKeyVaultContractHarness,
  harnessBearerToken,
} from "../../src/testing/provider-adapter-contract-harness.js";

// The value the vault would hand back. If it ever reaches a report, a log line
// or an error message, these assertions see it.
const storedSecret = "ntn_real-ming-notion-secret-material";

describe("RM-15 Azure Key Vault reader contract", () => {
  it("reads a secret through the managed identity, with no credential in the code", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
    });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "found", value: storedSecret });
    // The token comes from the instance metadata service, which is reachable
    // only from the machine itself. Nothing here carries a stored credential.
    expect(harness.tokenRequestCount()).toBe(1);
    expect(harness.requestedUrls()[0]).toContain("169.254.169.254");
    expect(harness.requestedUrls()[1]).toContain(
      "real-ming-vault.vault.azure.net/secrets/real-ming-notion-token",
    );
  });

  it("acquires the identity token once and reuses it across every secret", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: {
        "real-ming-notion-token": storedSecret,
        "real-ming-vault-key": "vault-key-material",
        "real-ming-dashboard-token": "dashboard-token-material",
      },
    });

    await harness.reader.read("real-ming-notion-token");
    await harness.reader.read("real-ming-vault-key");
    await harness.reader.read("real-ming-dashboard-token");

    // Ten credentials must not mean ten token requests. Each one is a round
    // trip on a cold start, when the CEO is waiting for the service to answer.
    expect(harness.tokenRequestCount()).toBe(1);
  });

  it("reports a refused read as forbidden rather than as an absent secret", async () => {
    // This is exactly what a missing Key Vault Secrets User role assignment
    // looks like. Calling it "absent" would send the CEO to re-paste a
    // credential that is already stored correctly.
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
      secretStatus: 403,
    });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "failed", failure: "forbidden" });
  });

  it("reports an unknown secret as absent so the environment can supply it", async () => {
    const harness = createKeyVaultContractHarness({ secrets: {} });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "absent" });
  });

  it("reports an unreachable metadata service as unavailable", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
      tokenFailure: "unreachable",
    });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "failed", failure: "unavailable" });
  });

  it("reports a refused identity token as forbidden", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
      tokenStatus: 401,
    });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "failed", failure: "forbidden" });
  });

  it("reports a vault outage as unavailable rather than crashing the start-up", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
      secretStatus: 503,
    });

    const result = await harness.reader.read("real-ming-notion-token");

    expect(result).toEqual({ kind: "failed", failure: "unavailable" });
  });

  it("never puts the bearer token or the secret value in a failure", async () => {
    const harness = createKeyVaultContractHarness({
      secrets: { "real-ming-notion-token": storedSecret },
      secretStatus: 500,
      errorBody: `token=${harnessBearerToken} value=${storedSecret}`,
    });

    const result = await harness.reader.read("real-ming-notion-token");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(storedSecret);
    expect(serialized).not.toContain(harnessBearerToken);
  });

  it("refuses a secret name the vault could not hold, before any call", async () => {
    const harness = createKeyVaultContractHarness({ secrets: {} });

    const result = await harness.reader.read("REAL_MING_NOTION_TOKEN");

    expect(result).toEqual({ kind: "absent" });
    // Key Vault names are lowercase alphanumerics and hyphens. Sending an
    // underscore would spend a round trip to be told what we already know.
    expect(harness.requestedUrls()).toEqual([]);
  });
});
