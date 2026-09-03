import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createAcademicContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-31 academic provider contract", () => {
  it("reads Canvas files and announcements with a datable provenance", async () => {
    const harness = createAcademicContractHarness();

    const result = await harness.canvas.readCourse({ courseId: "course-1" });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.files).toHaveLength(1);
    expect(result.value.announcements).toHaveLength(1);
    expect(result.provenance.asOf).toBe("2026-09-02T02:00:00.000Z");
    expect(result.value.announcements[0]?.sourceReference).toBe(
      "canvas:course-1:announcement:2",
    );
  });

  it("declares Canvas read-only and refuses a submission without a request", async () => {
    const harness = createAcademicContractHarness();
    const before = harness.networkCallCount();

    expect(harness.canvas.capabilities()).toEqual(["read"]);
    const submission = await harness.canvas.submitAssignment({
      courseId: "course-1",
      assignmentId: "assignment-3",
    });
    const write = await harness.canvas.write({
      reference: "course-1",
      idempotencyKey: "k",
      payload: {},
    });

    expect(submission).toMatchObject({
      kind: "failed",
      failure: { class: "unsupported-capability", retryable: false },
    });
    expect(write.kind).toBe("failed");
    expect(harness.networkCallCount()).toBe(before);
    expect(JSON.stringify(submission)).not.toContain(contractSecretFixture);
  });

  it("refuses an unsupervised Microsoft 365 send without a request", async () => {
    const harness = createAcademicContractHarness();
    const before = harness.networkCallCount();

    const sent = await harness.microsoft365.sendMail({
      mailbox: "academic@university.test",
    });

    expect(sent).toMatchObject({
      kind: "failed",
      failure: { class: "unsupported-capability", retryable: false },
    });
    expect(harness.networkCallCount()).toBe(before);
    expect(JSON.stringify(sent)).not.toContain(contractSecretFixture);
  });

  it("creates one Microsoft 365 draft and deduplicates a retry", async () => {
    const harness = createAcademicContractHarness();

    const first = await harness.microsoft365.createDraft({
      mailbox: "academic@university.test",
      to: ["supervisor@university.test"],
      subject: "Assignment 3",
      body: "Confirmed.",
      idempotencyKey: "academic:draft:1",
    });
    const callsAfterFirst = harness.networkCallCount();
    const retry = await harness.microsoft365.createDraft({
      mailbox: "academic@university.test",
      to: ["supervisor@university.test"],
      subject: "Assignment 3",
      body: "Confirmed.",
      idempotencyKey: "academic:draft:1",
    });

    expect(first).toMatchObject({ kind: "ok", deduplicated: false });
    expect(retry).toMatchObject({ kind: "ok", deduplicated: true });
    expect(harness.networkCallCount()).toBe(callsAfterFirst);
  });
});

describe("RM-31 academic provider Trust Domain containment", () => {
  it("redacts a Microsoft 365 file name that carries a credential", async () => {
    const harness = createAcademicContractHarness();

    const files = await harness.microsoft365.readAcademicFiles({
      mailbox: "academic@university.test",
    });

    expect(files.kind).toBe("ok");
    if (files.kind !== "ok") return;
    expect(files.value.map((file) => file.name)).toEqual([
      "notes.docx",
      "[redacted]",
    ]);
    expect(JSON.stringify(files.value)).not.toContain("sk-live-");
  });

  it("reads Teams messages rather than mail from the Teams endpoint", async () => {
    const harness = createAcademicContractHarness();

    const teams = await harness.microsoft365.readTeamsMessages({
      channel: "CPC151",
    });

    expect(teams.kind).toBe("ok");
    if (teams.kind !== "ok") return;
    expect(teams.value[0]?.sourceReference).toBe("m365:teams:CPC151:t1");
    expect(teams.value[0]?.body).toContain("moved deadline");
  });

  it("refuses a draft whose body carries a credential", async () => {
    const harness = createAcademicContractHarness();

    const drafted = await harness.microsoft365.createDraft({
      mailbox: "academic@university.test",
      to: ["supervisor@university.test"],
      subject: "Assignment 3",
      body: "Use sk-live-abcdefghijklmnopqrstuv to reach the portal.",
      idempotencyKey: "academic:draft:sensitive",
    });

    expect(drafted).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input" },
    });
  });
});
