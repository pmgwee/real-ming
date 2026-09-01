import { describe, expect, it } from "vitest";

import { createGitLineageContractHarness } from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-25 Git lineage adapter contract", () => {
  it("returns exact heads, divergence, tags and deployment associations", async () => {
    const harness = createGitLineageContractHarness();
    const result = await harness.adapter.read({ reference: "C:/controlled/subscription-agent" });
    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind === "failed") throw new Error("expected git read");
    expect(result.value).toMatchObject({
      productionBranch: "main",
      productionHeadSha: "sha-main",
      currentBranch: "feat/rm-25",
      currentHeadSha: "sha-work",
      branches: expect.arrayContaining([
        { name: "main", sha: "sha-main", ahead: 0, behind: 0, divergence: "same" },
        { name: "feat/rm-25", sha: "sha-work", ahead: 2, behind: 1, divergence: "diverged" },
      ]),
      tags: [{ name: "v1.2.0", sha: "sha-main" }],
      deploymentAssociations: [{ provider: "github", commitSha: "sha-main" }],
      worker: { availability: "online", dirty: true, dirtyFiles: 1 },
    });
    expect(harness.commands().every((args) => args[0] === "-C")).toBe(true);
  });

  it("keeps worker state unknown rather than inferring clean when git is offline", async () => {
    const result = await createGitLineageContractHarness({ failure: true }).adapter.read({ reference: "C:/controlled/subscription-agent" });
    expect(result).toMatchObject({ kind: "failed", failure: { class: "unavailable" } });
  });
});
