import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cutoverSourceReference,
  legacyLinkedViewSpecs,
  type CutoverApproval,
  type CutoverBindings,
  type CutoverDecision,
  type CutoverPlan,
} from "../../src/migration/master-tasks-cutover.js";
import {
  createRealMingSystemHarness,
  type ControlledCutoverSource,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const approvalId = "approval:rm11-cutover-1";

const sourceIds = [
  "data-source:content",
  "data-source:microsaas",
  "data-source:academic",
  "data-source:job-life",
  "data-source:finance",
] as const;

interface Fixture {
  readonly decision: CutoverDecision;
  readonly title: string;
}

const fixtures: readonly Fixture[] = [
  {
    title: "Continue the launch series",
    decision: {
      dataSourceId: sourceIds[0],
      pageId: "page:cc-01",
      payloadHash: "sha256:cc-01",
      disposition: "migrate",
      lifecycle: "Captured",
      workstream: "Content Creation",
      accountableExecutive: "CMO",
      commitmentProvenance: "none-in-source",
    },
  },
  {
    title: "Ship the agent runner",
    decision: {
      dataSourceId: sourceIds[1],
      pageId: "page:ms-01",
      payloadHash: "sha256:ms-01",
      disposition: "migrate",
      lifecycle: "Planned",
      workstream: "MicroSaaS",
      accountableExecutive: "CTO",
      commitmentProvenance: "none-in-source",
    },
  },
  {
    title: "Research paper prompt",
    decision: {
      dataSourceId: sourceIds[2],
      pageId: "page:ac-01",
      payloadHash: "sha256:ac-01",
      disposition: "migrate",
      lifecycle: "Ready for CEO Review",
      workstream: "Academic",
      accountableExecutive: "CAO",
      commitmentProvenance: "none-in-source",
    },
  },
  {
    title: "",
    decision: {
      dataSourceId: sourceIds[2],
      pageId: "page:ac-02",
      payloadHash: "sha256:ac-02",
      disposition: "archive-only",
      lifecycle: "Cancelled",
      workstream: "Academic",
      accountableExecutive: "CAO",
      commitmentProvenance: "none-in-source",
    },
  },
  {
    title: "Clear the blocked application",
    decision: {
      dataSourceId: sourceIds[3],
      pageId: "page:jl-01",
      payloadHash: "sha256:jl-01",
      disposition: "migrate",
      lifecycle: "Waiting/Blocked",
      workstream: "Personal Life",
      accountableExecutive: "COO",
      commitmentProvenance: "none-in-source",
    },
  },
  {
    title: "Update the balance sheet",
    decision: {
      dataSourceId: sourceIds[3],
      pageId: "page:jl-02",
      payloadHash: "sha256:jl-02",
      disposition: "migrate",
      lifecycle: "Captured",
      workstream: "Finance",
      accountableExecutive: "Personal CFO",
      commitmentProvenance: "none-in-source",
    },
  },
];

const bindings: CutoverBindings = {
  planVersion: "TEST-CUTOVER-1",
  digestVersion: "TEST-DIGEST-1",
  digestSha256: "a".repeat(64),
  backupSha256: "b".repeat(64),
  phaseAReportSha256: "d".repeat(64),
  executionPhase: "A",
  databaseId: "database:master-tasks",
  dataSourceId: "data-source:master-tasks",
  archivePrefix: "ARCHIVED EVIDENCE",
  sources: [
    { dataSourceId: sourceIds[0], recordCount: 1 },
    { dataSourceId: sourceIds[1], recordCount: 1 },
    { dataSourceId: sourceIds[2], recordCount: 2 },
    { dataSourceId: sourceIds[3], recordCount: 2 },
    { dataSourceId: sourceIds[4], recordCount: 0 },
  ],
  reviewedRecordCount: 6,
  canonicalImportCount: 5,
  archiveOnlyCount: 1,
  sourceCommitmentCount: 0,
  lifecycleCounts: [
    { lifecycle: "Captured", count: 2 },
    { lifecycle: "Planned", count: 1 },
    { lifecycle: "Waiting/Blocked", count: 1 },
    { lifecycle: "Ready for CEO Review", count: 1 },
    { lifecycle: "Cancelled", count: 1 },
  ],
  routingCounts: [
    { workstream: "Content Creation", accountableExecutive: "CMO", count: 1 },
    { workstream: "MicroSaaS", accountableExecutive: "CTO", count: 1 },
    { workstream: "Academic", accountableExecutive: "CAO", count: 1 },
    { workstream: "Personal Life", accountableExecutive: "COO", count: 1 },
    { workstream: "Finance", accountableExecutive: "Personal CFO", count: 1 },
  ],
};

const plan: CutoverPlan = {
  bindings,
  decisions: fixtures.map((fixture) => fixture.decision),
};

const phaseBPlan: CutoverPlan = {
  bindings: { ...bindings, executionPhase: "B" },
  decisions: plan.decisions,
};

const approval: CutoverApproval = {
  approvalId,
  planVersion: bindings.planVersion,
  digestVersion: bindings.digestVersion,
  digestSha256: bindings.digestSha256,
  backupSha256: bindings.backupSha256,
  phaseAReportSha256: bindings.phaseAReportSha256,
  executionPhase: bindings.executionPhase,
};

function controlledSources(): ControlledCutoverSource[] {
  return bindings.sources.map((source, index) => ({
    dataSourceId: source.dataSourceId,
    parentDatabaseId: `database:legacy-${index + 1}`,
    name: legacyLinkedViewSpecs[index]?.name ?? `legacy-${index + 1}`,
    records: fixtures
      .filter((fixture) => fixture.decision.dataSourceId === source.dataSourceId)
      .map((fixture) => ({
        pageId: fixture.decision.pageId,
        payloadHash: fixture.decision.payloadHash,
        title: fixture.title,
        legacyStatus: "Pending",
      })),
  }));
}

describe("RM-11 Master Tasks cutover", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(
    overrides: {
      readonly sources?: readonly ControlledCutoverSource[];
      readonly target?: {
        readonly databaseId: string;
        readonly dataSourceId: string;
      };
      readonly foreignSourceReference?: string;
      readonly retirementFailureFor?: string;
      readonly retirementWriteFailureFor?: string;
      readonly plan?: CutoverPlan;
    } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm11-"));
    directories.push(directory);
    const selectedPlan = overrides.plan ?? plan;
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-29T09:00:00.000Z",
      cutover: {
        plan: selectedPlan,
        approval: {
          ...approval,
          planVersion: selectedPlan.bindings.planVersion,
          digestVersion: selectedPlan.bindings.digestVersion,
          digestSha256: selectedPlan.bindings.digestSha256,
          backupSha256: selectedPlan.bindings.backupSha256,
          phaseAReportSha256: selectedPlan.bindings.phaseAReportSha256,
          executionPhase: selectedPlan.bindings.executionPhase,
        },
        sources: overrides.sources ?? controlledSources(),
        target: overrides.target ?? {
          databaseId: bindings.databaseId,
          dataSourceId: bindings.dataSourceId,
        },
        ...(overrides.foreignSourceReference === undefined
          ? {}
          : { foreignSourceReference: overrides.foreignSourceReference }),
        ...(overrides.retirementFailureFor === undefined
          ? {}
          : { retirementFailureFor: overrides.retirementFailureFor }),
        ...(overrides.retirementWriteFailureFor === undefined
          ? {}
          : {
              retirementWriteFailureFor: overrides.retirementWriteFailureFor,
            }),
      },
    });
    harnesses.push(harness);
    return harness;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("imports only the approved records with deterministic source references", async () => {
    const harness = startHarness();

    const report = await harness.executeCutoverPhaseA();

    expect(report.planVersion).toBe(bindings.planVersion);
    expect(report.approvalId).toBe(approvalId);
    expect(report.legacySourcesMutated).toBe(false);
    expect(report.imported).toHaveLength(bindings.canonicalImportCount);
    expect(report.archiveOnly).toEqual([
      cutoverSourceReference(sourceIds[2], "page:ac-02"),
    ]);
    expect(report.imported).toContain(
      cutoverSourceReference(sourceIds[0], "page:cc-01"),
    );
    expect(report.lifecycleCounts).toEqual(bindings.lifecycleCounts);
    expect(report.routingCounts).toEqual(bindings.routingCounts);
    expect(report.sources.map((source) => source.parentDatabaseId)).toEqual([
      "database:legacy-1",
      "database:legacy-2",
      "database:legacy-3",
      "database:legacy-4",
      "database:legacy-5",
    ]);
    expect(report.samples).toHaveLength(bindings.routingCounts.length);

    const imported = harness.workItems();
    expect(imported).toHaveLength(bindings.canonicalImportCount);
    expect(imported.map((workItem) => workItem.state).sort()).toEqual([
      "Captured",
      "Captured",
      "Planned",
      "Ready for CEO Review",
      "Waiting/Blocked",
    ]);
    expect(
      imported.every((workItem) =>
        workItem.idempotencyKey.startsWith("notion-migration:"),
      ),
    ).toBe(true);
    expect(
      imported.find((workItem) =>
        workItem.idempotencyKey.includes("page:ac-02"),
      ),
    ).toBeUndefined();
  });

  it("preserves legacy provenance in the audit trail of every imported Work Item", async () => {
    const harness = startHarness();

    await harness.executeCutoverPhaseA();

    const workItem = harness
      .workItems()
      .find((candidate) => candidate.idempotencyKey.includes("page:ac-01"));
    expect(workItem).toBeDefined();
    const trail = harness.auditTrail(workItem?.id ?? "");
    expect(trail.map((event) => event.type)).toEqual([
      "work-item.captured",
      "outcome-report.recorded",
      "work-item.ready-for-ceo-review",
    ]);
    expect(trail.at(-1)?.details).toMatchObject({
      basis: "ceo-approved-migration",
      approvalReference: approvalId,
      legacyStatus: "Pending",
      sourceReference: cutoverSourceReference(sourceIds[2], "page:ac-01"),
    });
  });

  it("gives a migrated review-ready item the Outcome Report its state requires", async () => {
    // CONTEXT.md defines Review-Ready Work as a Work Item presented WITH an
    // Outcome Report, and the status-semantics doc says a Pending-to-Review
    // record must arrive with its evidence. Without one the CEO could never
    // complete it, only cancel or reject it.
    const harness = startHarness();
    await harness.executeCutoverPhaseA();

    const reviewReady = harness
      .workItems()
      .find((workItem) => workItem.state === "Ready for CEO Review");
    expect(reviewReady).toBeDefined();

    const report = harness.outcomeReport(reviewReady?.id ?? "");
    expect(report?.completedEffect).toMatchObject({
      kind: "migrated-legacy-task",
      value: cutoverSourceReference(sourceIds[2], "page:ac-01"),
    });
    expect(report?.verification.evidence.reference).toBe(
      cutoverSourceReference(sourceIds[2], "page:ac-01"),
    );
    expect(report?.remainingRisks.join(" ")).toMatch(/outside Real-Ming/i);
    expect(report?.requiredDecisions.join(" ")).toMatch(/legacy/i);

    const completed = await harness.reviewWorkItem({
      workItemId: reviewReady?.id ?? "",
      actorId: "ceo:ming",
      decision: "complete",
    });
    expect(completed.state).toBe("Completed");
  });

  it("replays Phase A without creating a second import", async () => {
    const harness = startHarness();

    const first = await harness.executeCutoverPhaseA();
    const replay = await harness.executeCutoverPhaseA();

    expect(replay.imported).toEqual(first.imported);
    expect(harness.workItems()).toHaveLength(bindings.canonicalImportCount);
    expect(await harness.masterTasksView("CEO All Work")).toHaveLength(
      bindings.canonicalImportCount,
    );
  });

  it("rejects execution outside the exact Approval phase before any read or write", async () => {
    const harness = startHarness();

    await expect(harness.executeApprovedCutoverPhase("B")).rejects.toThrow(
      /phase.*not approved|approved.*phase/i,
    );
    expect(harness.cutoverSourceReadCount()).toBe(0);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("rejects compensating per-item decision drift even when aggregate totals still match", async () => {
    const mutableDecisions = plan.decisions.map((decision) => ({ ...decision }));
    const mutablePlan: CutoverPlan = { bindings, decisions: mutableDecisions };
    const harness = startHarness({ plan: mutablePlan });
    await harness.executeCutoverPhaseA();

    const content = mutableDecisions.findIndex(
      (decision) => decision.pageId === "page:cc-01",
    );
    const microSaas = mutableDecisions.findIndex(
      (decision) => decision.pageId === "page:ms-01",
    );
    const contentRoute = {
      workstream: mutableDecisions[content]!.workstream,
      accountableExecutive: mutableDecisions[content]!.accountableExecutive,
    };
    mutableDecisions[content] = {
      ...mutableDecisions[content]!,
      workstream: mutableDecisions[microSaas]!.workstream,
      accountableExecutive: mutableDecisions[microSaas]!.accountableExecutive,
    };
    mutableDecisions[microSaas] = {
      ...mutableDecisions[microSaas]!,
      ...contentRoute,
    };

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(
      /does not match.*CEO-approved decision|CEO-approved decision.*does not match/i,
    );
    expect(harness.cutoverRetiredSources()).toHaveLength(0);
  });

  it("rejects a projected record that drifted from its exact canonical Work Item", async () => {
    const harness = startHarness();
    await harness.executeCutoverPhaseA();
    const captured = harness
      .workItems()
      .find((workItem) => workItem.state === "Captured");
    expect(captured).toBeDefined();
    harness.simulateMasterTasksProviderEdit(captured!.id, {
      lifecycle: "Planned",
      updatedAt: "2026-08-29T09:05:00.000Z",
    });

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(
      /projection.*does not match|does not match.*canonical Work Item/i,
    );
    expect(harness.cutoverRetiredSources()).toHaveLength(0);
  });

  it("rejects a stale Approval before reading or writing anything", async () => {
    const harness = startHarness();

    await expect(
      harness.executeCutoverPhaseA({
        ...approval,
        digestSha256: "c".repeat(64),
      }),
    ).rejects.toThrow(/stale/i);
    expect(harness.workItems()).toHaveLength(0);
    expect(harness.cutoverSourceReadCount()).toBe(0);
  });

  it("rejects a Phase B continuation whose bound Phase A report has drifted", async () => {
    const harness = startHarness();

    await expect(
      harness.executeCutoverPhaseA({
        ...approval,
        phaseAReportSha256: "c".repeat(64),
      }),
    ).rejects.toThrow(/stale.*Phase A report|Phase A report.*stale/i);
    expect(harness.workItems()).toHaveLength(0);
    expect(harness.cutoverSourceReadCount()).toBe(0);
  });

  it("refuses to write when a bound source record hash drifts", async () => {
    const drifted = controlledSources().map((source) =>
      source.dataSourceId === sourceIds[1]
        ? {
            ...source,
            records: source.records.map((record) => ({
              ...record,
              payloadHash: "sha256:drifted",
            })),
          }
        : source,
    );
    const harness = startHarness({ sources: drifted });

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(/drift/i);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("refuses to write when the bound Master Tasks target does not match", async () => {
    const harness = startHarness({
      target: {
        databaseId: "database:other",
        dataSourceId: "data-source:other",
      },
    });

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(/target/i);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("refuses to write when Master Tasks already holds a conflicting migration reference", async () => {
    const harness = startHarness({
      foreignSourceReference: cutoverSourceReference(
        "data-source:unbound",
        "page:foreign",
      ),
    });

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(/conflicting/i);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("refuses to write when a planned record was already imported under another Work Item", async () => {
    // The Master Tasks duplicate guard keys on Work Item ID, so a prior import
    // whose local Work Item is gone would otherwise be imported a second time
    // and leave two Master Tasks pages for one legacy record.
    const harness = startHarness({
      foreignSourceReference: cutoverSourceReference(
        sourceIds[0],
        "page:cc-01",
      ),
    });

    await expect(harness.executeCutoverPhaseA()).rejects.toThrow(
      /already imported|conflicting/i,
    );
    expect(harness.workItems()).toHaveLength(0);
  });

  it("refuses any plan whose decisions do not add up to the approved result", async () => {
    const swapExecutive = (decision: CutoverDecision): CutoverDecision =>
      decision.workstream === "MicroSaaS"
        ? { ...decision, accountableExecutive: "COO" }
        : decision;
    const cases: readonly {
      readonly name: string;
      readonly plan: CutoverPlan;
      readonly expected: RegExp;
    }[] = [
      {
        name: "an Executive that does not own the Workstream",
        plan: { bindings, decisions: plan.decisions.map(swapExecutive) },
        expected: /routes MicroSaaS to COO/i,
      },
      {
        name: "an archive-only record that is not Cancelled",
        plan: {
          bindings,
          decisions: plan.decisions.map((decision) =>
            decision.disposition === "archive-only"
              ? { ...decision, lifecycle: "Captured" as const }
              : decision,
          ),
        },
        expected: /must carry the Cancelled disposition/i,
      },
      {
        name: "a lifecycle a migration may not create",
        plan: {
          bindings,
          decisions: plan.decisions.map((decision) =>
            decision.pageId === "page:cc-01"
              ? { ...decision, lifecycle: "Completed" as never }
              : decision,
          ),
        },
        expected: /which a migration may not create/i,
      },
      {
        name: "a source the Approval never bound",
        plan: {
          bindings,
          decisions: plan.decisions.map((decision) =>
            decision.pageId === "page:cc-01"
              ? { ...decision, dataSourceId: "data-source:unbound" }
              : decision,
          ),
        },
        expected: /names unbound source/i,
      },
      {
        name: "fewer decisions than the Approval reviewed",
        plan: { bindings, decisions: plan.decisions.slice(1) },
        expected: /decisions but binds/i,
      },
    ];

    for (const testCase of cases) {
      const harness = startHarness({ plan: testCase.plan });
      await expect(
        harness.executeCutoverPhaseA(),
        testCase.name,
      ).rejects.toThrow(testCase.expected);
      expect(harness.workItems(), testCase.name).toHaveLength(0);
      expect(harness.cutoverSourceReadCount(), testCase.name).toBe(0);
    }
  });

  it("records a usable blocker reason for a migrated Waiting/Blocked item", async () => {
    const harness = startHarness();

    await harness.executeCutoverPhaseA();

    const blocked = harness
      .workItems()
      .find((workItem) => workItem.state === "Waiting/Blocked");
    expect(blocked).toBeDefined();
    const event = harness
      .auditTrail(blocked?.id ?? "")
      .findLast((entry) => entry.type === "work-item.waiting-blocked");
    expect(event?.details["reason"]).toEqual(expect.stringContaining("Pending"));
    expect(event?.details["basis"]).toBe("ceo-approved-migration");
  });

  it("switches daily use to linked views whose edits reach the canonical Work Item", async () => {
    const harness = startHarness({ plan: phaseBPlan });
    await harness.seedPriorCutoverPhaseA();

    const report = await harness.executeCutoverPhaseB();

    expect(report.views.map((view) => view.name)).toEqual(
      legacyLinkedViewSpecs.map((spec) => spec.name),
    );
    expect(
      report.views.every((view) => view.dataSourceId === bindings.dataSourceId),
    ).toBe(true);
    expect(report.sampleEdits).toHaveLength(legacyLinkedViewSpecs.length);
    for (const edit of report.sampleEdits) {
      expect(edit.observedPriority).toBe("High");
      expect(harness.workItem(edit.workItemId)?.priority).toBe(
        edit.restoredPriority,
      );
    }
    expect(report.retirements).toHaveLength(bindings.sources.length);
    expect(
      report.retirements.every(
        (retirement) =>
          retirement.locked &&
          retirement.archivedName.startsWith(bindings.archivePrefix),
      ),
    ).toBe(true);
    expect(report.writableTaskSystems).toEqual([bindings.dataSourceId]);
  });

  it("stops before retirement when a legacy source cannot be locked", async () => {
    const harness = startHarness({
      plan: phaseBPlan,
      retirementFailureFor: sourceIds[2],
    });
    await harness.seedPriorCutoverPhaseA();

    await expect(harness.executeCutoverPhaseB()).rejects.toThrow(/retire/i);
    expect(harness.cutoverRetiredSources()).toEqual([]);
    expect(harness.workItems()).toHaveLength(bindings.canonicalImportCount);
  });

  it("reports the commit point as crossed once any legacy source is retired", async () => {
    // A probe can pass and the write still fail. From the first successful
    // retirement onward the operator must be told the commit point is behind
    // them, or they will be told the legacy databases are still the daily
    // system while two of them are already locked.
    const harness = startHarness({
      plan: phaseBPlan,
      retirementWriteFailureFor: sourceIds[2],
    });
    await harness.seedPriorCutoverPhaseA();

    await expect(harness.executeCutoverPhaseB()).rejects.toThrow(/retire/i);

    expect(harness.cutoverRetiredSources()).toEqual([
      sourceIds[0],
      sourceIds[1],
    ]);
    expect(harness.cutoverRecovery().stage).toBe("after-commit-point");
  });

  it("refuses a Phase B continuation when the approved Phase A state is absent", async () => {
    const harness = startHarness({ plan: phaseBPlan });

    await expect(harness.executeCutoverPhaseB()).rejects.toThrow(
      /Phase A.*missing|missing.*Phase A|continuation.*requires/i,
    );
    expect(harness.workItems()).toHaveLength(0);
    expect(harness.cutoverRetiredSources()).toHaveLength(0);
  });

  it("refuses a Phase B continuation when one Phase A projection is missing", async () => {
    const harness = startHarness({ plan: phaseBPlan });
    await harness.seedPriorCutoverPhaseA();
    const missing = harness.workItems()[0]!;
    harness.removeMasterTaskProjection(missing.id);

    await expect(harness.executeCutoverPhaseB()).rejects.toThrow(
      /Phase A.*projection|projection.*missing|requires.*projection/i,
    );
    expect(harness.cutoverRetiredSources()).toHaveLength(0);
  });

  it("refuses a Phase B continuation with a duplicate Phase A source projection", async () => {
    const harness = startHarness({ plan: phaseBPlan });
    await harness.seedPriorCutoverPhaseA();
    const duplicated = harness.workItems()[0]!;
    harness.duplicateMasterTaskProjection(duplicated.id, "duplicate-work-item");

    await expect(harness.executeCutoverPhaseB()).rejects.toThrow(
      /duplicate|another Work Item|Phase A.*projection/i,
    );
    expect(harness.cutoverRetiredSources()).toHaveLength(0);
  });

  it("names the recovery boundary on each side of the retirement commit point", async () => {
    const harness = startHarness({ plan: phaseBPlan });
    await harness.seedPriorCutoverPhaseA();

    const before = harness.cutoverRecovery();
    expect(before.stage).toBe("before-commit-point");
    expect(before.backupSha256).toBe(bindings.backupSha256);

    await harness.executeCutoverPhaseB();

    const after = harness.cutoverRecovery();
    expect(after.stage).toBe("after-commit-point");
    expect(after.bidirectionalSynchronization).toBe(false);
    expect(after.quarantinePrefix).toBe("notion-migration:");
  });
});
