import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  Approval,
  ApprovalScope,
  ApprovalState,
  AuditEvent,
  ConfirmedCommitment,
  EffectVerification,
  NormalizedCeoAction,
  OutcomeReport,
  ProposedCommitment,
  RiskClass,
  StandingAuthority,
  TrustDomain,
  WorkItem,
  WorkItemState,
  WorkerEffect,
  WorkerReceipt,
} from "./contracts.js";
import type {
  TelegramAuditEvent,
  TelegramOutboundMessage,
  TelegramIngressResult,
  TelegramReviewControl,
  TelegramReviewDecision,
} from "../telegram/contracts.js";
import type { ProviderFailure } from "../providers/adapter-contract.js";
import { lifecycleEventFor } from "./work-item-lifecycle.js";

interface WorkItemRow {
  id: string;
  actor_id: string;
  workspace_id: string;
  idempotency_key: string;
  intent: string;
  expected_effect_json: string;
  accountable_executive: WorkItem["accountableExecutive"];
  workstream: WorkItem["workstream"];
  collaborating_executives_json: string;
  confirmed_commitment_json: string | null;
  proposed_commitment_json: string | null;
  state: WorkItemState;
  created_at: string;
  updated_at: string;
}

interface OutcomeReportRow {
  id: string;
  work_item_id: string;
  revision: number;
  requested_intent: string;
  completed_effect_json: string;
  verification_json: string;
  remaining_risks_json: string;
  required_decisions_json: string;
  created_at: string;
}

interface AuditEventRow {
  sequence: number;
  work_item_id: string;
  event_type: AuditEvent["type"];
  occurred_at: string;
  details_json: string;
}

interface ApprovalRow {
  id: string;
  work_item_id: string;
  actor_id: string | null;
  scope: ApprovalScope;
  target_type: string;
  target_identity: string;
  target_version: string;
  risk_class: RiskClass;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
  state: ApprovalState;
}

interface StandingAuthorityRow {
  id: string;
  granted_by_actor_id: string;
  executive: StandingAuthority["executive"];
  trust_domain: TrustDomain;
  target_type: string;
  expires_at: string;
  granted_at: string;
}

interface TelegramReviewControlRow {
  id: string;
  work_item_id: string;
  decision: TelegramReviewDecision;
  target_version: string;
  expires_at: string;
  issued_at: string;
  used_at: string | null;
  claimed_update_id: number | null;
  state: TelegramReviewControl["state"];
}

interface TelegramAuditEventRow {
  sequence: number;
  actor_id: string;
  workspace_id: string;
  event_type: TelegramAuditEvent["type"];
  occurred_at: string;
  details_json: string;
}

interface TelegramIngressResultRow {
  update_id: number;
  actor_id: string;
  workspace_id: string;
  result_json: string;
  processed_at: string;
}

interface TelegramDeliveryReceiptRow {
  idempotency_key: string;
  actor_id: string;
  workspace_id: string;
  payload_digest: string;
  delivered_at: string;
}

interface TelegramDeliveryOutboxRow {
  idempotency_key: string;
  actor_id: string;
  workspace_id: string;
  chat_id: string;
  payload_json: string;
  payload_digest: string;
  state: "in-flight" | "sent" | "failed" | "uncertain";
  attempt_count: number;
  failure_class: ProviderFailure["class"] | null;
  failure_retryable: number | null;
  retry_after_ms: number | null;
  created_at: string;
  updated_at: string;
}

export type TelegramDeliveryClaim =
  | { readonly kind: "send"; readonly attempt: number }
  | { readonly kind: "sent" }
  | { readonly kind: "uncertain" }
  | { readonly kind: "deferred"; readonly failure: ProviderFailure }
  | { readonly kind: "terminal-failure"; readonly failure: ProviderFailure }
  | { readonly kind: "conflict" };

export interface TelegramPendingDelivery {
  readonly idempotencyKey: string;
  readonly message: TelegramOutboundMessage;
  readonly payloadDigest: string;
}

interface TableColumnRow {
  name: string;
}

interface OutcomeEffectMigrationRow {
  id: string;
  work_item_id: string;
  completed_effect_json: string;
  accountable_executive: WorkItem["accountableExecutive"];
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    idempotencyKey: row.idempotency_key,
    intent: row.intent,
    expectedEffect: parseJson<WorkItem["expectedEffect"]>(
      row.expected_effect_json,
    ),
    accountableExecutive: row.accountable_executive,
    workstream: row.workstream,
    collaboratingExecutives: parseJson<
      WorkItem["collaboratingExecutives"]
    >(row.collaborating_executives_json),
    confirmedCommitment:
      row.confirmed_commitment_json === null
        ? null
        : parseJson<ConfirmedCommitment>(row.confirmed_commitment_json),
    proposedCommitment:
      row.proposed_commitment_json === null
        ? null
        : parseJson<ProposedCommitment>(row.proposed_commitment_json),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutcomeReport(row: OutcomeReportRow): OutcomeReport {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    revision: row.revision,
    requestedIntent: row.requested_intent,
    completedEffect: parseJson<OutcomeReport["completedEffect"]>(
      row.completed_effect_json,
    ),
    verification: parseJson<OutcomeReport["verification"]>(
      row.verification_json,
    ),
    remainingRisks: parseJson<readonly string[]>(row.remaining_risks_json),
    requiredDecisions: parseJson<readonly string[]>(row.required_decisions_json),
    createdAt: row.created_at,
  };
}

function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    actorId: row.actor_id,
    scope: row.scope,
    targetType: row.target_type,
    targetIdentity: row.target_identity,
    targetVersion: row.target_version,
    riskClass: row.risk_class,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    state: row.state,
  };
}

