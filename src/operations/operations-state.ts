import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  AuditEvent,
  EffectVerification,
  NormalizedCeoAction,
  OutcomeReport,
  WorkItem,
  WorkItemState,
  WorkerEffect,
  WorkerReceipt,
} from "./contracts.js";

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
  state: WorkItemState;
  created_at: string;
  updated_at: string;
}

interface OutcomeReportRow {
  id: string;
  work_item_id: string;
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

interface TableColumnRow {
  name: string;
}

interface OutcomeEffectMigrationRow {
  id: string;
  work_item_id: string;
  completed_effect_json: string;
  accountable_executive: WorkItem["accountableExecutive"];
}

const allowedTransitions = [
  {
    from: "Captured",
    to: "Executing",
    event: "work-item.executing",
  },
  {
    from: "Executing",
    to: "Verifying",
    event: "work-item.verifying",
  },
  {
    from: "Executing",
    to: "Waiting/Blocked",
    event: "work-item.waiting-blocked",
  },
  {
    from: "Verifying",
    to: "Waiting/Blocked",
    event: "work-item.waiting-blocked",
  },
] as const;

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
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutcomeReport(row: OutcomeReportRow): OutcomeReport {
  return {
    id: row.id,
    workItemId: row.work_item_id,
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
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS outcome_reports (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL UNIQUE,
        requested_intent TEXT NOT NULL,
        completed_effect_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        remaining_risks_json TEXT NOT NULL,
        required_decisions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        details_json TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id)
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
    this.#backfillRm01OutcomeEffects();
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
      .prepare("SELECT * FROM work_items ORDER BY created_at ASC, id ASC")
      .all() as unknown as WorkItemRow[];

    return rows.map(mapWorkItem);
  }

  outcomeReport(workItemId: string): OutcomeReport | undefined {
    const row = this.#database
      .prepare("SELECT * FROM outcome_reports WHERE work_item_id = ?")
      .get(workItemId) as unknown as OutcomeReportRow | undefined;

    return row === undefined ? undefined : mapOutcomeReport(row);
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
            collaborating_executives_json, state,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Captured', ?, ?)`,
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
    state: Exclude<WorkItemState, "Ready for CEO Review" | "Completed">,
    eventType: AuditEvent["type"],
    occurredAt: string,
    details: Readonly<Record<string, unknown>> = {},
  ): WorkItem {
    const current = this.#requireWorkItem(workItemId);
    const allowed = allowedTransitions.some(
      (rule) =>
        rule.from === current.state &&
        rule.to === state &&
        rule.event === eventType,
    );
    if (!allowed) {
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
    if (current.state !== "Verifying") {
      throw new Error(
        "Only a verifying Work Item can become Ready for CEO Review.",
      );
    }

    const outcomeReport: OutcomeReport = {
      id: randomUUID(),
      workItemId: workItem.id,
      requestedIntent: current.intent,
      completedEffect: receipt.effect,
      verification,
      remainingRisks: [],
      requiredDecisions: ["CEO review required before completion."],
      createdAt: occurredAt,
    };

    this.#database.exec("BEGIN IMMEDIATE;");
    try {
      this.#database
        .prepare(
          `INSERT INTO outcome_reports (
            id, work_item_id, requested_intent, completed_effect_json,
            verification_json, remaining_risks_json,
            required_decisions_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          outcomeReport.id,
          outcomeReport.workItemId,
          outcomeReport.requestedIntent,
          JSON.stringify(outcomeReport.completedEffect),
          JSON.stringify(outcomeReport.verification),
          JSON.stringify(outcomeReport.remainingRisks),
          JSON.stringify(outcomeReport.requiredDecisions),
          outcomeReport.createdAt,
        );
      this.#appendAudit(
        workItem.id,
        "outcome-report.recorded",
        occurredAt,
        { outcomeReportId: outcomeReport.id },
      );
      this.#database
        .prepare(
          "UPDATE work_items SET state = 'Ready for CEO Review', updated_at = ? WHERE id = ?",
        )
        .run(occurredAt, workItem.id);
      this.#appendAudit(
        workItem.id,
        "work-item.ready-for-ceo-review",
        occurredAt,
        { outcomeReportId: outcomeReport.id },
      );
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
}
