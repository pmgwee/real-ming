import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  WorkerUnavailableError,
  type ControlledWorker,
  type EffectVerifier,
  type ExecutiveRole,
  type ExpectedEffect,
  type WorkerEffect,
  type WorkerReceipt,
  type VerifierResult,
} from "../operations/contracts.js";
import { detectSensitiveFields } from "../operations/sensitive-secret.js";

export const privateWorkerCapabilities = [
  "local-files",
  "browser-sessions",
  "windows-tools",
  "local-credentials",
  "sensitive-processing",
] as const;
export type PrivateWorkerCapability = (typeof privateWorkerCapabilities)[number];

export type PrivateWorkerJobState = "queued" | "running" | "failed" | "completed";

export interface PrivateWorkerRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

export interface PrivateWorkerJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly workItemId: string;
  readonly executive: ExecutiveRole;
  readonly authority: WorkerEffect["authority"];
  readonly idempotencyKey: string;
  readonly requiredCapability: PrivateWorkerCapability;
  readonly action: Readonly<Pick<WorkerEffect, "kind" | "value">>;
  readonly executionToken: string | null;
  readonly sourceReferences: readonly string[];
  readonly leaseToken: string | null;
  readonly leaseAcquiredAt: string | null;
  readonly leaseExpiresAt: string | null;
  readonly deadline: string;
  readonly retryPolicy: PrivateWorkerRetryPolicy;
  readonly expectedEvidence: string;
  readonly attemptCount: number;
  readonly state: PrivateWorkerJobState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivateWorkerHeartbeat {
  readonly workerId: string;
  readonly available: boolean;
  readonly capabilities: readonly PrivateWorkerCapability[];
  readonly observedAt: string;
}

export interface PrivateWorkerOutput {
  readonly evidence: Readonly<Record<string, string>>;
  readonly sourceReferences: readonly string[];
  readonly completedAt: string;
}

export type PrivateWorkerExecutor = (
  job: PrivateWorkerJob,
) => Promise<PrivateWorkerOutput>;

export interface PrivateWorker extends ControlledWorker {
  heartbeat(): PrivateWorkerHeartbeat;
  jobs(): readonly PrivateWorkerJob[];
  /** Controlled test seam for simulating a sleeping or reconnected laptop. */
  setAvailability(available: boolean): void;
  /** Fences renewal against concurrent claims; the active executor retains one completion right. */
  expireLeases(at?: string): void;
  close(): void;
}

interface JobRow {
  id: string;
  idempotency_key: string;
  job_json: string;
  state: PrivateWorkerJobState;
  attempt_count: number;
  lease_token: string | null;
  lease_acquired_at: string | null;
  lease_expires_at: string | null;
  execution_token: string | null;
  execution_active: number;
  output_json: string | null;
  created_at: string;
  updated_at: string;
}

const defaultLeaseMs = 60_000;
const defaultDeadlineMs = 15 * 60_000;
const defaultMaxAttempts = 3;
const defaultBackoffMs = 5_000;

function addMilliseconds(iso: string, milliseconds: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) throw new Error("Private worker requires a valid clock.");
  return new Date(time + milliseconds).toISOString();
}

/**
 * The private worker is deliberately a closed capability boundary.  An
 * unknown effect must never silently become a local-file operation (a money
 * movement or deployment action would otherwise be indistinguishable from a
 * harmless local edit).
 */
const capabilityByEffectKind: Readonly<
  Record<string, PrivateWorkerCapability>
> = {
  "local-file-read": "local-files",
  "local-file-edit": "local-files",
  "browser-session": "browser-sessions",
  "windows-tool": "windows-tools",
  "local-credential": "local-credentials",
  "sensitive-processing": "sensitive-processing",
  "executive-contribution": "local-files",
};

function requiredCapabilityFor(
  effect: WorkerEffect,
): PrivateWorkerCapability | undefined {
  return capabilityByEffectKind[effect.kind.trim().toLowerCase()];
}

function parseJob(row: JobRow): PrivateWorkerJob {
  const job = JSON.parse(row.job_json) as Omit<PrivateWorkerJob, "state" | "attemptCount" | "leaseToken" | "leaseAcquiredAt" | "leaseExpiresAt" | "updatedAt">;
  return {
    ...job,
    // Jobs written before RM-21 did not persist authority.  Treat those
    // legacy rows as accountable, while every new row preserves the exact
    // authority supplied by the gateway.
    authority: job.authority ?? "accountable",
    state: row.state,
    attemptCount: row.attempt_count,
    leaseToken: row.lease_token,
    leaseAcquiredAt: row.lease_acquired_at,
    leaseExpiresAt: row.lease_expires_at,
    executionToken: row.execution_token,
    updatedAt: row.updated_at,
  };
}

