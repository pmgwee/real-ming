import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-02 Executive Role command routing", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades an RM-01 database before persisting Executive Role routing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm02-"));
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
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, idempotency_key)
      );

      CREATE TABLE outcome_reports (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL UNIQUE,
        requested_intent TEXT NOT NULL,
        completed_effect_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        remaining_risks_json TEXT NOT NULL,
        required_decisions_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacyDatabase
      .prepare(
        `INSERT INTO work_items (
          id, actor_id, workspace_id, idempotency_key, intent,
          expected_effect_json, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Captured', ?, ?)`,
      )
      .run(
        "legacy-work-item",
        "ceo:ming",
        "workspace:real-ming",
        "telegram:legacy:rm-01",
        "Preserve this RM-01 Work Item",
        JSON.stringify({ kind: "record-note", value: "Legacy state" }),
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T00:00:00.000Z",
      );
    legacyDatabase
      .prepare(
        `INSERT INTO work_items (
          id, actor_id, workspace_id, idempotency_key, intent,
          expected_effect_json, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Ready for CEO Review', ?, ?)`,
      )
      .run(
        "legacy-review-ready",
        "ceo:ming",
        "workspace:real-ming",
        "telegram:legacy:review-ready",
        "Preserve this completed RM-01 execution",
        JSON.stringify({ kind: "record-note", value: "Legacy outcome" }),
        "2026-08-27T00:01:00.000Z",
        "2026-08-27T00:02:00.000Z",
      );
    legacyDatabase
      .prepare(
        `INSERT INTO outcome_reports (
          id, work_item_id, requested_intent, completed_effect_json,
          verification_json, remaining_risks_json,
          required_decisions_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-outcome-report",
        "legacy-review-ready",
        "Preserve this completed RM-01 execution",
        JSON.stringify({
          idempotencyKey:
            "workspace:real-ming:telegram:legacy:review-ready:effect",
          kind: "record-note",
          value: "Legacy outcome",
        }),
        JSON.stringify({
          status: "verified",
          evidence: {
            kind: "controlled-effect-reference",
            reference:
              "workspace:real-ming:telegram:legacy:review-ready:effect",
          },
        }),
        "[]",
        JSON.stringify(["CEO review required before completion."]),
        "2026-08-27T00:02:00.000Z",
      );
    legacyDatabase.close();

    const harness = createRealMingSystemHarness({ statePath });
    harnesses.push(harness);

    expect(harness.workItem("legacy-work-item")).toMatchObject({
      accountableExecutive: "COO",
      workstream: null,
      collaboratingExecutives: [],
      state: "Captured",
    });
    expect(harness.outcomeReport("legacy-review-ready")).toMatchObject({
      completedEffect: {
        workItemId: "legacy-review-ready",
        executive: "COO",
        authority: "accountable",
        kind: "record-note",
        value: "Legacy outcome",
      },
    });

    const resumed = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:legacy:review-ready",
      intent: "Preserve this completed RM-01 execution",
      expectedEffect: { kind: "record-note", value: "Legacy outcome" },
    });
    expect(resumed.outcomeReport.completedEffect).toMatchObject({
      workItemId: "legacy-review-ready",
      executive: "COO",
      authority: "accountable",
    });

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:migration:rm-01-to-rm-02",
      text: "Capture the next finance review",
      workstream: "Finance",
      expectedEffect: {
        kind: "record-note",
        value: "Finance review captured",
      },
    });

    expect(result).toMatchObject({
      kind: "work-item-acknowledgement",
      workItem: {
        accountableExecutive: "Personal CFO",
        workstream: "Finance",
        collaboratingExecutives: [],
        state: "Captured",
      },
    });
  });

  it("answers an information question without creating a Work Item", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledQuestionAnswer:
        "The Daily Operations tracer is the first rollout slice.",
    });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:question:daily-operations",
      text: "Tell me which tracer is implemented first",
    });

    expect(result).toEqual({
      kind: "information-answer",
      answer: "The Daily Operations tracer is the first rollout slice.",
    });
    expect(harness.workItems()).toEqual([]);
    expect(harness.controlledEffects()).toEqual([]);
  });

  it.each([
    "Please tell me which tracer is implemented first",
    "Can I see my current priorities?",
    "Could you show me today's schedule?",
  ])("answers the natural information request %j", async (text) => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledQuestionAnswer: "Here is the requested information.",
    });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `telegram:question:${text}`,
      text,
    });

    expect(result).toEqual({
      kind: "information-answer",
      answer: "Here is the requested information.",
    });
    expect(harness.workItems()).toEqual([]);
  });

  it("asks one focused clarification and performs no action for an ambiguous request", async () => {
    const harness = createRealMingSystemHarness({ statePath: ":memory:" });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:ambiguous:project-request",
      text: "Can you handle the project situation?",
    });

    expect(result).toEqual({
      kind: "clarification",
      question:
        "What specific outcome should Real-Ming produce for this request?",
    });
    expect(harness.workItems()).toEqual([]);
    expect(harness.controlledEffects()).toEqual([]);
  });

  it("routes an unqualified action to the COO as its one Accountable Executive", async () => {
    const harness = createRealMingSystemHarness({ statePath: ":memory:" });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:action:unqualified",
      text: "Record the Daily Operations implementation status",
      expectedEffect: {
        kind: "record-note",
        value: "Daily Operations implementation is active",
      },
    });

    expect(result).toMatchObject({
      kind: "work-item-acknowledgement",
      workItem: {
        accountableExecutive: "COO",
        state: "Captured",
      },
    });
    expect(harness.workItems()).toHaveLength(1);
    expect(harness.controlledEffects()).toEqual([]);
    if (result.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    expect(harness.outcomeReport(result.workItem.id)).toBeUndefined();

    const executed = await harness.executeWorkItem(result.workItem.id);
    expect(executed.workItem.state).toBe("Ready for CEO Review");
    expect(harness.controlledEffects()).toHaveLength(1);
  });

  it("durably acknowledges an action before a later worker failure", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledWorker: { executionError: "provider is unavailable" },
    });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:action:ack-before-worker",
      text: "Record the current operations status",
      expectedEffect: {
        kind: "record-note",
        value: "Operations status captured",
      },
    });

    expect(result).toMatchObject({
      kind: "work-item-acknowledgement",
      workItem: { state: "Captured" },
    });
    expect(harness.controlledEffects()).toEqual([]);
    if (result.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }

    await expect(harness.executeWorkItem(result.workItem.id)).rejects.toThrow(
      "Controlled work failed before verification.",
    );
    expect(harness.workItem(result.workItem.id)).toMatchObject({
      state: "Waiting/Blocked",
    });
  });

  it.each(["CTO", "Personal CFO", "CAO", "CMO"] as const)(
    "routes an explicitly addressed action directly to the %s",
    async (addressedExecutive) => {
      const harness = createRealMingSystemHarness({ statePath: ":memory:" });
      harnesses.push(harness);

      const result = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: `telegram:action:explicit:${addressedExecutive}`,
        text: `Perform bounded work for ${addressedExecutive}`,
        addressedExecutive,
        expectedEffect: {
          kind: "record-note",
          value: `${addressedExecutive} received the bounded work`,
        },
      });

      expect(result).toMatchObject({
        kind: "work-item-acknowledgement",
        workItem: { accountableExecutive: addressedExecutive },
      });
      expect(harness.workItems()).toHaveLength(1);
      if (result.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(result.workItem.id);
      expect(harness.controlledEffects()).toEqual([
        expect.objectContaining({
          executive: addressedExecutive,
          authority: "accountable",
        }),
      ]);
    },
  );

  it("lets an explicit Executive Role override inferred Workstream ownership", async () => {
    const harness = createRealMingSystemHarness({ statePath: ":memory:" });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:action:explicit-role-over-workstream",
      text: "Ask the CMO to contribute a finance communication",
      addressedExecutive: "CMO",
      workstream: "Finance",
      expectedEffect: {
        kind: "record-note",
        value: "Finance communication captured",
      },
    });

    expect(result).toMatchObject({
      kind: "work-item-acknowledgement",
      workItem: {
        accountableExecutive: "CMO",
        workstream: "Finance",
      },
    });
  });

  it.each([
    ["Personal Life", "COO"],
    ["Career Job", "COO"],
    ["Finance", "Personal CFO"],
    ["Academic", "CAO"],
    ["MicroSaaS", "CTO"],
    ["Content Creation", "CMO"],
  ] as const)(
    "routes the %s Workstream to the %s when no role is explicitly addressed",
    async (workstream, accountableExecutive) => {
      const harness = createRealMingSystemHarness({ statePath: ":memory:" });
      harnesses.push(harness);

      const result = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: `telegram:workstream:${workstream}`,
        text: `Perform one bounded ${workstream} action`,
        workstream,
        expectedEffect: {
          kind: "record-note",
          value: `${workstream} work captured`,
        },
      });

      expect(result).toMatchObject({
        kind: "work-item-acknowledgement",
        workItem: { workstream, accountableExecutive },
      });
    },
  );

  it("routes a normalized Finance action through the Personal CFO", async () => {
    const harness = createRealMingSystemHarness({ statePath: ":memory:" });
    harnesses.push(harness);

    const result = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "operations:normalized:finance",
      intent: "Record the bounded finance review",
      workstream: "Finance",
      expectedEffect: {
        kind: "record-note",
        value: "Finance review recorded",
      },
    });

    expect(result.workItem).toMatchObject({
      accountableExecutive: "Personal CFO",
      workstream: "Finance",
    });
    expect(harness.controlledEffects()).toEqual([
      expect.objectContaining({
        executive: "Personal CFO",
        authority: "accountable",
      }),
    ]);
  });

  it("records bounded Collaborating Executive contributions without parent outcome authority", async () => {
    const harness = createRealMingSystemHarness({ statePath: ":memory:" });
    harnesses.push(harness);

    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "telegram:action:cross-functional",
      text: "Prepare the release and its launch summary",
      addressedExecutive: "CTO",
      collaboratingExecutives: [
        {
          executive: "CMO",
          contribution: "Draft the bounded launch summary",
        },
      ],
      expectedEffect: {
        kind: "record-note",
        value: "Cross-functional release work captured",
      },
    });

    expect(result).toMatchObject({
      kind: "work-item-acknowledgement",
      workItem: {
        accountableExecutive: "CTO",
        collaboratingExecutives: [
          {
            executive: "CMO",
            contribution: "Draft the bounded launch summary",
            authority: "contribute-only",
            mayApproveParent: false,
            mayCompleteParent: false,
          },
        ],
      },
    });
    if (result.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    await harness.executeWorkItem(result.workItem.id);
    expect(harness.controlledEffects()).toEqual([
      expect.objectContaining({
        executive: "CMO",
        authority: "contribute-only",
        kind: "executive-contribution",
        value: "Draft the bounded launch summary",
      }),
      expect.objectContaining({
        executive: "CTO",
        authority: "accountable",
      }),
    ]);
  });
});
