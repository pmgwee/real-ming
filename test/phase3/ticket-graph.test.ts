import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyTicketGraph,
  liveIssueStateCommand,
  parseTicketGraph,
  renderGraphStatus,
  type LiveIssueState,
  type TicketGraph,
} from "../../src/phase3/ticket-graph.js";

const repositoryGraphSource = JSON.parse(
  readFileSync(
    new URL("../../real-ming-phase3-tickets.json", import.meta.url),
    "utf8",
  ),
) as unknown;

function graphSource(
  tickets: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    schemaVersion: "2.0",
    phase: "Phase 3 tracer-bullet decomposition",
    repository: "pmgwee/real-ming",
    parentSpecIssue: 1,
    ticketCount: tickets.length,
    architectureDecision: "Real-Ming v1.1",
    tickets,
  };
}

function ticket(
  id: string,
  issueNumber: number,
  blockedBy: readonly { id: string; issueNumber: number }[] = [],
  triageLabel = "ready-for-agent",
): Record<string, unknown> {
  return {
    id,
    issueNumber,
    title: `Ticket ${id}`,
    state: "open",
    triageLabel,
    blockedBy,
    url: `https://github.com/pmgwee/real-ming/issues/${issueNumber}`,
  };
}

describe("Phase 3 ticket graph validation", () => {
  it("parses the repository ticket graph and resolves every blocking edge", () => {
    const graph = parseTicketGraph(repositoryGraphSource);

    expect(graph.repository).toBe("pmgwee/real-ming");
    expect(graph.nodes).toHaveLength(44);

    const identities = new Set(graph.nodes.map((node) => node.id));
    for (const node of graph.nodes) {
      for (const blocker of node.blockedBy) {
        expect(identities.has(blocker)).toBe(true);
      }
    }
  });

  it("rejects a blocking edge that references a missing ticket", () => {
    expect(() =>
      parseTicketGraph(
        graphSource([ticket("RM-01", 2, [{ id: "RM-99", issueNumber: 99 }])]),
      ),
    ).toThrow("Ticket RM-01 is blocked by unknown ticket RM-99.");
  });

  it("rejects a blocking edge whose ticket identity and issue number disagree", () => {
    expect(() =>
      parseTicketGraph(
        graphSource([
          ticket("RM-01", 2),
          ticket("RM-02", 3, [{ id: "RM-01", issueNumber: 7 }]),
        ]),
      ),
    ).toThrow(
      "Ticket RM-02 is blocked by RM-01 with issue number 7 instead of 2.",
    );
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      parseTicketGraph(
        graphSource([
          ticket("RM-01", 2, [{ id: "RM-03", issueNumber: 4 }]),
          ticket("RM-02", 3, [{ id: "RM-01", issueNumber: 2 }]),
          ticket("RM-03", 4, [{ id: "RM-02", issueNumber: 3 }]),
        ]),
      ),
    ).toThrow("Ticket graph contains a dependency cycle: RM-01 -> RM-03 -> RM-02 -> RM-01.");
  });

  it("rejects a ticket that blocks itself", () => {
    expect(() =>
      parseTicketGraph(
        graphSource([ticket("RM-01", 2, [{ id: "RM-01", issueNumber: 2 }])]),
      ),
    ).toThrow("Ticket graph contains a dependency cycle: RM-01 -> RM-01.");
  });

  it("rejects duplicate ticket identities and duplicate issue numbers", () => {
    expect(() =>
      parseTicketGraph(graphSource([ticket("RM-01", 2), ticket("RM-01", 3)])),
    ).toThrow("Ticket RM-01 is declared more than once.");

    expect(() =>
      parseTicketGraph(graphSource([ticket("RM-01", 2), ticket("RM-02", 2)])),
    ).toThrow("Issue number 2 is declared by more than one ticket.");
  });

  it("rejects a declared ticket count that does not match the tickets", () => {
    const source = graphSource([ticket("RM-01", 2)]);
    source.ticketCount = 44;

    expect(() => parseTicketGraph(source)).toThrow(
      "Ticket graph declares 44 tickets but contains 1.",
    );
  });

  it("rejects an unknown triage label", () => {
    expect(() =>
      parseTicketGraph(graphSource([ticket("RM-01", 2, [], "needs-triage")])),
    ).toThrow("Ticket RM-01 has unsupported triage label needs-triage.");
  });
});

