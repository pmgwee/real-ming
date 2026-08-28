import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("RM-09 Master Tasks and linked Work Views", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "real-ming-rm09-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("provisions one canonical schema and six views over the same records idempotently", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });

    try {
      const first = await harness.provisionMasterTasks({
        parentPageId: "parent:real-ming-operations",
        idempotencyKey: "rm09:provision:v1",
      });
      const replay = await harness.provisionMasterTasks({
        parentPageId: "parent:real-ming-operations",
        idempotencyKey: "rm09:provision:v1",
      });

      expect(first.dataSourceName).toBe("Master Tasks");
      expect(first.schema.map((property) => property.name)).toEqual([
        "Title",
        "Work Item ID",
        "Workspace",
        "Source",
        "Source Reference",
        "Intent",
        "Trust Domain",
        "Workstream",
        "Accountable Executive",
        "Collaborating Executives",
        "Lifecycle",
        "Priority",
        "Commitment Value",
        "Commitment Provenance",
        "Risk Class",
        "Approval Required",
        "Approval Reference",
        "Portfolio Project",
        "Evidence References",
        "Outcome Report Reference",
        "Created At",
        "Updated At",
      ]);
      expect(first.views).toEqual([
        expect.objectContaining({ name: "CEO All Work", filter: null }),
        expect.objectContaining({
          name: "COO Work View",
          accountableExecutive: "COO",
        }),
        expect.objectContaining({
          name: "Personal CFO Work View",
          accountableExecutive: "Personal CFO",
        }),
        expect.objectContaining({
          name: "CAO Work View",
          accountableExecutive: "CAO",
        }),
        expect.objectContaining({
          name: "CTO Work View",
          accountableExecutive: "CTO",
        }),
        expect.objectContaining({
          name: "CMO Work View",
          accountableExecutive: "CMO",
        }),
      ]);
      expect(new Set(first.views.map((view) => view.dataSourceId))).toEqual(
        new Set([first.dataSourceId]),
      );
      expect(replay).toEqual(first);
      expect(harness.masterTasksExternalEffectCount()).toBe(7);
    } finally {
      harness.close();
    }
  });

  it("routes all six Workstreams to one accountable role and exposes one shared Work Item", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });

    try {
      await harness.provisionMasterTasks({
        parentPageId: "parent:real-ming-operations",
        idempotencyKey: "rm09:provision:v1",
      });

      const expectedRoutes = [
        ["Personal Life", "Personal", "COO", "COO Work View"],
        ["Career Job", "Personal", "COO", "COO Work View"],
        ["Finance", "Finance", "Personal CFO", "Personal CFO Work View"],
        ["Academic", "Academic", "CAO", "CAO Work View"],
        ["MicroSaaS", "Ming Creatives", "CTO", "CTO Work View"],
        ["Content Creation", "Ming Creatives", "CMO", "CMO Work View"],
      ] as const;

      for (const [workstream, trustDomain, executive, viewName] of expectedRoutes) {
        const workItemId = `work:${workstream}`;
        const created = await harness.putMasterTask({
          idempotencyKey: `create:${workstream}`,
          workItemId,
          workspaceId: "workspace:real-ming",
          title: `${workstream} work`,
          intent: `Coordinate ${workstream}`,
          workstream,
          source: "CEO request",
          sourceReference: `telegram:${workstream}`,
        });

        expect(created).toMatchObject({
          workItemId,
          trustDomain,
          accountableExecutive: executive,
          lifecycle: "Captured",
        });
        expect(harness.masterTasksView("CEO All Work")).toContainEqual(created);
        expect(harness.masterTasksView(viewName)).toContainEqual(created);
      }

      const financeBefore = harness.masterTasksView("Personal CFO Work View")[0];
      if (financeBefore === undefined) {
        throw new Error("Expected the Finance Work Item.");
      }
      const edited = await harness.editMasterTaskThroughView({
        viewName: "Personal CFO Work View",
        workItemId: financeBefore.workItemId,
        idempotencyKey: "finance:priority:high",
        priority: "High",
      });

      expect(edited.id).toBe(financeBefore.id);
      expect(
        harness
          .masterTasksView("CEO All Work")
          .find((item) => item.workItemId === financeBefore.workItemId),
      ).toEqual(edited);
      expect(await harness.putMasterTask({
        idempotencyKey: "create:Finance",
        workItemId: "work:Finance",
        workspaceId: "workspace:real-ming",
        title: "Finance work",
        intent: "Coordinate Finance",
        workstream: "Finance",
        source: "CEO request",
        sourceReference: "telegram:Finance",
      })).toEqual(financeBefore);
      expect(
        harness
          .masterTasksView("CEO All Work")
          .filter((item) => item.workItemId === "work:Finance"),
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("validates lifecycle transitions before writing the canonical record", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });

    try {
      await harness.provisionMasterTasks({
        parentPageId: "parent:real-ming-operations",
        idempotencyKey: "rm09:provision:v1",
      });
      await harness.putMasterTask({
        idempotencyKey: "create:academic",
        workItemId: "work:academic",
        workspaceId: "workspace:real-ming",
        title: "Academic work",
        intent: "Coordinate Academic",
        workstream: "Academic",
        source: "CEO request",
        sourceReference: "telegram:academic",
      });

      await expect(
        harness.transitionMasterTask({
          workItemId: "work:academic",
          idempotencyKey: "academic:complete-too-soon",
          to: "Completed",
        }),
      ).rejects.toThrow("Captured -> Completed");
      expect(harness.masterTasksView("CAO Work View")[0]).toMatchObject({
        lifecycle: "Captured",
      });

      await expect(
        harness.transitionMasterTask({
          workItemId: "work:academic",
          idempotencyKey: "academic:triage",
          to: "Triaged",
        }),
      ).resolves.toMatchObject({ lifecycle: "Triaged" });
    } finally {
      harness.close();
    }
  });
});

