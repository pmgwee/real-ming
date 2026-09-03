import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  CanvasAdapter,
  CanvasCourseEvidence,
} from "../../src/providers/canvas-adapter.js";
import type { Microsoft365Adapter } from "../../src/providers/microsoft365-adapter.js";
import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

const now = "2026-09-03T01:00:00.000Z";
const courseId = "course-cpc151";

describe("RM-31 academic commitment coordination", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const evidence: CanvasCourseEvidence = {
    files: [
      {
        id: "file-1",
        courseId,
        name: "Assignment 3 brief.pdf",
        updatedAt: "2026-09-01T02:00:00.000Z",
        sourceReference: `canvas:${courseId}:file:file-1`,
      },
    ],
    announcements: [
      {
        id: "announcement-1",
        courseId,
        title: "Assignment 3 deadline moved",
        body: "The deadline moves to 12 September.",
        postedAt: "2026-09-02T02:00:00.000Z",
        sourceReference: `canvas:${courseId}:announcement:announcement-1`,
      },
    ],
  };

  const identity = {
    provider: "canvas",
    workspaceId: "workspace:real-ming",
    accountReference: "canvas:real-ming",
  } as const;
  const provenance = {
    sourceIdentity: "canvas",
    sourceReference: `canvas:${courseId}`,
    asOf: "2026-09-02T02:00:00.000Z",
    retrievedAt: now,
    freshness: "current" as const,
  };

  function canvas(overrides: Partial<CanvasAdapter> = {}): CanvasAdapter {
    let calls = 0;
    return {
      identity: () => identity,
      capabilities: () => ["read"],
      read: async () => {
        calls += 1;
        return { kind: "ok", identity, provenance, value: evidence };
      },
      write: async () => ({
        kind: "failed",
        failure: {
          class: "unsupported-capability",
          retryable: false,
          message: "Canvas is read-only.",
        },
      }),
      readCourse: async () => {
        calls += 1;
        return { kind: "ok", identity, provenance, value: evidence };
      },
      submitAssignment: async () => {
        // Counted, so a coordinator that reaches the provider before refusing
        // is visible to the test rather than silently tolerated.
        calls += 1;
        return {
          kind: "failed" as const,
          failure: {
            class: "unsupported-capability" as const,
            retryable: false,
            message: "Submission is excluded.",
          },
        };
      },
      providerCallCount: () => calls,
      ...overrides,
    };
  }

  const teamsMessage = {
    id: "teams-1",
    channel: "CPC151 General",
    from: "supervisor@university.test",
    body: "Please confirm you can meet the moved deadline.",
    postedAt: "2026-09-02T03:00:00.000Z",
    sourceReference: "m365:teams:CPC151:teams-1",
  };
  const academicMail = {
    id: "m365-1",
    mailbox: "academic@university.test",
    from: "supervisor@university.test",
    to: ["academic@university.test"],
    subject: "Assignment 3",
    body: "Confirm the new deadline.",
    receivedAt: "2026-09-02T03:30:00.000Z",
    sourceReference: "m365:mail:m365-1",
  };

  function microsoft365(
    overrides: Partial<Microsoft365Adapter> = {},
  ): Microsoft365Adapter & { sendCount(): number } {
    const m365Identity = {
      provider: "microsoft365",
      workspaceId: "workspace:real-ming",
      accountReference: "m365:real-ming",
    } as const;
    const m365Provenance = {
      sourceIdentity: "microsoft365",
      sourceReference: "m365:academic@university.test",
      asOf: "2026-09-02T03:30:00.000Z",
      retrievedAt: now,
      freshness: "current" as const,
    };
    const drafts = new Map<string, string>();
    let sends = 0;
    const counted = {
      sendCount: () => sends,
    };
    Object.assign(overrides, {});
    return {
      ...counted,
      identity: () => m365Identity,
      capabilities: () => ["read", "write"],
      read: async () => ({
        kind: "ok",
        identity: m365Identity,
        provenance: m365Provenance,
        value: [],
      }),
      write: async () => ({
        kind: "failed",
        failure: {
          class: "unsupported-capability",
          retryable: false,
          message: "Unsupervised send is excluded.",
        },
      }),
      readAcademicMail: async () => ({
        kind: "ok",
        identity: m365Identity,
        provenance: m365Provenance,
        value: [academicMail],
      }),
      readTeamsMessages: async () => ({
        kind: "ok",
        identity: m365Identity,
        provenance: m365Provenance,
        value: [teamsMessage],
      }),
      createDraft: async (request) => {
        const replay = drafts.get(request.idempotencyKey);
        const effectReference = replay ?? "m365:draft:draft-1";
        drafts.set(request.idempotencyKey, effectReference);
        return {
          kind: "ok",
          identity: m365Identity,
          provenance: { ...m365Provenance, sourceReference: effectReference },
          effectReference,
          deduplicated: replay !== undefined,
          draft: {
            id: "draft-1",
            to: request.to,
            subject: request.subject,
            body: request.body,
            sourceReference: effectReference,
          },
        };
      },
      sendMail: async () => {
        sends += 1;
        return {
          kind: "failed",
          failure: {
            class: "unsupported-capability",
            retryable: false,
            message: "Unsupervised send is excluded.",
          },
        };
      },
      ...overrides,
    } as Microsoft365Adapter & { sendCount(): number };
  }

  function start(
    options: {
      readonly canvasAdapter?: CanvasAdapter;
      readonly microsoft365Adapter?: Microsoft365Adapter;
    } = {},
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm31-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      canvasAdapter: options.canvasAdapter ?? canvas(),
      microsoft365Adapter: options.microsoft365Adapter ?? microsoft365(),
      academic: {
        courseId,
        mailbox: "academic@university.test",
        calendarId: "primary",
      },
      calendar: { events: [] },
    });
    harnesses.push(harness);
    return harness;
  }

  it("reads Canvas course files and announcements with provenance", async () => {
    const harness = start();

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.citedEvidence.map((cited) => cited.sourceReference)).toEqual(
      expect.arrayContaining([
        `canvas:${courseId}:file:file-1`,
        `canvas:${courseId}:announcement:announcement-1`,
      ]),
    );
    expect(
      result.citedEvidence.every((cited) => cited.asOf === provenance.asOf),
    ).toBe(true);
  });

  it("rejects a Canvas write or submission without calling the provider", async () => {
    const adapter = canvas();
    const harness = start({ canvasAdapter: adapter });
    const before = adapter.providerCallCount();

    const submission = await harness.attemptAcademicSubmission({
      courseId,
      assignmentId: "assignment-3",
    });

    expect(submission).toMatchObject({
      kind: "denied",
      reason: "submission-excluded",
    });
    // Rejected locally: refusing only after a round trip would already have
    // told Canvas that Ming intended to submit.
    expect(adapter.providerCallCount()).toBe(before);
  });

  it("drafts an academic reply without ever sending it", async () => {
    const adapter = microsoft365();
    const harness = start({ microsoft365Adapter: adapter });

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
      draftReply: { to: ["supervisor@university.test"], body: "Confirmed." },
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.draft?.sourceReference).toBe("m365:draft:draft-1");
    expect(result.sentMail).toBe(false);
    // The flag alone proves nothing; the provider must never have been asked.
    expect(adapter.sendCount()).toBe(0);
  });

  it("creates one CAO Work Item and its authorized calendar commitment", async () => {
    const harness = start();

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.workItem.accountableExecutive).toBe("CAO");
    expect(result.workItem.workstream).toBe("Academic");
    expect(harness.workItems()).toHaveLength(1);

    const replay = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });
    expect(replay.kind).toBe("coordinated");
    expect(harness.workItems()).toHaveLength(1);
  });

  it("writes the academic calendar event only once the CEO authorizes it", async () => {
    // "when authorized" has to mean something: the university moved the
    // deadline, but moving Ming's calendar is a write and clears the Approval
    // branch like any other.
    const harness = start();

    const requested = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
      calendarEvent: {
        eventId: "event-assignment-3",
        start: "2026-09-12T16:00:00.000Z",
        end: "2026-09-12T17:00:00.000Z",
      },
    });

    expect(requested.kind).toBe("coordinated");
    if (requested.kind !== "coordinated") return;
    expect(requested.calendar?.kind).toBe("approval-required");
    expect(harness.calendarWriteCount()).toBe(0);

    if (requested.calendar?.kind !== "approval-required") return;
    await harness.grantApproval({
      approvalId: requested.calendar.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const authorized = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
      calendarEvent: {
        eventId: "event-assignment-3",
        start: "2026-09-12T16:00:00.000Z",
        end: "2026-09-12T17:00:00.000Z",
      },
    });

    expect(authorized.kind).toBe("coordinated");
    if (authorized.kind !== "coordinated") return;
    expect(authorized.calendar?.kind).toBe("written");
    expect(harness.calendarWriteCount()).toBe(1);
  });

  it("treats stale academic evidence as stale rather than current", async () => {
    const staleCanvas = canvas({
      readCourse: async () => ({
        kind: "stale",
        identity,
        provenance: { ...provenance, freshness: "stale" },
        value: evidence,
      }),
    });
    const harness = start({ canvasAdapter: staleCanvas });

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result.kind).toBe("stale-evidence");
  });

  it("gives the COO an Approved Projection and never the raw academic content", async () => {
    const harness = start();

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    expect(result.cooProjection).toMatchObject({
      kind: "approved-projection",
      executive: "COO",
      workItemId: result.workItem.id,
    });
    const serialized = JSON.stringify(result.cooProjection);
    expect(serialized).not.toContain(teamsMessage.body);
    expect(serialized).not.toContain(academicMail.body);
    expect(
      JSON.stringify(
        harness.dashboardOverview({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
        }),
      ),
    ).not.toContain(teamsMessage.body);
  });

  it("refuses an unbounded or sensitive academic intent", async () => {
    const harness = start();

    const unbounded = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "x".repeat(241),
      commitment: "2026-09-12T16:00:00.000Z",
    });
    const sensitive = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm deadline",
      commitment: "2026-09-12T16:00:00.000Z",
      draftReply: {
        to: ["supervisor@university.test"],
        body: "Use sk-live-abcdefghijklmnopqrstuv to reach the portal.",
      },
    });

    expect(unbounded).toMatchObject({
      kind: "denied",
      reason: "unbounded-academic-intent",
    });
    expect(sensitive).toMatchObject({
      kind: "denied",
      reason: "unbounded-academic-intent",
    });
    expect(harness.workItems()).toHaveLength(0);
  });

  it("surfaces a failed Canvas read instead of coordinating without evidence", async () => {
    const harness = start({
      canvasAdapter: canvas({
        readCourse: async () => ({
          kind: "failed",
          failure: {
            class: "unavailable",
            retryable: true,
            message: "Canvas unavailable.",
          },
        }),
      }),
    });

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "unavailable" },
    });
    expect(harness.workItems()).toHaveLength(0);
  });

  it("proves in the Outcome Report that nothing was submitted", async () => {
    const harness = start();

    const result = await harness.coordinateAcademicCommitment({
      courseId,
      intent: "Confirm the moved Assignment 3 deadline",
      commitment: "2026-09-12T16:00:00.000Z",
    });

    expect(result.kind).toBe("coordinated");
    if (result.kind !== "coordinated") return;
    const report = harness.outcomeReport(result.workItem.id);
    expect(report).toBeDefined();
    // The report cites the Canvas evidence it acted on, and its completed
    // effect records that coordination is all that happened.
    expect(report?.verification.evidence.reference).toContain(`canvas:${courseId}`);
    expect(report?.completedEffect.value).toMatch(/no assignment or examination/i);
    // Content-derived: the reference of a file Canvas actually returned. A
    // parameter-derived string would still say "canvas:" with no reads at all.
    expect(report?.completedEffect.value).toContain(
      `canvas:${courseId}:file:file-1`,
    );
    expect(report?.completedEffect.value).toContain(
      `canvas:${courseId}:announcement:announcement-1`,
    );
    expect(report?.completedEffect.kind).toBe("academic-coordination");
    expect(result.submittedAssignment).toBe(false);
  });
});