describe("Phase 3 graph status", () => {
  const graph: TicketGraph = parseTicketGraph(
    graphSource([
      ticket("RM-01", 2),
      ticket("RM-02", 3, [{ id: "RM-01", issueNumber: 2 }]),
      ticket("RM-03", 4, [{ id: "RM-02", issueNumber: 3 }]),
      ticket("RM-04", 5, [], "ready-for-human"),
      ticket("RM-05", 6, [{ id: "RM-04", issueNumber: 5 }]),
    ]),
  );

  function statusOf(
    live: readonly LiveIssueState[],
    id: string,
  ): ReturnType<typeof classifyTicketGraph>["tickets"][number] {
    const found = classifyTicketGraph(graph, live).tickets.find(
      (candidate) => candidate.id === id,
    );
    if (found === undefined) {
      throw new Error(`Ticket ${id} was not classified.`);
    }
    return found;
  }

  it("lets live GitHub state override stale local ticket state", () => {
    const status = classifyTicketGraph(graph, [
      { issueNumber: 2, state: "closed" },
    ]);

    expect(statusOf([{ issueNumber: 2, state: "closed" }], "RM-01").status).toBe(
      "completed",
    );
    expect(status.tickets.map((entry) => entry.status)).toEqual([
      "completed",
      "ready-for-agent",
      "blocked",
      "ready-for-human",
      "blocked",
    ]);
  });

  it("lists the exact open blockers for every unavailable ticket", () => {
    const live: readonly LiveIssueState[] = [
      { issueNumber: 2, state: "closed" },
    ];

    expect(statusOf(live, "RM-03").openBlockers).toEqual(["RM-02"]);
    expect(statusOf(live, "RM-02").openBlockers).toEqual([]);
    expect(statusOf(live, "RM-05").openBlockers).toEqual(["RM-04"]);
  });

  it("reports the human gates that transitively block a ticket", () => {
    const live: readonly LiveIssueState[] = [
      { issueNumber: 2, state: "closed" },
      { issueNumber: 3, state: "closed" },
      { issueNumber: 4, state: "closed" },
    ];

    expect(statusOf(live, "RM-05").humanGates).toEqual(["RM-04"]);
    expect(statusOf(live, "RM-04").humanGates).toEqual(["RM-04"]);
  });

  it("keeps a ready-for-human ticket out of agent selection even when unblocked", () => {
    const status = classifyTicketGraph(graph, []);

    expect(statusOf([], "RM-04").status).toBe("ready-for-human");
    expect(status.nextTicket?.id).toBe("RM-01");
  });

  it("selects the lowest open ready-for-agent issue whose blockers are closed", () => {
    const status = classifyTicketGraph(graph, [
      { issueNumber: 2, state: "closed" },
      { issueNumber: 3, state: "closed" },
    ]);

    expect(status.nextTicket?.id).toBe("RM-03");
    expect(status.onlyHumanWorkRemains).toBe(false);
  });

  it("reports when only human-gated work remains", () => {
    const status = classifyTicketGraph(graph, [
      { issueNumber: 2, state: "closed" },
      { issueNumber: 3, state: "closed" },
      { issueNumber: 4, state: "closed" },
    ]);

    expect(status.nextTicket).toBeUndefined();
    expect(status.onlyHumanWorkRemains).toBe(true);
    expect(
      status.tickets
        .filter((entry) => entry.status !== "completed")
        .map((entry) => entry.id),
    ).toEqual(["RM-04", "RM-05"]);
  });

  it("does not report remaining human work once every ticket is completed", () => {
    const status = classifyTicketGraph(
      graph,
      [2, 3, 4, 5, 6].map((issueNumber) => ({
        issueNumber,
        state: "closed" as const,
      })),
    );

    expect(status.nextTicket).toBeUndefined();
    expect(status.onlyHumanWorkRemains).toBe(false);
    expect(status.tickets.every((entry) => entry.status === "completed")).toBe(
      true,
    );
  });

  it("lets a live triage label override a stale local label", () => {
    const status = classifyTicketGraph(graph, [
      { issueNumber: 2, state: "open", triageLabel: "ready-for-human" },
    ]);

    expect(status.tickets[0]?.status).toBe("ready-for-human");
    expect(status.nextTicket).toBeUndefined();
    expect(status.onlyHumanWorkRemains).toBe(true);
    expect(status.tickets[1]?.humanGates).toEqual(["RM-01"]);
  });

  it("renders a readable status report", () => {
    const rendered = renderGraphStatus(
      classifyTicketGraph(graph, [{ issueNumber: 2, state: "closed" }]),
    );

    expect(rendered).toContain("pmgwee/real-ming");
    expect(rendered).toContain("RM-02");
    expect(rendered).toContain("next: RM-02 (#3)");
    expect(rendered).toContain("blocked by RM-02");
  });
});

describe("Phase 3 live issue reconciliation", () => {
  it("reads live issue state with a read-only GitHub command", () => {
    const command = liveIssueStateCommand("pmgwee/real-ming");

    expect(command.command).toBe("gh");
    expect(command.args).toEqual([
      "issue",
      "list",
      "--repo",
      "pmgwee/real-ming",
      "--state",
      "all",
      "--limit",
      "200",
      "--json",
      "number,state,labels",
    ]);
    for (const mutation of [
      "close",
      "reopen",
      "edit",
      "create",
      "comment",
      "delete",
      "--add-label",
      "--remove-label",
    ]) {
      expect(command.args).not.toContain(mutation);
    }
  });
});
