import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { detectSensitiveFields } from "../../operations/sensitive-secret.js";
import {
  NATIVE_KNOWLEDGE_LIMITS,
  type ActivationRequest,
  type ActivationResult,
  type AdmissionResult,
  type ActiveGeneration,
  type CandidateStatus,
  type GenerationManifest,
  type LeaseCheckResult,
  type LeaseClaimResult,
  type NativeKnowledgeCandidate,
  type NativeKnowledgeCandidateMetadata,
  type NativeKnowledgeRunHealth,
  type RunLease,
  type RunStatus,
  type StagedGeneration,
  type TombstoneOutboxRecord,
  type TombstoneRecord,
} from "./contracts.js";

export interface NativeKnowledgeRegistry {
  admitCandidate(candidate: NativeKnowledgeCandidate): AdmissionResult;
  listCandidates(status?: CandidateStatus): readonly NativeKnowledgeCandidateMetadata[];
  candidate(candidateId: string): NativeKnowledgeCandidateMetadata | undefined;
  claimRun(input: { readonly operatingDate: string; readonly limit: number }): LeaseClaimResult;
  assertLease(runId: string, leaseToken: string, leaseEpoch: number): LeaseCheckResult;
  recordRunRetry(runId: string, leaseToken: string, leaseEpoch: number, failureCode: string): void;
  recordRunFailure(runId: string, leaseToken: string, leaseEpoch: number, failureCode: string): void;
  recordRunSuccess(runId: string, leaseToken: string, leaseEpoch: number, at: string): void;
  recordStagedGeneration(generation: StagedGeneration): void;
  generation(generationId: string): ActiveGeneration | undefined;
  generationManifestHash(generationId: string): string | undefined;
  activateGeneration(input: ActivationRequest): ActivationResult;
  activeGeneration(): ActiveGeneration | undefined;
  appendLocalTombstone(input: {
    readonly tombstoneId?: string;
    readonly subject: string;
    readonly aliases: readonly string[];
    readonly reason: string;
    readonly requestedAt: string;
  }): TombstoneRecord;
  tombstones(): readonly TombstoneRecord[];
  tombstoneOutbox(): readonly TombstoneOutboxRecord[];
  markTombstoneOutboxSynced(tombstoneId: string, at?: string): void;
  recordTombstoneOutboxFailure(tombstoneId: string, at?: string): void;
  replayIndependentTombstone(input: {
    readonly tombstoneId: string;
    readonly subject: string;
    readonly localEpoch: number;
    readonly restoredAt: string;
  }): TombstoneRecord;
  updateTombstoneStatus(
    tombstoneId: string,
    status: TombstoneRecord["status"],
  ): TombstoneRecord | undefined;
  setTombstoneHeadEpoch(epoch: number): void;
  setRepairState(state: NativeKnowledgeRunHealth["repairState"]): void;
  runHealth(isolationEligible?: boolean): NativeKnowledgeRunHealth;
  close(): void;
}

interface CandidateRow {
  candidate_id: string;
  fingerprint: string;
  kind: NativeKnowledgeCandidate["kind"];
  claim_class: NativeKnowledgeCandidate["claimClass"];
  source_identity: string;
  source_reference: string;
  source_version: string;
  content_hash: string;
  captured_at: string;
  as_of: string;
  trust_domain: NativeKnowledgeCandidate["trustDomain"];
  sensitivity: NativeKnowledgeCandidate["sensitivity"];
  retention_class: NativeKnowledgeCandidate["retentionClass"];
  dependencies_json: string;
  status: CandidateStatus;
  disposition: NativeKnowledgeCandidateMetadata["disposition"];
  created_at: string;
  updated_at: string;
}

interface RunRow {
  run_id: string;
  operating_date: string;
  status: RunStatus;
  lease_token: string;
  lease_epoch: number;
  expires_at: string;
  claimed_at: string;
  completed_at: string | null;
  failure_code: string | null;
  retry_count: number;
}

interface GenerationRow {
  generation_id: string;
  run_id: string;
  path: string;
  manifest_hash: string;
  source_epoch: number;
  tombstone_epoch: number;
  publication_epoch: number | null;
  status: "staged" | "active" | "superseded" | "quarantined" | "needs-repair";
  created_at: string;
}

