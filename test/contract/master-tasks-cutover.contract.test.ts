import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createCutoverWorkspaceContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";
import { legacyLinkedViewSpecs } from "../../src/migration/master-tasks-cutover.js";

describe("RM-11 cutover workspace provider contract", () => {
  it("reports the bound Master Tasks data source as the cutover target", async () => {
    const harness = createCutoverWorkspaceContractHarness();

    expect(await harness.workspace.masterTasksTarget()).toEqual({
      databaseId: harness.masterTasksDatabaseId,
      dataSourceId: harness.masterTasksDataSourceId,
    });
  });

  it("hashes an unchanged source page identically on every read", async () => {
    const harness = createCutoverWorkspaceContractHarness();

    const first = await harness.workspace.readSources();
    const second = await harness.workspace.readSources();

    expect(first.map((source) => source.dataSourceId)).toEqual(
      harness.sourceDataSourceIds,
    );
    expect(first.flatMap((source) => source.records.map((r) => r.payloadHash))).toEqual(
      second.flatMap((source) => source.records.map((r) => r.payloadHash)),
    );
    expect(
      first.every((source) =>
        source.records.every((record) => record.payloadHash.startsWith("sha256:")),
      ),
    ).toBe(true);
    expect(first[0]?.records[0]?.legacyStatus).toBe("Pending");
    expect(first[0]?.parentDatabaseId).toBe("notion-database:legacy-1");
  });

  it("changes the payload hash as soon as a source page is edited", async () => {
    const harness = createCutoverWorkspaceContractHarness();
    const before = await harness.workspace.readSources();
    const target = before[0]?.records[0];
    expect(target).toBeDefined();

    harness.editSourcePage(
      harness.sourceDataSourceIds[0] ?? "",
      target?.pageId ?? "",
    );

    const after = await harness.workspace.readSources();
    expect(after[0]?.records[0]?.payloadHash).not.toBe(target?.payloadHash);
  });

  it("creates each linked view once and re-points a replay at the same view", async () => {
    const harness = createCutoverWorkspaceContractHarness();
    const spec = legacyLinkedViewSpecs[3];
    expect(spec).toBeDefined();

    const created = await harness.workspace.ensureLinkedView({
      name: spec?.name ?? "",
      dataSourceId: harness.masterTasksDataSourceId,
      workstreams: spec?.workstreams ?? [],
    });
    const replayed = await harness.workspace.ensureLinkedView({
      name: spec?.name ?? "",
      dataSourceId: harness.masterTasksDataSourceId,
      workstreams: spec?.workstreams ?? [],
    });

    expect(replayed.id).toBe(created.id);
    expect(replayed.dataSourceId).toBe(harness.masterTasksDataSourceId);
    expect(harness.viewCreateCount()).toBe(1);
    expect(harness.viewUpdateCount()).toBe(1);
  });

  it("retires a legacy source by renaming and locking its database", async () => {
    const harness = createCutoverWorkspaceContractHarness();
    const dataSourceId = harness.sourceDataSourceIds[0] ?? "";

    await harness.workspace.verifyRetirable(dataSourceId);
    const retirement = await harness.workspace.retireLegacySource({
      dataSourceId,
      archivedName: "ARCHIVED EVIDENCE (Legacy 1) Task To Do List",
    });

    expect(retirement).toEqual({
      dataSourceId,
      archivedName: "ARCHIVED EVIDENCE (Legacy 1) Task To Do List",
      locked: true,
    });
    expect(harness.renameCount()).toBe(1);
    expect(harness.lockedDatabases()).toEqual(["notion-database:legacy-1"]);
  });

  it("refuses the retirable probe for a database that is already locked", async () => {
    const harness = createCutoverWorkspaceContractHarness({
      lockedBeforeCutover: "notion-data-source:legacy-2",
    });

    await expect(
      harness.workspace.verifyRetirable("notion-data-source:legacy-2"),
    ).rejects.toThrow(/already locked/i);
    expect(harness.renameCount()).toBe(0);
  });

  it("reports one writable task system only after every legacy source is retired", async () => {
    const harness = createCutoverWorkspaceContractHarness();

    expect(await harness.workspace.writableTaskSystems()).toEqual([
      harness.masterTasksDataSourceId,
      ...harness.sourceDataSourceIds,
    ]);

    for (const dataSourceId of harness.sourceDataSourceIds) {
      await harness.workspace.retireLegacySource({
        dataSourceId,
        archivedName: `ARCHIVED EVIDENCE ${dataSourceId}`,
      });
    }

    expect(await harness.workspace.writableTaskSystems()).toEqual([
      harness.masterTasksDataSourceId,
    ]);
  });

  it("never reports the Notion credential in a cutover failure", async () => {
    const harness = createCutoverWorkspaceContractHarness();

    const failure = await harness.workspace
      .verifyRetirable("notion-data-source:absent")
      .catch((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      );

    expect(String(failure)).not.toContain(contractSecretFixture);
  });
});
