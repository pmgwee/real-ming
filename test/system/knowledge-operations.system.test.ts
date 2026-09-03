import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CandidateEnvelope,
  ProjectEvidenceCandidateResult,
} from "../../src/evidence/evidence-broker.js";
import type { KnowledgeOperationalOutput } from "../../src/knowledge/knowledge-compiler.js";
import type { TrustDomain } from "../../src/operations/contracts.js";
import type {
  PersonalContextAllowlistEntry,
  PersonalContextManifestEntry,
} from "../../src/knowledge/personal-context-ingestion.js";
import { personalContextManifestDigest } from "../../src/knowledge/personal-context-ingestion.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

describe("RM-44 scheduled Knowledge Compiler operations", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];
  const firstNow = "2026-09-04T20:00:00.000Z"; // 04:00 KL

  const contentHash = (content: string): string =>
    `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

  const candidate = (overrides: Partial<CandidateEnvelope> = {}): CandidateEnvelope => {
    const base: CandidateEnvelope = {
    id: "candidate:rm44-working-preferences",
    sourceSystem: "agent-brain",
    sourceIdentity: "agent-brain:personal",
    sourceReference: "agent-brain://personal/working-preferences.md",
    canonicalEvidenceId: "agent-brain:personal:evidence:rm44-1",
    capturedAt: "2026-09-04T19:30:00.000Z",
    asOf: "2026-09-04T19:00:00.000Z",
    contentHash: "",
    trustDomain: "Personal",
    sensitivity: "internal",
    allowedRoles: ["COO"],
    retentionClass: "project-evidence-30d",
    mode: "snapshot",
    content: "Ming protects deep work before 11:00.",
    citations: ["agent-brain://personal/evidence/rm44-1"],
    freshness: "current",
    };
    const merged = { ...base, ...overrides };
    return {
      ...merged,
      contentHash: overrides.contentHash ?? contentHash(merged.content),
    };
  };

  function start(
    now: () => string,
    read: () => readonly CandidateEnvelope[],
    backup?: () => Promise<void>,
    outputs: readonly KnowledgeOperationalOutput[] = [],
    capturedResult?: ProjectEvidenceCandidateResult,
    sourceTrustDomain: TrustDomain = "Personal",
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm44-"));
    directories.push(directory);
    return startInDirectory(directory, now, read, backup, outputs, capturedResult, sourceTrustDomain);
  }

  function startInDirectory(
    directory: string,
    now: () => string,
    read: () => readonly CandidateEnvelope[],
    backup?: () => Promise<void>,
    outputs: readonly KnowledgeOperationalOutput[] = [],
    capturedResult?: ProjectEvidenceCandidateResult,
    sourceTrustDomain: TrustDomain = "Personal",
  ): RealMingSystemHarness {
    const captureCandidate = async (): Promise<ProjectEvidenceCandidateResult> => {
      if (capturedResult !== undefined) return capturedResult;
      const value = read()[0];
      return value === undefined
        ? ({ kind: "rejected", reason: "uncited" } as const)
        : ({ kind: "candidate-envelope", candidate: value } as const);
    };
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now,
      knowledgeVault: {
        statePath: join(directory, "knowledge.sqlite"),
        encryptionKey: "rm44-controlled-key",
      },
      knowledgeOperations: {
        sources: [
          {
            sourceIdentity: "agent-brain:personal",
            trustDomain: sourceTrustDomain,
            evidenceBoundary: "project-evidence-broker",
            captureCandidate,
          },
        ],
        outputs,
        ...(backup === undefined ? {} : { backup }),
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

  it("declares the six jobs with schema, scope, retention and evidence contracts", () => {
    const harness = start(() => firstNow, () => [candidate()]);
    const definitions = harness.knowledgeJobDefinitions();
    expect(definitions).toHaveLength(6);
    for (const definition of definitions) {
      expect(definition.schema).toMatch(/\/v1$/u);
      expect(definition.domainRoots).toContain("Personal");
      expect(definition.workItemPurpose).toContain("knowledge-");
      expect(definition.allowedSources.length).toBeGreaterThan(0);
      expect(definition.retentionPolicy.length).toBeGreaterThan(0);
      expect(definition.idempotencyKey).toContain("{operatingDate}");
      expect(definition.expectedEvidence.length).toBeGreaterThan(0);
      expect(definition.evidenceLink).toContain(definition.job);
    }
  });

  it("runs ingest through backup once, publishes a generation, and is restart-safe", async () => {
    let backups = 0;
    const harness = start(
      () => firstNow,
      () => [candidate()],
      async () => {
        backups += 1;
      },
    );

    const first = await harness.tickDailyOperations();
    expect(first.ran).toEqual(
      expect.arrayContaining([
        "knowledge-ingest",
        "knowledge-compile",
        "knowledge-publish",
        "knowledge-lint",
        "knowledge-retention",
        "knowledge-backup",
      ]),
    );
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
    expect(backups).toBe(1);
    expect(harness.knowledgeHealth().find((health) => health.domain === "Personal")).toMatchObject({
      currentGeneration: 1,
      backlog: 0,
      stalePages: 0,
      citationFailures: 0,
      quarantinedConflicts: 0,
      status: "healthy",
    });
    expect(JSON.stringify(harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).knowledge)).not.toContain(candidate().content);

    const replay = await harness.tickDailyOperations();
    expect(replay.alreadyRun).toEqual(
      expect.arrayContaining(["knowledge-compile", "knowledge-backup"]),
    );
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
    expect(backups).toBe(1);

    // The scheduler claim is durable; a fresh process must not publish a
    // duplicate generation for the same candidate.
    harness.close();
    harnesses.splice(harnesses.indexOf(harness), 1);
    const directory = directories[0]!;
    const restored = startInDirectory(directory, () => "2026-09-05T20:00:00.000Z", () => [candidate()]);
    await restored.tickDailyOperations();
    expect(restored.vaultGenerations("Personal")).toHaveLength(1);
  });

  it("surfaces stale and conflicted pages without promoting operational output", async () => {
    let current = candidate({ freshness: "stale" });
    let clock = firstNow;
    const harness = start(() => clock, () => [current]);
    await harness.tickDailyOperations();
    expect(harness.knowledgeHealth().find((health) => health.domain === "Personal")?.status).toBe("stale");

    clock = "2026-09-05T20:00:00.000Z";
    current = candidate({
      id: "candidate:rm44-working-preferences-v2",
      contentHash: contentHash("Ming protects deep work after 15:00."),
      content: "Ming protects deep work after 15:00.",
      freshness: "current",
    });
    await harness.tickDailyOperations();
    const health = harness.knowledgeHealth().find((entry) => entry.domain === "Personal");
    expect(health).toMatchObject({ status: "conflicted", quarantinedConflicts: 1 });
    expect(harness.vaultGenerations("Personal")).toHaveLength(2);
    expect(JSON.stringify(harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).knowledge)).not.toContain("after 15:00");
  });

  it("replays authoritative sources when a process restarts between ingest and compile", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm44-restart-mid-"));
    directories.push(directory);
    const first = startInDirectory(directory, () => firstNow, () => [candidate()]);
    await first.runKnowledgeJob("knowledge-ingest");
    first.close();
    harnesses.splice(harnesses.indexOf(first), 1);

    const restored = startInDirectory(directory, () => firstNow, () => [candidate()]);
    await restored.runKnowledgeJob("knowledge-compile");
    expect(restored.vaultGenerations("Personal")).toHaveLength(1);
    expect(restored.knowledgeStagedCandidates()).toHaveLength(0);
  });

  it("keeps knowledge health isolated to the affected trust domain", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm44-domains-"));
    directories.push(directory);
    let clock = firstNow;
    let personal = candidate();
    const academic: CandidateEnvelope = candidate({
      id: "candidate:rm44-academic",
      sourceIdentity: "agent-brain:academic",
      sourceReference: "agent-brain://academic/course.md",
      canonicalEvidenceId: "agent-brain:academic:evidence:rm44-1",
      contentHash: contentHash("Course timetable is current."),
      trustDomain: "Academic",
      allowedRoles: ["CAO"],
      content: "Course timetable is current.",
      citations: ["agent-brain://academic/evidence/rm44-1"],
    });
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => clock,
      knowledgeVault: { statePath: join(directory, "knowledge.sqlite"), encryptionKey: "rm44-domain-key" },
      knowledgeOperations: {
        sources: [
          { sourceIdentity: "agent-brain:personal", trustDomain: "Personal", evidenceBoundary: "project-evidence-broker", captureCandidate: async () => ({ kind: "candidate-envelope", candidate: personal }) },
          { sourceIdentity: "agent-brain:academic", trustDomain: "Academic", evidenceBoundary: "project-evidence-broker", captureCandidate: async () => ({ kind: "candidate-envelope", candidate: academic }) },
          { sourceIdentity: "agent-brain:finance", trustDomain: "Finance", evidenceBoundary: "project-evidence-broker", captureCandidate: async () => ({ kind: "rejected", reason: "uncited" }) },
        ],
        backup: async () => undefined,
      },
    });
    harnesses.push(harness);
    await harness.tickDailyOperations();
    personal = { ...personal, id: "candidate:rm44-personal-v2", contentHash: contentHash("Contradictory personal claim."), content: "Contradictory personal claim." };
    clock = "2026-09-05T20:00:00.000Z";
    await harness.tickDailyOperations();
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("conflicted");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Academic")?.status).toBe("healthy");
    const generationsAfterConflict = harness.vaultGenerations("Personal").length;
    clock = "2026-09-06T20:00:00.000Z";
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Personal")).toHaveLength(generationsAfterConflict);
  });

  it("files daily outputs with provenance while keeping them out of stable wiki pages", async () => {
    const output: KnowledgeOperationalOutput = {
      idempotencyKey: "daily-note:2026-09-04",
      root: "Personal",
      path: "daily/2026-09-04.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/daily/2026-09-04",
      canonicalEvidenceId: "agent-brain:personal:evidence:rm44-daily",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: "sha256:0e519ecc801932f9f0d9b7c83ddc259be5c8dcc7b05229fce5d40d769a9cf6af",
      content: "Operational planning candidate for CEO review.",
      citations: ["agent-brain://personal/daily/2026-09-04"],
      recordKind: "daily-note",
    };
    let clock = firstNow;
    const harness = start(() => clock, () => [], undefined, [output]);
    await harness.tickDailyOperations();

    const filed = harness.readVaultPage("Personal", output.path);
    expect(filed).toContain("Operational record — pending normal validation");
    expect(filed).toContain(output.canonicalEvidenceId);
    expect(filed).toContain(output.contentHash);
    expect(harness.knowledgeStagedCandidates()).toHaveLength(0);
    expect(harness.compiledKnowledgePages().some((page) => page.path === output.path)).toBe(false);
    expect(harness.operationalKnowledgeOutputs()).toContainEqual(expect.objectContaining({
      idempotencyKey: output.idempotencyKey,
      state: "candidate",
      canonicalEvidenceId: output.canonicalEvidenceId,
    }));
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
    clock = "2026-09-05T20:00:00.000Z";
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
  });

  it("rejects an operational output with invalid provenance or a secret in metadata", async () => {
    const output: KnowledgeOperationalOutput = {
      idempotencyKey: "daily-note:invalid",
      root: "Personal",
      path: "daily/invalid.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "https://api.telegram.org/bot8123456789:AAH123456789012345678901234567890/sendMessage",
      canonicalEvidenceId: "agent-brain:personal:evidence:invalid",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: "sha256:9d08f2183a1cf346e848c1ba33b1457d5762512c52bf3f5625bfeee344673465",
      content: "Safe body.",
      citations: ["agent-brain://personal/evidence/invalid"],
      recordKind: "daily-note",
    };
    const harness = start(() => firstNow, () => [], undefined, [
      output,
      { ...output, contentHash: "sha256:4b27ea7b160a8eac83eac187b46493fce951d01424200541bc9ec567da785ec8", content: "Mutated redelivery." },
    ]);
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("denied");
  });

  it("does not let a Personal source file an operational record into Finance", async () => {
    const output: KnowledgeOperationalOutput = {
      idempotencyKey: "daily-note:cross-domain",
      root: "Finance",
      path: "daily/cross-domain.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/daily/cross-domain",
      canonicalEvidenceId: "agent-brain:personal:evidence:cross-domain",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: "sha256:9d08f2183a1cf346e848c1ba33b1457d5762512c52bf3f5625bfeee344673465",
      content: "Safe body.",
      citations: ["agent-brain://personal/evidence/cross-domain"],
      recordKind: "daily-note",
    };
    const harness = start(() => firstNow, () => [], undefined, [output]);
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Finance")).toHaveLength(0);
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Finance")?.status).toBe("denied");
  });

  it("rejects an operational record whose declared hash does not match its body", async () => {
    const output: KnowledgeOperationalOutput = {
      idempotencyKey: "daily-note:hash-mismatch",
      root: "Personal",
      path: "daily/hash-mismatch.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/daily/hash-mismatch",
      canonicalEvidenceId: "agent-brain:personal:evidence:hash-mismatch",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: "sha256:0e519ecc801932f9f0d9b7c83ddc259be5c8dcc7b05229fce5d40d769a9cf6af",
      content: "Different body.",
      citations: ["agent-brain://personal/evidence/hash-mismatch"],
      recordKind: "daily-note",
    };
    const harness = start(() => firstNow, () => [], undefined, [output]);
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
    expect(harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-publish")?.status).toBe("denied");
  });

  it("rejects an operational path that escapes its daily namespace", async () => {
    const output: KnowledgeOperationalOutput = {
      idempotencyKey: "daily-note:path-traversal",
      root: "Personal",
      path: "daily/../wiki/escape.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/daily/path-traversal",
      canonicalEvidenceId: "agent-brain:personal:evidence:path-traversal",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: contentHash("Safe body."),
      content: "Safe body.",
      citations: ["agent-brain://personal/evidence/path-traversal"],
      recordKind: "daily-note",
    };
    const harness = start(() => firstNow, () => [], undefined, [output]);
    await harness.tickDailyOperations();
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("denied");
  });

  it("attributes an operational publication failure to its affected domain", async () => {
    const output = {
      idempotencyKey: "daily-note:publication-failure",
      root: "Personal" as const,
      path: "daily/publication-failure.md",
      sourceIdentity: "agent-brain:personal",
      sourceReference: "agent-brain://personal/daily/publication-failure",
      canonicalEvidenceId: "agent-brain:personal:evidence:publication-failure",
      capturedAt: "2026-09-04T19:30:00.000Z",
      asOf: "2026-09-04T19:00:00.000Z",
      contentHash: contentHash("Safe body."),
      get content(): string {
        throw new Error("controlled vault publication failure");
      },
      citations: ["agent-brain://personal/evidence/publication-failure"],
      recordKind: "daily-note" as const,
    } as unknown as KnowledgeOperationalOutput;
    const harness = start(() => firstNow, () => [], undefined, [output]);
    await harness.tickDailyOperations();
    expect(harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-publish")?.status).toBe("failed");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("failed");
  });

  it("denies a source that returns a candidate outside its declared binding", async () => {
    const harness = start(() => firstNow, () => [candidate({ sourceIdentity: "agent-brain:finance", trustDomain: "Finance" })]);
    const tick = await harness.tickDailyOperations();
    expect(tick.failed).toContain("knowledge-ingest");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("denied");
    expect(harness.vaultGenerations("Personal")).toHaveLength(0);
  });

  it("denies a source declaration whose identity is registered to another Trust Domain", async () => {
    const mismatchedCandidate = candidate({ trustDomain: "Finance" });
    const harness = start(
      () => firstNow,
      () => [],
      undefined,
      [],
      { kind: "candidate-envelope", candidate: mismatchedCandidate },
      "Finance",
    );
    await harness.tickDailyOperations();
    expect(harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-ingest")?.status).toBe("denied");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Finance")?.status).toBe("denied");
    expect(harness.vaultGenerations("Finance")).toHaveLength(0);
  });

  it("denies a candidate whose source reference is outside the declared source allowlist", async () => {
    const harness = start(() => firstNow, () => [candidate({ sourceReference: "notion://unbound/page" })]);
    const tick = await harness.tickDailyOperations();
    expect(tick.failed).toContain("knowledge-ingest");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("denied");
  });

  it("counts an uncited candidate as a citation failure instead of an empty healthy page", async () => {
    const harness = start(() => firstNow, () => [candidate({ citations: [] })], async () => undefined);
    const tick = await harness.tickDailyOperations();
    expect(tick.ran).toContain("knowledge-compile");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")).toMatchObject({
      citationFailures: 1,
      status: "failed",
      currentGeneration: null,
    });
  });

  it("keeps broker rejection as failed and broker denial as denied per domain", async () => {
    const rejected = start(
      () => firstNow,
      () => [],
      undefined,
      [],
      { kind: "rejected", reason: "uncited" },
    );
    await rejected.tickDailyOperations();
    expect(rejected.knowledgeJobHealth().find((entry) => entry.job === "knowledge-ingest")?.status).toBe("failed");
    expect(rejected.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("failed");

    const denied = start(
      () => firstNow,
      () => [],
      undefined,
      [],
      { kind: "denied", reason: "not-authorized" },
    );
    await denied.tickDailyOperations();
    expect(denied.knowledgeJobHealth().find((entry) => entry.job === "knowledge-ingest")?.status).toBe("denied");
    expect(denied.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("denied");
  });

  it("reports bounded source unavailability and failed retry visibly", async () => {
    let unavailable = true;
    const harness = start(() => firstNow, () => {
      if (unavailable) throw new Error("controlled source unavailable");
      return [candidate()];
    });
    const first = await harness.tickDailyOperations();
    expect(first.failed).toContain("knowledge-ingest");
    expect(harness.knowledgeJobDefinitions()).toHaveLength(6);
    expect(harness.knowledgeStagedCandidates()).toHaveLength(0);
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("unavailable");

    unavailable = false;
    const retry = await harness.tickDailyOperations();
    expect(retry.ran).toContain("knowledge-ingest");
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
  });

  it("records a bounded lint failure and one recovery without duplicate generations", async () => {
    let clock = firstNow;
    const harness = start(() => clock, () => [candidate()], async () => undefined);
    await harness.failNextScheduledRun("knowledge-lint");
    const failed = await harness.tickDailyOperations();
    expect(failed.failed).toContain("knowledge-lint");
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.currentGeneration).toBe(1);
    expect(harness.knowledgeHealth().find((entry) => entry.domain === "Personal")?.status).toBe("failed");

    clock = "2026-09-05T20:00:00.000Z";
    await harness.failNextScheduledRun("knowledge-lint");
    const recovered = await harness.tickDailyOperations();
    expect(recovered.failed).toContain("knowledge-lint");
    expect(harness.vaultGenerations("Personal")).toHaveLength(1);
    expect(harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).scheduler.find((job) => job.job === "knowledge-lint")?.failureHistory).toHaveLength(2);

    clock = "2026-09-06T20:00:00.000Z";
    const released = await harness.tickDailyOperations();
    expect(released.ran).toContain("knowledge-lint");
    expect(harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).scheduler.find((job) => job.job === "knowledge-lint")?.failureStreak).toBe(0);
  });

  it("stops retrying one failed knowledge occurrence after the configured bound", async () => {
    const harness = start(() => firstNow, () => [candidate()], async () => undefined);
    await harness.failNextScheduledRun("knowledge-backup");
    await harness.tickDailyOperations();
    await harness.failNextScheduledRun("knowledge-backup");
    await harness.tickDailyOperations();
    await harness.failNextScheduledRun("knowledge-backup");
    await harness.tickDailyOperations();
    const before = harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).scheduler.find((job) => job.job === "knowledge-backup")?.failureHistory.length;
    await harness.tickDailyOperations();
    const after = harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" }).scheduler.find((job) => job.job === "knowledge-backup")?.failureHistory.length;
    expect(before).toBe(4); // one prior-day missed heartbeat plus three bounded attempts
    expect(after).toBe(4);
  });

  it("purges an expired raw context payload while retaining its provenance record", async () => {
    let clock = firstNow;
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm44-retention-"));
    directories.push(directory);
    const selected: PersonalContextManifestEntry = {
      manifestId: "rm44-retention",
      title: "Bounded retention fixture",
      purpose: "Prove scheduled payload retention.",
      trustDomain: "Personal",
      sensitivity: "private",
      allowedRoles: ["COO"],
      authority: "personal plan",
      freshnessPolicy: "monthly",
      sourceSystem: "local-file",
      sourceReference: "C:\\controlled\\rm44-retention.md",
      mode: "snapshot",
      retentionClass: "personal-context-30d",
    };
    const allowlist: PersonalContextAllowlistEntry = {
      manifestId: selected.manifestId,
      sourceSystem: selected.sourceSystem,
      sourceReference: selected.sourceReference,
      manifestDigest: personalContextManifestDigest(selected),
      approvedBy: "ceo:ming",
    };
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => clock,
      personalContext: {
        statePath: join(directory, "personal-context.sqlite"),
        stagingDirectory: join(directory, "staging"),
        repositoryRoot: process.cwd(),
        encryptionKey: "rm44-retention-key",
        allowlist: [allowlist],
        sources: {
          [`local-file:${selected.sourceReference}`]: {
            content: "Retain provenance but purge this payload.",
            asOf: firstNow,
            freshness: "current",
          },
        },
      },
      knowledgeVault: { encryptionKey: "rm44-retention-vault" },
      knowledgeOperations: { backup: async () => undefined },
    });
    harnesses.push(harness);
    const ingested = await harness.ingestPersonalContext(selected);
    expect(ingested.kind).toBe("verified-ingestion");
    if (ingested.kind !== "verified-ingestion") return;
    clock = "2026-10-05T20:00:00.000Z";
    await harness.runKnowledgeJob("knowledge-retention");
    expect(harness.personalContextCandidates().find((entry) => entry.id === ingested.candidate.id)).toMatchObject({
      purgeState: "purged",
      sourceReference: selected.sourceReference,
      contentHash: ingested.candidate.contentHash,
    });
    expect(() => harness.readPersonalContext(ingested.candidate.id, "COO")).toThrow("payload has been purged");
  });

  it("reports retention as unavailable when production requires a purge capability", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm44-retention-required-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => firstNow,
      knowledgeVault: { statePath: join(directory, "knowledge.sqlite"), encryptionKey: "rm44-retention-required-key" },
      knowledgeOperations: { backup: async () => undefined, retentionRequired: true },
    });
    harnesses.push(harness);
    await harness.runKnowledgeJob("knowledge-retention").catch(() => undefined);
    expect(harness.knowledgeJobHealth().find((entry) => entry.job === "knowledge-retention")?.status).toBe("unavailable");
  });
});
