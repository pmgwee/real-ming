import type {
  CandidateEnvelope,
  ProjectEvidenceCandidateResult,
} from "../evidence/evidence-broker.js";
import type { OperationsState } from "../operations/operations-state.js";
import type {
  ExecutiveRole,
  TrustDomain,
} from "../operations/contracts.js";
import type {
  SchedulerJobDefinition,
  SchedulerCriticality,
} from "../operations/daily-operations-scheduler.js";
import {
  createDailyOperationsScheduler,
  type DailyOperationsScheduler,
} from "../operations/daily-operations-scheduler.js";
import type { PersonalContextIngestion } from "./personal-context-ingestion.js";
import type {
  KnowledgeCompiler,
  KnowledgeCompilationResult,
  KnowledgeOperationalOutput,
} from "./knowledge-compiler.js";
import { sourceIdentityTrustDomain } from "./knowledge-compiler.js";
import type { KnowledgeVault, VaultRoot } from "./knowledge-vault.js";
import {
  addRetentionDuration,
  compiledGenerationRetentionByDomain,
  retentionClassDuration,
  retentionCutoff,
  retentionPolicy,
  type RetentionBackupPurgeResult,
  type RetentionPurgeCandidate,
  type RetentionPurgeEvidence,
} from "../operations/retention-policy.js";

export const knowledgeIngestJobName = "knowledge-ingest";
export const knowledgeCompileJobName = "knowledge-compile";
export const knowledgePublishJobName = "knowledge-publish";
export const knowledgeLintJobName = "knowledge-lint";
export const knowledgeRetentionJobName = "knowledge-retention";
export const knowledgeBackupJobName = "knowledge-backup";

export type KnowledgeJobName =
  | typeof knowledgeIngestJobName
  | typeof knowledgeCompileJobName
  | typeof knowledgePublishJobName
  | typeof knowledgeLintJobName
  | typeof knowledgeRetentionJobName
  | typeof knowledgeBackupJobName;

export type KnowledgeJobStatus =
  | "healthy"
  | "stale"
  | "unavailable"
  | "conflicted"
  | "denied"
  | "failed";

/**
 * The schedule is part of the job's contract, not an undocumented property of
 * a runner. This keeps a cold start independent of the previous chat turn.
 */
export interface KnowledgeJobDefinition extends SchedulerJobDefinition {
  readonly job: KnowledgeJobName;
  readonly schema: string;
  readonly domainRoots: readonly VaultRoot[];
  readonly workItemPurpose: string;
  readonly allowedSources: readonly string[];
  readonly retentionPolicy: string;
  readonly idempotencyKey: string;
  readonly expectedEvidence: string;
  /** Per-domain accountable executive; scheduler ownership remains COO coordination. */
  readonly domainAccountability: Readonly<Partial<Record<VaultRoot, ExecutiveRole>>>;
}

const allKnowledgeRoots: readonly Exclude<VaultRoot, "CEO">[] = [
  "Personal",
  "Ming Creatives",
  "Academic",
  "Entertainment",
  "Finance",
];

function definition(
  job: KnowledgeJobName,
  hour: number,
  minute: number,
  provider: string,
  criticality: SchedulerCriticality,
  schema: string,
  workItemPurpose: string,
  allowedSources: readonly string[],
  retentionPolicy: string,
  expectedEvidence: string,
): KnowledgeJobDefinition {
  return {
    job,
    hour,
    minute,
    provider,
    expectedCadence: "daily",
    criticality,
    // The scheduler is a control-plane operation coordinated by the COO;
    // domainAccountability below records which executive owns the content.
    accountableExecutive: "COO" satisfies ExecutiveRole,
    evidenceLink: `scheduler-definition:${job}`,
    schema,
    domainRoots: allKnowledgeRoots,
    workItemPurpose,
    allowedSources,
    retentionPolicy,
    idempotencyKey: `${job}:{operatingDate}`,
    expectedEvidence,
    domainAccountability: {
      Personal: "COO",
      "Ming Creatives": "CTO",
      Academic: "CAO",
      Entertainment: "COO",
      Finance: "Personal CFO",
    },
  };
}

