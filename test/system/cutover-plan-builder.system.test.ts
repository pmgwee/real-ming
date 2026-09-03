import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cutoverSourceReference } from "../../src/migration/master-tasks-cutover.js";
import type { CutoverBindings } from "../../src/migration/master-tasks-cutover.js";
import type {
  CutoverEvidenceSource,
  CutoverTitleMatchCounts,
} from "../../src/migration/cutover-plan-builder.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const bindings: CutoverBindings = {
  planVersion: "TEST-CUTOVER-1",
  digestVersion: "TEST-DIGEST-1",
  digestSha256: "a".repeat(64),
  backupSha256: "b".repeat(64),
  phaseAReportSha256: "d".repeat(64),
  executionPhase: "B",
  databaseId: "database:master-tasks",
  dataSourceId: "data-source:master-tasks",
  archivePrefix: "ARCHIVED EVIDENCE",
  sources: [
    { dataSourceId: "source:content", recordCount: 1 },
    { dataSourceId: "source:microsaas", recordCount: 1 },
    { dataSourceId: "source:academic", recordCount: 2 },
    { dataSourceId: "source:job-life", recordCount: 1 },
    { dataSourceId: "source:finance", recordCount: 0 },
  ],
  reviewedRecordCount: 5,
  canonicalImportCount: 4,
  archiveOnlyCount: 1,
  sourceCommitmentCount: 0,
  lifecycleCounts: [
    { lifecycle: "Captured", count: 1 },
    { lifecycle: "Planned", count: 2 },
    { lifecycle: "Ready for CEO Review", count: 1 },
    { lifecycle: "Cancelled", count: 1 },
  ],
  routingCounts: [
    { workstream: "Content Creation", accountableExecutive: "CMO", count: 1 },
    { workstream: "MicroSaaS", accountableExecutive: "CTO", count: 1 },
    { workstream: "Academic", accountableExecutive: "CAO", count: 1 },
    { workstream: "Personal Life", accountableExecutive: "COO", count: 1 },
  ],
};

const digest = [
  "| Ref | Title | Legacy status | Proposed lifecycle | Workstream | Executive | Commitment provenance | Disposition | CEO decision |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| CC-01 | Launch series | Pending | Captured | Content Creation | CMO | none in source | migrate | Approved |",
  "| MS-01 | (Ming Creatives) | To Do | Planned | MicroSaaS | CTO | none in source | migrate | Approved |",
  "| AC-01 | Research prompt | Pending to Review | Ready for CEO Review | Academic | CAO | none in source | migrate | Approved |",
  "| AC-02 | malformed link-only record | empty | Cancelled | Academic | CAO | none in source | archive-only | Approved |",
  "| JL-01 | blank-title record | To Do | Planned | Personal Life | COO | none in source | migrate | Approved |",
].join("\n");

const sources: readonly CutoverEvidenceSource[] = [
  {
    dataSourceId: "source:content",
    records: [
      { pageId: "page:cc-1", title: "Launch  series", payloadHash: "sha256:1" },
    ],
  },
  {
    dataSourceId: "source:microsaas",
    records: [
      {
        pageId: "page:ms-1",
        title: "(Ming Creatives) roadmap",
        payloadHash: "sha256:2",
      },
    ],
  },
  {
    dataSourceId: "source:academic",
    records: [
      { pageId: "page:ac-1", title: "Research prompt", payloadHash: "sha256:3" },
      {
        pageId: "page:ac-2",
        title: "https://example.invalid/track/abc",
        payloadHash: "sha256:4",
      },
    ],
  },
  {
    dataSourceId: "source:job-life",
    records: [{ pageId: "page:jl-1", title: "   ", payloadHash: "sha256:5" }],
  },
  { dataSourceId: "source:finance", records: [] },
];

const expectedTitleMatches: CutoverTitleMatchCounts = {
  exact: 2,
  blankSource: 1,
  descriptiveLabel: 2,
};

