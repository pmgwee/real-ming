import { afterAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import {
  createRealMingSystemHarness,
  type DashboardServer,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import { dashboardSessionCookie } from "../../src/dashboard/dashboard-server.js";

const ceoToken = "browser-dashboard-token-must-stay-private";
const credentials = [
  {
    actorId: "ceo:ming",
    workspaceId: "workspace:real-ming",
    accessToken: ceoToken,
  },
] as const;

let browser: Browser | undefined;
let launchFailure: string | undefined;

try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  launchFailure = error instanceof Error ? error.message : String(error);
}

afterAll(async () => {
  await browser?.close();
});

describe("RM-08 dashboard browser view", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const servers: DashboardServer[] = [];

  async function seedDashboard(): Promise<{
    harness: RealMingSystemHarness;
    server: DashboardServer;
  }> {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      now: () => "2026-08-27T09:00:00.000Z",
    });
    harnesses.push(harness);
    // Seed both health components, so the rendered-section assertion compares
    // real rows. Without a row the comparison is [] against [], which passes
    // even when the section is deleted from the page.
    harness.recordControlPlaneHealth({
      component: "telegram-ingress",
      outcome: "healthy",
      checkedAt: "2026-08-27T09:00:00.000Z",
    });
    harness.recordControlPlaneHealth({
      component: "daily-scheduler",
      outcome: "failed",
      checkedAt: "2026-08-27T09:00:00.000Z",
    });
    await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:browser",
      status: "unavailable",
      failureClass: "unavailable",
      retryable: true,
      observedAt: "2026-08-27T09:00:00.000Z",
      idempotencyKey: "browser:provider-observation:1",
    });
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
        value: `Browser outcome for ${idempotencyKey}`,
      },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    return acknowledgement.workItem;
  }

  afterAll(async () => {
    for (const server of servers.splice(0)) {
      await server.close();
    }
    for (const harness of harnesses.splice(0)) {
      harness.close();
    }
  });

  it("reports whether a real browser proved this view", () => {
    if (browser === undefined) {
      throw new Error(
        `Chromium did not launch, so the browser view is unproven: ${launchFailure ?? "unknown reason"}`,
      );
    }
    expect(browser.isConnected()).toBe(true);
  });

  it.skipIf(browser === undefined)(
    "renders the same Work Items, executives and audit the operations state holds",
    async () => {
      if (browser === undefined) {
        throw new Error(`Chromium did not launch: ${launchFailure ?? ""}`);
      }

      const { harness, server } = await seedDashboard();
      const reviewed = await captureWorkItem(
        harness,
        "browser:dashboard:reviewed",
        "MicroSaaS",
      );
      await harness.executeWorkItem(reviewed.id);

      const gated = await captureWorkItem(
        harness,
        "browser:dashboard:gated",
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

      const context = await browser.newContext();
      await context.addCookies([
        {
          name: dashboardSessionCookie,
          value: ceoToken,
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      const page = await context.newPage();
      await page.goto(server.origin, { waitUntil: "domcontentloaded" });

      const rendered = await page.evaluate(() => {
        const read = (row: Element, field: string) =>
          row.querySelector(`[data-field="${field}"]`)?.textContent ?? "";

        return {
          actorId:
            document.querySelector('[data-field="actorId"]')?.textContent ?? "",
          workspaceId:
            document.querySelector('[data-field="workspaceId"]')?.textContent ??
            "",
          workItems: [
            ...document.querySelectorAll("#work-items tr[data-work-item-id]"),
          ].map((row) => ({
            id: row.getAttribute("data-work-item-id") ?? "",
            state: read(row, "state"),
            accountableExecutive: read(row, "accountableExecutive"),
            blockers: read(row, "blockers"),
            outcomeReportRevision: read(row, "outcomeReportRevision"),
          })),
          controlPlane: [
            ...document.querySelectorAll(
              "#control-plane-health tr[data-control-plane-component]",
            ),
          ].map((row) => ({
            component: row.getAttribute("data-control-plane-component") ?? "",
            lastOutcome: read(row, "lastOutcome"),
            consecutiveFailures: read(row, "consecutiveFailures"),
          })),
          scheduler: [
            ...document.querySelectorAll("#scheduler-health tr[data-scheduler-job]"),
          ].map((row) => ({
            job: row.getAttribute("data-scheduler-job") ?? "",
            provider: read(row, "provider"),
            criticality: read(row, "criticality"),
             accountableExecutive: read(row, "accountableExecutive"),
             failureStreak: read(row, "failureStreak"),
             failureHistory: read(row, "failureHistory"),
          })),
          providerObservations: [
            ...document.querySelectorAll(
              "#provider-observations tr[data-provider-observation-id]",
            ),
          ].map((row) => ({
            id: row.getAttribute("data-provider-observation-id") ?? "",
            provider: read(row, "provider"),
            sourceReference: read(row, "sourceReference"),
            status: read(row, "status"),
          })),
          approvals: [
            ...document.querySelectorAll(
              "#pending-approvals tr[data-approval-id]",
            ),
          ].map((row) => ({
            id: row.getAttribute("data-approval-id") ?? "",
            scope: read(row, "scope"),
            targetIdentity: read(row, "targetIdentity"),
            targetVersion: read(row, "targetVersion"),
          })),
          executives: [
            ...document.querySelectorAll("#executives tr[data-executive]"),
          ].map((row) => ({
            executive: row.getAttribute("data-executive") ?? "",
            accountableWorkItems: read(row, "accountableWorkItems"),
            readyForCeoReview: read(row, "readyForCeoReview"),
          })),
          auditCount: document.querySelectorAll(
            "#audit-events tr[data-audit-sequence]",
          ).length,
          html: document.documentElement.outerHTML,
        };
      });

      const overview = harness.dashboardOverview({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
      });

      expect(rendered.actorId).toBe(overview.actorId);
      expect(rendered.workspaceId).toBe(overview.workspaceId);
      expect(rendered.workItems).toEqual(
        overview.workItems.map((workItem) => ({
          id: workItem.id,
          state: workItem.state,
          accountableExecutive: workItem.accountableExecutive,
          blockers: workItem.blockers.join("; "),
          outcomeReportRevision: String(workItem.outcomeReportRevision ?? ""),
        })),
      );
      expect(rendered.approvals).toEqual(
        overview.pendingApprovals.map((approval) => ({
          id: approval.id,
          scope: approval.scope,
          targetIdentity: approval.targetIdentity,
          targetVersion: approval.targetVersion,
        })),
      );
      expect(rendered.executives).toEqual(
        overview.executives.map((executive) => ({
          executive: executive.executive,
          accountableWorkItems: String(executive.accountableWorkItems),
          readyForCeoReview: String(executive.readyForCeoReview),
        })),
      );
      // Criterion 4 asks for health visible in the dashboard. The JSON API was
      // proven; the rendered page was not, so the whole section could have been
      // deleted with every test still passing.
      expect(rendered.controlPlane).toEqual(
        overview.controlPlane.map((component) => ({
          component: component.component,
          lastOutcome: component.lastOutcome,
          consecutiveFailures: String(component.consecutiveFailures),
        })),
      );
      expect(rendered.providerObservations).toEqual(
        overview.providerObservations.map((observation) => ({
          id: observation.observationId,
          provider: observation.provider,
          sourceReference: observation.sourceReference,
          status: observation.status,
        })),
      );
      expect(rendered.scheduler).toEqual(
        overview.scheduler.map((job) => ({
          job: job.job,
          provider: job.provider,
          criticality: job.criticality,
           accountableExecutive: job.accountableExecutive,
           failureStreak: String(job.failureStreak),
           failureHistory: job.failureHistory
             .map((failure) => `${failure.occurrenceDate} (${failure.evidenceLink})`)
             .join(", "),
        })),
      );
      expect(rendered.auditCount).toBe(overview.auditEvents.length);
      expect(rendered.html).not.toContain(ceoToken);

      await context.close();
    },
    30_000,
  );

  it.skipIf(browser === undefined)(
    "shows no private operational state to an unauthenticated browser",
    async () => {
      if (browser === undefined) {
        throw new Error(`Chromium did not launch: ${launchFailure ?? ""}`);
      }

      const { harness, server } = await seedDashboard();
      const workItem = await captureWorkItem(
        harness,
        "browser:dashboard:unauthenticated",
      );

      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(server.origin, {
        waitUntil: "domcontentloaded",
      });

      expect(response?.status()).toBe(401);
      const body = await page.content();
      expect(body).not.toContain(workItem.id);
      expect(body).not.toContain(workItem.intent);
      expect(body).toContain("authentication-required");

      await context.close();
    },
    30_000,
  );
});
