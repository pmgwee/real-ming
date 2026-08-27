import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type DashboardServer,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const ceoToken = "dashboard-token-ceo-must-stay-private";
const credentials = [
  {
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    accessToken: ceoToken,
  },
] as const;

describe("RM-08 authenticated CEO dashboard", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const servers: DashboardServer[] = [];
  let clock = "2026-08-27T09:00:00.000Z";

  async function startDashboard(): Promise<{
    harness: RealMingSystemHarness;
    server: DashboardServer;
  }> {
    clock = "2026-08-27T09:00:00.000Z";
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => clock,
    });
    harnesses.push(harness);
    const server = await harness.startDashboard(credentials);
    servers.push(server);
    return { harness, server };
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    idempotencyKey: string,
    workstream?: "Finance" | "MicroSaaS",
  ) {
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey,
      text: `Coordinate ${idempotencyKey}`,
      ...(workstream === undefined ? {} : { workstream }),
      expectedEffect: {
        kind: "record-note",
        value: `Dashboard outcome for ${idempotencyKey}`,
      },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    return acknowledgement.workItem;
  }

  const authorized = { authorization: `Bearer ${ceoToken}` };

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.close();
    }
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it("resolves an authenticated session to the same CEO actor and workspace", async () => {
    const { harness, server } = await startDashboard();
    await captureWorkItem(harness, "telegram:dashboard:identity");

    const response = await fetch(`${server.origin}/api/overview`, {
      headers: authorized,
    });
    const overview = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(overview["actorId"]).toBe("ceo:ming");
    expect(overview["workspaceId"]).toBe("workspace:real-ming");
    expect(harness.workItems()[0]?.actorId).toBe(overview["actorId"]);
  });

  it.each([
    ["no credential", {}],
    ["a wrong bearer token", { authorization: "Bearer not-the-token" }],
    ["an empty bearer token", { authorization: "Bearer " }],
    ["a wrong session cookie", { cookie: "real_ming_session=not-the-token" }],
  ])("refuses %s without leaking operational state", async (_label, headers) => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:private");

    for (const path of ["/", "/api/overview"]) {
      const response = await fetch(`${server.origin}${path}`, {
        headers: headers as Record<string, string>,
      });
      const body = await response.text();

      expect(response.status).toBe(401);
      expect(body).not.toContain(workItem.id);
      expect(body).not.toContain(workItem.intent);
      expect(body).not.toContain(ceoToken);
      expect(JSON.parse(body)).toEqual({ error: "authentication-required" });
    }
  });

  it("refuses an unauthenticated write and performs no state change", async () => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:no-write");

    const response = await fetch(`${server.origin}/api/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workItemId: workItem.id,
        executive: "CTO",
        trustDomain: "Ming Creatives",
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target: {
          type: "pull-request",
          identity: "pmgwee/duitsini#42",
          version: "commit:9f1c2ab",
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(harness.workItem(workItem.id)?.state).toBe("Captured");
    expect(harness.approvals(workItem.id)).toEqual([]);
  });

  it("shows Work Items, Accountable Executives, blockers, Approvals, outcomes and audit", async () => {
    const { harness, server } = await startDashboard();
    const reviewed = await captureWorkItem(
      harness,
      "telegram:dashboard:reviewed",
      "MicroSaaS",
    );
    await harness.executeWorkItem(reviewed.id);

    const gated = await captureWorkItem(
      harness,
      "telegram:dashboard:gated",
      "Finance",
    );
    const decision = await harness.requestAction({
      workItemId: gated.id,
      executive: "Personal CFO",
      trustDomain: "Finance",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "financial-record-change",
      target: {
        type: "duitsini-subscription",
        identity: "subscription:netflix",
        version: "sha256:aaa",
      },
    });
    if (decision.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }

    const overview = await (
      await fetch(`${server.origin}/api/overview`, { headers: authorized })
    ).json();

    expect(overview).toMatchObject({
      workItems: [
        {
          id: reviewed.id,
          state: "Ready for CEO Review",
          accountableExecutive: "CTO",
          workstream: "MicroSaaS",
          blockers: [],
          outcomeReportRevision: 1,
        },
        {
          id: gated.id,
          state: "Awaiting Approval",
          accountableExecutive: "Personal CFO",
          workstream: "Finance",
          blockers: ["Awaiting CEO Approval for financial-record-change"],
          pendingApprovalId: decision.approvalId,
          outcomeReportRevision: null,
        },
      ],
      pendingApprovals: [
        {
          id: decision.approvalId,
          workItemId: gated.id,
          scope: "financial-record-change",
          targetIdentity: "subscription:netflix",
          targetVersion: "sha256:aaa",
          riskClass: "high",
        },
      ],
      outcomeReports: [
        { workItemId: reviewed.id, revision: 1, verificationStatus: "verified" },
      ],
    });

    expect(harness.dashboardOverview({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
    })).toEqual(overview);
  });

  it("matches the underlying operations state exactly", async () => {
    const { harness, server } = await startDashboard();
    const first = await captureWorkItem(harness, "telegram:dashboard:match-1");
    await harness.executeWorkItem(first.id);
    await captureWorkItem(harness, "telegram:dashboard:match-2", "Finance");

    const overview = (await (
      await fetch(`${server.origin}/api/overview`, { headers: authorized })
    ).json()) as {
      workItems: readonly { id: string; state: string }[];
      auditEvents: readonly { sequence: number }[];
    };

    expect(overview.workItems.map((view) => view.id)).toEqual(
      harness.workItems().map((workItem) => workItem.id),
    );
    expect(overview.workItems.map((view) => view.state)).toEqual(
      harness.workItems().map((workItem) => workItem.state),
    );
    expect(overview.auditEvents.map((event) => event.sequence)).toEqual(
      harness
        .workItems()
        .flatMap((workItem) => harness.auditTrail(workItem.id))
        .map((event) => event.sequence)
        .sort((left, right) => left - right),
    );
  });

  it("summarizes Executive Role state without a second work database", async () => {
    const { harness, server } = await startDashboard();
    const cto = await captureWorkItem(harness, "telegram:dashboard:cto", "MicroSaaS");
    await harness.executeWorkItem(cto.id);
    await captureWorkItem(harness, "telegram:dashboard:coo");

    const overview = (await (
      await fetch(`${server.origin}/api/overview`, { headers: authorized })
    ).json()) as {
      executives: readonly {
        executive: string;
        accountableWorkItems: number;
        readyForCeoReview: number;
      }[];
    };

    expect(overview.executives).toEqual([
      { executive: "COO", accountableWorkItems: 1, awaitingApproval: 0, readyForCeoReview: 0 },
      { executive: "CTO", accountableWorkItems: 1, awaitingApproval: 0, readyForCeoReview: 1 },
      { executive: "Personal CFO", accountableWorkItems: 0, awaitingApproval: 0, readyForCeoReview: 0 },
      { executive: "CAO", accountableWorkItems: 0, awaitingApproval: 0, readyForCeoReview: 0 },
      { executive: "CMO", accountableWorkItems: 0, awaitingApproval: 0, readyForCeoReview: 0 },
    ]);
  });

  it("routes a dashboard action through the Policy and Approval Engine", async () => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:policy");

    const decision = (await (
      await fetch(`${server.origin}/api/actions`, {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({
          workItemId: workItem.id,
          executive: "CTO",
          trustDomain: "Ming Creatives",
          operation: "write",
          reversibility: "irreversible",
          riskClass: "high",
          scope: "code-promotion",
          target: {
            type: "pull-request",
            identity: "pmgwee/duitsini#42",
            version: "commit:9f1c2ab",
          },
        }),
      })
    ).json()) as { kind: string; approvalId: string };

    expect(decision.kind).toBe("approval-required");
    expect(harness.workItem(workItem.id)?.state).toBe("Awaiting Approval");
    expect(harness.approval(decision.approvalId)?.state).toBe("requested");
  });

  it("denies a prohibited capability requested from the dashboard", async () => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:prohibited");

    const decision = (await (
      await fetch(`${server.origin}/api/actions`, {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({
          workItemId: workItem.id,
          executive: "Personal CFO",
          trustDomain: "Finance",
          operation: "write",
          reversibility: "irreversible",
          riskClass: "high",
          capability: "money-movement",
          target: {
            type: "bank-transfer",
            identity: "transfer:rm-500",
            version: "sha256:bbb",
          },
        }),
      })
    ).json()) as { kind: string; reason: string };

    expect(decision).toMatchObject({
      kind: "denied",
      reason: "capability-not-grantable",
    });
    expect(harness.approvals(workItem.id)).toEqual([]);
  });

  it("cannot bypass the exact-target rule when granting from the dashboard", async () => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:exact-target");
    const target = {
      type: "pull-request",
      identity: "pmgwee/duitsini#42",
      version: "commit:9f1c2ab",
    };
    const requested = await harness.requestAction({
      workItemId: workItem.id,
      executive: "CTO",
      trustDomain: "Ming Creatives",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target,
    });
    if (requested.kind !== "approval-required") {
      throw new Error("Expected an Approval requirement.");
    }

    await fetch(`${server.origin}/api/approvals`, {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({
        approvalId: requested.approvalId,
        expiresAt: "2026-08-27T21:00:00.000Z",
      }),
    });
    expect(harness.approval(requested.approvalId)?.state).toBe("granted");

    const moved = await harness.requestAction({
      workItemId: workItem.id,
      executive: "CTO",
      trustDomain: "Ming Creatives",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: { ...target, version: "commit:deadbee" },
    });

    expect(moved.kind).toBe("approval-required");
    expect(harness.approval(requested.approvalId)?.state).toBe("invalidated");
  });

  it("cannot bypass the lifecycle rule when reviewing from the dashboard", async () => {
    const { harness, server } = await startDashboard();
    const workItem = await captureWorkItem(harness, "telegram:dashboard:lifecycle");

    const response = await fetch(`${server.origin}/api/reviews`, {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ workItemId: workItem.id, decision: "complete" }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      error: "rejected",
      message:
        "Completion requires verified Review-Ready Work with an Outcome Report.",
    });
    expect(harness.workItem(workItem.id)?.state).toBe("Captured");
  });

  it("never returns a dashboard access token in any response", async () => {
    const { harness, server } = await startDashboard();
    await captureWorkItem(harness, "telegram:dashboard:token-safety");

    for (const path of ["/", "/api/overview"]) {
      const body = await (
        await fetch(`${server.origin}${path}`, { headers: authorized })
      ).text();
      expect(body).not.toContain(ceoToken);
    }
  });

  it("refuses to act on a Work Item outside the authenticated workspace", async () => {
    const { harness, server } = await startDashboard();
    const foreign = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:other-tenant",
      idempotencyKey: "telegram:dashboard:foreign",
      text: "Coordinate foreign work",
      expectedEffect: { kind: "record-note", value: "Foreign outcome" },
    });
    if (foreign.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }

    const overview = (await (
      await fetch(`${server.origin}/api/overview`, { headers: authorized })
    ).json()) as { workItems: readonly unknown[] };
    expect(overview.workItems).toEqual([]);

    const response = await fetch(`${server.origin}/api/actions`, {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({
        workItemId: foreign.workItem.id,
        executive: "CTO",
        trustDomain: "Ming Creatives",
        operation: "write",
        reversibility: "irreversible",
        riskClass: "high",
        scope: "code-promotion",
        target: {
          type: "pull-request",
          identity: "pmgwee/duitsini#42",
          version: "commit:9f1c2ab",
        },
      }),
    });

    expect(response.status).toBe(404);
    expect(harness.workItem(foreign.workItem.id)?.state).toBe("Captured");
    expect(harness.approvals(foreign.workItem.id)).toEqual([]);
  });

  it("does not echo a malformed request body back to the caller", async () => {
    const { server } = await startDashboard();
    const secret = "malformed-body-secret-must-not-echo";

    const response = await fetch(`${server.origin}/api/actions`, {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: `{"workItemId": "${secret}"`,
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain(secret);
    expect(JSON.parse(body)).toEqual({ error: "invalid-request-body" });
  });

  it("rejects an oversized request body before parsing it", async () => {
    const { server } = await startDashboard();

    const response = await fetch(`${server.origin}/api/actions`, {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(200_000) }),
    });

    expect(response.status).toBe(413);
    expect((await response.json()) as unknown).toEqual({
      error: "request-body-too-large",
    });
  });
});
