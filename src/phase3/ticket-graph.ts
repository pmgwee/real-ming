export type TriageLabel = "ready-for-agent" | "ready-for-human";

export type IssueLifecycleState = "open" | "closed";

export type TicketStatus =
  | "completed"
  | "ready-for-agent"
  | "ready-for-human"
  | "blocked";

export interface TicketNode {
  readonly id: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly state: IssueLifecycleState;
  readonly triageLabel: TriageLabel;
  readonly blockedBy: readonly string[];
  readonly url: string;
}

export interface TicketGraph {
  readonly repository: string;
  readonly architectureDecision: string;
  readonly nodes: readonly TicketNode[];
}

export interface LiveIssueState {
  readonly issueNumber: number;
  readonly state: IssueLifecycleState;
  readonly triageLabel?: TriageLabel | undefined;
}

export interface ClassifiedTicket {
  readonly id: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly triageLabel: TriageLabel;
  readonly status: TicketStatus;
  readonly openBlockers: readonly string[];
  readonly humanGates: readonly string[];
  readonly url: string;
}

export interface GraphStatus {
  readonly repository: string;
  readonly tickets: readonly ClassifiedTicket[];
  readonly nextTicket: ClassifiedTicket | undefined;
  readonly onlyHumanWorkRemains: boolean;
}

export interface ReadOnlyGithubCommand {
  readonly command: string;
  readonly args: readonly string[];
}

const triageLabels: readonly string[] = ["ready-for-agent", "ready-for-human"];

const ticketIdPattern = /^RM-\d{2}$/;

function asRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${description} is not a non-empty string.`);
  }
  return value;
}

function asIssueNumber(value: unknown, description: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${description} is not a positive issue number.`);
  }
  return value;
}

function asLifecycleState(
  value: unknown,
  description: string,
): IssueLifecycleState {
  if (value !== "open" && value !== "closed") {
    throw new Error(`${description} is not an open or closed state.`);
  }
  return value;
}

function parseTicketNode(source: unknown, index: number): {
  readonly node: TicketNode;
  readonly blockedBy: readonly { readonly id: string; readonly issueNumber: number }[];
} {
  const record = asRecord(source, `Ticket at position ${index}`);
  const id = asString(record["id"], `Ticket identity at position ${index}`);
  if (!ticketIdPattern.test(id)) {
    throw new Error(`Ticket identity ${id} does not use the RM-nn form.`);
  }

  const triageLabel = asString(record["triageLabel"], `Ticket ${id} triage label`);
  if (!triageLabels.includes(triageLabel)) {
    throw new Error(`Ticket ${id} has unsupported triage label ${triageLabel}.`);
  }

  const rawBlockedBy = record["blockedBy"];
  if (!Array.isArray(rawBlockedBy)) {
    throw new Error(`Ticket ${id} does not declare a blockedBy list.`);
  }

  const blockedBy = rawBlockedBy.map((entry, edgeIndex) => {
    const edge = asRecord(entry, `Ticket ${id} blocking edge ${edgeIndex}`);
    return {
      id: asString(edge["id"], `Ticket ${id} blocking edge ${edgeIndex} identity`),
      issueNumber: asIssueNumber(
        edge["issueNumber"],
        `Ticket ${id} blocking edge ${edgeIndex} issue number`,
      ),
    };
  });

  return {
    node: {
      id,
      issueNumber: asIssueNumber(record["issueNumber"], `Ticket ${id} issue number`),
      title: asString(record["title"], `Ticket ${id} title`),
      state: asLifecycleState(record["state"], `Ticket ${id} state`),
      triageLabel: triageLabel as TriageLabel,
      blockedBy: blockedBy.map((edge) => edge.id),
      url: asString(record["url"], `Ticket ${id} url`),
    },
    blockedBy,
  };
}

