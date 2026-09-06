import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

/**
 * The Real-Ming extension under Architecture Revision 6.
 *
 * Hermes is the runtime; this is the small set of operations it cannot perform
 * for itself. The scenarios below are the contract: what the work means, and
 * which native task did it. Anything an agent could answer without Real-Ming
 * does not belong here.
 */
describe("RM-40 Real-Ming extension tools", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-extension-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-09-06T05:00:00.000Z",
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    intent: string,
  ): Promise<string> {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `extension-${intent}`,
      intent,
      expectedEffect: { kind: "record-note", value: `Extension scenario: ${intent}` },
      accountableExecutive: "CTO",
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("The harness did not capture a Work Item.");
    }
    return acknowledgement.workItem.id;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("offers only the operations the native runtime cannot perform itself", () => {
    const names = startHarness()
      .realMingTools()
      .map((tool) => tool.name)
      .sort();

    expect(names).toEqual([
      "real_ming_get_work_item",
      "real_ming_link_execution_task",
      "real_ming_list_work_items",
    ]);
  });

  it("reports the Notion category a lifecycle state presents as", async () => {
    // The status vocabulary is the single most valuable thing Real-Ming knows.
    // An agent reading raw Notion has no way to learn it.
    const harness = startHarness();
    await captureWorkItem(harness, "Prepare the September operating plan");

    const result = harness.callRealMingTool("real_ming_list_work_items", {});

    expect(result.kind).toBe("ok");
    const value = (result as { readonly value: { readonly workItems: readonly Record<string, unknown>[] } }).value;
    expect(value.workItems).toEqual([
      expect.objectContaining({
        intent: "Prepare the September operating plan",
        state: "Captured",
        notionCategory: "Pending",
        completed: false,
        awaitingCeoDecision: false,
        accountableExecutive: "CTO",
      }),
    ]);
  });

  it("never lets review-ready work read as completed", async () => {
    // `Pending to Review` means Ming still has to decide. Collapsing it into
    // `Done` is the exact mistake the status-semantics document exists to stop,
    // and an agent summarising the week is where it would happen.
    const harness = startHarness();
    await captureWorkItem(harness, "Ship the DuitSini fix");

    const listed = harness.callRealMingTool("real_ming_list_work_items", {});
    const workItems = (listed as { readonly value: { readonly workItems: readonly { readonly state: string; readonly completed: boolean }[] } }).value.workItems;

    for (const item of workItems) {
      if (item.state !== "Completed") expect(item.completed).toBe(false);
    }
  });

  it("does not create a second link when a retry replays the same key", async () => {
    // An agent whose connection drops mid-call retries. Two links to one piece
    // of work would later read as two pieces of work.
    const harness = startHarness();
    const workItemId = await captureWorkItem(harness, "Add the recurring-cycle fix");

    const first = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId,
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "duitsini-cycle-fix",
    });
    const replay = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId,
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "duitsini-cycle-fix",
    });

    expect(first).toMatchObject({ kind: "ok", value: { deduplicated: false } });
    expect(replay).toMatchObject({ kind: "ok", value: { deduplicated: true } });

    const detail = harness.callRealMingTool("real_ming_get_work_item", { workItemId });
    const tasks = (detail as { readonly value: { readonly executionTasks: readonly unknown[] } }).value.executionTasks;
    expect(tasks).toHaveLength(1);
  });

  it("refuses to link work that does not exist rather than recording a dangling fact", () => {
    const harness = startHarness();

    const result = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId: "work-item:does-not-exist",
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "dangling",
    });

    expect(result).toEqual({
      kind: "failed",
      reason: "No Work Item work-item:does-not-exist.",
    });
  });

  it("reports a missing Work Item instead of inventing an empty one", () => {
    const harness = startHarness();

    expect(
      harness.callRealMingTool("real_ming_get_work_item", {
        workItemId: "work-item:absent",
      }),
    ).toEqual({ kind: "failed", reason: "No Work Item work-item:absent." });
  });

  it("names an unknown tool rather than failing silently", () => {
    expect(
      startHarness().callRealMingTool("real_ming_delete_everything", {}),
    ).toEqual({ kind: "failed", reason: "Unknown tool real_ming_delete_everything." });
  });

  it("validates its arguments before touching durable state", () => {
    const harness = startHarness();

    expect(
      harness.callRealMingTool("real_ming_link_execution_task", {
        workItemId: "work-item:whatever",
      }),
    ).toEqual({
      kind: "failed",
      reason: "workItemId, nativeTaskId and idempotencyKey are all required.",
    });
  });
});