export const knowledgeJobInventory: readonly KnowledgeJobDefinition[] = [
  definition(
    knowledgeIngestJobName,
    1,
    0,
    "agent-brain",
    "critical",
    "CandidateEnvelope/v1",
    "knowledge-ingest",
    ["agent-brain:evidence-broker"],
    "candidate-payload-30d; provenance-retained",
    "candidate-envelope with source identity and citations",
  ),
  definition(
    knowledgeCompileJobName,
    1,
    15,
    "internal",
    "critical",
    "CompiledKnowledgePage/v1",
    "knowledge-compile",
    ["knowledge-staging"],
    "versioned generations retained; superseded policy applies",
    "compiler result and generation evidence",
  ),
  definition(
    knowledgePublishJobName,
    1,
    30,
    "knowledge-vault",
    "critical",
    "KnowledgeVaultGeneration/v1",
    "knowledge-publish",
    ["knowledge-compiler"],
    "atomic generation; append-only log",
    "verified generation and vault pointer",
  ),
  definition(
    knowledgeLintJobName,
    2,
    0,
    "knowledge-vault",
    "routine",
    "KnowledgeLintReport/v1",
    "knowledge-lint",
    ["knowledge-vault"],
    "lint reports are operational records",
    "payload-free lint counts and evidence link",
  ),
  definition(
    knowledgeRetentionJobName,
    2,
    30,
    "context-vault",
    "routine",
    "RetentionReport/v1",
    "knowledge-retention",
    ["context-vault"],
    "raw candidates/payloads purge after 30d; Personal superseded projections 12m; deleted backups 30d; financial snapshots/approvals/outcomes/audit indefinite",
    "purge tombstones and retained provenance",
  ),
  definition(
    knowledgeBackupJobName,
    3,
    0,
    "backup-store",
    "critical",
    "KnowledgeBackupManifest/v1",
    "knowledge-backup",
    ["knowledge-vault"],
    "backup ages out with the source retention policy",
    "hash-only backup manifest",
  ),
];

export interface KnowledgeSource {
  readonly sourceIdentity: string;
  readonly trustDomain: TrustDomain;
  /** Knowledge operations accept only broker-produced Project Evidence. */
  readonly evidenceBoundary: "project-evidence-broker";
  /** Must return the broker-produced Candidate Envelope union, never raw provider data. */
  readonly captureCandidate: () => ProjectEvidenceCandidateResult | Promise<ProjectEvidenceCandidateResult>;
}

export interface KnowledgeDomainHealth {
  readonly domain: VaultRoot;
  readonly lastIngest: string | null;
  readonly lastCompile: string | null;
  readonly lastPublish: string | null;
  readonly lastLint: string | null;
  readonly lastRetention: string | null;
  readonly purgedRecords: number;
  readonly currentGeneration: number | null;
  readonly currentGenerationId: string | null;
  readonly backlog: number;
  readonly stalePages: number;
  readonly citationFailures: number;
  readonly quarantinedConflicts: number;
  readonly status: KnowledgeJobStatus;
}

export interface KnowledgeJobHealth {
  readonly job: KnowledgeJobName;
  readonly status: KnowledgeJobStatus;
  readonly checkedAt: string | null;
  readonly evidenceLink: string;
  readonly lastFailure: string | null;
}

export interface KnowledgeOperations {
  readonly scheduler: DailyOperationsScheduler;
  readonly definitions: readonly KnowledgeJobDefinition[];
  readonly stagedCandidates: readonly CandidateEnvelope[];
  readonly jobHealth: readonly KnowledgeJobHealth[];
  readonly domainHealth: readonly KnowledgeDomainHealth[];
  readonly retentionEvidence: readonly RetentionPurgeEvidence[];
  runJob(job: KnowledgeJobName): Promise<void>;
}

function statusForCompilation(
  result: KnowledgeCompilationResult,
): KnowledgeJobStatus {
  switch (result.kind) {
    case "compiled":
    case "unchanged":
      return "healthy";
    case "quarantined":
      return "conflicted";
    case "rejected":
      return result.reason === "sensitive-secret" || result.reason === "invalid-provenance" ? "denied" : "failed";
  }
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : "Knowledge job failed.";
}

