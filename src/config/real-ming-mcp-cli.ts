import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  executionLinkStatePath,
  SqliteExecutionLinkStore,
} from "../integration/execution-link.js";
import { serveMcpOverStdio } from "../integration/mcp-stdio.js";
import { createNativeCronReportClient } from "../integration/native-cron-client.js";
import { createRealMingTools } from "../integration/real-ming-tools.js";
import { OperationsState } from "../operations/operations-state.js";

/**
 * The Real-Ming extension as an MCP server, which is how native Hermes reaches
 * it under Architecture Revision 6.
 *
 * It opens the operations state read-only in spirit: the only write it performs
 * is an append-only execution link. Everything else Hermes needs, it already
 * does better itself.
 */
function main(): void {
  const statePath =
    process.env["REAL_MING_STATE_PATH"]?.trim() ||
    join(process.cwd(), "var", "state.sqlite");
  mkdirSync(dirname(statePath), { recursive: true });

  const state = new OperationsState(statePath);
  const links = new SqliteExecutionLinkStore(executionLinkStatePath(statePath));

  const close = (): void => {
    try {
      links.close();
    } finally {
      state.close();
    }
  };
  process.once("SIGINT", () => {
    close();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    close();
    process.exit(0);
  });
  // Hermes closes the pipe when it shuts the server down. Exiting on that keeps
  // no orphan holding the SQLite file open.
  process.stdin.once("end", () => {
    close();
    process.exit(0);
  });

  const nativeCronEnabled =
    (process.env["REAL_MING_NATIVE_CRON_ENABLED"] ?? "").trim().toLowerCase() ===
    "true";
  const bridgeKey =
    process.env["REAL_MING_HERMES_API_KEY"]?.trim() ??
    process.env["API_SERVER_KEY"]?.trim();
  const scheduledReports =
    nativeCronEnabled && bridgeKey !== undefined && bridgeKey.length > 0
      ? createNativeCronReportClient({
          endpoint:
            process.env["REAL_MING_NATIVE_CRON_ENDPOINT"]?.trim() ||
            "http://127.0.0.1:8787/internal/native-cron/run",
          apiKey: bridgeKey,
        })
      : undefined;

  serveMcpOverStdio({
    tools: createRealMingTools({
      workItems: () => state.workItems(),
      workItem: (id) => state.workItem(id),
      links,
      now: () => new Date().toISOString(),
      ...(scheduledReports === undefined ? {} : { scheduledReports }),
    }),
    input: process.stdin,
    output: process.stdout,
  });
}

main();
