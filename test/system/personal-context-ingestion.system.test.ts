import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type {
  PersonalContextAllowlistEntry,
  PersonalContextManifestEntry,
  PersonalContextSourceReader,
  PersonalContextSourceValue,
} from "../../src/knowledge/personal-context-ingestion.js";
import {
  createLocalFilePersonalContextSourceAdapter,
  createPersonalContextSourceReader,
  maxPersonalContextSnapshotChars,
  personalContextManifestDigest,
} from "../../src/knowledge/personal-context-ingestion.js";

describe("RM-17 Personal Context ingestion boundary", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(
    sources: Readonly<Record<string, PersonalContextSourceValue>>,
    allowlist: readonly PersonalContextAllowlistEntry[] = [],
    sourceReader?: PersonalContextSourceReader,
  ): { harness: RealMingSystemHarness; directory: string } {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm17-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => "2026-09-02T09:00:00.000Z",
      personalContext: {
        statePath: join(directory, "personal-context.sqlite"),
        stagingDirectory: join(directory, "staging"),
        repositoryRoot: process.cwd(),
        encryptionKey: "rm17-controlled-key-must-not-be-reported",
        sources,
        allowlist,
        ...(sourceReader === undefined ? {} : { sourceReader }),
      },
    });
    harnesses.push(harness);
    return { harness, directory };
  }

  function entry(
    overrides: Partial<PersonalContextManifestEntry> = {},
  ): PersonalContextManifestEntry {
    return {
      manifestId: "rm17-working-preferences",
      title: "Working preferences and routine",
      purpose: "Help the CEO receive useful personalized daily planning.",
      trustDomain: "Personal",
      sensitivity: "private",
      allowedRoles: ["COO"],
      authority: "personal plan",
      freshnessPolicy: "monthly",
      sourceSystem: "local-file",
      sourceReference:
        "C:\\Users\\quekm\\Desktop\\projects\\real-ming-private-context\\working-preferences.md",
      mode: "snapshot",
      retentionClass: "personal-context-30d",
      ...overrides,
    };
  }

  function ceoAllowlist(
    selected: PersonalContextManifestEntry,
    approvedBy = "ceo:ming",
  ): PersonalContextAllowlistEntry {
    return {
      manifestId: selected.manifestId,
      sourceSystem: selected.sourceSystem,
      sourceReference: selected.sourceReference,
      manifestDigest: personalContextManifestDigest(selected),
      approvedBy,
    };
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates one provenance-bearing encrypted Candidate Envelope and scopes reads", async () => {
    const sourceReference = entry().sourceReference;
    const { harness, directory } = startHarness({
      [`local-file:${sourceReference}`]: {
        content:
          "The CEO wants agents to prepare personalized planning for final review.\n",
        asOf: "2026-09-01T09:00:00.000Z",
        freshness: "current",
      },
    }, [ceoAllowlist(entry())]);

    const result = await harness.ingestPersonalContext(entry());

    expect(result.kind).toBe("verified-ingestion");
    if (result.kind !== "verified-ingestion") return;
    expect(result.candidate).toMatchObject({
      manifestId: "rm17-working-preferences",
      sourceSystem: "local-file",
      sourceReference,
      capturedAt: "2026-09-02T09:00:00.000Z",
      asOf: "2026-09-01T09:00:00.000Z",
      authority: "personal plan",
      sensitivity: "private",
      trustDomain: "Personal",
      allowedRoles: ["COO"],
      retentionClass: "personal-context-30d",
      mode: "snapshot",
      provenanceLabel: "SNAPSHOT — Source of Record remains authoritative",
      freshness: "current",
      staleLabel: null,
      supersedesCandidateId: null,
      purgeEligibleAt: "2026-10-02T09:00:00.000Z",
    });
    expect(result.candidate.id).toMatch(/^candidate:/);
    expect(result.candidate.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      await harness.readPersonalContext(result.candidate.id, "COO"),
    ).toContain("personalized planning");
    expect(() => harness.readPersonalContext(result.candidate.id, "CMO")).toThrow(
      "The CMO is not allowed to read this Personal Context item.",
    );

    const stagingFiles = harness.personalContextStagingFiles();
    expect(stagingFiles).toHaveLength(1);
    expect(readFileSync(stagingFiles[0]!, "utf8")).not.toContain(
      "personalized planning",
    );
    expect(readFileSync(stagingFiles[0]!, "utf8")).not.toContain(
      "rm17-controlled-key",
    );
    expect(readdirSync(directory)).toEqual(
      expect.arrayContaining([
        "operations.sqlite",
        "personal-context.sqlite",
        "staging",
      ]),
    );
  });

  it("replays unchanged manifests idempotently and supersedes changed source content", async () => {
    const selected = entry();
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness({
      [sourceKey]: {
        content: "Initial bounded preference.\n",
        asOf: "2026-09-01T09:00:00.000Z",
        freshness: "current",
      },
    }, [ceoAllowlist(selected)]);

    const first = await harness.ingestPersonalContext(selected);
    const replay = await harness.ingestPersonalContext(selected);
    expect(first.kind).toBe("verified-ingestion");
    expect(replay.kind).toBe("verified-ingestion");
    if (first.kind !== "verified-ingestion" || replay.kind !== "verified-ingestion") {
      return;
    }
    expect(replay.candidate.id).toBe(first.candidate.id);
    expect(harness.personalContextCandidates()).toHaveLength(1);

    harness.setPersonalContextSource(sourceKey, {
      content: "Updated bounded preference.\n",
      asOf: "2026-09-02T08:00:00.000Z",
      freshness: "current",
    });
    const successor = await harness.ingestPersonalContext(selected);
    expect(successor.kind).toBe("verified-ingestion");
    if (successor.kind !== "verified-ingestion") return;
    expect(successor.candidate.id).not.toBe(first.candidate.id);
    expect(successor.candidate.supersedesCandidateId).toBe(first.candidate.id);
    expect(harness.personalContextCandidates()).toHaveLength(2);
    expect(
      await harness.readPersonalContext(successor.candidate.id, "COO"),
    ).toContain("Updated bounded preference");
  });

  it("quarantines Sensitive Secrets before any encrypted staging", async () => {
    const selected = entry({ manifestId: "rm17-secret-rejection" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness({
      [sourceKey]: {
        content: "password: do-not-store-this\n",
        asOf: "2026-09-02T09:00:00.000Z",
        freshness: "current",
      },
    }, [ceoAllowlist(selected)]);

    const result = await harness.ingestPersonalContext(selected);

    expect(result).toMatchObject({
      kind: "quarantined",
      reasons: ["credential"],
    });
    expect(harness.personalContextStagingFiles()).toEqual([]);
    expect(harness.personalContextCandidates()).toHaveLength(1);
    expect(harness.personalContextCandidates()[0]).toMatchObject({
      state: "quarantined",
      quarantineReasons: ["credential"],
      purgeEligibleAt: "2026-10-02T09:00:00.000Z",
    });
  });

  it("supports a Notion pointer and labels stale source material without changing the workflow", async () => {
    const selected = entry({
      manifestId: "rm17-notion-pointer",
      sourceSystem: "notion",
      sourceReference: "notion-page:working-preferences",
      mode: "pointer",
      freshnessPolicy: "weekly",
    });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness({
      [sourceKey]: {
        content: "A stale preference pointer.\n",
        asOf: "2026-08-01T09:00:00.000Z",
        freshness: "stale",
      },
    }, [ceoAllowlist(selected)]);

    const result = await harness.ingestPersonalContext(selected);

    expect(result.kind).toBe("verified-ingestion");
    if (result.kind !== "verified-ingestion") return;
    expect(result.candidate).toMatchObject({
      sourceSystem: "notion",
      mode: "pointer",
      freshness: "stale",
      staleLabel: "STALE — recheck source before treating as current",
      payloadPath: null,
    });
    expect(harness.personalContextCandidates()[0]?.staleLabel).toBe(
      "STALE — recheck source before treating as current",
    );
    expect(() => harness.readPersonalContext(result.candidate.id, "COO")).toThrow(
      "This Candidate Envelope is a pointer; read the Source of Record through its adapter.",
    );
  });

  it("requires an exact CEO allowlist entry before reading any source", async () => {
    const selected = entry({ manifestId: "rm17-not-allowlisted" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference.\n",
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected, "executive:COO")],
    );

    await expect(harness.ingestPersonalContext(selected)).rejects.toThrow(
      "Personal Context item is not CEO-allowlisted.",
    );
    expect(harness.personalContextCandidates()).toEqual([]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
  });

  it("binds CEO approval to the complete manifest policy", async () => {
    const approvedManifest = entry({ manifestId: "rm17-policy-binding" });
    const alteredManifest = entry({
      manifestId: approvedManifest.manifestId,
      allowedRoles: ["COO", "CMO"],
    });
    const sourceKey = `${alteredManifest.sourceSystem}:${alteredManifest.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference.\n",
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(approvedManifest)],
    );

    await expect(harness.ingestPersonalContext(alteredManifest)).rejects.toThrow(
      "Personal Context item is not CEO-allowlisted.",
    );
  });

  it("rejects an oversized snapshot before staging", async () => {
    const selected = entry({ manifestId: "rm17-oversized" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "x".repeat(maxPersonalContextSnapshotChars + 1),
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected)],
    );

    await expect(harness.ingestPersonalContext(selected)).rejects.toThrow(
      "Personal Context snapshot exceeds the bounded size limit.",
    );
    expect(harness.personalContextCandidates()).toEqual([]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
  });

  it("rejects an invalid source as-of timestamp before staging", async () => {
    const selected = entry({ manifestId: "rm17-invalid-as-of" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference.\n",
          asOf: "not-a-date",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected)],
    );
    await expect(harness.ingestPersonalContext(selected)).rejects.toThrow(
      "Personal Context source asOf must be a valid ISO date.",
    );
    expect(harness.personalContextCandidates()).toEqual([]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
  });

  it("purges an expired encrypted snapshot while retaining append-only evidence", async () => {
    const selected = entry({ manifestId: "rm17-purge" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference eligible for purge.\n",
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected)],
    );
    const result = await harness.ingestPersonalContext(selected);
    expect(result.kind).toBe("verified-ingestion");
    if (result.kind !== "verified-ingestion") return;

    expect(harness.purgePersonalContext("2026-10-02T09:00:00.000Z")).toEqual([
      result.candidate.id,
    ]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
    expect(harness.personalContextCandidates()[0]).toMatchObject({
      id: result.candidate.id,
      purgeState: "purged",
    });
    expect(() => harness.readPersonalContext(result.candidate.id, "COO")).toThrow(
      "The Personal Context payload has been purged.",
    );
  });

  it("honors a stricter finite Trust-Domain retention class", async () => {
    const selected = entry({
      manifestId: "rm17-stricter-retention",
      retentionClass: "personal-context-7d",
    });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference with a shorter retention policy.\n",
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected)],
    );
    const result = await harness.ingestPersonalContext(selected);
    expect(result.kind).toBe("verified-ingestion");
    if (result.kind !== "verified-ingestion") return;
    expect(result.candidate.purgeEligibleAt).toBe(
      "2026-09-09T09:00:00.000Z",
    );
    expect(harness.purgePersonalContext("2026-09-08T23:59:59.000Z")).toEqual([]);
    expect(harness.purgePersonalContext("2026-09-09T09:00:00.000Z")).toEqual([
      result.candidate.id,
    ]);
  });

  it("rejects a raw-staging retention class longer than the ADR limit", async () => {
    const selected = entry({
      manifestId: "rm17-retention-limit",
      retentionClass: "personal-context-31d",
    });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "A bounded preference.\n",
          asOf: "2026-09-02T09:00:00.000Z",
          freshness: "current",
        },
      },
      [ceoAllowlist(selected)],
    );
    await expect(harness.ingestPersonalContext(selected)).rejects.toThrow(
      "Personal Context retentionClass exceeds the 30-day raw staging maximum.",
    );
    expect(harness.personalContextCandidates()).toEqual([]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
  });

  it("creates a new envelope when provenance freshness metadata changes", async () => {
    const selected = entry({ manifestId: "rm17-provenance-change" });
    const sourceKey = `${selected.sourceSystem}:${selected.sourceReference}`;
    const { harness } = startHarness(
      {
        [sourceKey]: {
          content: "The same bounded preference.\n",
          asOf: "2026-09-01T09:00:00.000Z",
          freshness: "current",
          sourceVersion: "v1",
        },
      },
      [ceoAllowlist(selected)],
    );
    const first = await harness.ingestPersonalContext(selected);
    expect(first.kind).toBe("verified-ingestion");
    if (first.kind !== "verified-ingestion") return;

    harness.setPersonalContextSource(sourceKey, {
      content: "The same bounded preference.\n",
      asOf: "2026-09-02T08:00:00.000Z",
      freshness: "stale",
      sourceVersion: "v2",
    });
    const successor = await harness.ingestPersonalContext(selected);
    expect(successor.kind).toBe("verified-ingestion");
    if (successor.kind !== "verified-ingestion") return;
    expect(successor.candidate.id).not.toBe(first.candidate.id);
    expect(successor.candidate.supersedesCandidateId).toBe(first.candidate.id);
    expect(successor.candidate.staleLabel).toBe(
      "STALE — recheck source before treating as current",
    );
  });

  it("reads an additional CEO-selected local file through the generic adapter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm17-file-"));
    directories.push(directory);
    const sourceReference = join(directory, "second-preference.md");
    writeFileSync(sourceReference, "A second bounded preference.\n", "utf8");
    const selected = entry({
      manifestId: "rm17-local-adapter",
      sourceReference,
    });
    const sourceReader = createPersonalContextSourceReader({
      localFile: createLocalFilePersonalContextSourceAdapter({
        now: () => "2026-09-02T09:00:00.000Z",
      }),
      notion: () => {
        throw new Error("Notion adapter should not be called for a local file.");
      },
    });
    const { harness } = startHarness({}, [ceoAllowlist(selected)], sourceReader);
    const result = await harness.ingestPersonalContext(selected);
    expect(result.kind).toBe("verified-ingestion");
    if (result.kind !== "verified-ingestion") return;
    expect(await harness.readPersonalContext(result.candidate.id, "COO")).toContain(
      "second bounded preference",
    );
    expect(result.candidate.sourceReference).toBe(sourceReference);
  });

  it("rejects a staging directory inside the repository", () => {
    const directory = join(process.cwd(), "personal-context", "staging");
    const stateDirectory = mkdtempSync(join(tmpdir(), "real-ming-rm17-path-"));
    directories.push(stateDirectory);
    expect(() =>
      createRealMingSystemHarness({
        statePath: join(stateDirectory, "operations.sqlite"),
        personalContext: {
          statePath: join(stateDirectory, "personal-context.sqlite"),
          stagingDirectory: directory,
          repositoryRoot: process.cwd(),
          encryptionKey: "rm17-repository-path-key",
          sources: {},
          allowlist: [],
        },
      }),
    ).toThrow("Personal Context staging must be outside the repository.");
  });

  it("purges an orphaned encrypted staging file after the default retention window", async () => {
    const { harness, directory } = startHarness({}, []);
    const candidatesDirectory = join(directory, "staging", "candidates");
    mkdirSync(candidatesDirectory, { recursive: true });
    const orphanPath = join(candidatesDirectory, "candidate-orphan.enc");
    writeFileSync(orphanPath, "ciphertext-only", "utf8");
    const oldDate = new Date("2026-08-01T09:00:00.000Z");
    utimesSync(orphanPath, oldDate, oldDate);

    expect(harness.personalContextStagingFiles()).toEqual([orphanPath]);
    expect(harness.purgePersonalContext("2026-09-02T09:00:00.000Z")).toEqual([]);
    expect(harness.personalContextStagingFiles()).toEqual([]);
  });
});
