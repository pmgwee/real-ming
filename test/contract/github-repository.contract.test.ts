import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createGitHubRepositoryContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-25 GitHub Repository adapter contract", () => {
  it("normalizes repository identity, branches, PRs, checks, reviews, releases and incidents", async () => {
    const harness = createGitHubRepositoryContractHarness();
    const result = await harness.adapter.read({ reference: "pmgwee/subscription-agent" });

    expect(harness.adapter.identity()).toMatchObject({
      provider: "github",
      workspaceId: "workspace:real-ming",
    });
    expect(harness.adapter.capabilities()).toEqual(["read"]);
    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind === "failed") throw new Error("expected GitHub read");
    expect(result.value).toMatchObject({
      fullName: "pmgwee/subscription-agent",
      productionBranch: "main",
      productionHeadSha: "sha-main",
      branches: [
        { name: "main", sha: "sha-main", protected: true },
        { name: "feat/rm-25", sha: "sha-work", protected: false },
      ],
      pullRequests: [{ number: 99, head: { sha: "sha-work" }, base: { branch: "main" } }],
      reviews: [{ pullRequestNumber: 99, reviewer: "reviewer", commitSha: "sha-work" }],
      releases: [{ tag: "v1.2.0", targetSha: "sha-main" }],
      incidents: [{ number: 7, title: "incident" }],
    });
    expect(result.value.checks.some((check) => check.name === "check" && check.conclusion === "success")).toBe(true);
    expect(result.provenance).toMatchObject({ sourceReference: "pmgwee/subscription-agent", freshness: "current" });
  });

  it("reports stale and failed observations, and never exposes the token", async () => {
    const stale = await createGitHubRepositoryContractHarness({ stale: true }).adapter.read({ reference: "pmgwee/subscription-agent" });
    expect(stale).toMatchObject({ kind: "stale" });
    const failed = await createGitHubRepositoryContractHarness({ failure: "permission-denied" }).adapter.read({ reference: "pmgwee/subscription-agent" });
    expect(failed).toMatchObject({ kind: "failed", failure: { class: "permission-denied" } });
    expect(JSON.stringify(failed)).not.toContain(contractSecretFixture);
  });

  it("rejects writes and malformed references before contacting GitHub", async () => {
    const harness = createGitHubRepositoryContractHarness();
    expect(await harness.adapter.read({ reference: "not-a-repository" })).toMatchObject({ kind: "failed", failure: { class: "invalid-input" } });
    expect(await harness.adapter.write({ idempotencyKey: "x", reference: "pmgwee/subscription-agent", payload: {} })).toMatchObject({ kind: "failed", failure: { class: "unsupported-capability" } });
  });
});
