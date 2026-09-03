import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createVercelDeploymentContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";
import { vercelDeploymentLineageStatus } from "../../src/portfolio/repository-center.js";

describe("RM-26 Vercel deployment adapter contract", () => {
  it("normalizes preview and production deployments with exact commit metadata", async () => {
    const harness = createVercelDeploymentContractHarness();
    const result = await harness.adapter.read({ reference: "vercel:duitsini" });
    expect(harness.adapter.capabilities()).toEqual(["read"]);
    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind === "failed") throw new Error("expected Vercel read");
    expect(result.value).toMatchObject({
      projectReference: "vercel:duitsini",
      deployments: [
        { id: "vercel-preview", environment: "preview", status: "ready", commitSha: "sha-work", pullRequestNumber: 99, domain: "https://preview.duitsini.test" },
        { id: "vercel-production", environment: "production", status: "ready", commitSha: "sha-main", domain: "https://duitsini.test" },
        { id: "vercel-failed", status: "failed", commitSha: "sha-mismatch" },
        { id: "vercel-cancelled", status: "cancelled", commitSha: null },
      ],
    });
  });

  it("covers stale, missing, failed and read-only cases without leaking the token", async () => {
    expect(await createVercelDeploymentContractHarness({ stale: true }).adapter.read({ reference: "vercel:duitsini" })).toMatchObject({ kind: "stale" });
    const missing = await createVercelDeploymentContractHarness({ missing: true }).adapter.read({ reference: "vercel:duitsini" });
    expect(missing).toMatchObject({ kind: "ok", value: { deployments: [] } });
    const failed = await createVercelDeploymentContractHarness({ failure: "unavailable" }).adapter.read({ reference: "vercel:duitsini" });
    expect(failed).toMatchObject({ kind: "failed", failure: { class: "unavailable" } });
    expect(JSON.stringify(failed)).not.toContain(contractSecretFixture);
    expect(await createVercelDeploymentContractHarness().adapter.write({ idempotencyKey: "x", reference: "vercel:duitsini", payload: {} })).toMatchObject({ kind: "failed", failure: { class: "unsupported-capability" } });
  });

  it("classifies a deployment commit that is absent from GitHub and Git as mismatched", () => {
    expect(vercelDeploymentLineageStatus("sha-mismatch", ["sha-work"], ["sha-main"])).toBe("mismatched");
    expect(vercelDeploymentLineageStatus("sha-work", ["sha-work"], ["sha-main"])).toBe("matched");
    expect(vercelDeploymentLineageStatus(null, ["sha-work"], ["sha-main"])).toBe("unknown");
  });
});
