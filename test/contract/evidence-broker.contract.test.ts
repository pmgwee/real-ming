import { describe, expect, it } from "vitest";

import {
  createAgentBrainEvidenceContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";
import type { AgentBrainEvidenceReadResult } from "../../src/evidence/evidence-broker.js";

const cited: AgentBrainEvidenceReadResult = {
  kind: "ok",
  sourceIdentity: "agent-brain:duitsini",
  canonicalEvidenceId: "evidence:duitsini:1",
  sourceReference: "agent-brain://duitsini/evidence/1",
  content: "Controlled cited evidence.",
  citations: ["agent-brain://duitsini/evidence/1"],
  asOf: "2026-09-02T08:00:00.000Z",
  retrievedAt: "2026-09-02T09:00:00.000Z",
  freshness: "current",
};

describe("RM-20 Agent Brain provider contract", () => {
  it("exposes read-only, provenance-bearing results and preserves provider failures", async () => {
    const harness = createAgentBrainEvidenceContractHarness(cited);
    expect(await harness.provider.read({
      workspaceId: "workspace:real-ming",
      projectId: "project:duitsini",
      evidenceIdentity: "agent-brain:duitsini",
      purpose: "review",
    })).toEqual(cited);
    harness.setResult({ kind: "failed", reason: "provider-unavailable" });
    expect(await harness.provider.read({
      workspaceId: "workspace:real-ming",
      projectId: "project:duitsini",
      evidenceIdentity: "agent-brain:duitsini",
      purpose: "review",
    })).toEqual({ kind: "failed", reason: "provider-unavailable" });
    expect(harness.readCount()).toBe(2);
    expect("write" in harness.provider).toBe(false);
  });
});
