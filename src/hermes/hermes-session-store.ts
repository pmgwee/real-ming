import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface HermesTurnRecord {
  readonly sessionId: string;
  readonly turnId: string;
  readonly updateId: number;
  readonly textDigest: string;
  readonly mode: "answer" | "clarification" | "research" | "work";
  readonly answer: string | null;
  readonly role?: string;
  readonly workItemId?: string;
  readonly occurredAt: string;
}

export interface HermesSessionView {
  readonly telegramReference: string;
  readonly sessionId: string;
  readonly updatedAt: string;
  readonly turnCount: number;
  readonly lastTurnAt: string | null;
  readonly lastIntent: HermesTurnRecord["mode"] | null;
  readonly lastWorkItemId: string | null;
}

export interface HermesSessionStore {
  bindTelegramSession(telegramReference: string, sessionId: string, updatedAt: string): void;
  sessionForTelegram(telegramReference: string): string | undefined;
  recordTurn(record: HermesTurnRecord): void;
  turn(turnId: string): HermesTurnRecord | undefined;
  sessions(): readonly HermesSessionView[];
  recentTurns(limit?: number): readonly HermesTurnRecord[];
  close(): void;
}

interface SessionRow {
  telegram_reference: string;
  session_id: string;
}

interface TurnRow {
  session_id: string;
  turn_id: string;
  update_id: number;
  text_digest: string;
  mode: HermesTurnRecord["mode"];
  answer: string | null;
  role: string | null;
  work_item_id: string | null;
  occurred_at: string;
}

export function hermesTextDigest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`Hermes ${label} is required.`);
  return normalized;
}

function mapTurn(row: TurnRow): HermesTurnRecord {
  return {
    sessionId: row.session_id,
    turnId: row.turn_id,
    updateId: row.update_id,
    textDigest: row.text_digest,
    mode: row.mode,
    answer: row.answer,
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.work_item_id === null ? {} : { workItemId: row.work_item_id }),
    occurredAt: row.occurred_at,
  };
}

export function createHermesSessionStore(statePath: string): HermesSessionStore {
  mkdirSync(dirname(statePath), { recursive: true });
  const database = new DatabaseSync(statePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS hermes_sessions (
      telegram_reference TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hermes_turns (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      update_id INTEGER NOT NULL,
      text_digest TEXT NOT NULL,
      mode TEXT NOT NULL,
      answer TEXT,
      role TEXT,
      work_item_id TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hermes_turns_session_idx ON hermes_turns(session_id, occurred_at);
  `);

  return {
    bindTelegramSession(telegramReference, sessionId, updatedAt) {
      const reference = required(telegramReference, "Telegram session reference");
      const session = required(sessionId, "session ID");
      const existing = database
        .prepare("SELECT telegram_reference, session_id FROM hermes_sessions WHERE telegram_reference = ?")
        .get(reference) as SessionRow | undefined;
      if (existing !== undefined && existing.session_id !== session) {
        throw new Error("A Telegram chat is already bound to another Hermes session.");
      }
      database
        .prepare(
          `INSERT INTO hermes_sessions (telegram_reference, session_id, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(telegram_reference) DO UPDATE SET updated_at = excluded.updated_at`,
        )
        .run(reference, session, required(updatedAt, "session timestamp"));
    },

    sessionForTelegram(telegramReference) {
      const reference = required(telegramReference, "Telegram session reference");
      const row = database
        .prepare("SELECT session_id FROM hermes_sessions WHERE telegram_reference = ?")
        .get(reference) as { session_id: string } | undefined;
      return row?.session_id;
    },

    recordTurn(record) {
      const textDigest = required(record.textDigest, "turn digest");
      const existing = database
        .prepare("SELECT * FROM hermes_turns WHERE turn_id = ?")
        .get(required(record.turnId, "turn ID")) as TurnRow | undefined;
      if (existing !== undefined) {
        if (existing.text_digest !== textDigest || existing.session_id !== record.sessionId) {
          throw new Error("A Hermes turn ID was reused for a different turn.");
        }
        return;
      }
      database
        .prepare(
          `INSERT INTO hermes_turns (
             turn_id, session_id, update_id, text_digest, mode, answer, role,
             work_item_id, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          required(record.turnId, "turn ID"),
          required(record.sessionId, "session ID"),
          record.updateId,
          textDigest,
          record.mode,
          record.answer,
          record.role ?? null,
          record.workItemId ?? null,
          required(record.occurredAt, "turn timestamp"),
        );
    },

    turn(turnId) {
      const row = database
        .prepare("SELECT * FROM hermes_turns WHERE turn_id = ?")
        .get(required(turnId, "turn ID")) as TurnRow | undefined;
      return row === undefined ? undefined : mapTurn(row);
    },

    sessions() {
      const rows = database
        .prepare(
          `SELECT s.telegram_reference, s.session_id, s.updated_at,
                  COUNT(t.turn_id) AS turn_count,
                  MAX(t.occurred_at) AS last_turn_at,
                  (SELECT mode FROM hermes_turns t2
                   WHERE t2.session_id = s.session_id
                   ORDER BY t2.occurred_at DESC LIMIT 1) AS last_intent,
                  (SELECT work_item_id FROM hermes_turns t3
                   WHERE t3.session_id = s.session_id
                   ORDER BY t3.occurred_at DESC LIMIT 1) AS last_work_item_id
           FROM hermes_sessions s
           LEFT JOIN hermes_turns t ON t.session_id = s.session_id
           GROUP BY s.telegram_reference, s.session_id, s.updated_at
           ORDER BY s.updated_at DESC`,
        )
        .all() as unknown as readonly {
        readonly telegram_reference: string;
        readonly session_id: string;
        readonly updated_at: string;
        readonly turn_count: number;
        readonly last_turn_at: string | null;
        readonly last_intent: HermesTurnRecord["mode"] | null;
        readonly last_work_item_id: string | null;
      }[];
      return rows.map((row) => ({
        telegramReference: row.telegram_reference,
        sessionId: row.session_id,
        updatedAt: row.updated_at,
        turnCount: row.turn_count,
        lastTurnAt: row.last_turn_at,
        lastIntent: row.last_intent,
        lastWorkItemId: row.last_work_item_id,
      }));
    },

    recentTurns(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new Error("Hermes turn history limit must be between 1 and 500.");
      }
      const rows = database
        .prepare("SELECT * FROM hermes_turns ORDER BY occurred_at DESC LIMIT ?")
        .all(limit) as unknown as readonly TurnRow[];
      return rows.map(mapTurn);
    },

    close() {
      database.close();
    },
  };
}