/**
 * Schedule the LLM-Wiki pipeline without giving it a new write path. Sources
 * are read through callbacks, candidates are compiled by the existing
 * compiler, and only the encrypted Knowledge Vault is written.
 */
export function createKnowledgeOperations(options: {
  readonly state: OperationsState;
  readonly compiler: KnowledgeCompiler;
  readonly vault: KnowledgeVault;
  readonly now: () => string;
  readonly sources?: readonly KnowledgeSource[];
  readonly outputs?: readonly KnowledgeOperationalOutput[];
  readonly personalContext?: PersonalContextIngestion;
  readonly backup?: () => Promise<void>;
  /** Deletes external Context/Knowledge backup objects and proves the deletion. */
  readonly purgeBackups?: (at: string) => Promise<readonly RetentionBackupPurgeResult[]>;
  readonly admitExceptionNotice?: Parameters<typeof createDailyOperationsScheduler>[0]["admitExceptionNotice"];
  readonly recordExceptionNoticeRecovery?: Parameters<typeof createDailyOperationsScheduler>[0]["recordExceptionNoticeRecovery"];
  readonly runnerTimeoutMs?: number;
  /** Production enables this guard when a Personal Context purge capability is required. */
  readonly retentionRequired?: boolean;
  readonly failureFor?: (job: KnowledgeJobName) => string | undefined;
  readonly hangFor?: (job: KnowledgeJobName) => boolean;
}): KnowledgeOperations {
  const sources = options.sources ?? [];
  const outputs = options.outputs ?? [];
  const staged = new Map<string, CandidateEnvelope>();
  const health = new Map<KnowledgeJobName, KnowledgeJobHealth>();
  type DomainJobSnapshot = {
    status: KnowledgeJobStatus;
    checkedAt: string | null;
    error?: string;
  };
  const domainJobs = new Map<VaultRoot, Map<KnowledgeJobName, DomainJobSnapshot>>();
  const setDomainHealth = (
    root: VaultRoot,
    job: KnowledgeJobName,
    status: KnowledgeJobStatus,
    checkedAt: string,
    error?: string,
  ): void => {
    const byJob = domainJobs.get(root) ?? new Map<KnowledgeJobName, DomainJobSnapshot>();
    byJob.set(job, { status, checkedAt, ...(error === undefined ? {} : { error }) });
    domainJobs.set(root, byJob);
  };
  let lastLint = new Map<VaultRoot, { stale: number; citations: number; conflicts: number }>();
  let compileCitationFailures = new Map<VaultRoot, number>();

  const setHealth = (
    job: KnowledgeJobName,
    status: KnowledgeJobStatus,
    checkedAt: string,
    error?: string,
  ): void => {
    health.set(job, {
      job,
      status,
      checkedAt,
      evidenceLink: `scheduler-run:${job}:${checkedAt}`,
      lastFailure: error ?? health.get(job)?.lastFailure ?? null,
    });
  };

  const ingest = async (): Promise<void> => {
    let denied = false;
    let failed = false;
    let activeSource: KnowledgeSource | undefined;
    try {
      for (const source of sources) {
        activeSource = source;
        let sourceDenied = false;
        if (sourceIdentityTrustDomain(source.sourceIdentity) !== source.trustDomain) {
          setDomainHealth(source.trustDomain, knowledgeIngestJobName, "denied", options.now(), "source identity is not registered for this Trust Domain");
          setHealth(knowledgeIngestJobName, "denied", options.now(), "source identity is not registered for this Trust Domain");
          denied = true;
          continue;
        }
        const captured = await source.captureCandidate();
        const candidates = captured.kind === "candidate-envelope" || captured.kind === "stale"
          ? [captured.candidate]
          : [];
        if (captured.kind !== "candidate-envelope" && captured.kind !== "stale") {
          const status = captured.kind === "unavailable" ? "unavailable" : captured.kind === "denied" ? "denied" : "failed";
          const message = captured.kind === "unavailable" ? "evidence broker unavailable" : captured.kind === "denied" ? "evidence broker denied" : "evidence broker rejected candidate";
          setDomainHealth(source.trustDomain, knowledgeIngestJobName, status, options.now(), message);
          setHealth(knowledgeIngestJobName, status, options.now(), message);
          denied ||= captured.kind === "denied";
          failed ||= captured.kind === "rejected";
          sourceDenied = captured.kind !== "unavailable";
          if (captured.kind === "unavailable") throw new Error(message);
        }
        for (const candidate of candidates) {
          if (
            candidate.sourceIdentity !== source.sourceIdentity ||
            candidate.trustDomain !== source.trustDomain ||
            sourceIdentityTrustDomain(candidate.sourceIdentity) !== candidate.trustDomain
          ) {
            setDomainHealth(source.trustDomain, knowledgeIngestJobName, "denied", options.now(), "source binding mismatch");
            setHealth(knowledgeIngestJobName, "denied", options.now(), "source binding mismatch");
            denied = true;
            sourceDenied = true;
            continue;
          }
          const ingestDefinition = knowledgeJobInventory.find(
            (definition) => definition.job === knowledgeIngestJobName,
          );
          const sourceSegment = source.sourceIdentity.replace(/^agent-brain:/u, "");
          const sourcePrefix = `agent-brain://${sourceSegment}/`;
          const allowlistedReference = ingestDefinition?.allowedSources.some(
            (allowedSource) =>
              allowedSource === "agent-brain:evidence-broker" &&
                source.evidenceBoundary === "project-evidence-broker" &&
                candidate.sourceSystem === "agent-brain" &&
                candidate.sourceReference.startsWith(sourcePrefix),
          ) ?? false;
          if (
            !allowlistedReference ||
            candidate.sourceReference.trim().length === 0 ||
            candidate.canonicalEvidenceId.trim().length === 0 ||
            (candidate.citations.length > 0 && !candidate.citations.some(
              (citation) =>
                citation.includes(candidate.canonicalEvidenceId) ||
                citation.includes(candidate.sourceReference) ||
                (candidate.sourceSystem === "agent-brain" && citation.startsWith(sourcePrefix)),
            ))
          ) {
            const message = "source is outside the allowlist or lacks linked provenance";
            setDomainHealth(source.trustDomain, knowledgeIngestJobName, "denied", options.now(), message);
            setHealth(knowledgeIngestJobName, "denied", options.now(), message);
            denied = true;
            sourceDenied = true;
            continue;
          }
          // Persist provenance-only retention metadata before exposing the
          // bounded payload to the ephemeral staging map. The payload never
          // enters OperationsState, while the identity/hash survives a
          // compile or process restart for the later purge sweep.
          options.state.recordKnowledgeCandidate({
            candidateId: candidate.id,
            sourceIdentity: candidate.sourceIdentity,
            sourceReference: candidate.sourceReference,
            canonicalEvidenceId: candidate.canonicalEvidenceId,
            trustDomain: candidate.trustDomain,
            capturedAt: candidate.capturedAt,
            asOf: candidate.asOf,
            contentHash: candidate.contentHash,
            retentionClass: candidate.retentionClass,
          });
          staged.set(candidate.id, candidate);
        }
        if (!sourceDenied) setDomainHealth(source.trustDomain, knowledgeIngestJobName, "healthy", options.now());
      }
      if (denied) throw new Error("One or more Knowledge sources were denied.");
      if (failed) throw new Error("One or more Knowledge candidates were rejected.");
      setHealth(knowledgeIngestJobName, "healthy", options.now());
    } catch (error) {
      const currentStatus = health.get(knowledgeIngestJobName)?.status;
      if (currentStatus !== "denied" && currentStatus !== "failed" && currentStatus !== "unavailable") {
        setHealth(knowledgeIngestJobName, "unavailable", options.now(), failureText(error));
      }
      if (currentStatus !== "denied" && currentStatus !== "failed" && currentStatus !== "unavailable") {
        if (activeSource !== undefined) {
          setDomainHealth(activeSource.trustDomain, knowledgeIngestJobName, "unavailable", options.now(), failureText(error));
        }
      }
      throw error;
    }
  };

  const compile = async (): Promise<void> => {
    let status: KnowledgeJobStatus = "healthy";
    const processed: string[] = [];
    const citationFailures = new Map<VaultRoot, number>();
    try {
      const ingestStatus = health.get(knowledgeIngestJobName)?.status;
      if (staged.size === 0 && ingestStatus !== undefined && ingestStatus !== "healthy") {
        setHealth(knowledgeCompileJobName, ingestStatus, options.now(), "ingest did not produce a usable candidate set");
        throw new Error("Knowledge compilation is waiting for a usable ingest heartbeat.");
      }
      // Staging is intentionally ephemeral so sensitive payloads are not
      // persisted in plaintext. A restart after ingest replays the
      // authoritative source before compiling, preserving the occurrence.
      if (staged.size === 0 && sources.length > 0) await ingest();
      for (const candidate of staged.values()) {
        if (candidate.freshness === "stale") status = mergeStatus(status, "stale");
        const result = options.compiler.compile(candidate);
        status = mergeStatus(status, statusForCompilation(result));
        setDomainHealth(candidate.trustDomain, knowledgeCompileJobName, statusForCompilation(result), options.now());
        if (result.kind === "rejected" && result.reason === "uncited") {
          citationFailures.set(candidate.trustDomain, (citationFailures.get(candidate.trustDomain) ?? 0) + 1);
        }
        processed.push(candidate.id);
      }
      for (const candidateId of processed) {
        staged.delete(candidateId);
      }
      compileCitationFailures = citationFailures;
      setHealth(knowledgeCompileJobName, status, options.now());
    } catch (error) {
      const currentStatus = health.get(knowledgeCompileJobName)?.status;
      if (currentStatus !== "unavailable" && currentStatus !== "denied") {
        setHealth(knowledgeCompileJobName, "failed", options.now(), failureText(error));
        for (const source of sources) {
          setDomainHealth(source.trustDomain, knowledgeCompileJobName, "failed", options.now(), failureText(error));
        }
      }
      throw error;
    }
  };

  const publish = async (): Promise<void> => {
    let activeRoot: VaultRoot | undefined;
    try {
      let rejected = false;
      for (const output of outputs) {
        activeRoot = output.root;
        const result = options.compiler.fileOperationalOutput(output);
        if (result.kind === "rejected") {
          const status = result.reason === "sensitive-secret" || result.reason === "invalid-provenance" || result.reason === "unsafe-path" ? "denied" : "failed";
          setHealth(knowledgePublishJobName, status, options.now());
          setDomainHealth(output.root, knowledgePublishJobName, status, options.now());
          rejected = true;
        } else {
          setDomainHealth(output.root, knowledgePublishJobName, "healthy", options.now());
        }
      }
      if (rejected) throw new Error("A Knowledge operational output was rejected.");
      for (const root of allKnowledgeRoots) {
        const generation = options.vault.currentGeneration(root);
        if (generation !== undefined) {
          setHealth(knowledgePublishJobName, "healthy", options.now());
          setDomainHealth(root, knowledgePublishJobName, "healthy", options.now());
        }
      }
      if (!health.has(knowledgePublishJobName)) {
        setHealth(knowledgePublishJobName, "healthy", options.now());
      }
    } catch (error) {
      if (health.get(knowledgePublishJobName)?.status !== "denied") {
        setHealth(knowledgePublishJobName, "failed", options.now(), failureText(error));
      }
      if (activeRoot !== undefined && health.get(knowledgePublishJobName)?.status !== "denied") {
        setDomainHealth(activeRoot, knowledgePublishJobName, "failed", options.now(), failureText(error));
      }
      throw error;
    }
  };

  const lint = async (): Promise<void> => {
    try {
      const next = new Map<VaultRoot, { stale: number; citations: number; conflicts: number }>();
      for (const root of allKnowledgeRoots) {
        const pages = options.compiler.pages().filter((page) => page.root === root);
        const counts = {
          stale: pages.filter((page) => page.freshness === "stale").length,
          citations: pages.filter((page) => page.citations.length === 0).length,
          conflicts: pages.filter((page) => page.contested).length,
        };
        next.set(root, counts);
        setDomainHealth(
          root,
          knowledgeLintJobName,
          counts.citations > 0
            ? "failed"
            : counts.conflicts > 0
              ? "conflicted"
              : counts.stale > 0
                ? "stale"
                : "healthy",
          options.now(),
        );
      }
      lastLint = next;
      const status = [...next.values()].some((counts) => counts.citations > 0)
        ? "failed"
        : [...next.values()].some((counts) => counts.conflicts > 0)
          ? "conflicted"
          : [...next.values()].some((counts) => counts.stale > 0)
            ? "stale"
            : "healthy";
      setHealth(knowledgeLintJobName, status, options.now());
      if (status === "failed") throw new Error("Knowledge lint found citation failures.");
    } catch (error) {
      setHealth(knowledgeLintJobName, "failed", options.now(), failureText(error));
      throw error;
    }
  };

  const retention = async (): Promise<void> => {
    try {
      if (
        options.retentionRequired === true &&
        (options.personalContext === undefined || options.purgeBackups === undefined)
      ) {
        const reason = "Personal Context and backup purge capabilities are not configured";
        setHealth(knowledgeRetentionJobName, "unavailable", options.now(), reason);
        throw new Error(reason);
      }
      const purgedAt = options.now();
      const recorded = new Map(
        options.state.retentionPurgeEvents().map((event) => [event.idempotencyKey, event]),
      );
      const record = (candidate: RetentionPurgeCandidate): void => {
        const idempotencyKey = `retention:${candidate.kind}:${candidate.recordId}`;
        const existing = recorded.get(idempotencyKey);
        if (existing !== undefined) {
          if (
            existing.kind !== candidate.kind ||
            existing.recordId !== candidate.recordId ||
            existing.trustDomain !== candidate.trustDomain ||
            existing.contentHash !== candidate.contentHash ||
            existing.eligibleAt !== candidate.eligibleAt ||
            existing.policy !== candidate.policy
          ) {
            throw new Error("Retention purge evidence drifted for an existing idempotency key.");
          }
          return;
        }
        const evidence: RetentionPurgeEvidence = {
          ...candidate,
          idempotencyKey,
          purgedAt,
        };
        options.state.recordRetentionPurge(evidence);
        recorded.set(idempotencyKey, evidence);
      };

      options.personalContext?.purgeExpired(purgedAt);
      for (const event of options.personalContext?.purgeEvents() ?? []) {
        if (event.trustDomain === null || event.trustDomain === undefined) {
          // Orphaned staging payloads keep their evidence in the Personal
          // Context store's own append-only log. Naming a Trust Domain here
          // would be a guess, and the guess lands on a CEO dashboard count.
          continue;
        }
        record({
          kind: "personal-context-payload",
          recordId: event.candidateId,
          trustDomain: event.trustDomain,
          contentHash: event.contentHash,
          eligibleAt: event.eligibleAt ?? event.purgedAt,
          policy:
            event.retentionClass ??
            `personal-context-${retentionPolicy.personalContextPayloadDays}d`,
        });
      }

      const recordedRawCandidates = new Set(
        options.state
          .retentionPurgeEvents()
          .filter((event) => event.kind === "raw-candidate")
          .map((event) => event.recordId),
      );
      for (const metadata of options.state.knowledgeCandidateRetention()) {
        if (recordedRawCandidates.has(metadata.candidateId)) continue;
        // An unreadable class is refused when the row is written, so this
        // cannot throw for stored metadata. If it ever does, the outer catch
        // fails the job rather than inventing a window for a payload.
        const eligibleAt = addRetentionDuration(
          metadata.capturedAt,
          retentionClassDuration(metadata.retentionClass),
        );
        if (Date.parse(eligibleAt) > Date.parse(purgedAt)) continue;
        record({
          kind: "raw-candidate",
          recordId: metadata.candidateId,
          trustDomain: metadata.trustDomain,
          contentHash: metadata.contentHash,
          eligibleAt,
          // Preserve a stricter source/Trust-Domain class in the evidence;
          // the calculated eligibility above is the enforcement boundary.
          policy: metadata.retentionClass,
        });
        // Delete the bounded payload only after the hash-only tombstone is
        // durably recorded.  A failed evidence write must never erase the
        // only payload that can be retried safely.
        staged.delete(metadata.candidateId);
      }

      for (const root of allKnowledgeRoots) {
        const duration = compiledGenerationRetentionByDomain[root];
        const months = duration.months;
        const before = retentionCutoff(
          purgedAt,
          duration,
        );
        const policy = months === undefined
          ? `compiled-${root}-superseded-${duration.days}d`
          : `compiled-${root}-superseded-${months}m`;
        options.vault.purgeSuperseded({
          root,
          before,
          purgedAt,
          policy,
          eligibility: duration,
        });
        // The vault owns its append-only purge log. Replaying every local
        // event makes central evidence reconciliation restart-safe if the
        // control-plane database was unavailable after the vault committed.
        for (const event of options.vault.purgeEvents(root)) {
          record({
            kind: "compiled-generation",
            recordId: event.generationId,
            trustDomain: root,
            contentHash: event.contentHash,
            eligibleAt: event.eligibleAt,
            policy: event.policy,
          });
        }
      }

      for (const result of await options.purgeBackups?.(purgedAt) ?? []) {
        if (result.deleted !== true || result.verified !== true) {
          throw new Error("Backup purge did not prove deletion.");
        }
        record(result.candidate);
      }
      for (const root of allKnowledgeRoots) {
        setDomainHealth(root, knowledgeRetentionJobName, "healthy", purgedAt);
      }
      setHealth(knowledgeRetentionJobName, "healthy", options.now());
    } catch (error) {
      if (
        health.get(knowledgeRetentionJobName)?.status !== "unavailable" &&
        health.get(knowledgeRetentionJobName)?.status !== "denied"
      ) {
        setHealth(knowledgeRetentionJobName, "failed", options.now(), failureText(error));
        for (const root of allKnowledgeRoots) {
          setDomainHealth(root, knowledgeRetentionJobName, "failed", options.now(), failureText(error));
        }
      }
      throw error;
    }
  };

  const backup = async (): Promise<void> => {
    if (options.backup === undefined) {
      setHealth(knowledgeBackupJobName, "unavailable", options.now(), "backup destination is not configured");
      throw new Error("The Knowledge Vault backup destination is unavailable.");
    }
    try {
      await options.backup();
      setHealth(knowledgeBackupJobName, "healthy", options.now());
    } catch (error) {
      setHealth(knowledgeBackupJobName, "failed", options.now(), failureText(error));
      throw error;
    }
  };

  const guarded = (
    job: KnowledgeJobName,
    run: () => Promise<void>,
  ): (() => Promise<void>) => async () => {
    const failure = options.failureFor?.(job);
    if (failure !== undefined) {
      setHealth(job, "failed", options.now(), failure);
      if (job === knowledgeLintJobName) {
        for (const root of allKnowledgeRoots) {
          setDomainHealth(root, job, "failed", options.now(), failure);
        }
      }
      throw new Error(failure);
    }
    if (options.hangFor?.(job) === true) {
      await new Promise<never>(() => undefined);
    }
    await run();
  };

  const runners: Record<KnowledgeJobName, () => Promise<void>> = {
    [knowledgeIngestJobName]: guarded(knowledgeIngestJobName, ingest),
    [knowledgeCompileJobName]: guarded(knowledgeCompileJobName, compile),
    [knowledgePublishJobName]: guarded(knowledgePublishJobName, publish),
    [knowledgeLintJobName]: guarded(knowledgeLintJobName, lint),
    [knowledgeRetentionJobName]: guarded(knowledgeRetentionJobName, retention),
    [knowledgeBackupJobName]: guarded(knowledgeBackupJobName, backup),
  };

  const scheduler = createDailyOperationsScheduler({
    state: options.state,
    now: options.now,
    runners,
    jobs: knowledgeJobInventory,
    maxAttempts: 3,
      ...(options.runnerTimeoutMs === undefined ? {} : { runnerTimeoutMs: options.runnerTimeoutMs }),
    ...(options.retentionRequired === undefined ? {} : { retentionRequired: options.retentionRequired }),
    ...(options.admitExceptionNotice === undefined ? {} : { admitExceptionNotice: options.admitExceptionNotice }),
    ...(options.recordExceptionNoticeRecovery === undefined ? {} : { recordExceptionNoticeRecovery: options.recordExceptionNoticeRecovery }),
  });

  const runJob = async (job: KnowledgeJobName): Promise<void> => {
    await runners[job]();
  };

  return {
    scheduler,
    definitions: knowledgeJobInventory,
    get stagedCandidates() {
      return [...staged.values()];
    },
    get jobHealth() {
      return knowledgeJobInventory.map((definition) =>
        health.get(definition.job) ?? {
          job: definition.job,
          status: "unavailable" as const,
          checkedAt: null,
          evidenceLink: definition.evidenceLink,
          lastFailure: null,
        },
      );
    },
    get retentionEvidence() {
      return options.state.retentionPurgeEvents();
    },
    get domainHealth() {
      return allKnowledgeRoots.map((domain) => {
        const pages = options.compiler.pages().filter((page) => page.root === domain);
        const snapshots = domainJobs.get(domain) ?? new Map<KnowledgeJobName, DomainJobSnapshot>();
        const latest = (job: KnowledgeJobName): string | null =>
          snapshots.get(job)?.checkedAt ?? null;
        const lintSnapshot = lastLint.get(domain);
        const retentionSnapshot = snapshots.get(knowledgeRetentionJobName);
        const purgeEvidence = options.state
          .retentionPurgeEvents()
          .filter((event) => event.trustDomain === domain);
        const lintCounts = {
          stale: lintSnapshot?.stale ?? pages.filter((page) => page.freshness === "stale").length,
          citations: (lintSnapshot?.citations ?? pages.filter((page) => page.citations.length === 0).length) + (compileCitationFailures.get(domain) ?? 0),
          conflicts: lintSnapshot?.conflicts ?? pages.filter((page) => page.contested).length,
        };
        const generation = options.vault.currentGeneration(domain);
        const compileState = snapshots.get(knowledgeCompileJobName)?.status;
        const ingestState = snapshots.get(knowledgeIngestJobName)?.status;
        const lintState = snapshots.get(knowledgeLintJobName)?.status;
        const publishState = snapshots.get(knowledgePublishJobName)?.status;
        const hasHeartbeat = snapshots.size > 0 || generation !== undefined;
        const failedHeartbeat = [ingestState, compileState, publishState, lintState, retentionSnapshot?.status].includes("failed");
        const status: KnowledgeJobStatus =
          ingestState === "denied" || compileState === "denied" || publishState === "denied" || lintState === "denied" || retentionSnapshot?.status === "denied"
              ? "denied"
                : ingestState === "unavailable" || compileState === "unavailable" || publishState === "unavailable" || lintState === "unavailable" || retentionSnapshot?.status === "unavailable"
                ? "unavailable"
                : lintCounts.citations > 0 || failedHeartbeat || compileState === "failed" || ingestState === "failed" || lintState === "failed"
                  ? "failed"
                  : lintCounts.conflicts > 0 || compileState === "conflicted" || lintState === "conflicted"
                    ? "conflicted"
                    : lintCounts.stale > 0 || compileState === "stale" || lintState === "stale"
                      ? "stale"
                      : !hasHeartbeat
                        ? "unavailable"
                        : "healthy";
        return {
          domain,
          lastIngest: latest(knowledgeIngestJobName),
          lastCompile: latest(knowledgeCompileJobName),
          lastPublish: latest(knowledgePublishJobName),
          lastLint: latest(knowledgeLintJobName),
          lastRetention: latest(knowledgeRetentionJobName),
          purgedRecords: purgeEvidence.length,
          currentGeneration: generation?.sequence ?? null,
          currentGenerationId: generation?.id ?? null,
          backlog: [...staged.values()].filter((candidate) => candidate.trustDomain === domain).length,
          stalePages: lintCounts.stale,
          citationFailures: lintCounts.citations,
          quarantinedConflicts: lintCounts.conflicts,
          status,
        };
      });
    },
    runJob,
  };
}

function mergeStatus(
  current: KnowledgeJobStatus,
  next: KnowledgeJobStatus,
): KnowledgeJobStatus {
  const order: readonly KnowledgeJobStatus[] = [
    "healthy",
    "stale",
    "conflicted",
    "denied",
    "unavailable",
    "failed",
  ];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}
