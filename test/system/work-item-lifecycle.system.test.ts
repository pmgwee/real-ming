import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-03 Work Item lifecycle and commitments", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const temporaryDirectories: string[] = [];

  function startHarness(
    overrides: Omit<
      Parameters<typeof createRealMingSystemHarness>[0],
      "statePath"
    > = {},
  ): RealMingSystemHarness {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      ...overrides,
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    idempotencyKey: string,
  ) {
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey,
      text: "Record one bounded lifecycle outcome",
      expectedEffect: {
        kind: "record-note",
        value: `Lifecycle outcome for ${idempotencyKey}`,
      },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    return acknowledgement.workItem;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("moves material work through planning and completes it only after CEO review", async () => {
    const harness = startHarness();
    const captured = await captureWorkItem(
      harness,
      "telegram:lifecycle:complete",
    );

    const reviewReady = await harness.executeWorkItem(captured.id);

    expect(reviewReady.workItem.state).toBe("Ready for CEO Review");
    expect(harness.auditTrail(captured.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.triaged",
      "work-item.planned",
      "work-item.executing",
      "worker.effect-recorded",
      "work-item.verifying",
      "worker.effect-verified",
      "outcome-report.recorded",
      "work-item.ready-for-ceo-review",
    ]);

    const completed = await harness.reviewWorkItem({
      workItemId: captured.id,
      actorId: "ceo:ming",
      decision: "complete",
    });

    expect(completed.state).toBe("Completed");
    expect(harness.outcomeReport(captured.id)).toEqual(
      reviewReady.outcomeReport,
    );
    expect(harness.auditTrail(captured.id).at(-1)).toMatchObject({
      type: "work-item.completed",
      details: { actorId: "ceo:ming", from: "Ready for CEO Review" },
    });
  });

  it("rejects premature completion and records an explainable audit event", async () => {
    const harness = startHarness();
    const captured = await captureWorkItem(
      harness,
      "telegram:lifecycle:premature-completion",
    );

    await expect(
      harness.reviewWorkItem({
        workItemId: captured.id,
        actorId: "ceo:ming",
        decision: "complete",
      }),
    ).rejects.toThrow(
      "Completion requires verified Review-Ready Work with an Outcome Report.",
    );

    expect(harness.workItem(captured.id)?.state).toBe("Captured");
    expect(harness.auditTrail(captured.id).at(-1)).toMatchObject({
      type: "work-item.transition-rejected",
      details: {
        actorId: "ceo:ming",
        from: "Captured",
        to: "Completed",
        reason: "review-ready-outcome-required",
      },
    });
  });

  it("stops planned work at Awaiting Approval and audits rejected execution", async () => {
    const harness = startHarness();
    const captured = await captureWorkItem(
      harness,
      "telegram:lifecycle:awaiting-approval",
    );

    const awaitingApproval = await harness.stageWorkItemForApproval(captured.id);
    expect(awaitingApproval.state).toBe("Awaiting Approval");

    await expect(harness.executeWorkItem(captured.id)).rejects.toThrow(
      "Awaiting Approval Work cannot execute without an Approval.",
    );
    expect(harness.auditTrail(captured.id).map((event) => event.type)).toEqual([
      "work-item.captured",
      "work-item.triaged",
      "work-item.planned",
      "work-item.awaiting-approval",
      "work-item.transition-rejected",
    ]);
  });

  it.each([
    ["request-changes", "Changes Requested", "Revise the evidence summary"],
    ["cancel", "Cancelled", "The outcome is no longer needed"],
  ] as const)(
    "lets the CEO choose %s for Review-Ready Work",
    async (decision, expectedState, reason) => {
      const harness = startHarness();
      const captured = await captureWorkItem(
        harness,
        `telegram:lifecycle:${decision}`,
      );
      await harness.executeWorkItem(captured.id);

      const reviewed = await harness.reviewWorkItem({
        workItemId: captured.id,
        actorId: "ceo:ming",
        decision,
        reason,
      });

      expect(reviewed.state).toBe(expectedState);
      expect(harness.auditTrail(captured.id).at(-1)).toMatchObject({
        details: {
          actorId: "ceo:ming",
          from: "Ready for CEO Review",
          reason,
        },
      });
    },
  );

  it("prevents an Executive Role from completing its parent Work Item", async () => {
    const harness = startHarness();
    const captured = await captureWorkItem(
      harness,
      "telegram:lifecycle:executive-completion",
    );
    await harness.executeWorkItem(captured.id);

    await expect(
      harness.reviewWorkItem({
        workItemId: captured.id,
        actorId: "executive:COO",
        decision: "complete",
      }),
    ).rejects.toThrow("Only the CEO may review a Work Item outcome.");
    expect(harness.workItem(captured.id)?.state).toBe("Ready for CEO Review");
    expect(harness.auditTrail(captured.id).at(-1)).toMatchObject({
      type: "work-item.transition-rejected",
      details: {
        actorId: "executive:COO",
        from: "Ready for CEO Review",
        to: "Completed",
        reason: "ceo-review-required",
      },
    });
  });

  it("preserves confirmed commitment provenance and stores agent timing as a Proposed Commitment", async () => {
    const harness = startHarness();
    const externalWork = await captureWorkItem(
      harness,
      "telegram:commitment:external",
    );

    const externallyCommitted = await harness.recordWorkItemCommitment({
      workItemId: externalWork.id,
      value: "2026-09-15T09:00:00+08:00",
      actor: {
        kind: "External Source",
        sourceIdentity: "google-calendar:leeahming199@gmail.com",
        sourceReference: "calendar-event:academic-deadline",
        asOf: "2026-08-27T13:00:00+08:00",
      },
    });
    const withExternalProposal = await harness.recordWorkItemCommitment({
      workItemId: externalWork.id,
      value: "2026-09-14T17:00:00+08:00",
      actor: { kind: "Executive Role", executive: "COO" },
    });

    expect(withExternalProposal.confirmedCommitment).toEqual(
      externallyCommitted.confirmedCommitment,
    );
    expect(withExternalProposal).toMatchObject({
      confirmedCommitment: {
        kind: "Externally Sourced",
        value: "2026-09-15T09:00:00+08:00",
        provenance: {
          sourceIdentity: "google-calendar:leeahming199@gmail.com",
          sourceReference: "calendar-event:academic-deadline",
          asOf: "2026-08-27T13:00:00+08:00",
        },
      },
      proposedCommitment: {
        kind: "Proposed Commitment",
        value: "2026-09-14T17:00:00+08:00",
        provenance: { proposedBy: "COO" },
      },
    });

    const ceoWork = await captureWorkItem(
      harness,
      "telegram:commitment:ceo-set",
    );
    const ceoCommitted = await harness.recordWorkItemCommitment({
      workItemId: ceoWork.id,
      value: "2026-09-20T10:00:00+08:00",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });
    const withCeoProposal = await harness.recordWorkItemCommitment({
      workItemId: ceoWork.id,
      value: "2026-09-19T10:00:00+08:00",
      actor: { kind: "Executive Role", executive: "COO" },
    });

    expect(withCeoProposal.confirmedCommitment).toEqual(
      ceoCommitted.confirmedCommitment,
    );
    expect(withCeoProposal.proposedCommitment).toMatchObject({
      kind: "Proposed Commitment",
      value: "2026-09-19T10:00:00+08:00",
    });
  });

  it("keeps a CEO-set commitment unchanged when an external source reports a different date", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "telegram:commitment:ceo-set-is-immutable",
    );

    const ceoCommitted = await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-09-20T10:00:00+08:00",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    await expect(
      harness.recordWorkItemCommitment({
        workItemId: workItem.id,
        value: "2026-09-25T10:00:00+08:00",
        actor: {
          kind: "External Source",
          sourceIdentity: "google-calendar:leeahming199@gmail.com",
          sourceReference: "calendar-event:rescheduled-deadline",
          asOf: "2026-08-27T14:00:00+08:00",
        },
      }),
    ).rejects.toThrow("A CEO-set commitment can only be changed by the CEO.");

    expect(harness.workItem(workItem.id)?.confirmedCommitment).toEqual(
      ceoCommitted.confirmedCommitment,
    );
    expect(harness.auditTrail(workItem.id).at(-1)).toMatchObject({
      type: "work-item.commitment-rejected",
      details: {
        kind: "Externally Sourced",
        reason: "ceo-set-commitment-immutable",
      },
    });
  });

  it("refuses a CEO-set commitment claimed by a non-CEO actor", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "telegram:commitment:non-ceo-actor",
    );

    await expect(
      harness.recordWorkItemCommitment({
        workItemId: workItem.id,
        value: "2026-09-20T10:00:00+08:00",
        actor: { kind: "CEO", actorId: "executive:COO" },
      }),
    ).rejects.toThrow("Only the CEO may set a CEO commitment.");

    expect(harness.workItem(workItem.id)?.confirmedCommitment).toBeNull();
    expect(harness.auditTrail(workItem.id).at(-1)).toMatchObject({
      type: "work-item.commitment-rejected",
      details: { kind: "CEO-set", reason: "ceo-actor-required" },
    });
  });

  it("adds commitment storage to an existing RM-02 database without losing Work Items", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm03-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "operations.sqlite");
    const legacyDatabase = new DatabaseSync(statePath);
    legacyDatabase.exec(`
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        intent TEXT NOT NULL,
        expected_effect_json TEXT NOT NULL,
        accountable_executive TEXT NOT NULL,
        workstream TEXT,
        collaborating_executives_json TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, idempotency_key)
      );
    `);
    legacyDatabase
      .prepare(
        `INSERT INTO work_items (
          id, actor_id, workspace_id, idempotency_key, intent,
          expected_effect_json, accountable_executive, workstream,
          collaborating_executives_json, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Personal CFO', 'Finance', '[]', 'Captured', ?, ?)`,
      )
      .run(
        "legacy-rm-02-work-item",
        "ceo:ming",
        "workspace:real-ming",
        "telegram:legacy:rm-02",
        "Preserve this RM-02 Work Item",
        JSON.stringify({ kind: "record-note", value: "Legacy RM-02 state" }),
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T00:00:00.000Z",
      );
    legacyDatabase.close();

    const harness = createRealMingSystemHarness({ statePath });
    harnesses.push(harness);

    expect(harness.workItem("legacy-rm-02-work-item")).toMatchObject({
      accountableExecutive: "Personal CFO",
      workstream: "Finance",
      state: "Captured",
      confirmedCommitment: null,
      proposedCommitment: null,
    });

    const committed = await harness.recordWorkItemCommitment({
      workItemId: "legacy-rm-02-work-item",
      value: "2026-09-30T09:00:00+08:00",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    expect(committed.confirmedCommitment).toMatchObject({
      kind: "CEO-set",
      value: "2026-09-30T09:00:00+08:00",
      provenance: { actorId: "ceo:ming" },
    });
    expect(
      harness.workItem("legacy-rm-02-work-item")?.confirmedCommitment,
    ).toEqual(committed.confirmedCommitment);
  });

  it("replays a completed Work Item result instead of executing it again", async () => {
    const harness = startHarness();
    const action = {
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:lifecycle:completed-replay",
      intent: "Record one bounded lifecycle outcome",
      expectedEffect: {
        kind: "record-note",
        value: "Completed replay outcome",
      },
    } as const;

    const first = await harness.submitCeoAction(action);
    await harness.reviewWorkItem({
      workItemId: first.workItem.id,
      actorId: "ceo:ming",
      decision: "complete",
    });

    const repeated = await harness.submitCeoAction(action);

    expect(repeated.workItem.state).toBe("Completed");
    expect(repeated.outcomeReport).toEqual(first.outcomeReport);
    expect(harness.controlledEffects()).toHaveLength(1);
    expect(harness.auditTrail(first.workItem.id).at(-1)).toMatchObject({
      type: "work-item.completed",
    });
  });

  it("refuses to execute Changes Requested Work that already recorded an Outcome Report", async () => {
    const harness = startHarness();
    const action = {
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:lifecycle:changes-requested-replay",
      intent: "Record one bounded lifecycle outcome",
      expectedEffect: {
        kind: "record-note",
        value: "Changes requested replay outcome",
      },
    } as const;

    const first = await harness.submitCeoAction(action);
    await harness.reviewWorkItem({
      workItemId: first.workItem.id,
      actorId: "ceo:ming",
      decision: "request-changes",
      reason: "Revise the evidence summary",
    });

    await expect(harness.submitCeoAction(action)).rejects.toThrow(
      "Work with a recorded Outcome Report cannot execute again.",
    );

    expect(harness.controlledEffects()).toHaveLength(1);
    expect(harness.workItem(first.workItem.id)?.state).toBe(
      "Changes Requested",
    );
    expect(harness.outcomeReport(first.workItem.id)).toEqual(
      first.outcomeReport,
    );
    expect(harness.auditTrail(first.workItem.id).at(-1)).toMatchObject({
      type: "work-item.transition-rejected",
      details: {
        from: "Changes Requested",
        to: "Executing",
        reason: "recorded-outcome-cannot-be-replaced",
      },
    });
  });
});