interface TombstoneRow {
  tombstone_id: string;
  subject: string;
  aliases_json: string;
  reason: string;
  local_epoch: number;
  status: TombstoneRecord["status"];
  created_at: string;
}

interface TombstoneOutboxRow {
  outbox_id: string;
  tombstone_id: string;
  local_epoch: number;
  status: TombstoneOutboxRecord["status"];
  attempts: number;
  created_at: string;
  updated_at: string;
}

interface StateRow {
  active_generation_id: string | null;
  publication_epoch: number;
  lease_epoch: number;
  tombstone_epoch: number;
  tombstone_head_epoch: number;
  repair_state: NativeKnowledgeRunHealth["repairState"];
}

function json<T>(value: T): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function mapCandidate(row: CandidateRow): NativeKnowledgeCandidateMetadata {
  return {
    candidateId: row.candidate_id,
    fingerprint: row.fingerprint,
    kind: row.kind,
    claimClass: row.claim_class,
    sourceIdentity: row.source_identity,
    sourceReference: row.source_reference,
    sourceVersion: row.source_version,
    contentHash: row.content_hash,
    capturedAt: row.captured_at,
    asOf: row.as_of,
    trustDomain: row.trust_domain,
    sensitivity: row.sensitivity,
    retentionClass: row.retention_class,
    dependencies: parseJson<readonly string[]>(row.dependencies_json),
    status: row.status,
    disposition: row.disposition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTombstone(row: TombstoneRow): TombstoneRecord {
  return {
    tombstoneId: row.tombstone_id,
    subject: row.subject,
    aliases: parseJson<readonly string[]>(row.aliases_json),
    reason: row.reason,
    localEpoch: row.local_epoch,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapTombstoneOutbox(row: TombstoneOutboxRow): TombstoneOutboxRecord {
  return {
    outboxId: row.outbox_id,
    tombstoneId: row.tombstone_id,
    localEpoch: row.local_epoch,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function state(database: DatabaseSync): StateRow {
  return database.prepare("SELECT * FROM native_knowledge_state WHERE id = 1").get() as unknown as StateRow;
}

function requireLease(
  database: DatabaseSync,
  now: string,
  runId: string,
  token: string,
  epoch: number,
): RunRow | undefined {
  const row = database.prepare("SELECT * FROM native_knowledge_runs WHERE run_id = ?").get(runId) as unknown as RunRow | undefined;
  if (
    row === undefined ||
    row.status !== "running" ||
    row.lease_token !== token ||
    row.lease_epoch !== epoch ||
    Date.parse(row.expires_at) <= Date.parse(now)
  ) {
    return undefined;
  }
  return row;
}

function ensureSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS native_knowledge_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_generation_id TEXT,
      publication_epoch INTEGER NOT NULL DEFAULT 0,
      lease_epoch INTEGER NOT NULL DEFAULT 0,
      tombstone_epoch INTEGER NOT NULL DEFAULT 0,
      tombstone_head_epoch INTEGER NOT NULL DEFAULT 0,
      repair_state TEXT NOT NULL DEFAULT 'healthy'
    );
    INSERT OR IGNORE INTO native_knowledge_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS native_knowledge_candidates (
      candidate_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      claim_class TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      source_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      as_of TEXT NOT NULL,
      trust_domain TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      retention_class TEXT NOT NULL,
      dependencies_json TEXT NOT NULL,
      status TEXT NOT NULL,
      disposition TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS native_knowledge_status_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS native_knowledge_status_events_no_update
      BEFORE UPDATE ON native_knowledge_status_events
      BEGIN SELECT RAISE(ABORT, 'native knowledge status events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS native_knowledge_status_events_no_delete
      BEFORE DELETE ON native_knowledge_status_events
      BEGIN SELECT RAISE(ABORT, 'native knowledge status events are append-only'); END;

    CREATE TABLE IF NOT EXISTS native_knowledge_runs (
      run_id TEXT PRIMARY KEY,
      operating_date TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      lease_epoch INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      completed_at TEXT,
      failure_code TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS native_knowledge_generations (
      generation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      path TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      source_epoch INTEGER NOT NULL,
      tombstone_epoch INTEGER NOT NULL,
      publication_epoch INTEGER,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS native_knowledge_tombstones (
      tombstone_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      aliases_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      local_epoch INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS native_knowledge_tombstone_outbox (
      outbox_id TEXT PRIMARY KEY,
      tombstone_id TEXT NOT NULL UNIQUE,
      local_epoch INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'synced')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tombstone_id) REFERENCES native_knowledge_tombstones(tombstone_id)
    );
  `);
}

export function createNativeKnowledgeRegistry(options: {
  readonly statePath: string;
  readonly now?: () => string;
  readonly leaseSeconds?: number;
}): NativeKnowledgeRegistry {
  if (options.statePath !== ":memory:") {
    mkdirSync(dirname(options.statePath), { recursive: true });
  }
  const database = new DatabaseSync(options.statePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  ensureSchema(database);
  const now = options.now ?? (() => new Date().toISOString());
  const leaseSeconds = options.leaseSeconds ?? 600;

  const appendStatus = (
    candidateId: string,
    fromStatus: CandidateStatus | null,
    toStatus: CandidateStatus,
    reason: string,
    occurredAt: string,
  ): void => {
    database.prepare(
      `INSERT INTO native_knowledge_status_events
       (candidate_id, from_status, to_status, occurred_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(candidateId, fromStatus, toStatus, occurredAt, reason);
  };

  const registry: NativeKnowledgeRegistry = {
    admitCandidate(candidate) {
      const serialized = json(candidate);
      if (bytes(candidate) > NATIVE_KNOWLEDGE_LIMITS.maxCandidateEnvelopeBytes) {
        return { kind: "denied", reason: "candidate-envelope-too-large" };
      }
      if (
        candidate.claim.trim() === "" ||
        candidate.excerpt.trim() === "" ||
        candidate.sourceReference.trim() === "" ||
        candidate.sourceIdentity.trim() === ""
      ) {
        return { kind: "denied", reason: "candidate-required-field-missing" };
      }
      if (
        candidate.sensitivity !== "normal" ||
        detectSensitiveFields({ claim: candidate.claim, excerpt: candidate.excerpt, source: candidate.sourceReference }).length > 0
      ) {
        return { kind: "denied", reason: "candidate-contains-sensitive-field" };
      }
      const fingerprint = digest({
        kind: candidate.kind,
        claimClass: candidate.claimClass,
        sourceIdentity: candidate.sourceIdentity,
        sourceReference: candidate.sourceReference,
        sourceVersion: candidate.sourceVersion,
        contentHash: candidate.contentHash,
        asOf: candidate.asOf,
      });
      const existingByFingerprint = database
        .prepare("SELECT candidate_id FROM native_knowledge_candidates WHERE fingerprint = ?")
        .get(fingerprint) as unknown as { candidate_id: string } | undefined;
      if (existingByFingerprint !== undefined) {
        return { kind: "duplicate", candidateId: existingByFingerprint.candidate_id };
      }
      const existingById = database
        .prepare("SELECT fingerprint FROM native_knowledge_candidates WHERE candidate_id = ?")
        .get(candidate.candidateId) as unknown as { fingerprint: string } | undefined;
      if (existingById !== undefined && existingById.fingerprint !== fingerprint) {
        return { kind: "denied", reason: "candidate-id-conflict" };
      }
      const timestamp = now();
      database.exec("BEGIN IMMEDIATE;");
      try {
        database.prepare(
          `INSERT INTO native_knowledge_candidates
           (candidate_id, fingerprint, kind, claim_class, source_identity,
            source_reference, source_version, content_hash, captured_at, as_of,
            trust_domain, sensitivity, retention_class, dependencies_json,
            status, disposition, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', NULL, ?, ?)`,
        ).run(
          candidate.candidateId,
          fingerprint,
          candidate.kind,
          candidate.claimClass,
          candidate.sourceIdentity,
          candidate.sourceReference,
          candidate.sourceVersion,
          candidate.contentHash,
          candidate.capturedAt,
          candidate.asOf,
          candidate.trustDomain,
          candidate.sensitivity,
          candidate.retentionClass,
          json(candidate.dependencies),
          timestamp,
          timestamp,
        );
        appendStatus(candidate.candidateId, null, "staged", "admitted", timestamp);
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        if (error instanceof Error && /UNIQUE/.test(error.message)) {
          const replay = database
            .prepare("SELECT candidate_id FROM native_knowledge_candidates WHERE fingerprint = ?")
            .get(fingerprint) as unknown as { candidate_id: string } | undefined;
          if (replay !== undefined) return { kind: "duplicate", candidateId: replay.candidate_id };
        }
        return { kind: "denied", reason: "candidate-admission-failed" };
      }
      // Keep this local variable referenced so future schema additions cannot
      // accidentally persist the claim text while refactoring this method.
      void serialized;
      return { kind: "accepted", candidateId: candidate.candidateId, fingerprint };
    },

    listCandidates(status) {
      const rows = (status === undefined
        ? database.prepare("SELECT * FROM native_knowledge_candidates ORDER BY created_at, candidate_id").all()
        : database.prepare("SELECT * FROM native_knowledge_candidates WHERE status = ? ORDER BY created_at, candidate_id").all(status)) as unknown as CandidateRow[];
      return rows.map(mapCandidate);
    },

    candidate(candidateId) {
      const row = database.prepare("SELECT * FROM native_knowledge_candidates WHERE candidate_id = ?").get(candidateId) as unknown as CandidateRow | undefined;
      return row === undefined ? undefined : mapCandidate(row);
    },

    claimRun(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > NATIVE_KNOWLEDGE_LIMITS.maxCandidatesPerRun) {
        return { kind: "denied", reason: "invalid-run-limit" };
      }
      const timestamp = now();
      database.exec("BEGIN IMMEDIATE;");
      try {
        const running = database.prepare("SELECT * FROM native_knowledge_runs WHERE status = 'running' ORDER BY claimed_at DESC LIMIT 1").get() as unknown as RunRow | undefined;
        if (running !== undefined && Date.parse(running.expires_at) > Date.parse(timestamp)) {
          database.exec("COMMIT;");
          return { kind: "busy", runId: running.run_id, expiresAt: running.expires_at };
        }
        if (running !== undefined) {
          database.prepare("UPDATE native_knowledge_runs SET status = 'fenced', completed_at = ? WHERE run_id = ? AND status = 'running'").run(timestamp, running.run_id);
        }
        const current = state(database);
        const leaseEpoch = current.lease_epoch + 1;
        database.prepare("UPDATE native_knowledge_state SET lease_epoch = ? WHERE id = 1").run(leaseEpoch);
        const lease: RunLease = {
          runId: `native-knowledge:run:${randomUUID()}`,
          leaseToken: `native-knowledge:lease:${randomUUID()}`,
          leaseEpoch,
          expiresAt: addSeconds(timestamp, leaseSeconds),
          operatingDate: input.operatingDate,
        };
        database.prepare(
          `INSERT INTO native_knowledge_runs
           (run_id, operating_date, status, lease_token, lease_epoch, expires_at, claimed_at, completed_at, failure_code, retry_count)
           VALUES (?, ?, 'running', ?, ?, ?, ?, NULL, NULL, 0)`,
        ).run(lease.runId, lease.operatingDate, lease.leaseToken, lease.leaseEpoch, lease.expiresAt, timestamp);
        database.exec("COMMIT;");
        return { kind: "claimed", ...lease };
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    },

    assertLease(runId, leaseToken, leaseEpoch) {
      const row = database.prepare("SELECT * FROM native_knowledge_runs WHERE run_id = ?").get(runId) as unknown as RunRow | undefined;
      if (row === undefined) return { kind: "missing" };
      if (requireLease(database, now(), runId, leaseToken, leaseEpoch) === undefined) {
        if (row.status === "running" && Date.parse(row.expires_at) <= Date.parse(now())) {
          database.prepare("UPDATE native_knowledge_runs SET status = 'fenced', completed_at = ? WHERE run_id = ? AND status = 'running'").run(now(), runId);
        }
        return { kind: "fenced" };
      }
      return { kind: "valid" };
    },

    recordRunRetry(runId, leaseToken, leaseEpoch, failureCode) {
      const timestamp = now();
      database.exec("BEGIN IMMEDIATE;");
      try {
        const run = requireLease(database, timestamp, runId, leaseToken, leaseEpoch);
        if (run === undefined) {
          database.exec("ROLLBACK;");
          throw new Error("native-knowledge lease fenced");
        }
        database.prepare(
          "UPDATE native_knowledge_runs SET failure_code = ?, retry_count = retry_count + 1 WHERE run_id = ? AND lease_token = ? AND lease_epoch = ?",
        ).run(failureCode, runId, leaseToken, leaseEpoch);
        database.exec("COMMIT;");
      } catch (error) {
        try { database.exec("ROLLBACK;"); } catch { /* already rolled back */ }
        throw error;
      }
    },

    recordRunFailure(runId, leaseToken, leaseEpoch, failureCode) {
      const timestamp = now();
      database.exec("BEGIN IMMEDIATE;");
      try {
        const run = requireLease(database, timestamp, runId, leaseToken, leaseEpoch);
        if (run === undefined) {
          database.exec("ROLLBACK;");
          throw new Error("native-knowledge lease fenced");
        }
        database.prepare(
          "UPDATE native_knowledge_runs SET status = 'failed', completed_at = ?, failure_code = ? WHERE run_id = ? AND lease_token = ? AND lease_epoch = ?",
        ).run(timestamp, failureCode, runId, leaseToken, leaseEpoch);
        database.exec("COMMIT;");
      } catch (error) {
        try { database.exec("ROLLBACK;"); } catch { /* already rolled back */ }
        throw error;
      }
    },

    recordRunSuccess(runId, leaseToken, leaseEpoch, at) {
      database.exec("BEGIN IMMEDIATE;");
      try {
        const run = requireLease(database, at, runId, leaseToken, leaseEpoch);
        if (run === undefined) {
          database.exec("ROLLBACK;");
          throw new Error("native-knowledge lease fenced");
        }
        database.prepare("UPDATE native_knowledge_runs SET status = 'succeeded', completed_at = ?, failure_code = NULL WHERE run_id = ? AND lease_token = ? AND lease_epoch = ?").run(at, runId, leaseToken, leaseEpoch);
        database.exec("COMMIT;");
      } catch (error) {
        try { database.exec("ROLLBACK;"); } catch { /* already rolled back */ }
        throw error;
      }
    },

    recordStagedGeneration(generation) {
      database.prepare(
        `INSERT INTO native_knowledge_generations
         (generation_id, run_id, path, manifest_hash, source_epoch, tombstone_epoch, publication_epoch, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'staged', ?)
         ON CONFLICT(generation_id) DO UPDATE SET
           path = excluded.path, manifest_hash = excluded.manifest_hash,
           source_epoch = excluded.source_epoch, tombstone_epoch = excluded.tombstone_epoch`,
      ).run(
        generation.generationId,
        generation.runId,
        generation.immutablePath,
        generation.manifestHash,
        generation.manifest.sourceEpoch,
        generation.manifest.tombstoneEpoch,
        generation.manifest.createdAt,
      );
    },

    generation(generationId) {
      const row = database.prepare("SELECT * FROM native_knowledge_generations WHERE generation_id = ?").get(generationId) as unknown as GenerationRow | undefined;
      if (row === undefined) return undefined;
      return {
        generationId: row.generation_id,
        runId: row.run_id,
        path: row.path,
        manifestHash: row.manifest_hash,
        sourceEpoch: row.source_epoch,
        tombstoneEpoch: row.tombstone_epoch,
        publicationEpoch: row.publication_epoch ?? 0,
        createdAt: row.created_at,
      };
    },

    generationManifestHash(generationId) {
      const row = database.prepare("SELECT manifest_hash FROM native_knowledge_generations WHERE generation_id = ?").get(generationId) as unknown as { manifest_hash: string } | undefined;
      return row?.manifest_hash;
    },

    activateGeneration(input) {
      const timestamp = input.now;
      database.exec("BEGIN IMMEDIATE;");
      try {
        const run = requireLease(database, timestamp, input.lease.runId, input.lease.leaseToken, input.lease.leaseEpoch);
        if (run === undefined) {
          database.exec("ROLLBACK;");
          return { kind: "fenced", reason: "lease-expired-or-replaced" };
        }
        const generation = database.prepare("SELECT * FROM native_knowledge_generations WHERE generation_id = ?").get(input.generation.generationId) as unknown as GenerationRow | undefined;
        if (generation === undefined || generation.run_id !== input.lease.runId || generation.path !== input.generation.immutablePath || generation.manifest_hash !== input.generation.manifestHash || generation.status !== "staged") {
          database.exec("ROLLBACK;");
          return { kind: "invalid", reason: "staged-generation-mismatch" };
        }
        const current = state(database);
        // A forget can arrive after filesystem preparation but before this
        // SQLite pointer transaction. The generation must not become active
        // when its tombstone epoch is older than the current local ledger.
        if (generation.tombstone_epoch < current.tombstone_epoch) {
          database.exec("ROLLBACK;");
          return { kind: "invalid", reason: "tombstone-epoch-advanced" };
        }
        const publicationEpoch = current.publication_epoch + 1;
        database.prepare("UPDATE native_knowledge_state SET active_generation_id = ?, publication_epoch = ?, repair_state = 'healthy' WHERE id = 1").run(input.generation.generationId, publicationEpoch);
        database.prepare("UPDATE native_knowledge_generations SET status = 'active', publication_epoch = ? WHERE generation_id = ?").run(publicationEpoch, input.generation.generationId);
        if (current.active_generation_id !== null) {
          database.prepare("UPDATE native_knowledge_generations SET status = 'superseded' WHERE generation_id = ? AND status = 'active'").run(current.active_generation_id);
        }
        const staged = database.prepare("SELECT candidate_id, status FROM native_knowledge_candidates WHERE status = 'staged'").all() as unknown as { candidate_id: string; status: CandidateStatus }[];
        for (const candidate of staged) {
          database.prepare("UPDATE native_knowledge_candidates SET status = 'published', updated_at = ? WHERE candidate_id = ? AND status = 'staged'").run(timestamp, candidate.candidate_id);
          appendStatus(candidate.candidate_id, candidate.status, "published", "generation-activated", timestamp);
        }
        database.exec("COMMIT;");
        return { kind: "activated", generationId: input.generation.generationId, publicationEpoch };
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    },

    activeGeneration() {
      const current = state(database);
      if (current.active_generation_id === null) return undefined;
      return registry.generation(current.active_generation_id);
    },

    appendLocalTombstone(input) {
      const timestamp = input.requestedAt;
      database.exec("BEGIN IMMEDIATE;");
      try {
        const existing = database.prepare("SELECT * FROM native_knowledge_tombstones WHERE subject = ?").get(input.subject) as unknown as TombstoneRow | undefined;
        if (existing !== undefined) {
          // Older state databases may contain the suppression but not the
          // outbox table row. Reconcile that omission inside this same
          // transaction so every supported forget has a durable propagation
          // record before the operation returns.
          database.prepare(
            `INSERT OR IGNORE INTO native_knowledge_tombstone_outbox
             (outbox_id, tombstone_id, local_epoch, status, attempts, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
          ).run(`native-knowledge:outbox:${existing.tombstone_id}`, existing.tombstone_id, existing.local_epoch, existing.created_at, timestamp);
          database.exec("COMMIT;");
          return mapTombstone(existing);
        }
        const current = state(database);
        const localEpoch = current.tombstone_epoch + 1;
        const tombstone: TombstoneRecord = {
          tombstoneId: input.tombstoneId ?? `native-knowledge:tombstone:${randomUUID()}`,
          subject: input.subject,
          aliases: [...new Set(input.aliases)].sort(),
          reason: input.reason,
          localEpoch,
          status: "local-suppressed",
          createdAt: timestamp,
        };
        database.prepare("UPDATE native_knowledge_state SET tombstone_epoch = ?, repair_state = 'head_sync_pending' WHERE id = 1").run(localEpoch);
        database.prepare("INSERT INTO native_knowledge_tombstones (tombstone_id, subject, aliases_json, reason, local_epoch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(tombstone.tombstoneId, tombstone.subject, json(tombstone.aliases), tombstone.reason, tombstone.localEpoch, tombstone.status, tombstone.createdAt);
        // Suppression and its durable independent-head propagation record are
        // one SQLite transaction. A process crash can therefore leave both
        // absent or both present, never a suppression without an outbox item.
        database.prepare(
          `INSERT INTO native_knowledge_tombstone_outbox
           (outbox_id, tombstone_id, local_epoch, status, attempts, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
        ).run(`native-knowledge:outbox:${tombstone.tombstoneId}`, tombstone.tombstoneId, tombstone.localEpoch, tombstone.createdAt, timestamp);
        database.exec("COMMIT;");
        return tombstone;
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
    },

    tombstones() {
      const rows = database.prepare("SELECT * FROM native_knowledge_tombstones ORDER BY local_epoch").all() as unknown as TombstoneRow[];
      return rows.map(mapTombstone);
    },

    tombstoneOutbox() {
      const rows = database.prepare("SELECT * FROM native_knowledge_tombstone_outbox ORDER BY local_epoch, outbox_id").all() as unknown as TombstoneOutboxRow[];
      return rows.map(mapTombstoneOutbox);
    },

    markTombstoneOutboxSynced(tombstoneId, at = now()) {
      database.prepare(
        `UPDATE native_knowledge_tombstone_outbox
         SET status = 'synced', updated_at = ?
         WHERE tombstone_id = ? AND status IN ('pending', 'failed')`,
      ).run(at, tombstoneId);
    },

    recordTombstoneOutboxFailure(tombstoneId, at = now()) {
      database.prepare(
        `UPDATE native_knowledge_tombstone_outbox
         SET status = 'failed', attempts = attempts + 1, updated_at = ?
         WHERE tombstone_id = ? AND status <> 'synced'`,
      ).run(at, tombstoneId);
    },

    replayIndependentTombstone(input) {
      if (!Number.isSafeInteger(input.localEpoch) || input.localEpoch < 1) {
        throw new Error("independent tombstone epoch is invalid");
      }
      database.exec("BEGIN IMMEDIATE;");
      try {
        const existingById = database.prepare("SELECT * FROM native_knowledge_tombstones WHERE tombstone_id = ?").get(input.tombstoneId) as unknown as TombstoneRow | undefined;
        if (existingById !== undefined) {
          if (existingById.subject !== input.subject || existingById.local_epoch !== input.localEpoch) {
            database.exec("ROLLBACK;");
            throw new Error("independent tombstone conflicts with restored local state");
          }
          database.prepare(
            "UPDATE native_knowledge_state SET tombstone_epoch = CASE WHEN tombstone_epoch > ? THEN tombstone_epoch ELSE ? END, tombstone_head_epoch = CASE WHEN tombstone_head_epoch > ? THEN tombstone_head_epoch ELSE ? END WHERE id = 1",
          ).run(input.localEpoch, input.localEpoch, input.localEpoch, input.localEpoch);
          database.prepare(
            `INSERT OR IGNORE INTO native_knowledge_tombstone_outbox
             (outbox_id, tombstone_id, local_epoch, status, attempts, created_at, updated_at)
             VALUES (?, ?, ?, 'synced', 0, ?, ?)`,
          ).run(`native-knowledge:outbox:${input.tombstoneId}`, input.tombstoneId, input.localEpoch, existingById.created_at, input.restoredAt);
          database.prepare(
            "UPDATE native_knowledge_tombstone_outbox SET status = 'synced', updated_at = ? WHERE tombstone_id = ?",
          ).run(input.restoredAt, input.tombstoneId);
          if (existingById.status === "local-suppressed" || existingById.status === "head-sync-pending") {
            database.prepare("UPDATE native_knowledge_tombstones SET status = 'restore-safe' WHERE tombstone_id = ?").run(input.tombstoneId);
          }
          database.exec("COMMIT;");
          const updated = database.prepare("SELECT * FROM native_knowledge_tombstones WHERE tombstone_id = ?").get(input.tombstoneId) as unknown as TombstoneRow;
          return mapTombstone(updated);
        }
        const existingBySubject = database.prepare("SELECT tombstone_id FROM native_knowledge_tombstones WHERE subject = ?").get(input.subject) as unknown as { tombstone_id: string } | undefined;
        if (existingBySubject !== undefined) {
          database.exec("ROLLBACK;");
          throw new Error("independent tombstone subject conflicts with restored local state");
        }
        const tombstone: TombstoneRecord = {
          tombstoneId: input.tombstoneId,
          subject: input.subject,
          aliases: [],
          reason: "replayed from independent tombstone head",
          localEpoch: input.localEpoch,
          status: "restore-safe",
          createdAt: input.restoredAt,
        };
        database.prepare(
          "INSERT INTO native_knowledge_tombstones (tombstone_id, subject, aliases_json, reason, local_epoch, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(tombstone.tombstoneId, tombstone.subject, "[]", tombstone.reason, tombstone.localEpoch, tombstone.status, tombstone.createdAt);
        database.prepare(
          "INSERT INTO native_knowledge_tombstone_outbox (outbox_id, tombstone_id, local_epoch, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'synced', 0, ?, ?)",
        ).run(`native-knowledge:outbox:${tombstone.tombstoneId}`, tombstone.tombstoneId, tombstone.localEpoch, tombstone.createdAt, tombstone.createdAt);
        database.prepare(
          "UPDATE native_knowledge_state SET tombstone_epoch = CASE WHEN tombstone_epoch > ? THEN tombstone_epoch ELSE ? END, tombstone_head_epoch = CASE WHEN tombstone_head_epoch > ? THEN tombstone_head_epoch ELSE ? END WHERE id = 1",
        ).run(input.localEpoch, input.localEpoch, input.localEpoch, input.localEpoch);
        database.exec("COMMIT;");
        return tombstone;
      } catch (error) {
        try { database.exec("ROLLBACK;"); } catch { /* already rolled back */ }
        throw error;
      }
    },

    updateTombstoneStatus(tombstoneId, status) {
      const row = database.prepare("SELECT * FROM native_knowledge_tombstones WHERE tombstone_id = ?").get(tombstoneId) as unknown as TombstoneRow | undefined;
      if (row === undefined) return undefined;
      const allowed: Record<TombstoneRecord["status"], readonly TombstoneRecord["status"][]> = {
        "local-suppressed": ["local-suppressed", "head-sync-pending", "restore-safe"],
        "head-sync-pending": ["head-sync-pending", "restore-safe"],
        "restore-safe": ["restore-safe", "cleanup-complete"],
        "cleanup-complete": ["cleanup-complete"],
      };
      if (!allowed[row.status].includes(status)) {
        throw new Error(`invalid tombstone status transition ${row.status} -> ${status}`);
      }
      database.prepare("UPDATE native_knowledge_tombstones SET status = ? WHERE tombstone_id = ?").run(status, tombstoneId);
      const updated = database.prepare("SELECT * FROM native_knowledge_tombstones WHERE tombstone_id = ?").get(tombstoneId) as unknown as TombstoneRow;
      return mapTombstone(updated);
    },

    setTombstoneHeadEpoch(epoch) {
      if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error("tombstone head epoch must be non-negative");
      database.prepare("UPDATE native_knowledge_state SET tombstone_head_epoch = CASE WHEN tombstone_head_epoch > ? THEN tombstone_head_epoch ELSE ? END WHERE id = 1").run(epoch, epoch);
    },

    setRepairState(repairState) {
      database.prepare("UPDATE native_knowledge_state SET repair_state = ? WHERE id = 1").run(repairState);
    },

    runHealth(isolationEligible = true) {
      const current = state(database);
      const lastSuccess = database.prepare("SELECT completed_at FROM native_knowledge_runs WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1").get() as unknown as { completed_at: string | null } | undefined;
      const lastFailure = database.prepare("SELECT failure_code FROM native_knowledge_runs WHERE status = 'failed' ORDER BY completed_at DESC LIMIT 1").get() as unknown as { failure_code: string | null } | undefined;
      const backlog = database.prepare("SELECT COUNT(*) AS count FROM native_knowledge_candidates WHERE status = 'staged'").get() as unknown as { count: number };
      const stale = database.prepare("SELECT COUNT(*) AS count FROM native_knowledge_candidates WHERE disposition = 'stale'").get() as unknown as { count: number };
      const quarantined = database.prepare("SELECT COUNT(*) AS count FROM native_knowledge_candidates WHERE status = 'quarantined' OR disposition = 'quarantined'").get() as unknown as { count: number };
      const latest = database.prepare("SELECT run_id FROM native_knowledge_runs ORDER BY claimed_at DESC LIMIT 1").get() as unknown as { run_id: string } | undefined;
      return {
        runId: latest?.run_id ?? null,
        lastSuccess: lastSuccess?.completed_at ?? null,
        lastFailureCode: lastFailure?.failure_code ?? null,
        backlog: Number(backlog.count),
        activeGenerationId: current.active_generation_id,
        tombstoneHeadEpoch: current.tombstone_head_epoch,
        staleCount: Number(stale.count),
        quarantinedCount: Number(quarantined.count),
        repairState: current.repair_state,
        isolationEligible,
      };
    },

    close() {
      database.close();
    },
  };

  return registry;
}

export function manifestHash(manifest: GenerationManifest): string {
  return digest(manifest);
}
