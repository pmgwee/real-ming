import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LegacyTaskSource } from "../../src/migration/task-migration-rehearsal.js";
import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("RM-10 five-source migration rehearsal", () => {
  it("backs up, normalizes, reports ambiguity, replays idempotently, and rolls back the isolated target", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm10-"));
    const sources: readonly LegacyTaskSource[] = [
      {
        id: "notion:content",
        name: "(IP Content Creation) Task To Do List",
        workstream: "Content Creation",
        records: [{
          id: "content:1",
          title: "Publish launch post",
          status: "Done",
          workstream: "Personal Life",
          updatedAt: "2026-08-28T01:00:00Z",
          sourcePayload: { untouchedLegacyColumn: "preserved" },
        }],
      },
      {
        id: "notion:microsaas",
        name: "(MicroSaaS) Task To Do List",
        workstream: "MicroSaaS",
        records: [{ id: "saas:1", title: "  PUBLISH   launch post ", status: "Pending", updatedAt: "2026-08-28T02:00:00Z" }],
      },
      {
        id: "notion:academic",
        name: "(Academic) Task To Do List",
        workstream: "Academic",
        records: [{ id: "academic:1", title: "", status: "To Do", updatedAt: "2026-08-28T03:00:00Z" }],
      },
      {
        id: "notion:job-life",
        name: "(Job x Life) Task To Do List",
        workstream: null,
        records: [{
          id: "career:1",
          title: "Submit application",
          status: "In progress",
          owner: "CTO",
          commitment: "Friday",
          updatedAt: "2026-08-28T04:00:00Z",
        }],
      },
      {
        id: "notion:finance",
        name: "(Finance) Task To Do List",
        workstream: "Finance",
        records: [
          { id: "finance:1", title: "Reconcile August", status: "", updatedAt: "2026-08-28T05:00:00Z" },
          { id: "finance:1", title: "Reconcile August", status: "", updatedAt: "2026-08-28T05:00:00Z" },
        ],
      },
    ];
    const before = JSON.stringify(sources);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      legacyTaskSources: sources,
      now: () => "2026-08-29T03:00:00.000Z",
    });
    try {
      const backups = await harness.captureTaskMigrationBackups();
      expect(harness.migrationRehearsalTargetCount()).toBe(0);
      expect(backups).toHaveLength(5);
      expect(backups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceId: "notion:finance",
          recordCount: 2,
          capturedAt: "2026-08-29T03:00:00.000Z",
          integrity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        }),
      ]));
      expect(backups[0]?.records[0]?.sourcePayload).toEqual({
        untouchedLegacyColumn: "preserved",
      });
      const firstBackup = backups[0];
      if (firstBackup === undefined) throw new Error("Expected the first backup.");
      await expect(
        harness.importTaskMigrationBackups(Array.from({ length: 5 }, () => firstBackup)),
      ).rejects.toThrow("five backups");
      await expect(
        harness.importTaskMigrationBackups([
          { ...firstBackup, capturedAt: "2026-08-29T04:00:00.000Z" },
          ...backups.slice(1),
        ]),
      ).rejects.toThrow("SHA-256");
      expect(harness.migrationRehearsalTargetCount()).toBe(0);
      const first = await harness.importTaskMigrationBackups(backups);
      expect(first.targetRecords).toContainEqual(expect.objectContaining({
        sourceReference: "notion:content:content:1",
        lifecycle: "Completed",
        workstream: "Content Creation",
        accountableExecutive: "CMO",
      }));
      expect(first.report.ambiguousStatus).toHaveLength(4);
      expect(first.report.missingFields).toContainEqual(expect.objectContaining({ recordId: "academic:1", field: "title" }));
      expect(first.report.ambiguousOwnership).toContainEqual(expect.objectContaining({ recordId: "career:1" }));
      expect(first.report.ambiguousWorkstream).toContainEqual(expect.objectContaining({ recordId: "career:1" }));
      expect(first.targetRecords).toContainEqual(expect.objectContaining({
        sourceReference: "notion:job-life:career:1",
        workstream: null,
        accountableExecutive: "COO",
      }));
      expect(first.report.proposedCommitments).toContainEqual(expect.objectContaining({ recordId: "career:1", value: "Friday" }));
      expect(first.report.duplicates).toContainEqual(expect.objectContaining({ recordId: "finance:1" }));
      expect(first.report.duplicates).toContainEqual(expect.objectContaining({
        recordId: "saas:1",
        matchesRecordId: "content:1",
        candidateKey: "normalized-title:publish launch post",
      }));
      expect(harness.migrationRehearsalTargetCount()).toBe(5);
      expect(JSON.stringify(sources)).toBe(before);

      const replay = await harness.importTaskMigrationBackups(backups);
      expect(replay).toEqual(first);
      expect(harness.migrationRehearsalTargetCount()).toBe(5);

      harness.rollbackTaskMigrationRehearsal();
      expect(harness.migrationRehearsalTargetCount()).toBe(0);
      expect(JSON.stringify(sources)).toBe(before);
    } finally {
      harness.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
