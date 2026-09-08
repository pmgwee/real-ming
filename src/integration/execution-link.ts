import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A link between one native Hermes execution task and one Real-Ming Work Item.
 *
 * This is the cross-app record Architecture Revision 6 keeps: Hermes owns how
 * the work is done, Real-Ming owns what the work *was* and what it belongs to.
 * The link is the only thing that has to agree, so it is the only thing stored.
 */
export interface ExecutionLink {
  readonly workItemId: string;
  readonly nativeTaskId: string;
  readonly idempotencyKey: string;
  readonly linkedAt: string;
}

export interface ExecutionLinkResult {
  readonly link: ExecutionLink;
  /** True when this exact key was already recorded, so nothing new happened. */
  readonly deduplicated: boolean;
}

export function executionLinkStatePath(statePath: string): string {
  return statePath === ":memory:"
    ? ":memory:"
    : `${statePath}.execution-links.sqlite`;
}

export interface ExecutionLinkStore {
  link(request: ExecutionLink): ExecutionLinkResult;
  forWorkItem(workItemId: string): readonly ExecutionLink[];
  close(): void;
}

/**
 * Durable, append-only links keyed by idempotency key.
 *
 * An agent that loses its connection mid-call retries, and a retry must not
 * produce a second link to the same work. The key is the primary key, so a
 * replay is a read rather than a write, and the caller is told which happened
 * instead of being left to guess.
 */
export class SqliteExecutionLinkStore implements ExecutionLinkStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS execution_links (
        idempotency_key TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        native_task_id TEXT NOT NULL,
        linked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_links_by_work_item
        ON execution_links (work_item_id);
      CREATE TRIGGER IF NOT EXISTS execution_links_reject_update
      BEFORE UPDATE ON execution_links BEGIN
        SELECT RAISE(ABORT, 'execution_links are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS execution_links_reject_delete
      BEFORE DELETE ON execution_links BEGIN
        SELECT RAISE(ABORT, 'execution_links are append-only');
      END;
    `);
  }

  link(request: ExecutionLink): ExecutionLinkResult {
    const existing = this.#database
      .prepare(
        `SELECT work_item_id, native_task_id, idempotency_key, linked_at
         FROM execution_links WHERE idempotency_key = ?`,
      )
      .get(request.idempotencyKey) as unknown as
      | {
          readonly work_item_id: string;
          readonly native_task_id: string;
          readonly idempotency_key: string;
          readonly linked_at: string;
        }
      | undefined;
    if (existing !== undefined) {
      return {
        link: {
          workItemId: existing.work_item_id,
          nativeTaskId: existing.native_task_id,
          idempotencyKey: existing.idempotency_key,
          linkedAt: existing.linked_at,
        },
        deduplicated: true,
      };
    }
    this.#database
      .prepare(
        `INSERT INTO execution_links
           (idempotency_key, work_item_id, native_task_id, linked_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        request.idempotencyKey,
        request.workItemId,
        request.nativeTaskId,
        request.linkedAt,
      );
    return { link: request, deduplicated: false };
  }

  forWorkItem(workItemId: string): readonly ExecutionLink[] {
    return (
      this.#database
        .prepare(
          `SELECT work_item_id, native_task_id, idempotency_key, linked_at
           FROM execution_links WHERE work_item_id = ? ORDER BY linked_at`,
        )
        .all(workItemId) as unknown as readonly {
        readonly work_item_id: string;
        readonly native_task_id: string;
        readonly idempotency_key: string;
        readonly linked_at: string;
      }[]
    ).map((row) => ({
      workItemId: row.work_item_id,
      nativeTaskId: row.native_task_id,
      idempotencyKey: row.idempotency_key,
      linkedAt: row.linked_at,
    }));
  }

  close(): void {
    this.#database.close();
  }
}
