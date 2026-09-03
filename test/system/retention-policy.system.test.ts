import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CandidateEnvelope } from "../../src/evidence/evidence-broker.js";
import type {
  PersonalContextAllowlistEntry,
  PersonalContextManifestEntry,
  PersonalContextSourceValue,
} from "../../src/knowledge/personal-context-ingestion.js";
import { personalContextManifestDigest } from "../../src/knowledge/personal-context-ingestion.js";
import type {
  RetentionBackupPurgeResult,
  RetentionPurgeCandidate,
} from "../../src/operations/retention-policy.js";
import { compiledGenerationRetentionByDomain } from "../../src/operations/retention-policy.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-38 retention and ingestion purge policy", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];
  let clock = "2026-09-01T02:30:00.000Z";

  const hash = (content: string): string =>
    `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

  const candidate = (overrides: Partial<CandidateEnvelope> = {}): CandidateEnvelope => {
    const base: CandidateEnvelope = {
      id: "candidate:rm38-raw",
      sourceSystem: "agent-brain",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/rm38.md",
      canonicalEvidenceId: "agent-brain:personal:evidence:rm38",
      capturedAt: "2026-08-01T02:30:00.000Z",
      asOf: "2026-08-01T02:00:00.000Z",
      contentHash: "",
      trustDomain: "Personal",
      sensitivity: "internal",
      allowedRoles: ["COO"],
      retentionClass: "project-evidence-30d",
      mode: "snapshot",
      content: "A raw candidate that must not survive its retention window.",
      citations: ["agent-brain://personal/evidence/rm38"],
      freshness: "current",
    };
    const merged = { ...base, ...overrides };
    return { ...merged, contentHash: overrides.contentHash ?? hash(merged.content) };
  };

  function start(options: {
    readonly directory?: string;
    readonly sources?: readonly CandidateEnvelope[];
    readonly personalContext?: {
      readonly entry: PersonalContextManifestEntry;
      readonly source: PersonalContextSourceValue;
      readonly allowlist: readonly PersonalContextAllowlistEntry[];
    };
    readonly purgeBackups?: (at: string) => Promise<readonly RetentionBackupPurgeResult[]>;
    readonly retentionRequired?: boolean;
  } = {}): RealMingSystemHarness {
    const directory = options.directory ?? mkdtempSync(join(tmpdir(), "real-ming-rm38-"));
    if (options.directory === undefined) directories.push(directory);
    const source = options.personalContext;
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => clock,
      knowledgeVault: {
        statePath: join(directory, "knowledge.sqlite"),
        encryptionKey: "rm38-controlled-knowledge-key",
      },
      knowledgeOperations: {
        sources: (options.sources ?? []).map((value) => ({
          sourceIdentity: value.sourceIdentity,
          trustDomain: value.trustDomain,
          evidenceBoundary: "project-evidence-broker" as const,
          captureCandidate: async () => ({ kind: "candidate-envelope" as const, candidate: value }),
        })),
        ...(options.purgeBackups === undefined ? {} : { purgeBackups: options.purgeBackups }),
        ...(options.retentionRequired === undefined ? {} : { retentionRequired: options.retentionRequired }),
      },
      ...(source === undefined
        ? {}
        : {
            personalContext: {
              statePath: join(directory, "personal-context.sqlite"),
              stagingDirectory: join(directory, "staging"),
              repositoryRoot: process.cwd(),
              encryptionKey: "rm38-controlled-context-key",
              sources: {
                [`${source.entry.sourceSystem}:${source.entry.sourceReference}`]: source.source,
              },
              allowlist: source.allowlist,
            },
          }),
    });
    harnesses.push(harness);
    return harness;
  }

  afterEach(() => {
    clock = "2026-09-01T02:30:00.000Z";
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("purges an expired raw candidate and keeps only hash-based evidence", async () => {
    const raw = candidate();
    const harness = start({ sources: [raw] });
    await harness.runKnowledgeJob("knowledge-ingest");
    expect(harness.knowledgeStagedCandidates()).toHaveLength(1);

    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.knowledgeStagedCandidates()).toHaveLength(0);
    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "raw-candidate",
      recordId: raw.id,
      contentHash: raw.contentHash,
      trustDomain: "Personal",
    }));
    expect(JSON.stringify(harness.retentionPurgeEvidence())).not.toContain(raw.content);
  });

  it("retains raw candidate metadata after compilation and purges it later", async () => {
    const raw = candidate({ id: "candidate:rm38-compiled-raw" });
    const harness = start({ sources: [raw] });
    await harness.runKnowledgeJob("knowledge-ingest");
    await harness.runKnowledgeJob("knowledge-compile");
    expect(harness.knowledgeStagedCandidates()).toHaveLength(0);

    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "raw-candidate",
      recordId: raw.id,
      contentHash: raw.contentHash,
    }));
    expect(JSON.stringify(harness.retentionPurgeEvidence())).not.toContain(raw.content);
  });

  it("keeps a raw candidate until its 30-day window has actually elapsed", async () => {
    // The sweep is a scheduled job, so it runs over candidates that are not
    // yet eligible far more often than over ones that are. Purging on the
    // wrong side of the boundary destroys a payload that is still in use.
    const raw = candidate({ id: "candidate:rm38-boundary", capturedAt: "2026-08-15T02:30:00.000Z" });
    const harness = start({ sources: [raw] });
    await harness.runKnowledgeJob("knowledge-ingest");

    // Day 17 of 30.
    await harness.runKnowledgeJob("knowledge-retention");
    expect(harness.knowledgeStagedCandidates()).toHaveLength(1);
    expect(harness.retentionPurgeEvidence()).toHaveLength(0);

    // One day past the window.
    clock = "2026-09-15T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.knowledgeStagedCandidates()).toHaveLength(0);
    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "raw-candidate",
      recordId: raw.id,
      eligibleAt: "2026-09-14T02:30:00.000Z",
    }));
  });

  it("emits a Scheduler Heartbeat for the domain it purged", async () => {
    const raw = candidate({ id: "candidate:rm38-heartbeat" });
    const harness = start({ sources: [raw] });
    await harness.runKnowledgeJob("knowledge-ingest");
    expect(
      harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.lastRetention,
    ).toBeNull();

    await harness.runKnowledgeJob("knowledge-retention");

    // A silent sweep and a sweep that did nothing are indistinguishable to the
    // CEO dashboard unless the job says when it last ran and what it removed.
    const personal = harness.knowledgeHealth().find((entry) => entry.domain === "Personal");
    expect(personal?.lastRetention).toBe(clock);
    expect(personal?.purgedRecords).toBeGreaterThan(0);
    expect(
      harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-retention")?.status,
    ).toBe("healthy");
  });

  it("advertises its retention policy in the job definition", () => {
    const harness = start();
    const retention = harness.knowledgeJobDefinitions().find((definition) => definition.job === "knowledge-retention");
    expect(retention?.retentionPolicy).toContain("financial snapshots/approvals/outcomes/audit indefinite");
  });

  it("never purges Financial Snapshots, Approvals, Outcome Reports or audit events", async () => {
    const harness = start();
    const prepared = await harness.prepareFinancialSnapshot({
      period: "2026-09",
      sourceExports: ["moomoo:export:2026-08-31.csv"],
      reconciliationReference: "reconciliation:2026-08-31",
      workbook: "net-worth=104200.00;cash=8200.00",
    });
    if (prepared.kind !== "prepared") throw new Error("Expected a prepared snapshot.");
    harness.validateFinancialSnapshot({
      snapshotId: prepared.snapshot.id,
      reconciliationReference: "reconciliation:2026-08-31",
    });
    const presented = await harness.requestFinancialSnapshotApproval(prepared.snapshot.id);
    if (presented.kind !== "approval-required") throw new Error("Expected an Approval request.");
    await harness.grantApproval({
      approvalId: presented.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-01T21:00:00.000Z",
    });
    const completed = await harness.completeFinancialSnapshot(prepared.snapshot.id);
    if (completed.kind !== "approved") throw new Error("Expected an approved snapshot.");
    const workItemId = completed.workItem.id;
    const auditBefore = harness.auditTrail(workItemId).length;
    expect(auditBefore).toBeGreaterThan(0);

    // Far beyond every finite window in the v1 policy, and past the Approval's
    // own expiry. An expired Approval is still the record of what Ming
    // authorised; ageing out is not the same as being purgeable.
    clock = "2030-01-01T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");
    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.financialSnapshot(prepared.snapshot.id)?.workbook).toBe(
      "net-worth=104200.00;cash=8200.00",
    );
    expect(harness.approval(presented.approvalId)).toBeDefined();
    expect(harness.outcomeReport(workItemId)).toBeDefined();
    expect(harness.auditTrail(workItemId)).toHaveLength(auditBefore);
    // Indefinite records are retained, not quietly re-classified as purged.
    const purgedIds = harness.retentionPurgeEvidence().map((event) => event.recordId);
    expect(purgedIds).not.toContain(prepared.snapshot.id);
    expect(purgedIds).not.toContain(presented.approvalId);
  });

  it("declares compiled-generation retention for every Trust Domain", () => {
    expect(compiledGenerationRetentionByDomain).toEqual({
      Personal: { months: 12 },
      "Ming Creatives": { days: 30 },
      Academic: { days: 30 },
      Entertainment: { days: 30 },
      Finance: { days: 30 },
    });
  });

  it("purges Personal Context payloads while retaining candidate provenance", async () => {
    const entry: PersonalContextManifestEntry = {
      manifestId: "rm38-context",
      title: "Bounded context",
      purpose: "Retention proof",
      trustDomain: "Personal",
      sensitivity: "private",
      allowedRoles: ["COO"],
      authority: "personal plan",
      freshnessPolicy: "monthly",
      sourceSystem: "local-file",
      sourceReference: "C:\\controlled\\rm38-context.md",
      mode: "snapshot",
      retentionClass: "personal-context-30d",
    };
    const source: PersonalContextSourceValue = {
      content: "A private context payload that expires.",
      asOf: "2026-08-01T02:00:00.000Z",
      freshness: "current",
      sourceVersion: "rm38-v1",
    };
    const harness = start({
      personalContext: {
        entry: entry,
        source,
        allowlist: [{
          manifestId: entry.manifestId,
          sourceSystem: entry.sourceSystem,
          sourceReference: entry.sourceReference,
          manifestDigest: personalContextManifestDigest(entry),
          approvedBy: "ceo:ming",
        }],
      },
    });
    clock = "2026-08-01T02:30:00.000Z";
    await harness.ingestPersonalContext(entry);
    clock = "2026-09-03T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.personalContextCandidates()[0]).toMatchObject({ purgeState: "purged" });
    expect(harness.personalContextStagingFiles()).toHaveLength(0);
    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "personal-context-payload",
      trustDomain: "Personal",
    }));
    expect(() => harness.readPersonalContext(harness.personalContextCandidates()[0]!.id, "COO"))
      .toThrow("payload has been purged");
  });

  it("preserves a stricter Personal Context retention class in purge evidence", async () => {
    const entry: PersonalContextManifestEntry = {
      manifestId: "rm38-context-strict",
      title: "Strict context",
      purpose: "Retention proof",
      trustDomain: "Personal",
      sensitivity: "private",
      allowedRoles: ["COO"],
      authority: "personal plan",
      freshnessPolicy: "monthly",
      sourceSystem: "local-file",
      sourceReference: "C:\\controlled\\rm38-context-strict.md",
      mode: "snapshot",
      retentionClass: "personal-context-7d",
    };
    const harness = start({
      personalContext: {
        entry,
        source: {
          content: "Strict context payload.",
          asOf: "2026-08-01T02:00:00.000Z",
          freshness: "current",
          sourceVersion: "rm38-strict-v1",
        },
        allowlist: [{
          manifestId: entry.manifestId,
          sourceSystem: entry.sourceSystem,
          sourceReference: entry.sourceReference,
          manifestDigest: personalContextManifestDigest(entry),
          approvedBy: "ceo:ming",
        }],
      },
    });
    clock = "2026-08-01T02:30:00.000Z";
    await harness.ingestPersonalContext(entry);
    clock = "2026-08-08T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "personal-context-payload",
      policy: "personal-context-7d",
      eligibleAt: "2026-08-08T02:30:00.000Z",
    }));
  });

  it("recovers vault purge evidence after a restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm38-restart-"));
    directories.push(directory);
    const before = start({ directory });
    clock = "2024-01-01T02:30:00.000Z";
    expect(before.compileKnowledgeCandidate(candidate({ id: "candidate:rm38-restart-old" })).kind).toBe("compiled");
    const superseded = before.vaultGenerations("Personal")[0];
    expect(superseded).toBeDefined();
    clock = "2026-08-01T02:30:00.000Z";
    expect(before.compileKnowledgeCandidate(candidate({
      id: "candidate:rm38-restart-current",
      sourceReference: "agent-brain://personal/rm38-restart-current.md",
      canonicalEvidenceId: "agent-brain:personal:evidence:rm38-restart-current",
      citations: ["agent-brain://personal/evidence/rm38-restart-current"],
      content: "Current restart claim.",
    })).kind).toBe("compiled");
    clock = "2026-09-03T02:30:00.000Z";
    await before.runKnowledgeJob("knowledge-retention");
    expect(before.vaultPurgeEvents("Personal")).toHaveLength(1);
    harnesses.splice(harnesses.indexOf(before), 1);
    before.close();

    // The vault deletion is already committed and cannot be undone. A process
    // that restarts must reconcile the vault's own append-only log rather than
    // leave the deletion without central evidence.
    const after = start({ directory });
    await after.runKnowledgeJob("knowledge-retention");

    const compiled = after
      .retentionPurgeEvidence()
      .filter((event) => event.kind === "compiled-generation" && event.contentHash === superseded?.contentHash);
    expect(compiled).toHaveLength(1);
    expect(after.vaultPurgeEvents("Personal")).toHaveLength(1);
  });

  it("retains a superseded generation that is still inside its window", async () => {
    // The cutoff is the whole policy. Without it every superseded generation
    // would be purged on the next sweep, which is a twelve-month retention
    // rule that retains nothing.
    const harness = start();
    clock = "2026-08-01T02:30:00.000Z";
    expect(harness.compileKnowledgeCandidate(candidate({ id: "candidate:rm38-recent-first" })).kind).toBe("compiled");
    const recent = harness.vaultGenerations("Personal")[0];
    expect(recent).toBeDefined();
    clock = "2026-08-15T02:30:00.000Z";
    expect(harness.compileKnowledgeCandidate(candidate({
      id: "candidate:rm38-recent-second",
      sourceReference: "agent-brain://personal/rm38-recent.md",
      canonicalEvidenceId: "agent-brain:personal:evidence:rm38-recent",
      citations: ["agent-brain://personal/evidence/rm38-recent"],
      content: "Superseding claim.",
    })).kind).toBe("compiled");

    clock = "2026-09-03T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    // Superseded five weeks ago, not twelve months: its files stay.
    expect(harness.vaultGenerationFileCount("Personal", recent!.id)).toBeGreaterThan(0);
    expect(harness.vaultPurgeEvents("Personal")).toHaveLength(0);
  });

  it("applies each Trust Domain's own compiled-generation window", async () => {
    // Ming Creatives keeps superseded generations for thirty days, not the
    // twelve months Personal gets. Same sweep, different boundary.
    const harness = start();
    clock = "2026-06-01T02:30:00.000Z";
    const first = candidate({
      id: "candidate:rm38-mc-first",
      trustDomain: "Ming Creatives",
      sourceReference: "agent-brain://ming-creatives/rm38-mc.md",
      canonicalEvidenceId: "agent-brain:ming-creatives:evidence:rm38-mc",
      citations: ["agent-brain://ming-creatives/evidence/rm38-mc"],
      sourceIdentity: "agent-brain:ming-creatives",
    });
    expect(harness.compileKnowledgeCandidate(first).kind).toBe("compiled");
    const superseded = harness.vaultGenerations("Ming Creatives")[0];
    expect(superseded).toBeDefined();
    clock = "2026-08-01T02:30:00.000Z";
    // A separate page, so this publishes a new generation rather than
    // contradicting the first one.
    expect(harness.compileKnowledgeCandidate({
      ...first,
      id: "candidate:rm38-mc-second",
      sourceReference: "agent-brain://ming-creatives/rm38-mc-second.md",
      canonicalEvidenceId: "agent-brain:ming-creatives:evidence:rm38-mc-second",
      citations: ["agent-brain://ming-creatives/evidence/rm38-mc-second"],
      contentHash: hash("A second Ming Creatives claim."),
      content: "A second Ming Creatives claim.",
    }).kind).toBe("compiled");

    clock = "2026-09-03T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    // Published 2026-06-01, so eligible 2026-07-01 under the 30-day policy.
    expect(harness.vaultGenerationFileCount("Ming Creatives", superseded!.id)).toBe(0);
    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "compiled-generation",
      trustDomain: "Ming Creatives",
      eligibleAt: "2026-07-01T02:30:00.000Z",
    }));
  });

  it("keeps the current projection and purges an old superseded generation", async () => {
    const harness = start();
    clock = "2024-01-01T02:30:00.000Z";
    const old = candidate({ id: "candidate:rm38-old", content: "Old compiled claim." });
    expect(harness.compileKnowledgeCandidate(old).kind).toBe("compiled");
    const oldGeneration = harness.vaultGenerations("Personal")[0];
    expect(oldGeneration).toBeDefined();
    expect(harness.vaultGenerationFileCount("Personal", oldGeneration!.id)).toBeGreaterThan(0);
    clock = "2026-08-01T02:30:00.000Z";
    const current = candidate({
      id: "candidate:rm38-current",
      sourceReference: "agent-brain://personal/rm38-current.md",
      canonicalEvidenceId: "agent-brain:personal:evidence:rm38-current",
      citations: ["agent-brain://personal/evidence/rm38-current"],
      content: "Current compiled claim.",
    });
    expect(harness.compileKnowledgeCandidate(current).kind).toBe("compiled");

    clock = "2026-09-03T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");

    expect(harness.readVaultPage("Personal", "wiki/rm38-current.md")).toContain("Current compiled claim.");
    expect(harness.vaultGenerationFileCount("Personal", oldGeneration!.id)).toBe(0);
    expect(harness.vaultPurgeEvents("Personal")).toHaveLength(1);
    expect(harness.retentionPurgeEvidence()).toContainEqual(expect.objectContaining({
      kind: "compiled-generation",
      trustDomain: "Personal",
      contentHash: oldGeneration?.contentHash,
      eligibleAt: "2025-01-01T02:30:00.000Z",
    }));
  });

  it("records no backup evidence when the adapter cannot prove deletion", async () => {
    // Purge evidence is the only durable claim that a backup copy is gone.
    // Recording it on an adapter's say-so would turn an unverified deletion
    // into a permanent assertion that the data no longer exists.
    const unproven: RetentionPurgeCandidate = {
      kind: "knowledge-vault-backup",
      recordId: "backup:knowledge:2026-07-01",
      trustDomain: "Personal",
      contentHash: hash("unverified backup bytes"),
      eligibleAt: "2026-08-01T00:00:00.000Z",
      policy: "deleted-knowledge-backup-30d",
    };
    const harness = start({
      purgeBackups: async () => [
        { candidate: unproven, deleted: true, verified: false },
        { candidate: { ...unproven, recordId: "backup:knowledge:2026-07-02" }, deleted: false, verified: true },
      ],
    });

    // The sweep fails loudly rather than skipping: an unprovable deletion is
    // an operational fault, and a silent skip would look identical to a
    // backup store that had nothing left to purge.
    await expect(harness.runKnowledgeJob("knowledge-retention")).rejects.toThrow(
      /prove deletion/iu,
    );

    const backupEvidence = harness
      .retentionPurgeEvidence()
      .filter((event) => event.kind === "knowledge-vault-backup");
    expect(backupEvidence).toHaveLength(0);
    expect(
      harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-retention")?.status,
    ).toBe("failed");
  });

  it("purges eligible backup metadata idempotently and preserves indefinite records", async () => {
    const backup: RetentionPurgeCandidate = {
      kind: "context-vault-backup",
      recordId: "backup:context:2026-07-01",
      trustDomain: "Personal",
      contentHash: hash("encrypted backup bytes"),
      eligibleAt: "2026-08-01T00:00:00.000Z",
      policy: "deleted-context-backup-30d",
    };
    const backupDirectory = mkdtempSync(join(tmpdir(), "real-ming-rm38-backup-"));
    directories.push(backupDirectory);
    const backupPath = join(backupDirectory, "context-backup.enc");
    writeFileSync(backupPath, "encrypted backup bytes", "utf8");
    const harness = start({
      purgeBackups: async () => {
        if (existsSync(backupPath)) unlinkSync(backupPath);
        return [{ candidate: backup, deleted: true, verified: !existsSync(backupPath) }];
      },
      retentionRequired: true,
      personalContext: {
        entry: {
          manifestId: "rm38-backup-context",
          title: "Backup context",
          purpose: "Backup retention proof",
          trustDomain: "Personal",
          sensitivity: "private",
          allowedRoles: ["COO"],
          authority: "personal plan",
          freshnessPolicy: "monthly",
          sourceSystem: "local-file",
          sourceReference: "C:\\controlled\\rm38-backup-context.md",
          mode: "snapshot",
          retentionClass: "personal-context-30d",
        },
        source: {
          content: "Backup context payload.",
          asOf: "2026-08-01T02:00:00.000Z",
          freshness: "current",
          sourceVersion: "rm38-backup-v1",
        },
        allowlist: [],
      },
    });
    const created = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm38-indefinite-records",
      text: "Create a retention evidence work item.",
      expectedEffect: { kind: "retention-test", value: "indefinite" },
      workstream: "Personal Life",
    });
    if (!("workItem" in created)) throw new Error("Expected a Work Item acknowledgement.");
    const workItemId = created.workItem.id;
    const auditBefore = harness.auditTrail(workItemId).length;
    await harness.runKnowledgeJob("knowledge-retention");
    clock = "2026-09-04T02:30:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");
    expect(harness.retentionPurgeEvidence().filter((event) => event.recordId === backup.recordId)).toHaveLength(1);
    expect(harness.workItem(workItemId)).toBeDefined();
    expect(harness.auditTrail(workItemId)).toHaveLength(auditBefore);
    expect(JSON.stringify(harness.retentionPurgeEvidence())).not.toContain("encrypted backup bytes");
    expect(existsSync(backupPath)).toBe(false);
  });

  it("does not mistake a record identifier for an account number", async () => {
    // Roughly one UUID in 750 contains a 13-19 digit run once the hyphens are
    // treated as separators, so the card-number heuristic refuses a legitimate
    // identifier at random. A refused audit event blocks the Work Item behind
    // it, which makes this a durability failure, not a cosmetic one.
    const harness = start();
    const identifier = "52461506-1802-4201-8101-bf39beb475cc";

    const accepted = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm38-identifier",
      intent: `Reconcile record ${identifier}.`,
      expectedEffect: { kind: "secret-test", value: `record ${identifier}` },
      workstream: "Personal Life",
    });
    await harness.recordWorkItemCommitment({
      workItemId: accepted.workItem.id,
      value: `record ${identifier}`,
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });
    expect(JSON.stringify(harness.auditTrail(accepted.workItem.id))).toContain(identifier);

    // The heuristic still does its actual job.
    await expect(harness.recordWorkItemCommitment({
      workItemId: accepted.workItem.id,
      value: "card 4242 4242 4242 4242",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    })).rejects.toThrow(/Sensitive Secret/);

    // The exemption is for identifiers, not for the identifier shape. An
    // all-digit run in 8-4-4-4-12 is what a grouped account number looks like,
    // so it stays refused.
    await expect(harness.recordWorkItemCommitment({
      workItemId: accepted.workItem.id,
      value: "record 12345678-1234-1234-1234-123456789012",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    })).rejects.toThrow(/Sensitive Secret/);
  });

  it("rejects secret-bearing Work Items and audit records before durable write", async () => {
    const harness = start();
    await expect(harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm38-secret-work-item",
      intent: "Use token sk-ABCDEFGHIJKLMNOPQRSTUV.",
      expectedEffect: { kind: "secret-test", value: "token sk-ABCDEFGHIJKLMNOPQRSTUV" },
      workstream: "Personal Life",
    })).rejects.toThrow(/Sensitive Secret/);

    const clean = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm38-secret-audit",
      intent: "Record a safe commitment.",
      expectedEffect: { kind: "secret-test", value: "safe" },
      workstream: "Personal Life",
    });
    await expect(harness.recordWorkItemCommitment({
      workItemId: clean.workItem.id,
      value: "token sk-ABCDEFGHIJKLMNOPQRSTUV",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    })).rejects.toThrow(/Sensitive Secret/);
    expect(JSON.stringify(harness.workItem(clean.workItem.id))).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUV");
    expect(JSON.stringify(harness.auditTrail(clean.workItem.id))).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUV");
  });

});
