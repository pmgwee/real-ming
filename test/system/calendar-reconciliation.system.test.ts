import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CalendarEvent } from "../../src/providers/google-calendar-adapter.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const calendarId = "ming@example.invalid";
const eventId = "event-supervisor-meeting";
const sourceReference = `google-calendar:${calendarId}:${eventId}`;

const event: CalendarEvent = {
  id: eventId,
  calendarId,
  title: "Research paper supervisor meeting",
  start: "2026-09-02T02:00:00.000Z",
  end: "2026-09-02T03:00:00.000Z",
  allDay: false,
  status: "confirmed",
  updatedAt: "2026-08-29T08:00:00.000Z",
  sourceReference,
};

describe("RM-12 Google Calendar commitment reconciliation", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(
    calendar: {
      readonly events?: readonly CalendarEvent[];
      readonly failure?: "unavailable" | "authentication-failed";
      readonly asOf?: string;
    } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm12-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-08-29T09:00:00.000Z",
      calendar: {
        events: calendar.events ?? [event],
        ...(calendar.failure === undefined ? {} : { failure: calendar.failure }),
        ...(calendar.asOf === undefined ? {} : { asOf: calendar.asOf }),
      },
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(harness: RealMingSystemHarness) {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm12:supervisor-meeting",
      intent: "Attend the research paper supervisor meeting",
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

  it("normalizes calendar reads with source identity, provenance and an as-of time", async () => {
    const harness = startHarness();

    const result = await harness.listCalendarEvents({ calendarId });

    expect(result.kind).toBe("ok");
    if (result.kind === "failed") throw new Error("expected a calendar read");
    expect(result.identity).toMatchObject({
      provider: "google-calendar",
      workspaceId: "workspace:real-ming",
    });
    expect(result.provenance).toMatchObject({
      sourceReference: calendarId,
      asOf: "2026-08-29T08:00:00.000Z",
      retrievedAt: "2026-08-29T09:00:00.000Z",
      freshness: "current",
    });
    expect(result.value).toEqual([event]);
  });

  it("records an externally sourced commitment carrying the calendar as its origin", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    expect(reconciliation.kind).toBe("reconciled");
    if (reconciliation.kind !== "reconciled") return;
    expect(reconciliation.workItem.confirmedCommitment).toMatchObject({
      kind: "Externally Sourced",
      value: event.start,
      provenance: {
        sourceIdentity: "google-calendar",
        sourceReference,
        asOf: event.updatedAt,
      },
    });
  });

  it("keeps a CEO-set date authoritative and surfaces the calendar disagreement", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-09-05T02:00:00.000Z",
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    expect(reconciliation.kind).toBe("conflict");
    if (reconciliation.kind !== "conflict") return;
    expect(reconciliation.committedValue).toBe("2026-09-05T02:00:00.000Z");
    expect(reconciliation.calendarValue).toBe(event.start);
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toMatchObject({
      kind: "CEO-set",
      value: "2026-09-05T02:00:00.000Z",
    });
  });

  it("keeps a Proposed Commitment distinct from a confirmed one", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);

    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: "2026-09-03T02:00:00.000Z",
      actor: { kind: "Executive Role", executive: "CAO" },
    });

    const proposed = harness.workItem(workItem.id);
    expect(proposed?.proposedCommitment).toMatchObject({
      kind: "Proposed Commitment",
      provenance: { proposedBy: "CAO" },
    });
    expect(proposed?.confirmedCommitment).toBeNull();

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    expect(reconciliation.kind).toBe("reconciled");
    expect(
      harness.workItem(workItem.id)?.confirmedCommitment?.kind,
    ).toBe("Externally Sourced");
    expect(harness.workItem(workItem.id)?.proposedCommitment).toMatchObject({
      kind: "Proposed Commitment",
    });
  });

  it("does not fail when a CEO-set date already agrees with the calendar", async () => {
    // The steady state after any successful sync. Falling through to an
    // External Source write here makes the gateway reject a CEO-set commitment
    // and the reconciliation reject instead of naming an outcome.
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);
    await harness.recordWorkItemCommitment({
      workItemId: workItem.id,
      value: event.start,
      actor: { kind: "CEO", actorId: "ceo:ming" },
    });

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    expect(reconciliation.kind).toBe("reconciled");
    if (reconciliation.kind !== "reconciled") return;
    expect(reconciliation.changed).toBe(false);
    expect(reconciliation.commitment.kind).toBe("CEO-set");
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toMatchObject({
      kind: "CEO-set",
      value: event.start,
    });
  });

  it("moves the Work Item commitment with the calendar change it authorized", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);
    const start = "2026-09-02T04:00:00.000Z";

    const refused = await harness.changeCalendarEvent({
      workItemId: workItem.id,
      calendarId,
      eventId,
      start,
      end: "2026-09-02T05:00:00.000Z",
    });
    if (refused.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: refused.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-29T21:00:00.000Z",
    });
    const written = await harness.changeCalendarEvent({
      workItemId: workItem.id,
      calendarId,
      eventId,
      start,
      end: "2026-09-02T05:00:00.000Z",
    });
    expect(written.kind).toBe("written");

    // Leaving the commitment on the old time would make the next
    // reconciliation report a conflict against the CEO's own change.
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toMatchObject({
      value: start,
    });
  });

  it("performs a re-authorized change back to a previously used time", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);
    const times = [
      { start: "2026-09-02T04:00:00.000Z", end: "2026-09-02T05:00:00.000Z" },
      { start: "2026-09-02T06:00:00.000Z", end: "2026-09-02T07:00:00.000Z" },
      { start: "2026-09-02T04:00:00.000Z", end: "2026-09-02T05:00:00.000Z" },
    ] as const;

    for (const [index, time] of times.entries()) {
      const requested = await harness.changeCalendarEvent({
        workItemId: workItem.id,
        calendarId,
        eventId,
        ...time,
      });
      if (requested.kind !== "approval-required") {
        throw new Error(`change ${index} should have needed an Approval`);
      }
      await harness.grantApproval({
        approvalId: requested.approvalId,
        actorId: "ceo:ming",
        expiresAt: "2026-08-29T21:00:00.000Z",
      });
      const written = await harness.changeCalendarEvent({
        workItemId: workItem.id,
        calendarId,
        eventId,
        ...time,
      });
      expect(written.kind, `change ${index}`).toBe("written");
      if (written.kind !== "written") return;
      // Each is a separately approved occurrence, so none of them may be
      // swallowed as a replay of an earlier change to the same time.
      expect(written.deduplicated, `change ${index}`).toBe(false);
    }

    expect(harness.calendarWriteCount()).toBe(3);
  });

  it("reports an unavailable calendar rather than an empty healthy one", async () => {
    const harness = startHarness({ failure: "unavailable" });
    const workItem = await captureWorkItem(harness);

    const read = await harness.listCalendarEvents({ calendarId });
    expect(read.kind).toBe("failed");
    if (read.kind !== "failed") return;
    expect(read.failure.retryable).toBe(true);

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });
    expect(reconciliation.kind).toBe("unavailable");
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toBeNull();
  });

  it("distinguishes a calendar with no such event from an unavailable calendar", async () => {
    const harness = startHarness({ events: [] });
    const workItem = await captureWorkItem(harness);

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    expect(reconciliation.kind).toBe("event-missing");
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toBeNull();
  });

  it("surfaces stale calendar data instead of committing to it", async () => {
    const harness = startHarness({ asOf: "2026-08-20T09:00:00.000Z" });
    const workItem = await captureWorkItem(harness);

    const read = await harness.listCalendarEvents({ calendarId });
    expect(read.kind).toBe("stale");

    const reconciliation = await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });
    expect(reconciliation.kind).toBe("stale");
    if (reconciliation.kind !== "stale") return;
    expect(reconciliation.asOf).toBe("2026-08-20T09:00:00.000Z");
    expect(harness.workItem(workItem.id)?.confirmedCommitment).toBeNull();
  });

  it("refuses an unapproved calendar write and performs it once when approved", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);

    const refused = await harness.changeCalendarEvent({
      workItemId: workItem.id,
      calendarId,
      eventId,
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
    });
    expect(refused.kind).toBe("approval-required");
    expect(harness.calendarWriteCount()).toBe(0);
    if (refused.kind !== "approval-required") return;

    await harness.grantApproval({
      approvalId: refused.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-08-29T21:00:00.000Z",
    });

    const approved = await harness.changeCalendarEvent({
      workItemId: workItem.id,
      calendarId,
      eventId,
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
    });
    expect(approved.kind).toBe("written");
    expect(harness.calendarWriteCount()).toBe(1);

    const replay = await harness.changeCalendarEvent({
      workItemId: workItem.id,
      calendarId,
      eventId,
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
    });
    expect(replay.kind).toBe("written");
    if (replay.kind !== "written") return;
    expect(replay.deduplicated).toBe(true);
    expect(harness.calendarWriteCount()).toBe(1);
  });

  it("shows the reconciled commitment through Master Tasks as a viewing client", async () => {
    const harness = startHarness();
    const workItem = await captureWorkItem(harness);

    await harness.reconcileCalendarCommitment({
      workItemId: workItem.id,
      calendarId,
      eventId,
    });

    const view = await harness.masterTasksView("CAO Work View");
    expect(view).toHaveLength(1);
    expect(view[0]?.commitmentValue).toBe(event.start);
    expect(view[0]?.commitmentProvenance).toEqual(
      expect.stringContaining(sourceReference),
    );
  });
});
