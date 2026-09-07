import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRealMingSystemHarness, type RealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("V6 daily reports help Ming decide what deserves attention", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];
  function start() {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-digest-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => "2026-09-07T13:30:00.000Z",
      telegram: { ceoTelegramId: "100000001" },
      calendar: { events: [], asOf: "2026-09-04T07:57:31.078Z" },
      morningBrief: { calendarId: "primary" },
    });
    harnesses.push(harness);
    return harness;
  }
  async function imported(harness: RealMingSystemHarness, intent: string, lifecycle: "Captured" | "Planned" | "Waiting/Blocked") {
    return harness.importMigratedWorkItem({
      actorId: "ceo:ming", workspaceId: "workspace:real-ming",
      sourceReference: `notion:test:${intent}`, intent, lifecycle,
      workstream: "Personal Life", accountableExecutive: "COO",
      legacyStatus: lifecycle === "Waiting/Blocked" ? "🚧Issues" : lifecycle === "Captured" ? "Pending" : "To Do",
      commitmentProvenance: "none-in-source", approvalReference: "controlled:test-approval",
    });
  }
  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("does not promote future backlog into priorities, and names each blocker with a clearing question", async () => {
    const harness = start();
    for (let index = 0; index < 30; index++) await imported(harness, `Future idea ${index}`, "Captured");
    await imported(harness, "Missing items", "Waiting/Blocked");
    await imported(harness, "Housing application", "Waiting/Blocked");
    const before = harness.workItems();
    const result = await harness.runNativeScheduledReport({ job: "executive-roll-up" });
    if (result.kind !== "composed") throw new Error("Expected report");
    expect(result.text).not.toContain("Future idea");
    expect(result.text).toContain("30 backlog items");
    expect(result.text).not.toContain("Migrated at the CEO-approved lifecycle");
    expect(result.text).toContain("Missing items");
    expect(result.text).toContain("Housing application");
    expect(result.text).toContain("What is blocking this, and what would clear it?");
    expect(result.text).toContain("No verified outcomes recorded today");
    expect(result.text).not.toContain("Scheduler exceptions: none");
    expect(result.text.length).toBeLessThan(2000);
    expect(harness.workItems()).toEqual(before);
    expect(harness.telegramMessages()).toEqual([]);
  });

  it("shows at most three ready options with dated work first and preserves the complete structured list", async () => {
    const harness = start();
    for (let index = 0; index < 8; index++) await imported(harness, `Ready option ${index}`, "Planned");
    const due = await imported(harness, "Time-bound application", "Planned");
    await harness.recordWorkItemCommitment({ workItemId: due.id, value: "2026-09-08T02:00:00.000Z", actor: { kind: "CEO", actorId: "ceo:ming" } });
    const { rollUp } = await harness.runExecutiveRollUp();
    expect(rollUp.nextPriorities).toHaveLength(9);
    expect(rollUp.readyOptions[0]?.workItemId).toBe(due.id);
    expect(rollUp.text).toContain("Possible next steps");
    expect(rollUp.text).toContain("6 more");
    expect(rollUp.text.match(/Ready option/g)).toHaveLength(2);
    expect(rollUp.text).toContain("not new commitments");
  });

  it("leads with a stale-calendar action, useful blockers and a bounded focus instead of empty sections", async () => {
    const harness = start();
    await imported(harness, "Missing items", "Waiting/Blocked");
    const { brief } = await harness.runMorningBrief();
    expect(brief.text).toContain("**Focus");
    expect(brief.text).toContain("Check Google Calendar directly");
    expect(brief.text).toContain("2026-09-04");
    expect(brief.text).toContain("Missing items");
    expect(brief.text).not.toContain("Migrated at the CEO-approved lifecycle");
    expect(brief.text).not.toContain("Pending Approvals: none");
    expect(brief.text).not.toContain("Incidents: none");
    expect(brief.text).not.toContain("Proposed Commitments (not confirmed): none");
    expect(brief.text.length).toBeLessThan(1800);
  });
});
