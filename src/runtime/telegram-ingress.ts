import type { TelegramIngressResult, TelegramUpdate } from "../telegram/contracts.js";

export interface TelegramPollResult {
  readonly processed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cursor: number;
}

/**
 * Hand one batch of polled updates to the front door, in order, advancing the
 * durable cursor only behind work that actually finished.
 *
 * Two rules carry the restart guarantee:
 *
 * - anything at or below the cursor has already been handled, so it is skipped
 *   rather than replayed. Telegram resends until the offset moves, so without
 *   this every restart would re-run the CEO's last instructions;
 * - a failure stops the batch and leaves the cursor behind the failed update.
 *   Skipping past it would drop a CEO instruction silently, which is worse than
 *   handling it late: Telegram only redelivers while the offset stays put.
 */
export async function pollTelegramUpdates(options: {
  readonly updates: readonly TelegramUpdate[];
  readonly cursor: () => number;
  readonly advance: (updateId: number) => void;
  readonly receive: (update: TelegramUpdate) => Promise<TelegramIngressResult>;
}): Promise<TelegramPollResult> {
  let cursor = options.cursor();
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  // Telegram does not guarantee ordering within a batch, and the cursor is only
  // meaningful against an ascending sequence.
  const ordered = [...options.updates].sort((a, b) => a.updateId - b.updateId);

  for (const update of ordered) {
    if (update.updateId <= cursor) {
      skipped += 1;
      continue;
    }
    try {
      await options.receive(update);
    } catch {
      failed += 1;
      break;
    }
    options.advance(update.updateId);
    cursor = update.updateId;
    processed += 1;
  }

  return { processed, skipped, failed, cursor };
}