function receiptFor(job: PrivateWorkerJob, output: PrivateWorkerOutput): WorkerReceipt {
  return {
    effect: {
      workItemId: job.workItemId,
      executive: job.executive,
      authority: job.authority,
      idempotencyKey: job.idempotencyKey,
      kind: job.action.kind,
      value: job.action.value,
    },
    evidence: output.evidence,
  };
}

/**
 * A small durable adapter for the Lenovo private worker.  The control plane
 * sees only ControlledWorker.execute; this adapter adds capability discovery,
 * a fenced lease and idempotent output storage around that seam.
 */
export function createPrivateWorker(options: {
  readonly statePath: string;
  readonly workerId?: string;
  readonly available?: boolean;
  readonly capabilities?: readonly PrivateWorkerCapability[];
  readonly now?: () => string;
  readonly leaseMs?: number;
  readonly deadlineMs?: number;
  readonly retryPolicy?: PrivateWorkerRetryPolicy;
  readonly executor: PrivateWorkerExecutor;
}): PrivateWorker {
  const database = new DatabaseSync(options.statePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS private_worker_jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      job_json TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      lease_token TEXT,
      lease_acquired_at TEXT,
      lease_expires_at TEXT,
      execution_token TEXT,
      execution_active INTEGER NOT NULL DEFAULT 0,
      output_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Additive migration for the first RM-21 candidate, which did not yet
  // separate the renewable lease token from the executor's ownership token.
  const columns = database
    .prepare("PRAGMA table_info(private_worker_jobs)")
    .all() as unknown as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("execution_token")) {
    database.exec(
      "ALTER TABLE private_worker_jobs ADD COLUMN execution_token TEXT;",
    );
  }
  if (!columnNames.has("execution_active")) {
    database.exec(
      "ALTER TABLE private_worker_jobs ADD COLUMN execution_active INTEGER NOT NULL DEFAULT 0;",
    );
  }
  const now = options.now ?? (() => new Date().toISOString());
  const workerId = options.workerId ?? "lenovo-private-worker";
  const leaseMs = options.leaseMs ?? defaultLeaseMs;
  const deadlineMs = options.deadlineMs ?? defaultDeadlineMs;
  const retryPolicy = options.retryPolicy ?? {
    maxAttempts: defaultMaxAttempts,
    backoffMs: defaultBackoffMs,
  };
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("Private worker leaseMs must be positive.");
  if (!Number.isInteger(deadlineMs) || deadlineMs <= 0) throw new Error("Private worker deadlineMs must be positive.");
  if (!Number.isInteger(retryPolicy.maxAttempts) || retryPolicy.maxAttempts < 1) throw new Error("Private worker maxAttempts must be positive.");
  if (!Number.isInteger(retryPolicy.backoffMs) || retryPolicy.backoffMs < 0) throw new Error("Private worker backoffMs cannot be negative.");

  let available = options.available ?? false;
  const capabilities = [...(options.capabilities ?? privateWorkerCapabilities)];
  if (capabilities.some((capability) => !privateWorkerCapabilities.includes(capability))) {
    throw new Error("Private worker capabilities are not recognized.");
  }
  const inFlight = new Map<string, Promise<WorkerReceipt>>();

  const rowFor = (idempotencyKey: string): JobRow | undefined =>
    database
      .prepare("SELECT * FROM private_worker_jobs WHERE idempotency_key = ?")
      .get(idempotencyKey) as unknown as JobRow | undefined;

  const failOrFence = (job: PrivateWorkerJob, at: string): void => {
    // This is called only after the executor has returned or thrown, so the
    // active-execution marker can be cleared. A concurrent claimant was
    // refused while it was set; subsequent retry remains governed by the
    // stable idempotency key and bounded retry policy.
    database
      .prepare(
        "UPDATE private_worker_jobs SET state = 'failed', lease_token = NULL, lease_acquired_at = NULL, lease_expires_at = NULL, execution_active = 0, execution_token = NULL, updated_at = ? WHERE id = ? AND state = 'running' AND execution_token = ?",
      )
      .run(at, job.id, job.executionToken);
  };

  const insertJob = (effect: WorkerEffect, occurredAt: string): JobRow => {
    if (
      effect.workItemId.trim().length === 0 ||
      effect.idempotencyKey.trim().length === 0 ||
      effect.kind.trim().length === 0 ||
      effect.value.trim().length === 0
    ) {
      throw new Error("Private worker jobs require a bounded action and stable identity.");
    }
    const requiredCapability = requiredCapabilityFor(effect);
    if (requiredCapability === undefined) {
      throw new WorkerUnavailableError("unsupported-capability");
    }
    if (
      detectSensitiveFields({
        workItemId: effect.workItemId,
        idempotencyKey: effect.idempotencyKey,
        kind: effect.kind,
        value: effect.value,
      }).length > 0
    ) {
      throw new Error("Private worker jobs cannot contain Sensitive Secrets.");
    }
    const deadline = addMilliseconds(occurredAt, deadlineMs);
    const job: Omit<PrivateWorkerJob, "state" | "attemptCount" | "leaseToken" | "leaseAcquiredAt" | "leaseExpiresAt" | "executionToken" | "updatedAt"> = {
      id: randomUUID(),
      workspaceId: "workspace:real-ming",
      workItemId: effect.workItemId,
      executive: effect.executive,
      authority: effect.authority,
      idempotencyKey: effect.idempotencyKey,
      requiredCapability,
      action: { kind: effect.kind, value: effect.value },
      sourceReferences: [effect.workItemId],
      deadline,
      retryPolicy,
      expectedEvidence: effect.idempotencyKey,
      createdAt: occurredAt,
    };
    // Scan the complete durable job projection, including derived fields.
    // Source references and expected evidence are part of the worker's
    // untrusted input and must not become a secret side channel.
    if (
      detectSensitiveFields({
        workItemId: job.workItemId,
        idempotencyKey: job.idempotencyKey,
        kind: job.action.kind,
        value: job.action.value,
        expectedEvidence: job.expectedEvidence,
        sourceReferences: job.sourceReferences.join("\n"),
      }).length > 0
    ) {
      throw new Error("Private worker jobs cannot contain Sensitive Secrets.");
    }
    database
      .prepare(
        `INSERT INTO private_worker_jobs (
          id, idempotency_key, job_json, state, attempt_count,
          lease_token, lease_acquired_at, lease_expires_at,
          execution_token, execution_active, output_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, 0, NULL, ?, ?)`,
      )
      .run(job.id, job.idempotencyKey, JSON.stringify(job), occurredAt, occurredAt);
    return rowFor(effect.idempotencyKey)!;
  };

  const claim = (effect: WorkerEffect, occurredAt: string):
    | { readonly kind: "completed"; readonly receipt: WorkerReceipt }
    | { readonly kind: "claimed"; readonly job: PrivateWorkerJob }
    | { readonly kind: "error"; readonly error: WorkerUnavailableError } => {
    database.exec("BEGIN IMMEDIATE;");
    try {
      let row = rowFor(effect.idempotencyKey);
      if (row === undefined) row = insertJob(effect, occurredAt);
      const existingJob = parseJob(row);
      if (
        existingJob.workItemId !== effect.workItemId ||
        existingJob.action.kind !== effect.kind ||
        existingJob.action.value !== effect.value
      ) {
        database.exec("COMMIT;");
        throw new Error("Private worker idempotency key conflicts with another action.");
      }
      if (row.state === "completed" && row.output_json !== null) {
        database.exec("COMMIT;");
        return {
          kind: "completed",
          receipt: receiptFor(existingJob, JSON.parse(row.output_json) as PrivateWorkerOutput),
        };
      }
      if (row.state === "running") {
        const expires = row.lease_expires_at === null ? NaN : Date.parse(row.lease_expires_at);
        if (Number.isFinite(expires) && expires > Date.parse(occurredAt)) {
          database.exec("COMMIT;");
          return { kind: "error", error: new WorkerUnavailableError("lease-held") };
        }
        if (row.execution_active === 1) {
          // An expired lease is not evidence that the original executor did
          // not perform its side effect. Never start a second executor while
          // the original one is still active; its execution token can still
          // commit a valid late result.
          database.exec("COMMIT;");
          return { kind: "error", error: new WorkerUnavailableError("lease-held") };
        }
        // The previous executor has returned and fenced its own execution
        // token. Requeue only this now-inactive lease so a reconnect can
        // resume the same idempotent Work Item without concurrent execution.
        database
          .prepare(
            "UPDATE private_worker_jobs SET state = 'queued', lease_token = NULL, lease_acquired_at = NULL, lease_expires_at = NULL, execution_token = NULL, updated_at = ? WHERE id = ? AND state = 'running' AND execution_active = 0",
          )
          .run(occurredAt, row.id);
        row = rowFor(effect.idempotencyKey)!;
      }
      if (
        row.state === "failed" &&
        row.attempt_count >= existingJob.retryPolicy.maxAttempts
      ) {
        database.exec("COMMIT;");
        return { kind: "error", error: new WorkerUnavailableError("retry-exhausted") };
      }
      if (
        row.state === "failed" &&
        row.attempt_count > 0 &&
        Date.parse(occurredAt) <
          Date.parse(row.updated_at) + existingJob.retryPolicy.backoffMs
      ) {
        database.exec("COMMIT;");
        return { kind: "error", error: new WorkerUnavailableError("retry-deferred") };
      }
      if (Date.parse(occurredAt) >= Date.parse(existingJob.deadline)) {
        database
          .prepare("UPDATE private_worker_jobs SET state = 'failed', updated_at = ? WHERE id = ?")
          .run(occurredAt, row.id);
        database.exec("COMMIT;");
        return { kind: "error", error: new WorkerUnavailableError("deadline-expired") };
      }
      const leaseToken = randomUUID();
      const executionToken = randomUUID();
      const leaseExpiresAt = addMilliseconds(occurredAt, leaseMs);
      const attemptCount = row.attempt_count + 1;
      database
        .prepare(
          `UPDATE private_worker_jobs
           SET state = 'running', attempt_count = ?, lease_token = ?,
               lease_acquired_at = ?, lease_expires_at = ?,
               execution_token = ?, execution_active = 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          attemptCount,
          leaseToken,
          occurredAt,
          leaseExpiresAt,
          executionToken,
          occurredAt,
          row.id,
        );
      database.exec("COMMIT;");
      return {
        kind: "claimed",
        job: {
          ...existingJob,
          state: "running",
          attemptCount,
          leaseToken,
          leaseAcquiredAt: occurredAt,
          leaseExpiresAt,
          executionToken,
          updatedAt: occurredAt,
        },
      };
    } catch (error) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // The transaction may already have been committed before a conflict.
      }
      throw error;
    }
  };

  const executeFresh = async (effect: WorkerEffect): Promise<WorkerReceipt> => {
    const occurredAt = now();
    const existing = rowFor(effect.idempotencyKey);
    if (existing === undefined) {
      insertJob(effect, occurredAt);
    }
    const current = rowFor(effect.idempotencyKey)!;
    if (current.state !== "completed" && !available) {
      throw new WorkerUnavailableError("private-worker-offline");
    }
    const jobRow = rowFor(effect.idempotencyKey)!;
    const job = parseJob(jobRow);
    if (!capabilities.includes(job.requiredCapability)) {
      throw new WorkerUnavailableError("unsupported-capability");
    }
    const result = claim(effect, occurredAt);
    if (result.kind === "completed") return result.receipt;
    if (result.kind === "error") throw result.error;
    let output: PrivateWorkerOutput;
    try {
      output = await options.executor(result.job);
    } catch {
      failOrFence(result.job, now());
      throw new Error("Private worker execution failed.");
    }
    const isValidOutput = (candidate: unknown): candidate is PrivateWorkerOutput => {
      if (candidate === null || typeof candidate !== "object") return false;
      const record = candidate as Record<string, unknown>;
      if (typeof record.completedAt !== "string") return false;
      if (!Array.isArray(record.sourceReferences)) return false;
      if (!record.sourceReferences.every((value) => typeof value === "string")) return false;
      if (record.evidence === null || typeof record.evidence !== "object" || Array.isArray(record.evidence)) return false;
      const evidence = record.evidence as Record<string, unknown>;
      return Object.values(evidence).every((value) => typeof value === "string");
    };
    if (
      !isValidOutput(output) ||
      output.sourceReferences.length === 0 ||
      !output.sourceReferences.includes(result.job.workItemId) ||
      Object.keys(output.evidence).length === 0 ||
      output.evidence["expectedEvidence"] !== result.job.expectedEvidence ||
      detectSensitiveFields(output.evidence).length > 0 ||
      detectSensitiveFields({
        sourceReferences: output.sourceReferences.join("\n"),
      }).length > 0 ||
      !Number.isFinite(Date.parse(output.completedAt))
    ) {
      failOrFence(result.job, now());
      throw new Error("Private worker output failed validation.");
    }
    const completionAt = now();
    const completionTime = Date.parse(completionAt);
    const deadline = Date.parse(result.job.deadline);
    // A lease may expire while the original executor is still running. The
    // execution token prevents another claimant from starting concurrently,
    // so that original executor may commit a valid late result. The hard
    // Work Item deadline remains non-negotiable.
    if (
      !Number.isFinite(completionTime) ||
      completionTime >= deadline
    ) {
      failOrFence(result.job, completionAt);
      throw new WorkerUnavailableError(
        completionTime >= deadline ? "deadline-expired" : "lease-held",
      );
    }
    const stored = database
      .prepare(
        `UPDATE private_worker_jobs
         SET state = 'completed', lease_token = NULL, lease_acquired_at = NULL,
             lease_expires_at = NULL, execution_token = NULL,
             execution_active = 0, output_json = ?, updated_at = ?
         WHERE id = ? AND state = 'running' AND execution_active = 1
           AND execution_token = ? AND ? < ?`,
      )
      .run(
        JSON.stringify(output),
        completionAt,
        result.job.id,
        result.job.executionToken,
        completionTime,
        deadline,
      );
    if (stored.changes !== 1) throw new WorkerUnavailableError("lease-held");
    return receiptFor(
      {
        ...result.job,
        state: "completed",
        leaseToken: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        executionToken: null,
        updatedAt: completionAt,
      },
      output,
    );
  };

  return {
    async execute(effect): Promise<WorkerReceipt> {
      const existing = inFlight.get(effect.idempotencyKey);
      if (existing !== undefined) return existing;
      const promise = executeFresh(effect);
      inFlight.set(effect.idempotencyKey, promise);
      try {
        return await promise;
      } finally {
        if (inFlight.get(effect.idempotencyKey) === promise) inFlight.delete(effect.idempotencyKey);
      }
    },
    heartbeat: () => ({
      workerId,
      available,
      capabilities: [...capabilities],
      observedAt: now(),
    }),
    jobs: () =>
      (database
        .prepare("SELECT * FROM private_worker_jobs ORDER BY created_at ASC, id ASC")
        .all() as unknown as JobRow[]).map(parseJob),
    setAvailability: (value) => {
      available = value;
    },
    expireLeases: (at = now()) => {
      const rows = database
        .prepare(
          "SELECT id FROM private_worker_jobs WHERE state = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
        )
        .all(at) as unknown as Array<{ id: string }>;
      // Rotate only the renewable lease token. The executor token remains
      // active until the original call returns, so a concurrent claimant is
      // refused; once it returns, the next claim may safely requeue it.
      const update = database.prepare(
        "UPDATE private_worker_jobs SET lease_token = ?, updated_at = ? WHERE id = ? AND state = 'running'",
      );
      for (const row of rows) update.run(randomUUID(), at, row.id);
    },
    close: () => database.close(),
  };
}

/**
 * Production composition uses this verifier whenever a private worker is
 * supplied.  The worker has already validated the untrusted output; this
 * second seam verifies that the receipt still names exactly the expected
 * bounded effect before the Operations Gateway records an Outcome Report.
 */
export function createPrivateWorkerVerifier(): EffectVerifier {
  return {
    async verify(
      receipt: WorkerReceipt,
      expectedEffect: ExpectedEffect,
      expectedWorkerEffect,
    ): Promise<VerifierResult> {
      const evidence = receipt.evidence;
      if (
        expectedWorkerEffect === undefined ||
        receipt.effect.kind !== expectedEffect.kind ||
        receipt.effect.value !== expectedEffect.value ||
        receipt.effect.workItemId !== expectedWorkerEffect.workItemId ||
        receipt.effect.executive !== expectedWorkerEffect.executive ||
        receipt.effect.authority !== expectedWorkerEffect.authority ||
        receipt.effect.idempotencyKey !== expectedWorkerEffect.idempotencyKey ||
        receipt.effect.kind !== expectedWorkerEffect.kind ||
        receipt.effect.value !== expectedWorkerEffect.value ||
        evidence === null ||
        typeof evidence !== "object" ||
        Object.keys(evidence).length === 0 ||
        evidence["expectedEvidence"] !== expectedWorkerEffect?.idempotencyKey ||
        detectSensitiveFields({
          workItemId: receipt.effect.workItemId,
          executive: receipt.effect.executive,
          authority: receipt.effect.authority,
          idempotencyKey: receipt.effect.idempotencyKey,
          kind: receipt.effect.kind,
          value: receipt.effect.value,
        }).length > 0 ||
        detectSensitiveFields(evidence).length > 0
      ) {
        throw new Error("The private-worker effect could not be verified.");
      }
      return {
        status: "verified",
        evidence: {
          adapter: "private-worker-verifier",
          effectId: receipt.effect.idempotencyKey,
        },
      };
    },
  };
}

export { requiredCapabilityFor };
