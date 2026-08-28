import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Workstream } from "../../src/operations/contracts.js";
import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("RM-09 Master Tasks Work Views", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "real-ming-rm09-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("projects gateway-created Work Items into the CEO and accountable Executive views", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-29T02:00:00.000Z",
    });

    try {
      const expectedRoutes = [
        ["Personal Life", "Personal", "COO", "COO Work View"],
        ["Career Job", "Personal", "COO", "COO Work View"],
        ["Finance", "Finance", "Personal CFO", "Personal CFO Work View"],
        ["Academic", "Academic", "CAO", "CAO Work View"],
        ["MicroSaaS", "Ming Creatives", "CTO", "CTO Work View"],
        ["Content Creation", "Ming Creatives", "CMO", "CMO Work View"],
      ] as const;

      for (const [workstream, trustDomain, executive, viewName] of expectedRoutes) {
        const result = await harness.submitCeoCommand({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          idempotencyKey: `rm09:create:${workstream}`,
          text: `Please coordinate ${workstream} work`,
          workstream,
          expectedEffect: { kind: "controlled", value: workstream },
        });
        expect(result.kind).toBe("work-item-acknowledgement");
        if (result.kind !== "work-item-acknowledgement") {
          throw new Error("Expected a Work Item acknowledgement.");
        }

        const projection = (await harness
          .masterTasksView(viewName))
          .find((item) => item.workItemId === result.workItem.id);
        expect(projection).toMatchObject({
          id: result.workItem.id,
          workItemId: result.workItem.id,
          workspaceId: "workspace:real-ming",
          trustDomain,
          workstream,
          accountableExecutive: executive,
          lifecycle: "Captured",
        });
        expect(await harness.masterTasksView("CEO All Work")).toContainEqual(projection);
      }
    } finally {
      harness.close();
    }
  });

  it("writes a Work View edit through to the same durable Work Item without copying it", async () => {
    const statePath = join(directory, "state.sqlite");
    const first = createRealMingSystemHarness({
      statePath,
      now: () => "2026-08-29T02:00:00.000Z",
    });
    let workItemId: string;

    try {
      const result = await first.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "rm09:create:finance",
        text: "Please coordinate Finance work",
        workstream: "Finance",
        expectedEffect: { kind: "controlled", value: "Finance" },
      });
      if (result.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      workItemId = result.workItem.id;

      first.simulateMasterTasksProviderEdit(workItemId, {
        priority: "High",
        updatedAt: "2026-08-29T02:01:00.000Z",
      });
      await first.reconcileMasterTasks();
      const edited = (await first.masterTasksView("Personal CFO Work View"))
        .find((item) => item.workItemId === workItemId);
      if (edited === undefined) throw new Error("Expected the edited Master Tasks record.");
      expect(edited.id).toBe(workItemId);
      expect(first.workItem(workItemId)).toMatchObject({ priority: "High" });
      expect(first.workItems().filter((item) => item.id === workItemId)).toHaveLength(1);
      expect(
        (await first
          .masterTasksView("CEO All Work"))
          .find((item) => item.workItemId === workItemId),
      ).toEqual(edited);

      await first.reconcileMasterTasks();
      expect(
        first
          .auditTrail(workItemId)
          .filter((event) => event.type === "work-item.priority-recorded"),
      ).toHaveLength(1);
    } finally {
      first.close();
    }

    const reconstructed = createRealMingSystemHarness({ statePath });
    try {
      expect(reconstructed.workItem(workItemId)).toMatchObject({ priority: "High" });
      expect(
        (await reconstructed.masterTasksView("Personal CFO Work View")).map((item) => item.id),
      ).toEqual([workItemId]);
    } finally {
      reconstructed.close();
    }
  });

  it("keeps lifecycle validation and audit on the Operations Gateway", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-29T02:00:00.000Z",
    });

    try {
      const result = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "rm09:create:academic",
        text: "Please coordinate Academic work",
        workstream: "Academic",
        expectedEffect: { kind: "controlled", value: "Academic" },
      });
      if (result.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }

      harness.simulateMasterTasksProviderEdit(result.workItem.id, {
        lifecycle: "Completed",
        updatedAt: "2026-08-29T02:01:00.000Z",
      });
      await expect(harness.reconcileMasterTasks()).rejects.toThrow(
        "must go through the Operations Gateway",
      );
      expect(harness.workItem(result.workItem.id)).toMatchObject({ state: "Captured" });
      expect(await harness.masterTasksView("CAO Work View")).toContainEqual(
        expect.objectContaining({
          workItemId: result.workItem.id,
          lifecycle: "Captured",
        }),
      );

      await expect(
        harness.reviewWorkItem({
          workItemId: result.workItem.id,
          actorId: "ceo:ming",
          decision: "complete",
        }),
      ).rejects.toThrow("Completion requires verified Review-Ready Work");
      expect((await harness.masterTasksView("CAO Work View"))[0]).toMatchObject({
        lifecycle: "Captured",
      });
      expect(harness.auditTrail(result.workItem.id)).toContainEqual(
        expect.objectContaining({ type: "work-item.transition-rejected" }),
      );

      await harness.executeWorkItem(result.workItem.id);
      expect((await harness.masterTasksView("CAO Work View"))[0]).toMatchObject({
        lifecycle: "Ready for CEO Review",
        outcomeReportReference: expect.any(String),
      });
    } finally {
      harness.close();
    }
  });

  it("refuses to expose a Work Item through a mismatched Executive view", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });

    try {
      for (const workstream of ["Finance", "Academic"] satisfies Workstream[]) {
        await harness.submitCeoCommand({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          idempotencyKey: `rm09:isolation:${workstream}`,
          text: `Please coordinate ${workstream} work`,
          workstream,
          expectedEffect: { kind: "controlled", value: workstream },
        });
      }
      expect(await harness.masterTasksView("Personal CFO Work View")).toHaveLength(1);
      expect(await harness.masterTasksView("CAO Work View")).toHaveLength(1);
      expect(await harness.masterTasksView("CTO Work View")).toHaveLength(0);
    } finally {
      harness.close();
    }
  });

  it("keeps an explicitly addressed Executive without a Workstream in that role's Trust Domain", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
    });
    try {
      const result = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "rm09:explicit-cto:no-workstream",
        text: "CTO, inspect this product concern",
        addressedExecutive: "CTO",
        expectedEffect: { kind: "controlled", value: "inspect" },
      });
      if (result.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      expect(await harness.masterTasksView("CTO Work View")).toContainEqual(
        expect.objectContaining({
          workItemId: result.workItem.id,
          workstream: null,
          trustDomain: "Ming Creatives",
        }),
      );
    } finally {
      harness.close();
    }
  });

  it.each([
    ["worker", { controlledWorker: { executionError: "controlled worker failed" } }],
    ["verifier", { controlledVerifier: { result: "error" as const } }],
  ])("publishes Waiting/Blocked after a %s failure", async (_kind, failureOptions) => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, `state-${_kind}.sqlite`),
      ...failureOptions,
    });
    try {
      const result = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: `rm09:${_kind}:failure`,
        text: "Coordinate failure-path evidence",
        workstream: "MicroSaaS",
        expectedEffect: { kind: "controlled", value: "failure" },
      });
      if (result.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await expect(harness.executeWorkItem(result.workItem.id)).rejects.toThrow();
      expect(await harness.masterTasksView("CTO Work View")).toContainEqual(
        expect.objectContaining({
          workItemId: result.workItem.id,
          lifecycle: "Waiting/Blocked",
        }),
      );
    } finally {
      harness.close();
    }
  });
});
