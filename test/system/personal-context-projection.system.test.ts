import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import {
  personalContextManifestDigest,
  type PersonalContextAllowlistEntry,
  type PersonalContextManifestEntry,
  type PersonalContextSourceValue,
} from "../../src/knowledge/personal-context-ingestion.js";

describe("RM-18 Personal Context Approved Projection boundary", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function selectedEntry(
    overrides: Partial<PersonalContextManifestEntry> = {},
  ): PersonalContextManifestEntry {
    return {
      manifestId: "rm18-working-preferences",
      title: "Working preferences and routine",
      purpose: "Prepare the CEO's personalized daily plan.",
      trustDomain: "Personal",
      sensitivity: "private",
      allowedRoles: ["COO"],
      authority: "personal plan",
      freshnessPolicy: "monthly",
      sourceSystem: "local-file",
      sourceReference: "C:\\real-ming-private-context\\working-preferences.md",
      mode: "snapshot",
      retentionClass: "personal-context-30d",
      ...overrides,
    };
  }

  function allowlist(entry: PersonalContextManifestEntry): PersonalContextAllowlistEntry {
    return {
      manifestId: entry.manifestId,
      sourceSystem: entry.sourceSystem,
      sourceReference: entry.sourceReference,
      manifestDigest: personalContextManifestDigest(entry),
      approvedBy: "ceo:ming",
    };
  }

  function start(
    entry: PersonalContextManifestEntry,
    source: PersonalContextSourceValue,
  ): Promise<{ harness: RealMingSystemHarness; directory: string; workItemId: string }> {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm18-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => "2026-09-03T09:00:00.000Z",
      personalContext: {
        statePath: join(directory, "personal-context.sqlite"),
        stagingDirectory: join(directory, "staging"),
        repositoryRoot: process.cwd(),
        encryptionKey: "rm18-controlled-key-must-not-be-reported",
        sources: {
          [`${entry.sourceSystem}:${entry.sourceReference}`]: source,
        },
        allowlist: [allowlist(entry)],
      },
    });
    harnesses.push(harness);
    return harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `rm18:${entry.manifestId}`,
      text: entry.purpose,
      expectedEffect: { kind: "record-note", value: entry.purpose },
    }).then((acknowledgement) => {
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      return { harness, directory, workItemId: acknowledgement.workItem.id };
    });
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("serves a bounded role/task/purpose projection with provenance, without dashboard raw content", async () => {
    const entry = selectedEntry();
    const raw = "The CEO prefers a concise morning plan with three priorities.\n";
    const { harness, workItemId } = await start(entry, {
      content: raw,
      asOf: "2026-09-02T09:00:00.000Z",
      freshness: "current",
    });
    const candidate = await harness.ingestPersonalContext(entry);
    expect(candidate.kind).toBe("verified-ingestion");
    if (candidate.kind !== "verified-ingestion") return;

    const projection = harness.servePersonalContextProjection({
      candidateId: candidate.candidate.id,
      workItemId,
      executive: "COO",
      purpose: "Prepare today's personalized daily plan",
    });

    expect(projection).toMatchObject({
      kind: "approved-projection",
      candidateId: candidate.candidate.id,
      workItemId,
      executive: "COO",
      trustDomain: "Personal",
      sourceReference: entry.sourceReference,
      contentHash: candidate.candidate.contentHash,
      asOf: "2026-09-02T09:00:00.000Z",
      freshness: "current",
      staleLabel: null,
      purpose: "Prepare today's personalized daily plan",
    });
    expect(projection.text).toContain("three priorities");
    expect(JSON.stringify(harness.dashboardOverview({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
    }))).not.toContain(raw);
    expect(harness.personalContextAuditTrail(workItemId)).toEqual([
      expect.objectContaining({
        type: "personal-context.projection-served",
        details: expect.objectContaining({
          candidateId: candidate.candidate.id,
          purpose: "Prepare today's personalized daily plan",
        }),
      }),
    ]);
    expect(JSON.stringify(harness.personalContextAuditTrail(workItemId))).not.toContain(raw);
  });

  it("denies an unrelated role and an unscoped purpose", async () => {
    const entry = selectedEntry();
    const { harness, workItemId } = await start(entry, {
      content: "A private COO preference.\n",
      asOf: "2026-09-02T09:00:00.000Z",
      freshness: "current",
    });
    const candidate = await harness.ingestPersonalContext(entry);
    expect(candidate.kind).toBe("verified-ingestion");
    if (candidate.kind !== "verified-ingestion") return;

    expect(() => harness.servePersonalContextProjection({
      candidateId: candidate.candidate.id,
      workItemId,
      executive: "CMO",
      purpose: "Prepare content",
    })).toThrow("not allowed to read this Personal Context item");
    expect(() => harness.servePersonalContextProjection({
      candidateId: candidate.candidate.id,
      workItemId,
      executive: "COO",
      purpose: "   ",
    })).toThrow("purpose");

    const cmoEntry = selectedEntry({
      manifestId: "rm18-task-role-mismatch",
      allowedRoles: ["CMO"],
    });
    const { harness: cmoHarness, workItemId: cmoWorkItemId } = await start(
      cmoEntry,
      {
        content: "A content preference.",
        asOf: "2026-09-02T09:00:00.000Z",
        freshness: "current",
      },
    );
    const cmoCandidate = await cmoHarness.ingestPersonalContext(cmoEntry);
    expect(cmoCandidate.kind).toBe("verified-ingestion");
    if (cmoCandidate.kind !== "verified-ingestion") return;
    expect(() => cmoHarness.servePersonalContextProjection({
      candidateId: cmoCandidate.candidate.id,
      workItemId: cmoWorkItemId,
      executive: "CMO",
      purpose: "Prepare content",
    })).toThrow("outside the Work Item scope");
  });

  it("preserves stale provenance and bounds projection text", async () => {
    const entry = selectedEntry({ manifestId: "rm18-stale-preferences" });
    const { harness, workItemId } = await start(entry, {
      content: "x".repeat(5_000),
      asOf: "2026-08-01T09:00:00.000Z",
      freshness: "stale",
    });
    const candidate = await harness.ingestPersonalContext(entry);
    expect(candidate.kind).toBe("verified-ingestion");
    if (candidate.kind !== "verified-ingestion") return;
    const projection = harness.servePersonalContextProjection({
      candidateId: candidate.candidate.id,
      workItemId,
      executive: "COO",
      purpose: "Prepare today's plan",
    });
    expect(projection.staleLabel).toBe(
      "STALE — recheck source before treating as current",
    );
    expect(projection.text.length).toBeLessThanOrEqual(2_000);
  });

  it("requires an explicit CEO drill-down and audits it without logging raw content", async () => {
    const entry = selectedEntry({ manifestId: "rm18-drilldown" });
    const raw = "Private routine detail for an authorized CEO review.\n";
    const { harness, workItemId } = await start(entry, {
      content: raw,
      asOf: "2026-09-02T09:00:00.000Z",
      freshness: "current",
    });
    const candidate = await harness.ingestPersonalContext(entry);
    expect(candidate.kind).toBe("verified-ingestion");
    if (candidate.kind !== "verified-ingestion") return;

    expect(() => harness.drillDownPersonalContext({
      candidateId: candidate.candidate.id,
      workItemId,
      actorId: "executive:COO",
      purpose: "Review the exact source",
    })).toThrow("Only the CEO may request a Personal Context drill-down.");
    expect(harness.drillDownPersonalContext({
      candidateId: candidate.candidate.id,
      workItemId,
      actorId: "ceo:ming",
      purpose: "Review the exact source",
    })).toBe(raw);
    expect(harness.personalContextAuditTrail(workItemId)).toEqual([
      expect.objectContaining({
        type: "personal-context.raw-drilldown",
        details: expect.objectContaining({
          candidateId: candidate.candidate.id,
          purpose: "Review the exact source",
          actorId: "ceo:ming",
        }),
      }),
    ]);
    expect(JSON.stringify(harness.personalContextAuditTrail(workItemId))).not.toContain(raw);
  });
});