function mapStandingAuthority(row: StandingAuthorityRow): StandingAuthority {
  return {
    id: row.id,
    grantedByActorId: row.granted_by_actor_id,
    executive: row.executive,
    trustDomain: row.trust_domain,
    targetType: row.target_type,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
  };
}

function mapTelegramReviewControl(
  row: TelegramReviewControlRow,
): TelegramReviewControl {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    decision: row.decision,
    targetVersion: row.target_version,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    usedAt: row.used_at,
    claimedUpdateId: row.claimed_update_id,
    state: row.state,
  };
}

export class OperationsState {
  readonly #database: DatabaseSync;

  constructor(statePath: string) {
    this.#database = new DatabaseSync(statePath);
    this.#database.exec("PRAGMA foreign_keys = ON;");
    this.#database.exec("PRAGMA journal_mode = WAL;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        intent TEXT NOT NULL,
        expected_effect_json TEXT NOT NULL,
        accountable_executive TEXT NOT NULL,
        workstream TEXT,
        collaborating_executives_json TEXT NOT NULL,
        confirmed_commitment_json TEXT,
        proposed_commitment_json TEXT,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS outcome_reports (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL DEFAULT 1,
        requested_intent TEXT NOT NULL,
        completed_effect_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        remaining_risks_json TEXT NOT NULL,
        required_decisions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE TABLE IF NOT EXISTS outcome_report_revisions (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        requested_intent TEXT NOT NULL,
        completed_effect_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        remaining_risks_json TEXT NOT NULL,
        required_decisions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (work_item_id, revision),
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE TRIGGER IF NOT EXISTS outcome_report_revisions_reject_update
      BEFORE UPDATE ON outcome_report_revisions
      BEGIN
        SELECT RAISE(ABORT, 'outcome_report_revisions are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS outcome_report_revisions_reject_delete
      BEFORE DELETE ON outcome_report_revisions
      BEGIN
        SELECT RAISE(ABORT, 'outcome_report_revisions are append-only');
      END;

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        actor_id TEXT,
        scope TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_identity TEXT NOT NULL,
        target_version TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT,
        expires_at TEXT,
        state TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE TABLE IF NOT EXISTS standing_authorities (
        id TEXT PRIMARY KEY,
        granted_by_actor_id TEXT NOT NULL,
        executive TEXT NOT NULL,
        trust_domain TEXT NOT NULL,
        target_type TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        granted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        details_json TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE TABLE IF NOT EXISTS telegram_audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        details_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_review_controls (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        target_version TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        used_at TEXT,
        claimed_update_id INTEGER,
        state TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS telegram_review_controls_exact_decision
      ON telegram_review_controls (
        work_item_id, target_version, expires_at, decision
      );

      CREATE TABLE IF NOT EXISTS telegram_ingress_results (
        update_id INTEGER PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_delivery_receipts (
        idempotency_key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        delivered_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telegram_delivery_outbox (
        idempotency_key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        failure_class TEXT,
        failure_retryable INTEGER,
        retry_after_ms INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS audit_events_reject_update
      BEFORE UPDATE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_events_reject_delete
      BEFORE DELETE ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_audit_events_reject_update
      BEFORE UPDATE ON telegram_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'telegram_audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_audit_events_reject_delete
      BEFORE DELETE ON telegram_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'telegram_audit_events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_ingress_results_reject_update
      BEFORE UPDATE ON telegram_ingress_results
      BEGIN
        SELECT RAISE(ABORT, 'telegram_ingress_results are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_ingress_results_reject_delete
      BEFORE DELETE ON telegram_ingress_results
      BEGIN
        SELECT RAISE(ABORT, 'telegram_ingress_results are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_delivery_receipts_reject_update
      BEFORE UPDATE ON telegram_delivery_receipts
      BEGIN
        SELECT RAISE(ABORT, 'telegram_delivery_receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS telegram_delivery_receipts_reject_delete
      BEFORE DELETE ON telegram_delivery_receipts
      BEGIN
        SELECT RAISE(ABORT, 'telegram_delivery_receipts are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS work_items_require_outcome_before_review
      BEFORE UPDATE OF state ON work_items
      WHEN NEW.state IN ('Ready for CEO Review', 'Completed')
        AND NOT EXISTS (
          SELECT 1 FROM outcome_reports WHERE work_item_id = NEW.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'review-ready work requires an Outcome Report');
      END;
    `);
    this.#ensureWorkItemSchema();
    this.#ensureOutcomeReportSchema();
    this.#ensureTelegramAuditSchema();
    this.#ensureTelegramReviewControlSchema();
    this.#backfillRm01OutcomeEffects();
    this.#backfillOutcomeReportRevisions();
  }

  close(): void {
    this.#database.close();
  }

  findWorkItemByCommand(
    workspaceId: string,
    idempotencyKey: string,
  ): WorkItem | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM work_items
         WHERE workspace_id = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, idempotencyKey) as unknown as WorkItemRow | undefined;

    return row === undefined ? undefined : mapWorkItem(row);
  }

  workItem(id: string): WorkItem | undefined {
    const row = this.#database
      .prepare("SELECT * FROM work_items WHERE id = ?")
      .get(id) as unknown as WorkItemRow | undefined;

    return row === undefined ? undefined : mapWorkItem(row);
  }

  workItems(): WorkItem[] {
    const rows = this.#database
      .prepare("SELECT * FROM work_items ORDER BY rowid ASC")
      .all() as unknown as WorkItemRow[];

    return rows.map(mapWorkItem);
  }

  outcomeReport(workItemId: string): OutcomeReport | undefined {
    const row = this.#database
      .prepare("SELECT * FROM outcome_reports WHERE work_item_id = ?")
      .get(workItemId) as unknown as OutcomeReportRow | undefined;

    return row === undefined ? undefined : mapOutcomeReport(row);
  }

  outcomeReportRevisions(workItemId: string): OutcomeReport[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM outcome_report_revisions
         WHERE work_item_id = ?
         ORDER BY revision ASC`,
      )
      .all(workItemId) as unknown as OutcomeReportRow[];

    return rows.map(mapOutcomeReport);
  }

  nextOutcomeReportRevision(workItemId: string): number {
    const row = this.#database
      .prepare(
        `SELECT MAX(revision) AS highest FROM outcome_report_revisions
         WHERE work_item_id = ?`,
      )
      .get(workItemId) as unknown as { highest: number | null } | undefined;

    return (row?.highest ?? 0) + 1;
  }

  auditTrail(workItemId: string): AuditEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM audit_events
         WHERE work_item_id = ?
         ORDER BY sequence ASC`,
      )
      .all(workItemId) as unknown as AuditEventRow[];

    return rows.map((row) => ({
      sequence: row.sequence,
      workItemId: row.work_item_id,
      type: row.event_type,
      occurredAt: row.occurred_at,
      details: parseJson<Record<string, unknown>>(row.details_json),
    }));
  }

  telegramAuditTrail(): TelegramAuditEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT sequence, actor_id, workspace_id, event_type, occurred_at,
                details_json
         FROM telegram_audit_events
         ORDER BY sequence ASC`,
      )
      .all() as unknown as TelegramAuditEventRow[];

    return rows.map((row) => ({
      sequence: row.sequence,
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      type: row.event_type,
      occurredAt: row.occurred_at,
      details: parseJson<Record<string, unknown>>(row.details_json),
    }));
  }

  recordTelegramAudit(
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    type: TelegramAuditEvent["type"],
    occurredAt: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    this.#appendTelegramAudit(ownership, type, occurredAt, details);
  }

  telegramIngressResult(updateId: number): TelegramIngressResult | undefined {
    const row = this.#database
      .prepare(
        `SELECT update_id, actor_id, workspace_id, result_json, processed_at
         FROM telegram_ingress_results WHERE update_id = ?`,
      )
      .get(updateId) as unknown as TelegramIngressResultRow | undefined;
    return row === undefined
      ? undefined
      : parseJson<TelegramIngressResult>(row.result_json);
  }

  recordTelegramIngressResult(
    updateId: number,
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    result: TelegramIngressResult,
    processedAt: string,
  ): TelegramIngressResult {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO telegram_ingress_results (
          update_id, actor_id, workspace_id, result_json, processed_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        updateId,
        ownership.actorId,
        ownership.workspaceId,
        JSON.stringify(result),
        processedAt,
      );
    return this.telegramIngressResult(updateId) ?? result;
  }

  telegramDeliveryReceipt(
    idempotencyKey: string,
  ): { readonly payloadDigest: string; readonly deliveredAt: string } | undefined {
    const row = this.#database
      .prepare(
        `SELECT idempotency_key, actor_id, workspace_id, payload_digest,
                delivered_at
         FROM telegram_delivery_receipts WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as unknown as TelegramDeliveryReceiptRow | undefined;
    return row === undefined
      ? undefined
      : { payloadDigest: row.payload_digest, deliveredAt: row.delivered_at };
  }

  recordTelegramDeliveryReceipt(
    idempotencyKey: string,
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    payloadDigest: string,
    deliveredAt: string,
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO telegram_delivery_receipts (
          idempotency_key, actor_id, workspace_id, payload_digest, delivered_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        idempotencyKey,
        ownership.actorId,
        ownership.workspaceId,
        payloadDigest,
        deliveredAt,
      );
  }

  claimTelegramDelivery(
    idempotencyKey: string,
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    message: TelegramOutboundMessage,
    payloadDigest: string,
    occurredAt: string,
  ): TelegramDeliveryClaim {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.#database
        .prepare("SELECT * FROM telegram_delivery_outbox WHERE idempotency_key = ?")
        .get(idempotencyKey) as unknown as TelegramDeliveryOutboxRow | undefined;
      if (row !== undefined) {
        if (row.payload_digest !== payloadDigest) {
          this.#database.exec("COMMIT;");
          return { kind: "conflict" };
        }
        if (row.state === "sent") {
          this.#database.exec("COMMIT;");
          return { kind: "sent" };
        }
        if (row.state === "in-flight" || row.state === "uncertain") {
          this.#database.exec("COMMIT;");
          return { kind: "uncertain" };
        }
        if (row.failure_retryable !== 1 || row.attempt_count >= 3) {
          const failure: ProviderFailure = {
            class: row.failure_class ?? "provider-error",
            retryable: false,
            message: "Telegram delivery exhausted its governed retry policy.",
            ...(row.retry_after_ms === null
              ? {}
              : { retryAfterMs: row.retry_after_ms }),
          };
          this.#database.exec("COMMIT;");
          return { kind: "terminal-failure", failure };
        }
        const retryAt =
          Date.parse(row.updated_at) + (row.retry_after_ms ?? 0);
        const currentTime = Date.parse(occurredAt);
        if (
          row.retry_after_ms !== null &&
          Number.isFinite(retryAt) &&
          Number.isFinite(currentTime) &&
          currentTime < retryAt
        ) {
          const failure: ProviderFailure = {
            class: row.failure_class ?? "rate-limited",
            retryable: true,
            message: "Telegram delivery is deferred by the provider retry policy.",
            retryAfterMs: retryAt - currentTime,
          };
          this.#database.exec("COMMIT;");
          return { kind: "deferred", failure };
        }

        this.#database
          .prepare(
            `UPDATE telegram_delivery_outbox
             SET state = 'in-flight', attempt_count = attempt_count + 1,
                 failure_class = NULL, failure_retryable = NULL,
                 retry_after_ms = NULL, updated_at = ?
             WHERE idempotency_key = ? AND state = 'failed'`,
          )
          .run(occurredAt, idempotencyKey);
        this.#database.exec("COMMIT;");
        return { kind: "send", attempt: row.attempt_count + 1 };
      }

      const legacyReceipt = this.telegramDeliveryReceipt(idempotencyKey);
      if (legacyReceipt !== undefined) {
        this.#database.exec("COMMIT;");
        return legacyReceipt.payloadDigest === payloadDigest
          ? { kind: "sent" }
          : { kind: "conflict" };
      }

      this.#database
        .prepare(
          `INSERT INTO telegram_delivery_outbox (
            idempotency_key, actor_id, workspace_id, chat_id, payload_json,
            payload_digest, state, attempt_count, failure_class,
            failure_retryable, retry_after_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'in-flight', 1, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          idempotencyKey,
          ownership.actorId,
          ownership.workspaceId,
          message.chatId,
          JSON.stringify(message),
          payloadDigest,
          occurredAt,
          occurredAt,
        );
      this.#database.exec("COMMIT;");
      return { kind: "send", attempt: 1 };
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  completeTelegramDelivery(
    idempotencyKey: string,
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    payloadDigest: string,
    occurredAt: string,
  ): void {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#database
        .prepare(
          `UPDATE telegram_delivery_outbox
           SET state = 'sent', updated_at = ?
           WHERE idempotency_key = ? AND payload_digest = ?
             AND state = 'in-flight'`,
        )
        .run(occurredAt, idempotencyKey, payloadDigest);
      if (result.changes !== 1) {
        throw new Error("Telegram delivery claim changed before completion.");
      }
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO telegram_delivery_receipts (
            idempotency_key, actor_id, workspace_id, payload_digest, delivered_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          ownership.actorId,
          ownership.workspaceId,
          payloadDigest,
          occurredAt,
        );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  failTelegramDelivery(
    idempotencyKey: string,
    payloadDigest: string,
    failure: ProviderFailure,
    occurredAt: string,
    outcome: "failed" | "uncertain" = "failed",
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE telegram_delivery_outbox
         SET state = ?, failure_class = ?, failure_retryable = ?,
             retry_after_ms = ?, updated_at = ?
         WHERE idempotency_key = ? AND payload_digest = ?
           AND state = 'in-flight'`,
      )
      .run(
        outcome,
        failure.class,
        failure.retryable ? 1 : 0,
        failure.retryAfterMs ?? null,
        occurredAt,
        idempotencyKey,
        payloadDigest,
      );
    if (result.changes !== 1) {
      throw new Error("Telegram delivery claim changed before failure recording.");
    }
  }

  pendingTelegramDeliveries(occurredAt: string): TelegramPendingDelivery[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM telegram_delivery_outbox
         WHERE state = 'failed' AND failure_retryable = 1 AND attempt_count < 3
         ORDER BY created_at ASC`,
      )
      .all() as unknown as TelegramDeliveryOutboxRow[];
    const currentTime = Date.parse(occurredAt);
    return rows
      .filter((row) => {
        if (row.retry_after_ms === null) {
          return true;
        }
        const retryAt = Date.parse(row.updated_at) + row.retry_after_ms;
        return Number.isFinite(currentTime) && currentTime >= retryAt;
      })
      .map((row) => ({
        idempotencyKey: row.idempotency_key,
        message: parseJson<TelegramOutboundMessage>(row.payload_json),
        payloadDigest: row.payload_digest,
      }));
  }

  telegramUncertainDeliveryCount(): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM telegram_delivery_outbox WHERE state IN ('in-flight', 'uncertain')",
      )
      .get() as unknown as { count: number };
    return row.count;
  }

  issueTelegramReviewControls(
    workItemId: string,
    targetVersion: string,
    expiresAt: string,
    occurredAt: string,
    expiryPolicy: string,
  ): TelegramReviewControl[] {
    const decisions: readonly TelegramReviewDecision[] = [
      "approve",
      "request-changes",
      "reject",
      "cancel",
    ];
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const existingRows = this.#database
        .prepare(
          `SELECT * FROM telegram_review_controls
           WHERE work_item_id = ? AND target_version = ?
             AND expires_at = (
               SELECT expires_at FROM telegram_review_controls
               WHERE work_item_id = ? AND target_version = ?
                 AND expires_at > ?
                 AND state IN ('issued', 'awaiting-reason', 'applying')
               ORDER BY issued_at DESC LIMIT 1
             )`,
        )
        .all(
          workItemId,
          targetVersion,
          workItemId,
          targetVersion,
          occurredAt,
        ) as unknown as TelegramReviewControlRow[];
      if (existingRows.length > 0) {
        if (existingRows.length !== decisions.length) {
          throw new Error(
            "Telegram review-control set is incomplete for the exact target.",
          );
        }
        const existing = existingRows
          .map(mapTelegramReviewControl)
          .sort(
            (left, right) =>
              decisions.indexOf(left.decision) -
              decisions.indexOf(right.decision),
          );
        this.#database.exec("COMMIT;");
        return existing;
      }

      const controls = decisions.map((decision) => ({
        id: randomUUID(),
        workItemId,
        decision,
        targetVersion,
        expiresAt,
        issuedAt: occurredAt,
        usedAt: null,
        claimedUpdateId: null,
        state: "issued" as const,
      }));
      const statement = this.#database.prepare(
        `INSERT INTO telegram_review_controls (
          id, work_item_id, decision, target_version, expires_at,
          issued_at, used_at, claimed_update_id, state
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'issued')`,
      );
      for (const control of controls) {
        statement.run(
          control.id,
          control.workItemId,
          control.decision,
          control.targetVersion,
          control.expiresAt,
          control.issuedAt,
        );
      }
      this.#appendTelegramAudit(
        {
          actorId: this.workItem(workItemId)?.actorId ?? "system:telegram",
          workspaceId:
            this.workItem(workItemId)?.workspaceId ?? "workspace:real-ming",
        },
        "telegram.review-controls-issued",
        occurredAt,
        {
          workItemId,
          targetVersion,
          expiresAt,
          expiryPolicy,
          decisions,
        },
      );
      this.#database.exec("COMMIT;");
      return controls;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

  }

  telegramReviewControl(id: string): TelegramReviewControl | undefined {
    const row = this.#database
      .prepare("SELECT * FROM telegram_review_controls WHERE id = ?")
      .get(id) as unknown as TelegramReviewControlRow | undefined;
    return row === undefined ? undefined : mapTelegramReviewControl(row);
  }

  claimTelegramReviewControl(
    id: string,
    expectedState: "issued" | "awaiting-reason",
    updateId: number,
    occurredAt: string,
  ): "claimed" | "replay" | "unavailable" {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.telegramReviewControl(id);
      if (
        current?.state === "applying" &&
        current.claimedUpdateId === updateId
      ) {
        this.#database.exec("COMMIT;");
        return "replay";
      }
      const result = this.#database
        .prepare(
          `UPDATE telegram_review_controls
           SET state = 'applying', claimed_update_id = ?
           WHERE id = ? AND state = ?`,
        )
        .run(updateId, id, expectedState);
      if (result.changes !== 1) {
        this.#database.exec("COMMIT;");
        return "unavailable";
      }
      const control = this.telegramReviewControl(id);
      this.#appendTelegramAudit(
        {
          actorId:
            control === undefined
              ? "system:telegram"
              : (this.workItem(control.workItemId)?.actorId ??
                "system:telegram"),
          workspaceId:
            control === undefined
              ? "workspace:real-ming"
              : (this.workItem(control.workItemId)?.workspaceId ??
                "workspace:real-ming"),
        },
        "telegram.review-control-claimed",
        occurredAt,
        {
          controlId: id,
          workItemId: control?.workItemId,
          decision: control?.decision,
          updateId,
        },
      );
      this.#database.exec("COMMIT;");
      return "claimed";
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  markTelegramReviewControl(
    id: string,
    state: Exclude<TelegramReviewControl["state"], "issued">,
    occurredAt: string,
    reason?: string,
    expectedState: TelegramReviewControl["state"] = "issued",
    expectedUpdateId?: number,
  ): boolean {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#database
        .prepare(
          `UPDATE telegram_review_controls
           SET state = ?, used_at = CASE WHEN ? = 'used' THEN ? ELSE used_at END
           WHERE id = ? AND state = ?
             AND (? IS NULL OR claimed_update_id = ?)`,
        )
        .run(
          state,
          state,
          occurredAt,
          id,
          expectedState,
          expectedUpdateId ?? null,
          expectedUpdateId ?? null,
        );
      if (result.changes !== 1) {
        this.#database.exec("COMMIT;");
        return false;
      }

      const control = this.telegramReviewControl(id);
      this.#appendTelegramAudit(
        {
          actorId:
            control === undefined
              ? "system:telegram"
              : (this.workItem(control.workItemId)?.actorId ??
                "system:telegram"),
          workspaceId:
            control === undefined
              ? "workspace:real-ming"
              : (this.workItem(control.workItemId)?.workspaceId ??
                "workspace:real-ming"),
        },
        state === "used"
          ? "telegram.review-control-applied"
          : state === "applying"
            ? "telegram.review-control-claimed"
            : state === "awaiting-reason"
              ? "telegram.review-control-awaiting-reason"
              : "telegram.review-control-rejected",
        occurredAt,
        {
          controlId: id,
          workItemId: control?.workItemId,
          decision: control?.decision,
          state,
          ...(reason === undefined ? {} : { reason }),
        },
      );
      this.#database.exec("COMMIT;");
      return true;
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  createWorkItem(action: NormalizedCeoAction, occurredAt: string): WorkItem {
    const id = randomUUID();
    const accountableExecutive = action.accountableExecutive ?? "COO";
    const collaboratorRoles = new Set<string>();
    const collaboratingExecutives = (
      action.collaboratingExecutives ?? []
    ).map((request) => {
      if (
        request.executive === accountableExecutive ||
        collaboratorRoles.has(request.executive) ||
        request.contribution.trim().length === 0
      ) {
        throw new Error("Collaborating Executive assignment is not valid.");
      }
      collaboratorRoles.add(request.executive);
      return {
        executive: request.executive,
        contribution: request.contribution,
        authority: "contribute-only",
        mayApproveParent: false,
        mayCompleteParent: false,
      } as const;
    });

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT INTO work_items (
            id, actor_id, workspace_id, idempotency_key, intent,
            expected_effect_json, accountable_executive, workstream,
            collaborating_executives_json, confirmed_commitment_json,
            proposed_commitment_json, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'Captured', ?, ?)`,
        )
        .run(
          id,
          action.actorId,
          action.workspaceId,
          action.idempotencyKey,
          action.intent,
          JSON.stringify(action.expectedEffect),
          accountableExecutive,
          action.workstream ?? null,
          JSON.stringify(collaboratingExecutives),
          occurredAt,
          occurredAt,
        );
      this.#appendAudit(
        id,
        "work-item.captured",
        occurredAt,
        {
          actorId: action.actorId,
          workspaceId: action.workspaceId,
          idempotencyKey: action.idempotencyKey,
          accountableExecutive,
          workstream: action.workstream ?? null,
          collaboratingExecutives: collaboratingExecutives.map(
            (assignment) => assignment.executive,
          ),
        },
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return this.#requireWorkItem(id);
  }

  transition(
    workItemId: string,
    state: Exclude<WorkItemState, "Ready for CEO Review">,
    occurredAt: string,
    details: Readonly<Record<string, unknown>> = {},
  ): WorkItem {
    const current = this.#requireWorkItem(workItemId);
    const eventType = lifecycleEventFor(current.state, state);
    if (eventType === undefined) {
      throw new Error(
        `Work Item transition ${current.state} -> ${state} is not allowed.`,
      );
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          "UPDATE work_items SET state = ?, updated_at = ? WHERE id = ?",
        )
        .run(state, occurredAt, workItemId);
      this.#appendAudit(workItemId, eventType, occurredAt, details);
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return this.#requireWorkItem(workItemId);
  }

  approval(id: string): Approval | undefined {
    const row = this.#database
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(id) as unknown as ApprovalRow | undefined;

    return row === undefined ? undefined : mapApproval(row);
  }

  approvals(workItemId: string): Approval[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM approvals
         WHERE work_item_id = ?
         ORDER BY rowid ASC`,
      )
      .all(workItemId) as unknown as ApprovalRow[];

    return rows.map(mapApproval);
  }

  standingAuthorities(): StandingAuthority[] {
    const rows = this.#database
      .prepare(
        "SELECT * FROM standing_authorities ORDER BY granted_at ASC, id ASC",
      )
      .all() as unknown as StandingAuthorityRow[];

    return rows.map(mapStandingAuthority);
  }

  requestApproval(
    request: {
      readonly workItemId: string;
      readonly scope: ApprovalScope;
      readonly targetType: string;
      readonly targetIdentity: string;
      readonly targetVersion: string;
      readonly riskClass: RiskClass;
      readonly reason: string;
    },
    occurredAt: string,
  ): Approval {
    const id = randomUUID();

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT INTO approvals (
            id, work_item_id, actor_id, scope, target_type, target_identity,
            target_version, risk_class, requested_at, decided_at, expires_at,
            state
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, 'requested')`,
        )
        .run(
          id,
          request.workItemId,
          request.scope,
          request.targetType,
          request.targetIdentity,
          request.targetVersion,
          request.riskClass,
          occurredAt,
        );
      this.#appendAudit(
        request.workItemId,
        "approval.requested",
        occurredAt,
        {
          approvalId: id,
          scope: request.scope,
          targetType: request.targetType,
          targetIdentity: request.targetIdentity,
          targetVersion: request.targetVersion,
          riskClass: request.riskClass,
          reason: request.reason,
        },
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return this.#requireApproval(id);
  }

  grantApproval(
    approvalId: string,
    actorId: string,
    expiresAt: string,
    occurredAt: string,
  ): Approval {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `UPDATE approvals
           SET actor_id = ?, decided_at = ?, expires_at = ?, state = 'granted'
           WHERE id = ?`,
        )
        .run(actorId, occurredAt, expiresAt, approvalId);
      const approval = this.#requireApproval(approvalId);
      this.#appendAudit(
        approval.workItemId,
        "approval.granted",
        occurredAt,
        {
          approvalId,
          actorId,
          scope: approval.scope,
          targetType: approval.targetType,
          targetIdentity: approval.targetIdentity,
          targetVersion: approval.targetVersion,
          expiresAt,
        },
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return this.#requireApproval(approvalId);
  }

  invalidateApproval(
    approvalId: string,
    state: Extract<ApprovalState, "invalidated" | "expired">,
    details: Readonly<Record<string, unknown>>,
    occurredAt: string,
  ): void {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const approval = this.#requireApproval(approvalId);
      this.#database
        .prepare("UPDATE approvals SET state = ? WHERE id = ?")
        .run(state, approvalId);
      this.#appendAudit(
        approval.workItemId,
        "approval.invalidated",
        occurredAt,
        { approvalId, state, ...details },
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  recordStandingAuthority(
    request: {
      readonly actorId: string;
      readonly executive: StandingAuthority["executive"];
      readonly trustDomain: TrustDomain;
      readonly targetType: string;
      readonly expiresAt: string;
    },
    occurredAt: string,
  ): StandingAuthority {
    const id = randomUUID();
    this.#database
      .prepare(
        `INSERT INTO standing_authorities (
          id, granted_by_actor_id, executive, trust_domain, target_type,
          expires_at, granted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        request.actorId,
        request.executive,
        request.trustDomain,
        request.targetType,
        request.expiresAt,
        occurredAt,
      );

    return {
      id,
      grantedByActorId: request.actorId,
      executive: request.executive,
      trustDomain: request.trustDomain,
      targetType: request.targetType,
      expiresAt: request.expiresAt,
      grantedAt: occurredAt,
    };
  }

  recordPolicyDecision(
    workItemId: string,
    type: Extract<AuditEvent["type"], "policy.permitted" | "policy.denied">,
    details: Readonly<Record<string, unknown>>,
    occurredAt: string,
  ): void {
    this.#appendAudit(workItemId, type, occurredAt, details);
  }

  #requireApproval(id: string): Approval {
    const approval = this.approval(id);
    if (approval === undefined) {
      throw new Error("Approval was not found after a durable state change.");
    }
    return approval;
  }

  recordRejectedTransition(
    workItemId: string,
    rejection: {
      readonly actorId?: string;
      readonly from: WorkItemState;
      readonly to: WorkItemState;
      readonly reason: string;
    },
    occurredAt: string,
  ): void {
    this.#appendAudit(
      workItemId,
      "work-item.transition-rejected",
      occurredAt,
      {
        ...(rejection.actorId === undefined
          ? {}
          : { actorId: rejection.actorId }),
        from: rejection.from,
        to: rejection.to,
        reason: rejection.reason,
      },
    );
  }

  recordCommitment(
    workItemId: string,
    commitment: ConfirmedCommitment | ProposedCommitment,
    occurredAt: string,
  ): WorkItem {
    const statement =
      commitment.kind === "Proposed Commitment"
        ? "UPDATE work_items SET proposed_commitment_json = ?, updated_at = ? WHERE id = ?"
        : "UPDATE work_items SET confirmed_commitment_json = ?, updated_at = ? WHERE id = ?";

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(statement)
        .run(JSON.stringify(commitment), occurredAt, workItemId);
      this.#appendAudit(
        workItemId,
        "work-item.commitment-recorded",
        occurredAt,
        {
          kind: commitment.kind,
          value: commitment.value,
          provenance: commitment.provenance,
        },
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return this.#requireWorkItem(workItemId);
  }

  recordRejectedCommitment(
    workItemId: string,
    rejection: {
      readonly kind: (ConfirmedCommitment | ProposedCommitment)["kind"];
      readonly reason: string;
    },
    occurredAt: string,
  ): void {
    this.#appendAudit(
      workItemId,
      "work-item.commitment-rejected",
      occurredAt,
      { kind: rejection.kind, reason: rejection.reason },
    );
  }

  recordWorkerEffect(
    workItemId: string,
    receipt: WorkerReceipt,
    occurredAt: string,
  ): void {
    this.#appendAudit(workItemId, "worker.effect-recorded", occurredAt, {
      idempotencyKey: receipt.effect.idempotencyKey,
      kind: receipt.effect.kind,
      executive: receipt.effect.executive,
      authority: receipt.effect.authority,
      evidenceReference: receipt.effect.idempotencyKey,
    });
  }

  recordWorkerFailure(workItemId: string, occurredAt: string): void {
    this.#appendAudit(workItemId, "worker.effect-failed", occurredAt, {
      classification: "worker-execution-failed",
      secretSafe: true,
    });
  }

  recordVerification(
    workItemId: string,
    verification: EffectVerification,
    occurredAt: string,
  ): void {
    this.#appendAudit(workItemId, "worker.effect-verified", occurredAt, {
      status: verification.status,
      evidence: verification.evidence,
    });
  }

  recordVerificationFailure(workItemId: string, occurredAt: string): void {
    this.#appendAudit(
      workItemId,
      "worker.effect-verification-failed",
      occurredAt,
      {
        classification: "effect-verification-failed",
        secretSafe: true,
      },
    );
  }

  recordReviewReadyOutcome(
    workItem: WorkItem,
    receipt: WorkerReceipt,
    verification: EffectVerification,
    occurredAt: string,
  ): { workItem: WorkItem; outcomeReport: OutcomeReport } {
    const current = this.#requireWorkItem(workItem.id);
    const reviewEvent = lifecycleEventFor(
      current.state,
      "Ready for CEO Review",
    );
    if (reviewEvent === undefined) {
      throw new Error(
        "Only a verifying Work Item can become Ready for CEO Review.",
      );
    }

    const superseded = this.outcomeReport(workItem.id);
    const outcomeReport: OutcomeReport = {
      id: randomUUID(),
      workItemId: workItem.id,
      revision: this.nextOutcomeReportRevision(workItem.id),
      requestedIntent: current.intent,
      completedEffect: receipt.effect,
      verification,
      remainingRisks: [],
      requiredDecisions: ["CEO review required before completion."],
      createdAt: occurredAt,
    };

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const values = [
        outcomeReport.workItemId,
        outcomeReport.revision,
        outcomeReport.requestedIntent,
        JSON.stringify(outcomeReport.completedEffect),
        JSON.stringify(outcomeReport.verification),
        JSON.stringify(outcomeReport.remainingRisks),
        JSON.stringify(outcomeReport.requiredDecisions),
        outcomeReport.createdAt,
      ] as const;

      this.#database
        .prepare(
          `INSERT INTO outcome_report_revisions (
            id, work_item_id, revision, requested_intent,
            completed_effect_json, verification_json, remaining_risks_json,
            required_decisions_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(outcomeReport.id, ...values);

      if (superseded === undefined) {
        this.#database
          .prepare(
            `INSERT INTO outcome_reports (
              id, work_item_id, revision, requested_intent,
              completed_effect_json, verification_json, remaining_risks_json,
              required_decisions_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(outcomeReport.id, ...values);
      } else {
        this.#database
          .prepare(
            `UPDATE outcome_reports SET
              id = ?, revision = ?, requested_intent = ?,
              completed_effect_json = ?, verification_json = ?,
              remaining_risks_json = ?, required_decisions_json = ?,
              created_at = ?
             WHERE work_item_id = ?`,
          )
          .run(
            outcomeReport.id,
            outcomeReport.revision,
            outcomeReport.requestedIntent,
            JSON.stringify(outcomeReport.completedEffect),
            JSON.stringify(outcomeReport.verification),
            JSON.stringify(outcomeReport.remainingRisks),
            JSON.stringify(outcomeReport.requiredDecisions),
            outcomeReport.createdAt,
            outcomeReport.workItemId,
          );
        this.#appendAudit(
          workItem.id,
          "outcome-report.superseded",
          occurredAt,
          {
            supersededOutcomeReportId: superseded.id,
            supersededRevision: superseded.revision,
          },
        );
      }

      this.#appendAudit(workItem.id, "outcome-report.recorded", occurredAt, {
        outcomeReportId: outcomeReport.id,
        revision: outcomeReport.revision,
      });
      this.#database
        .prepare(
          "UPDATE work_items SET state = 'Ready for CEO Review', updated_at = ? WHERE id = ?",
        )
        .run(occurredAt, workItem.id);
      this.#appendAudit(workItem.id, reviewEvent, occurredAt, {
        outcomeReportId: outcomeReport.id,
      });
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }

    return {
      workItem: this.#requireWorkItem(workItem.id),
      outcomeReport,
    };
  }

  #requireWorkItem(id: string): WorkItem {
    const workItem = this.workItem(id);
    if (workItem === undefined) {
      throw new Error("Work Item was not found after a durable state change.");
    }
    return workItem;
  }

  #ensureWorkItemSchema(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(work_items)")
      .all() as unknown as TableColumnRow[];
    const names = new Set(columns.map((column) => column.name));

    if (!names.has("accountable_executive")) {
      this.#database.exec(
        "ALTER TABLE work_items ADD COLUMN accountable_executive TEXT NOT NULL DEFAULT 'COO';",
      );
    }
    if (!names.has("workstream")) {
      this.#database.exec("ALTER TABLE work_items ADD COLUMN workstream TEXT;");
    }
    if (!names.has("collaborating_executives_json")) {
      this.#database.exec(
        "ALTER TABLE work_items ADD COLUMN collaborating_executives_json TEXT NOT NULL DEFAULT '[]';",
      );
    }
    if (!names.has("confirmed_commitment_json")) {
      this.#database.exec(
        "ALTER TABLE work_items ADD COLUMN confirmed_commitment_json TEXT;",
      );
    }
    if (!names.has("proposed_commitment_json")) {
      this.#database.exec(
        "ALTER TABLE work_items ADD COLUMN proposed_commitment_json TEXT;",
      );
    }
  }

  #ensureOutcomeReportSchema(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(outcome_reports)")
      .all() as unknown as TableColumnRow[];

    if (!columns.some((column) => column.name === "revision")) {
      this.#database.exec(
        "ALTER TABLE outcome_reports ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;",
      );
    }
  }

  #backfillOutcomeReportRevisions(): void {
    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database.exec(
        `INSERT INTO outcome_report_revisions (
          id, work_item_id, revision, requested_intent, completed_effect_json,
          verification_json, remaining_risks_json, required_decisions_json,
          created_at
        )
        SELECT
          outcome_reports.id, outcome_reports.work_item_id,
          outcome_reports.revision, outcome_reports.requested_intent,
          outcome_reports.completed_effect_json,
          outcome_reports.verification_json,
          outcome_reports.remaining_risks_json,
          outcome_reports.required_decisions_json, outcome_reports.created_at
        FROM outcome_reports
        WHERE NOT EXISTS (
          SELECT 1 FROM outcome_report_revisions
          WHERE outcome_report_revisions.work_item_id = outcome_reports.work_item_id
        );`,
      );
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #backfillRm01OutcomeEffects(): void {
    const rows = this.#database
      .prepare(
        `SELECT
          outcome_reports.id,
          outcome_reports.work_item_id,
          outcome_reports.completed_effect_json,
          work_items.accountable_executive
        FROM outcome_reports
        INNER JOIN work_items
          ON work_items.id = outcome_reports.work_item_id`,
      )
      .all() as unknown as OutcomeEffectMigrationRow[];
    const updates: Array<{ readonly id: string; readonly effect: WorkerEffect }> =
      [];

    for (const row of rows) {
      const stored = parseJson<Partial<WorkerEffect>>(
        row.completed_effect_json,
      );
      if (
        typeof stored.workItemId === "string" &&
        typeof stored.executive === "string" &&
        (stored.authority === "accountable" ||
          stored.authority === "contribute-only")
      ) {
        continue;
      }
      if (
        typeof stored.idempotencyKey !== "string" ||
        typeof stored.kind !== "string" ||
        typeof stored.value !== "string"
      ) {
        throw new Error(
          `Outcome Report ${row.id} has an unsupported completed effect.`,
        );
      }

      updates.push({
        id: row.id,
        effect: {
          workItemId: row.work_item_id,
          executive: row.accountable_executive,
          authority: "accountable",
          idempotencyKey: stored.idempotencyKey,
          kind: stored.kind,
          value: stored.value,
        },
      });
    }

    if (updates.length === 0) {
      return;
    }

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      const statement = this.#database.prepare(
        "UPDATE outcome_reports SET completed_effect_json = ? WHERE id = ?",
      );
      for (const update of updates) {
        statement.run(JSON.stringify(update.effect), update.id);
      }
      this.#database.exec("COMMIT;");
    } catch (error) {
      this.#database.exec("ROLLBACK;");
      throw error;
    }
  }

  #appendAudit(
    workItemId: string,
    type: AuditEvent["type"],
    occurredAt: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events (
          work_item_id, event_type, occurred_at, details_json
        ) VALUES (?, ?, ?, ?)`,
      )
      .run(workItemId, type, occurredAt, JSON.stringify(details));
  }

  #ensureTelegramAuditSchema(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(telegram_audit_events)")
      .all() as unknown as TableColumnRow[];
    const names = new Set(columns.map((column) => column.name));

    if (!names.has("actor_id")) {
      this.#database.exec(
        "ALTER TABLE telegram_audit_events ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'system:legacy-telegram';",
      );
    }
    if (!names.has("workspace_id")) {
      this.#database.exec(
        "ALTER TABLE telegram_audit_events ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'workspace:real-ming';",
      );
    }
  }

  #ensureTelegramReviewControlSchema(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(telegram_review_controls)")
      .all() as unknown as TableColumnRow[];
    const names = new Set(columns.map((column) => column.name));

    if (!names.has("claimed_update_id")) {
      this.#database.exec(
        "ALTER TABLE telegram_review_controls ADD COLUMN claimed_update_id INTEGER;",
      );
    }
  }

  #appendTelegramAudit(
    ownership: Pick<TelegramAuditEvent, "actorId" | "workspaceId">,
    type: TelegramAuditEvent["type"],
    occurredAt: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO telegram_audit_events (
          actor_id, workspace_id, event_type, occurred_at, details_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        ownership.actorId,
        ownership.workspaceId,
        type,
        occurredAt,
        JSON.stringify(details),
      );
  }
}