function assertAcyclic(nodes: readonly TicketNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const settled = new Set<string>();
  const active = new Set<string>();

  const walk = (id: string, trail: readonly string[]): void => {
    if (settled.has(id)) {
      return;
    }
    if (active.has(id)) {
      const start = trail.indexOf(id);
      const cycle = [...trail.slice(start), id];
      throw new Error(
        `Ticket graph contains a dependency cycle: ${cycle.join(" -> ")}.`,
      );
    }

    active.add(id);
    for (const blocker of byId.get(id)?.blockedBy ?? []) {
      walk(blocker, [...trail, id]);
    }
    active.delete(id);
    settled.add(id);
  };

  for (const node of nodes) {
    walk(node.id, []);
  }
}

export function parseTicketGraph(source: unknown): TicketGraph {
  const record = asRecord(source, "Ticket graph");
  const rawTickets = record["tickets"];
  if (!Array.isArray(rawTickets)) {
    throw new Error("Ticket graph does not declare a tickets list.");
  }

  const parsed = rawTickets.map(parseTicketNode);
  const nodes = parsed.map((entry) => entry.node);

  const declaredCount = asIssueNumber(
    record["ticketCount"],
    "Ticket graph ticket count",
  );
  if (declaredCount !== nodes.length) {
    throw new Error(
      `Ticket graph declares ${declaredCount} tickets but contains ${nodes.length}.`,
    );
  }

  const byId = new Map<string, TicketNode>();
  const byIssueNumber = new Map<number, string>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new Error(`Ticket ${node.id} is declared more than once.`);
    }
    const owner = byIssueNumber.get(node.issueNumber);
    if (owner !== undefined) {
      throw new Error(
        `Issue number ${node.issueNumber} is declared by more than one ticket.`,
      );
    }
    byId.set(node.id, node);
    byIssueNumber.set(node.issueNumber, node.id);
  }

  for (const entry of parsed) {
    for (const edge of entry.blockedBy) {
      const blocker = byId.get(edge.id);
      if (blocker === undefined) {
        throw new Error(
          `Ticket ${entry.node.id} is blocked by unknown ticket ${edge.id}.`,
        );
      }
      if (blocker.issueNumber !== edge.issueNumber) {
        throw new Error(
          `Ticket ${entry.node.id} is blocked by ${edge.id} with issue number ${edge.issueNumber} instead of ${blocker.issueNumber}.`,
        );
      }
    }
  }

  assertAcyclic(nodes);

  return {
    repository: asString(record["repository"], "Ticket graph repository"),
    architectureDecision: asString(
      record["architectureDecision"],
      "Ticket graph architecture decision",
    ),
    nodes,
  };
}

export function classifyTicketGraph(
  graph: TicketGraph,
  liveIssues: readonly LiveIssueState[],
): GraphStatus {
  const liveByIssueNumber = new Map(
    liveIssues.map((issue) => [issue.issueNumber, issue]),
  );

  const effective = new Map<
    string,
    { readonly state: IssueLifecycleState; readonly triageLabel: TriageLabel }
  >();
  for (const node of graph.nodes) {
    const live = liveByIssueNumber.get(node.issueNumber);
    effective.set(node.id, {
      state: live?.state ?? node.state,
      triageLabel: live?.triageLabel ?? node.triageLabel,
    });
  }

  const statusOf = (node: TicketNode): TicketStatus => {
    const current = effective.get(node.id);
    if (current === undefined || current.state === "closed") {
      return "completed";
    }
    if (current.triageLabel === "ready-for-human") {
      return "ready-for-human";
    }
    return node.blockedBy.some(
      (blocker) => effective.get(blocker)?.state !== "closed",
    )
      ? "blocked"
      : "ready-for-agent";
  };

  const statuses = new Map(
    graph.nodes.map((node) => [node.id, statusOf(node)] as const),
  );
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  const humanGateCache = new Map<string, readonly string[]>();
  const humanGatesFor = (id: string): readonly string[] => {
    const cached = humanGateCache.get(id);
    if (cached !== undefined) {
      return cached;
    }

    const gates = new Set<string>();
    if (statuses.get(id) === "ready-for-human") {
      gates.add(id);
    }
    for (const blocker of byId.get(id)?.blockedBy ?? []) {
      if (statuses.get(blocker) === "completed") {
        continue;
      }
      for (const gate of humanGatesFor(blocker)) {
        gates.add(gate);
      }
    }

    const resolved = [...gates].sort();
    humanGateCache.set(id, resolved);
    return resolved;
  };

  const tickets = graph.nodes.map((node) => ({
    id: node.id,
    issueNumber: node.issueNumber,
    title: node.title,
    triageLabel: effective.get(node.id)?.triageLabel ?? node.triageLabel,
    status: statuses.get(node.id) ?? "blocked",
    openBlockers: node.blockedBy.filter(
      (blocker) => statuses.get(blocker) !== "completed",
    ),
    humanGates:
      statuses.get(node.id) === "completed" ? [] : humanGatesFor(node.id),
    url: node.url,
  }));

  const nextTicket = tickets
    .filter((entry) => entry.status === "ready-for-agent")
    .sort((left, right) => left.issueNumber - right.issueNumber)[0];

  return {
    repository: graph.repository,
    tickets,
    nextTicket,
    onlyHumanWorkRemains:
      nextTicket === undefined &&
      tickets.some((entry) => entry.status !== "completed"),
  };
}