describe("RM-11 cutover plan builder", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm11-plan-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-29T09:00:00.000Z",
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

  it("joins every reviewed decision onto the page identity at its position", () => {
    const harness = startHarness();

    const built = harness.buildCutoverPlanFromEvidence({
      digest,
      sources,
      bindings,
      expectedTitleMatches,
    });

    expect(built.plan.decisions).toHaveLength(bindings.reviewedRecordCount);
    expect(built.titleMatches).toEqual(expectedTitleMatches);
    expect(built.descriptiveLabelRefs).toEqual(["MS-01", "AC-02"]);
    expect(
      built.plan.decisions.map((decision) =>
        cutoverSourceReference(decision.dataSourceId, decision.pageId),
      ),
    ).toEqual([
      cutoverSourceReference("source:content", "page:cc-1"),
      cutoverSourceReference("source:microsaas", "page:ms-1"),
      cutoverSourceReference("source:academic", "page:ac-1"),
      cutoverSourceReference("source:academic", "page:ac-2"),
      cutoverSourceReference("source:job-life", "page:jl-1"),
    ]);
    expect(
      built.plan.decisions.find((decision) => decision.pageId === "page:ac-2"),
    ).toMatchObject({ disposition: "archive-only", lifecycle: "Cancelled" });
  });

  it("refuses an ambiguous join when two unmatched rows in a batch disagree", () => {
    // Positional joins are only safe where the title proves the position. Two
    // rows in one batch that the title cannot tell apart must therefore carry
    // the same decision, or the join could apply either one to either page.
    const harness = startHarness();
    const ambiguousDigest = [
      digest,
      "| AC-03 | second link-only record | empty | Captured | Academic | CAO | none in source | migrate | Approved |",
    ].join("\n");
    const ambiguousSources = sources.map((source) =>
      source.dataSourceId === "source:academic"
        ? {
            ...source,
            records: [
              ...source.records,
              {
                pageId: "page:ac-3",
                title: "https://example.invalid/track/def",
                payloadHash: "sha256:6",
              },
            ],
          }
        : source,
    );

    expect(() =>
      harness.buildCutoverPlanFromEvidence({
        digest: ambiguousDigest,
        sources: ambiguousSources,
        bindings: {
          ...bindings,
          sources: bindings.sources.map((source) =>
            source.dataSourceId === "source:academic"
              ? { ...source, recordCount: 3 }
              : source,
          ),
          reviewedRecordCount: 6,
          canonicalImportCount: 5,
          lifecycleCounts: [
            { lifecycle: "Captured", count: 2 },
            { lifecycle: "Planned", count: 2 },
            { lifecycle: "Ready for CEO Review", count: 1 },
            { lifecycle: "Cancelled", count: 1 },
          ],
          routingCounts: bindings.routingCounts.map((routing) =>
            routing.workstream === "Academic"
              ? { ...routing, count: 2 }
              : routing,
          ),
        },
        expectedTitleMatches: { ...expectedTitleMatches, descriptiveLabel: 3 },
      }),
    ).toThrow(/ambiguous/i);
  });

  it("refuses the join when the digest and the backup describe different records", () => {
    const harness = startHarness();
    const renamed = sources.map((source) =>
      source.dataSourceId === "source:content"
        ? {
            ...source,
            records: source.records.map((record) => ({
              ...record,
              title: "A completely different task",
            })),
          }
        : source,
    );

    expect(() =>
      harness.buildCutoverPlanFromEvidence({
        digest,
        sources: renamed,
        bindings,
        expectedTitleMatches,
      }),
    ).toThrow(/join drifted/i);
  });

  it("refuses the join when a batch and its source disagree on record count", () => {
    const harness = startHarness();
    const shortened = sources.map((source) =>
      source.dataSourceId === "source:academic"
        ? { ...source, records: source.records.slice(0, 1) }
        : source,
    );

    expect(() =>
      harness.buildCutoverPlanFromEvidence({
        digest,
        sources: shortened,
        bindings,
        expectedTitleMatches,
      }),
    ).toThrow(/decisions but its source holds/i);
  });

  it("refuses a digest that does not carry every reviewed record", () => {
    const harness = startHarness();
    const truncated = digest
      .split("\n")
      .filter((line) => !line.startsWith("| JL-01"))
      .join("\n");

    expect(() =>
      harness.buildCutoverPlanFromEvidence({
        digest: truncated,
        sources,
        bindings,
        expectedTitleMatches,
      }),
    ).toThrow(/carries 4 decisions but the plan binds 5/i);
  });
});
