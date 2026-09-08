import { describe, expect, it } from "vitest";

import { buildDashboardOverview } from "../../src/dashboard/dashboard-read-model.js";
import { renderDashboardPage } from "../../src/dashboard/dashboard-page.js";
import { OperationsState } from "../../src/operations/operations-state.js";
import type { NativeKnowledgeRunHealth } from "../../src/knowledge/native-consolidation/contracts.js";

describe("native knowledge dashboard read model", () => {
  it("projects opaque run, generation, tombstone and repair health without payloads", () => {
    const state = new OperationsState(":memory:");
    const health: NativeKnowledgeRunHealth = {
      runId: "native-knowledge:run:controlled",
      lastSuccess: "2026-09-09T02:00:00.000Z",
      lastFailureCode: null,
      backlog: 2,
      activeGenerationId: "native-knowledge-generation-controlled",
      tombstoneHeadEpoch: 3,
      staleCount: 1,
      quarantinedCount: 1,
      repairState: "healthy",
      isolationEligible: true,
    };
    try {
      const overview = buildDashboardOverview(
        state,
        { actorId: "ceo:ming", workspaceId: "workspace:real-ming", now: "2026-09-09T02:01:00.000Z" },
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        health,
      );
      expect(overview.knowledgeConsolidation).toEqual(health);
      const html = renderDashboardPage(overview);
      expect(html).toContain("native-knowledge-health");
      expect(html).toContain("native-knowledge-generation-controlled");
      expect(html).toContain("head epoch");
      expect(html).not.toContain("Project claim");
      expect(html).not.toContain("MEMORY.md");
    } finally {
      state.close();
    }
  });

  it("shows repair and isolation ineligibility as health, never as a content payload", () => {
    const state = new OperationsState(":memory:");
    try {
      const overview = buildDashboardOverview(
        state,
        { actorId: "ceo:ming", workspaceId: "workspace:real-ming" },
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        {
          runId: null,
          lastSuccess: null,
          lastFailureCode: "registry-unavailable",
          backlog: 1,
          activeGenerationId: null,
          tombstoneHeadEpoch: 0,
          staleCount: 0,
          quarantinedCount: 0,
          repairState: "needs-repair",
          isolationEligible: false,
        },
      );
      const html = renderDashboardPage(overview);
      expect(html).toContain("needs-repair");
      expect(html).toContain("false");
      expect(html).not.toContain("registry-unavailable\nclaim");
    } finally {
      state.close();
    }
  });
});