export function renderGraphStatus(status: GraphStatus): string {
  const counts = new Map<TicketStatus, number>();
  for (const ticket of status.tickets) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
  }

  const lines = [
    `Phase 3 graph status for ${status.repository}`,
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, count]) => `${label}: ${count}`)
      .join(" | "),
    "",
  ];

  for (const ticket of status.tickets) {
    const detail =
      ticket.openBlockers.length > 0
        ? ` blocked by ${ticket.openBlockers.join(", ")}`
        : "";
    const gates =
      ticket.status !== "completed" && ticket.humanGates.length > 0
        ? ` human gate ${ticket.humanGates.join(", ")}`
        : "";
    lines.push(
      `${ticket.id} #${ticket.issueNumber} ${ticket.status}${detail}${gates} ${ticket.title}`,
    );
  }

  lines.push("");

  if (status.nextTicket !== undefined) {
    lines.push(
      `next: ${status.nextTicket.id} (#${status.nextTicket.issueNumber}) ${status.nextTicket.title}`,
    );
    return lines.join("\n");
  }

  if (!status.onlyHumanWorkRemains) {
    lines.push("next: none, every ticket is completed");
    return lines.join("\n");
  }

  lines.push("next: none, only human-gated work remains");
  lines.push("");
  lines.push("BLOCKED ON YOU. Open CEO-Office/README.md for what to do next.");

  for (const gate of status.tickets.filter(
    (ticket) => ticket.status === "ready-for-human",
  )) {
    const blocked = status.tickets.filter(
      (ticket) =>
        ticket.status !== "completed" && ticket.humanGates.includes(gate.id),
    ).length;
    lines.push(
      `  ${gate.id} (#${gate.issueNumber}) unblocks ${blocked} ticket${blocked === 1 ? "" : "s"} - ${gate.title}`,
    );
  }

  lines.push("");
  lines.push("Resume afterwards with the prompt in docs/agents/RESUME-PROMPT.md.");

  return lines.join("\n");
}

export function liveIssueStateCommand(
  repository: string,
): ReadOnlyGithubCommand {
  return {
    command: "gh",
    args: [
      "issue",
      "list",
      "--repo",
      repository,
      "--state",
      "all",
      "--limit",
      "200",
      "--json",
      "number,state,labels",
    ],
  };
}

export function parseLiveIssueStates(source: unknown): LiveIssueState[] {
  if (!Array.isArray(source)) {
    throw new Error("Live issue state is not a list.");
  }

  return source.map((entry, index) => {
    const record = asRecord(entry, `Live issue at position ${index}`);
    const labels = Array.isArray(record["labels"]) ? record["labels"] : [];
    const triageLabel = labels
      .map((label) =>
        typeof label === "object" && label !== null
          ? (label as Record<string, unknown>)["name"]
          : undefined,
      )
      .find(
        (name): name is TriageLabel =>
          typeof name === "string" && triageLabels.includes(name),
      );

    return {
      issueNumber: asIssueNumber(
        record["number"],
        `Live issue at position ${index} number`,
      ),
      state: asLifecycleState(
        String(record["state"]).toLowerCase(),
        `Live issue at position ${index} state`,
      ),
      triageLabel,
    };
  });
}
