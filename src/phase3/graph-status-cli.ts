import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  classifyTicketGraph,
  liveIssueStateCommand,
  parseLiveIssueStates,
  parseTicketGraph,
  renderGraphStatus,
  type LiveIssueState,
} from "./ticket-graph.js";

const ticketGraphUrl = new URL(
  "../../real-ming-phase3-tickets.json",
  import.meta.url,
);

function readLiveIssueStates(repository: string): LiveIssueState[] {
  const { command, args } = liveIssueStateCommand(repository);
  const output = execFileSync(command, [...args], {
    encoding: "utf8",
    shell: false,
  });
  return parseLiveIssueStates(JSON.parse(output));
}

function main(argv: readonly string[]): number {
  const offline = argv.includes("--offline");
  const asJson = argv.includes("--json");

  const graph = parseTicketGraph(
    JSON.parse(readFileSync(ticketGraphUrl, "utf8")),
  );
  const liveIssues = offline ? [] : readLiveIssueStates(graph.repository);
  const status = classifyTicketGraph(graph, liveIssues);

  process.stdout.write(
    asJson
      ? `${JSON.stringify(status, null, 2)}\n`
      : `${renderGraphStatus(status)}\n`,
  );

  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
