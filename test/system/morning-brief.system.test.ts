import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CalendarEvent } from "../../src/providers/google-calendar-adapter.js";
import { morningBriefOccurrence } from "../../src/operations/morning-brief.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const calendarId = "ming@example.invalid";
const eventId = "event-supervisor-meeting";
const sourceReference = `google-calendar:${calendarId}:${eventId}`;

// 2026-08-29T02:00Z is 10:00 on 29 August in Asia/Kuala_Lumpur, so it belongs
// to the same brief occurrence as the 07:30 run.
const event: CalendarEvent = {
  id: eventId,
  calendarId,
  title: "Research paper supervisor meeting",
  start: "2026-08-29T02:00:00.000Z",
  end: "2026-08-29T03:00:00.000Z",
  allDay: false,
  status: "confirmed",
  updatedAt: "2026-08-29T00:00:00.000Z",
  sourceReference,
};

const now = "2026-08-29T09:00:00.000Z";

describe("RM-13 07:30 Morning Brief", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(
    options: {
      readonly calendarFailure?: "unavailable" | "authentication-failed";
      readonly calendarAsOf?: string;
      readonly events?: readonly CalendarEvent[];
      readonly executionError?: string;
      readonly clock?: () => string;
    } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm13-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: options.clock ?? (() => now),
      telegram: { ceoTelegramId: "100000001" },
      calendar: {
        events: options.events ?? [event],
        ...(options.calendarFailure === undefined
          ? {}
          : { failure: options.calendarFailure }),
        ...(options.calendarAsOf === undefined
          ? {}
          : { asOf: options.calendarAsOf }),
      },
      morningBrief: { calendarId },
      ...(options.executionError === undefined
        ? {}
        : { controlledWorker: { executionError: options.executionError } }),
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    idempotencyKey: string,
    intent: string,
  ) {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey,
      intent,
      expectedEffect: { kind: "calendar-commitment", value: sourceReference },
      workstream: "Academic",
    });
    return acknowledgement.workItem;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("anchors the occurrence to 07:30 Asia/Kuala_Lumpur", () => {
    expect(morningBriefOccurrence(now)).toEqual({
      occurrenceDate: "2026-08-29",
      scheduledAt: "2026-08-28T23:30:00.000Z",
      idempotencyKey: "morning-brief:2026-08-29",
    });

    // A run just after midnight in Kuala Lumpur still belongs to that day's
    // brief, not the previous one.
    expect(morningBriefOccurrence("2026-08-29T16:30:00.000Z")).toMatchObject({
      occurrenceDate: "2026-08-30",
    });
  });

  it("reconciles calendar and Master Tasks and delivers the brief once", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:supervisor-meeting",
      "Attend the research paper supervisor meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: event.start,
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const result = await harness.runMorningBrief();

    expect(result.brief.occurrenceDate).toBe("2026-08-29");
    expect(result.brief.idempotencyKey).toBe("morning-brief:2026-08-29");
    expect(result.delivery.kind).toBe("sent");
    expect(
      result.brief.sources.map((source) => `${source.source}:${source.health}`),
    ).toEqual(["google-calendar:current", "work-items:current"]);
    expect(
      result.brief.scheduledCommitments.map((entry) => entry.evidence),
    ).toContain(sourceReference);
    expect(harness.telegramMessages()).toHaveLength(1);
    expect(harness.telegramMessages()[0]?.text).toContain("Morning Brief");
    expect(
      harness.telegramAuditTrail().some(
        (entry) => entry.type === "telegram.notification-sent",
      ),
    ).toBe(true);
  });

  it("labels an unavailable calendar rather than reporting an empty day", async () => {
    const harness = startHarness({ calendarFailure: "unavailable" });

    const result = await harness.runMorningBrief();

    const calendar = result.brief.sources.find(
      (source) => source.source === "google-calendar",
    );
    expect(calendar?.health).toBe("unavailable");
    // The one thing the brief must never do is read like a clear day. Assert
    // against strings the renderer actually emits, not ones it never could.
    expect(result.brief.text).toMatch(/Source health:/);
    expect(result.brief.text).toMatch(/Google Calendar is unavailable/);
    expect(result.delivery.kind).toBe("sent");
  });

  it("never renders a calendar-backed section as empty when the calendar failed", async () => {
    // "Scheduled today: none" and "Conflicts: none" are indistinguishable from
    // a genuinely clear day. When the calendar could not be read, those
    // sections are unknown, not empty.
    const harness = startHarness({ calendarFailure: "unavailable" });

    const result = await harness.runMorningBrief();

    expect(result.brief.text).not.toMatch(/Scheduled today: none/);
    expect(result.brief.text).not.toMatch(/Conflicts: none/);
    expect(result.brief.text).toMatch(/Scheduled today: unknown/);
    expect(result.brief.text).toMatch(/Conflicts: unknown/);

    // A calendar that answered and held nothing is a different, honest answer.
    const clear = await startHarness({ events: [] }).runMorningBrief();
    expect(clear.brief.text).toMatch(/Scheduled today: none/);
    expect(clear.brief.text).toMatch(/Conflicts: none/);
  });

  it("labels stale calendar data instead of presenting it as current", async () => {
    const harness = startHarness({ calendarAsOf: "2026-08-20T00:00:00.000Z" });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.sources.find((source) => source.source === "google-calendar")
        ?.health,
    ).toBe("stale");
    expect(result.brief.text).toMatch(/stale/i);
  });

  it("separates confirmed commitments from explicitly labelled proposals", async () => {
    const harness = startHarness();
    const confirmed = await captureWorkItem(
      harness,
      "rm13:confirmed",
      "Attend the supervisor meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: confirmed.id,
      value: event.start,
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });
    const proposed = await captureWorkItem(
      harness,
      "rm13:proposed",
      "Draft the research outline",
    );
    await harness.recordWorkItemCommitment({
      workItemId: proposed.id,
      value: event.start,
      actor: { kind: "Executive Role", executive: "CAO" },
    });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.scheduledCommitments.map((entry) => entry.workItemId),
    ).toContain(confirmed.id);
    expect(
      result.brief.scheduledCommitments.map((entry) => entry.workItemId),
    ).not.toContain(proposed.id);
    expect(
      result.brief.proposedCommitments.map((entry) => entry.workItemId),
    ).toEqual([proposed.id]);
    expect(result.brief.text).toMatch(/proposed/i);
  });

  it("surfaces blocked Work Items, pending Approvals and incidents", async () => {
    const harness = startHarness({
      executionError: "Controlled worker failure",
    });
    const blocked = await captureWorkItem(
      harness,
      "rm13:blocked",
      "Clear the blocked application",
    );
    await expect(harness.executeWorkItem(blocked.id)).rejects.toThrow();
    const awaiting = await captureWorkItem(
      harness,
      "rm13:approval",
      "Promote the verified candidate",
    );
    const decision = await harness.requestAction({
      workItemId: awaiting.id,
      executive: "CAO",
      trustDomain: "Academic",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      scope: "code-promotion",
      target: { type: "commit", identity: "abc123", version: "1" },
    });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.overdueOrBlocked.map((entry) => entry.workItemId),
    ).toContain(blocked.id);
    if (decision.kind !== "approval-required") throw new Error("expected approval");
    expect(
      result.brief.pendingApprovals.map((entry) => entry.evidence),
    ).toContain(decision.approvalId);
    expect(result.brief.incidents.length).toBeGreaterThan(0);
    expect(
      result.brief.incidents.every((entry) => entry.evidence.length > 0),
    ).toBe(true);
  });

  it("reports only today's incidents, not every failure ever recorded", async () => {
    // The brief is a Telegram message. Replaying the whole audit trail every
    // morning would grow it without bound and bury today's exceptions.
    let clock = now;
    const harness = startHarness({
      executionError: "Controlled worker failure",
      clock: () => clock,
    });
    const failed = await captureWorkItem(
      harness,
      "rm13:yesterday-incident",
      "Yesterday's failing work",
    );
    await expect(harness.executeWorkItem(failed.id)).rejects.toThrow();
    expect((await harness.runMorningBrief()).brief.incidents.length).toBeGreaterThan(0);

    clock = "2026-08-30T09:00:00.000Z";

    const tomorrow = await harness.runMorningBrief();
    expect(tomorrow.brief.occurrenceDate).toBe("2026-08-30");
    expect(tomorrow.brief.incidents).toEqual([]);
  });

  it("reports an unreadable commitment date instead of dropping the Work Item", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:unreadable",
      "Work with a corrupt date",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "sometime next week",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.incidents.map((entry) => entry.workItemId),
    ).toContain(workItem.id);
    expect(result.brief.text).toMatch(/unreadable/i);
  });

  it("lists a Work Item that is both overdue and blocked exactly once", async () => {
    const harness = startHarness({
      executionError: "Controlled worker failure",
    });
    const workItem = await captureWorkItem(
      harness,
      "rm13:overdue-and-blocked",
      "Overdue and blocked work",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-08-20T02:00:00.000Z",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();

    const result = await harness.runMorningBrief();

    expect(
      result.brief.overdueOrBlocked.filter(
        (entry) => entry.workItemId === workItem.id,
      ),
    ).toHaveLength(1);
  });

  it("carries the recorded blocker reason rather than a bare label", async () => {
    const harness = startHarness({
      executionError: "Controlled worker failure",
    });
    const workItem = await captureWorkItem(
      harness,
      "rm13:blocked-reason",
      "Blocked work",
    );
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();

    const result = await harness.runMorningBrief();

    const blocked = result.brief.overdueOrBlocked.find(
      (entry) => entry.workItemId === workItem.id,
    );
    expect(blocked?.label).toMatch(/worker-execution-failed/);
  });

  it("reports a calendar conflict against an externally sourced date too", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:external-drift",
      "Externally sourced meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-08-29T06:00:00.000Z",
      actor: {
        kind: "External Source",
        sourceIdentity: "google-calendar",
        sourceReference,
        asOf: "2026-08-29T00:00:00.000Z",
      },
    });

    const result = await harness.runMorningBrief();

    expect(result.brief.conflicts.map((entry) => entry.workItemId)).toContain(
      workItem.id,
    );
  });

  it("reports a calendar conflict against a CEO-set date", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:conflict",
      "Attend the supervisor meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-08-29T06:00:00.000Z",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const result = await harness.runMorningBrief();

    expect(result.brief.conflicts.map((entry) => entry.workItemId)).toContain(
      workItem.id,
    );
    expect(result.brief.text).toMatch(/conflict/i);
  });

  it("delivers a corrected brief when the day's picture changes", async () => {
    // A retry after a transient outage produces different content. Treating it
    // as a duplicate would leave Ming with the broken brief for the whole day.
    const harness = startHarness();
    const result = await harness.runMorningBrief();
    expect(result.delivery.kind).toBe("sent");

    await captureWorkItem(harness, "rm13:late-arrival", "Work that arrived later");
    const corrected = await harness.runMorningBrief();

    expect(corrected.delivery.kind).toBe("sent");
    expect(corrected.brief.occurrenceDate).toBe(result.brief.occurrenceDate);
    expect(harness.telegramMessages()).toHaveLength(2);
  });

  it("lists an overdue commitment that is not otherwise blocked", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:overdue-only",
      "Overdue but unblocked work",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-08-20T02:00:00.000Z",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.overdueOrBlocked.map((entry) => entry.workItemId),
    ).toContain(workItem.id);
    expect(result.brief.text).toMatch(/Overdue since 2026-08-20/);
  });

  it("does not call an event unclaimed when its Work Item only proposed a date", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:proposal-only",
      "Proposed supervisor meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: event.start,
      actor: { kind: "Executive Role", executive: "CAO" },
    });

    const result = await harness.runMorningBrief();

    // Reporting "(no Work Item)" while also listing it as a proposal would
    // make the brief contradict itself.
    expect(result.brief.text).not.toMatch(/no Work Item/);
    expect(
      result.brief.proposedCommitments.map((entry) => entry.workItemId),
    ).toEqual([workItem.id]);
  });

  it("names the day the calendar was read for", async () => {
    const harness = startHarness({ events: [] });

    const result = await harness.runMorningBrief();

    expect(
      result.brief.sources.find((s) => s.source === "google-calendar")?.detail,
    ).toContain("2026-08-29");
    expect(result.brief.text).toMatch(/holds no events for 2026-08-29/);
  });

  it("creates no duplicate notification or Work Item when the run is retried", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(
      harness,
      "rm13:supervisor-meeting",
      "Attend the research paper supervisor meeting",
    );
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: event.start,
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const first = await harness.runMorningBrief();
    const workItemsAfterFirst = harness.workItems().length;
    const replay = await harness.runMorningBrief();

    expect(replay.brief.idempotencyKey).toBe(first.brief.idempotencyKey);
    expect(harness.telegramMessages()).toHaveLength(1);
    expect(harness.workItems()).toHaveLength(workItemsAfterFirst);
    expect(
      harness
        .telegramAuditTrail()
        .filter((entry) => entry.type === "telegram.notification-sent"),
    ).toHaveLength(1);
  });
});
