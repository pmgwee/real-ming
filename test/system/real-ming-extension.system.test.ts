import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

/**
 * The Real-Ming extension under Architecture Revision 6.
 *
 * Hermes is the runtime; this is the small set of operations it cannot perform
 * for itself. The scenarios below are the contract: what the work means, and
 * which native task did it. Anything an agent could answer without Real-Ming
 * does not belong here.
 */
describe("RM-40 Real-Ming extension tools", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function startHarness(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-extension-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-09-06T05:00:00.000Z",
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureWorkItem(
    harness: RealMingSystemHarness,
    intent: string,
  ): Promise<string> {
    const acknowledgement = await harness.acknowledgeCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `extension-${intent}`,
      intent,
      expectedEffect: { kind: "record-note", value: `Extension scenario: ${intent}` },
      accountableExecutive: "CTO",
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("The harness did not capture a Work Item.");
    }
    return acknowledgement.workItem.id;
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("offers only the operations the native runtime cannot perform itself", () => {
    const names = startHarness()
      .realMingTools()
      .map((tool) => tool.name)
      .sort();

    expect(names).toEqual([
      "real_ming_get_work_item",
      "real_ming_link_execution_task",
      "real_ming_list_work_items",
    ]);
  });

  it("reports the Notion category a lifecycle state presents as", async () => {
    // The status vocabulary is the single most valuable thing Real-Ming knows.
    // An agent reading raw Notion has no way to learn it.
    const harness = startHarness();
    await captureWorkItem(harness, "Prepare the September operating plan");

    const result = harness.callRealMingTool("real_ming_list_work_items", {});

    expect(result.kind).toBe("ok");
    const value = (result as { readonly value: { readonly workItems: readonly Record<string, unknown>[] } }).value;
    expect(value.workItems).toEqual([
      expect.objectContaining({
        intent: "Prepare the September operating plan",
        state: "Captured",
        notionCategory: "Pending",
        completed: false,
        awaitingCeoDecision: false,
        accountableExecutive: "CTO",
      }),
    ]);
  });

  it("never lets review-ready work read as completed", async () => {
    // `Pending to Review` means Ming still has to decide. Collapsing it into
    // `Done` is the exact mistake the status-semantics document exists to stop,
    // and an agent summarising the week is where it would happen.
    const harness = startHarness();
    await captureWorkItem(harness, "Ship the DuitSini fix");

    const listed = harness.callRealMingTool("real_ming_list_work_items", {});
    const workItems = (listed as { readonly value: { readonly workItems: readonly { readonly state: string; readonly completed: boolean }[] } }).value.workItems;

    for (const item of workItems) {
      if (item.state !== "Completed") expect(item.completed).toBe(false);
    }
  });

  it("does not create a second link when a retry replays the same key", async () => {
    // An agent whose connection drops mid-call retries. Two links to one piece
    // of work would later read as two pieces of work.
    const harness = startHarness();
    const workItemId = await captureWorkItem(harness, "Add the recurring-cycle fix");

    const first = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId,
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "duitsini-cycle-fix",
    });
    const replay = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId,
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "duitsini-cycle-fix",
    });

    expect(first).toMatchObject({ kind: "ok", value: { deduplicated: false } });
    expect(replay).toMatchObject({ kind: "ok", value: { deduplicated: true } });

    const detail = harness.callRealMingTool("real_ming_get_work_item", { workItemId });
    const tasks = (detail as { readonly value: { readonly executionTasks: readonly unknown[] } }).value.executionTasks;
    expect(tasks).toHaveLength(1);
  });

  it("refuses to link work that does not exist rather than recording a dangling fact", () => {
    const harness = startHarness();

    const result = harness.callRealMingTool("real_ming_link_execution_task", {
      workItemId: "work-item:does-not-exist",
      nativeTaskId: "20260906_044002_66dc9dc2",
      idempotencyKey: "dangling",
    });

    expect(result).toEqual({
      kind: "failed",
      reason: "No Work Item work-item:does-not-exist.",
    });
  });

  it("reports a missing Work Item instead of inventing an empty one", () => {
    const harness = startHarness();

    expect(
      harness.callRealMingTool("real_ming_get_work_item", {
        workItemId: "work-item:absent",
      }),
    ).toEqual({ kind: "failed", reason: "No Work Item work-item:absent." });
  });

  it("names an unknown tool rather than failing silently", () => {
    expect(
      startHarness().callRealMingTool("real_ming_delete_everything", {}),
    ).toEqual({ kind: "failed", reason: "Unknown tool real_ming_delete_everything." });
  });

  it("validates its arguments before touching durable state", () => {
    const harness = startHarness();

    expect(
      harness.callRealMingTool("real_ming_link_execution_task", {
        workItemId: "work-item:whatever",
      }),
    ).toEqual({
      kind: "failed",
      reason: "workItemId, nativeTaskId and idempotencyKey are all required.",
    });
  });

  /**
   * Native Hermes ships no Google Calendar connector, and Google publishes no
   * official remote MCP, so the agent cannot answer "what is on Friday?" for
   * itself. Real-Ming already holds an authorized Calendar credential, so it
   * surfaces the agenda as a tool rather than standing up a second integration.
   */
  describe("calendar agenda", () => {
    const agendaEvent = {
      id: "event-friday-review",
      calendarId: "ceo@real-ming",
      title: "Quarterly review with the board",
      start: "2026-09-11T02:00:00.000Z",
      end: "2026-09-11T03:00:00.000Z",
      allDay: false,
      status: "confirmed" as const,
      updatedAt: "2026-09-06T04:00:00.000Z",
      sourceReference: "google-calendar:ceo@real-ming:event-friday-review",
    };

    function startWithCalendar(
      calendar: NonNullable<
        Parameters<typeof createRealMingSystemHarness>[0]["calendar"]
      >,
    ): RealMingSystemHarness {
      const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-calendar-"));
      directories.push(directory);
      const harness = createRealMingSystemHarness({
        statePath: join(directory, "state.sqlite"),
        telegram: { ceoTelegramId: "100000001" },
        now: () => "2026-09-06T05:00:00.000Z",
        calendar,
      });
      harnesses.push(harness);
      return harness;
    }

    it("offers the agenda only where a calendar is actually configured", () => {
      // A tool that is always present but never able to answer teaches the
      // agent to invent an empty day.
      expect(
        startHarness()
          .realMingTools()
          .map((tool) => tool.name),
      ).not.toContain("real_ming_list_calendar_events");

      expect(
        startWithCalendar({ events: [agendaEvent] })
          .realMingTools()
          .map((tool) => tool.name),
      ).toContain("real_ming_list_calendar_events");
    });

    it("returns the events the calendar actually holds", async () => {
      const harness = startWithCalendar({ events: [agendaEvent] });

      const result = await harness.callRealMingToolAsync(
        "real_ming_list_calendar_events",
        { calendarId: "ceo@real-ming" },
      );

      expect(result.kind).toBe("ok");
      const value = (result as { readonly value: Record<string, unknown> }).value;
      expect(value["events"]).toEqual([
        {
          title: "Quarterly review with the board",
          start: "2026-09-11T02:00:00.000Z",
          end: "2026-09-11T03:00:00.000Z",
          allDay: false,
          status: "confirmed",
        },
      ]);
    });

    it("reports an unreachable calendar instead of an empty day", async () => {
      // An empty agenda and an unreachable calendar look identical to a
      // reader. Reported as "no events", the agent tells Ming his Friday is
      // clear when it never managed to look.
      const harness = startWithCalendar({ events: [], failure: "unavailable" });

      const result = await harness.callRealMingToolAsync(
        "real_ming_list_calendar_events",
        { calendarId: "ceo@real-ming" },
      );

      expect(result.kind).toBe("failed");
      expect((result as { readonly reason: string }).reason).toMatch(
        /calendar/i,
      );
    });
  });

  /**
   * Ming reads three mailboxes for one question: what needs his reply. The
   * agent must name which mailbox it read, because "no job replies" is a
   * different fact depending on whether it looked at his personal mail or his
   * university account.
   */
  describe("mailboxes", () => {
    // Identifiers and source references belong to the adapter, which the
    // Provider Adapter Contract Harness covers. This seam is about which
    // mailbox was read and what the agent is told.
    const jobReply = {
      from: "Recruiting <talent@example.com>",
      subject: "Your application",
      snippet: "We would like to invite you to a first interview.",
      receivedAt: "2026-09-06T01:00:00.000Z",
      unread: true,
    };

    function startWithMail(
      mail: NonNullable<Parameters<typeof createRealMingSystemHarness>[0]["mail"]>,
    ): RealMingSystemHarness {
      const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-mail-"));
      directories.push(directory);
      const harness = createRealMingSystemHarness({
        statePath: join(directory, "state.sqlite"),
        telegram: { ceoTelegramId: "100000001" },
        now: () => "2026-09-06T05:00:00.000Z",
        mail,
      });
      harnesses.push(harness);
      return harness;
    }

    it("offers mail only where a mailbox is actually configured", () => {
      expect(
        startHarness()
          .realMingTools()
          .map((tool) => tool.name),
      ).not.toContain("real_ming_search_mail");

      expect(
        startWithMail({ mailboxes: ["personal@example.com"] })
          .realMingTools()
          .map((tool) => tool.name),
      ).toContain("real_ming_search_mail");
    });

    it("names the mailboxes it can read, so the agent picks rather than guesses", () => {
      // With three accounts and no list, an agent reads whichever one it
      // assumes is default and reports the answer as if it covered them all.
      const tool = startWithMail({
        mailboxes: ["personal@example.com", "student@example.edu"],
      })
        .realMingTools()
        .find((entry) => entry.name === "real_ming_search_mail");

      expect(tool?.description).toContain("personal@example.com");
      expect(tool?.description).toContain("student@example.edu");
    });

    it("returns the messages that mailbox actually holds", async () => {
      const harness = startWithMail({
        mailboxes: ["personal@example.com"],
        messages: { "personal@example.com": [jobReply] },
      });

      const result = await harness.callRealMingToolAsync("real_ming_search_mail", {
        mailbox: "personal@example.com",
        query: "is:unread",
      });

      expect(result.kind).toBe("ok");
      const value = (result as { readonly value: Record<string, unknown> }).value;
      expect(value["mailbox"]).toBe("personal@example.com");
      expect(value["messages"]).toEqual([
        {
          from: "Recruiting <talent@example.com>",
          subject: "Your application",
          snippet: "We would like to invite you to a first interview.",
          receivedAt: "2026-09-06T01:00:00.000Z",
          unread: true,
        },
      ]);
    });

    it("refuses an unknown mailbox instead of quietly reading another", async () => {
      // Silently falling back to the default mailbox answers a question Ming
      // did not ask, in a way that reads as if it did.
      const harness = startWithMail({ mailboxes: ["personal@example.com"] });

      const result = await harness.callRealMingToolAsync("real_ming_search_mail", {
        mailbox: "someone-else@example.com",
      });

      expect(result.kind).toBe("failed");
      expect((result as { readonly reason: string }).reason).toContain(
        "someone-else@example.com",
      );
    });

    it("reports an unreachable mailbox instead of an empty inbox", async () => {
      const harness = startWithMail({
        mailboxes: ["personal@example.com"],
        unavailable: true,
      });

      const result = await harness.callRealMingToolAsync("real_ming_search_mail", {
        mailbox: "personal@example.com",
      });

      expect(result.kind).toBe("failed");
      expect((result as { readonly reason: string }).reason).toMatch(
        /could not be read/i,
      );
    });
  });

  /**
   * Ming asked for a gate on sending, like Claude Code's permission prompt.
   * The gate is his own Gmail: the agent writes a draft, he reads it there and
   * presses send. There is deliberately no send tool, because an approval
   * relayed back through the agent is one the agent could fabricate.
   */
  describe("drafting and booking", () => {
    function startWritable(): RealMingSystemHarness {
      const directory = mkdtempSync(join(tmpdir(), "real-ming-rm40-write-"));
      directories.push(directory);
      const harness = createRealMingSystemHarness({
        statePath: join(directory, "state.sqlite"),
        telegram: { ceoTelegramId: "100000001" },
        now: () => "2026-09-06T05:00:00.000Z",
        mail: { mailboxes: ["personal@example.com"] },
        calendar: { events: [] },
      });
      harnesses.push(harness);
      return harness;
    }

    it("offers drafting but never offers sending", () => {
      const names = startWritable()
        .realMingTools()
        .map((tool) => tool.name);

      expect(names).toContain("real_ming_draft_email");
      expect(names).toContain("real_ming_create_calendar_event");
      for (const name of names) expect(name).not.toMatch(/send/i);
    });

    it("writes the draft and says plainly that it was not sent", async () => {
      const harness = startWritable();

      const result = await harness.callRealMingToolAsync("real_ming_draft_email", {
        mailbox: "personal@example.com",
        to: ["support@example.com"],
        subject: "Refund request for order 4182",
        body: "Please refund order 4182.",
        idempotencyKey: "refund-4182",
      });

      expect(result.kind).toBe("ok");
      const value = (result as { readonly value: Record<string, unknown> }).value;
      expect(value["sent"]).toBe(false);
      expect(String(value["note"])).toMatch(/Ming sends it himself/);
      expect(harness.draftedEmails()).toEqual([
        {
          mailbox: "personal@example.com",
          to: ["support@example.com"],
          subject: "Refund request for order 4182",
          body: "Please refund order 4182.",
        },
      ]);
    });

    it("refuses to draft from a mailbox it holds no credential for", async () => {
      const harness = startWritable();

      const result = await harness.callRealMingToolAsync("real_ming_draft_email", {
        mailbox: "someone-else@example.com",
        to: ["support@example.com"],
        subject: "Nope",
        body: "Nope",
        idempotencyKey: "wrong-mailbox",
      });

      expect(result.kind).toBe("failed");
      expect(harness.draftedEmails()).toEqual([]);
    });

    it("refuses a draft with no recipient rather than writing a blank", async () => {
      const harness = startWritable();

      const result = await harness.callRealMingToolAsync("real_ming_draft_email", {
        mailbox: "personal@example.com",
        to: [],
        subject: "Nowhere",
        body: "No one.",
        idempotencyKey: "no-recipient",
      });

      expect(result.kind).toBe("failed");
      expect(harness.draftedEmails()).toEqual([]);
    });

    it("books the event and does not double-book on a replay", async () => {
      const harness = startWritable();
      const event = {
        title: "Coffee with the DuitSini team",
        start: "2026-09-11T10:00:00+08:00",
        end: "2026-09-11T11:00:00+08:00",
        calendarId: "ceo@real-ming",
        idempotencyKey: "duitsini-coffee",
      };

      const first = await harness.callRealMingToolAsync(
        "real_ming_create_calendar_event",
        event,
      );
      const replay = await harness.callRealMingToolAsync(
        "real_ming_create_calendar_event",
        event,
      );

      expect(first).toMatchObject({ kind: "ok", value: { deduplicated: false } });
      expect(replay).toMatchObject({ kind: "ok", value: { deduplicated: true } });
      expect(harness.createdCalendarEvents()).toHaveLength(1);
    });

    it("says when it last looked, so an empty answer can be trusted", async () => {
      // "No job replies" is worthless without when it checked.
      const harness = startWritable();

      const result = await harness.callRealMingToolAsync("real_ming_search_mail", {
        mailbox: "personal@example.com",
      });

      const value = (result as { readonly value: Record<string, unknown> }).value;
      expect(value["retrievedAt"]).toBe("2026-09-06T05:00:00.000Z");
    });
  });
});
