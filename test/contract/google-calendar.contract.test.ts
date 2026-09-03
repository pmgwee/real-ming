import { describe, expect, it } from "vitest";

import {
  contractSecretFixture,
  createCalendarContractHarness,
} from "../../src/testing/provider-adapter-contract-harness.js";

const calendarId = "ming@example.invalid";

describe("RM-12 Google Calendar adapter contract", () => {
  it("normalizes its identity and capabilities", () => {
    const { adapter } = createCalendarContractHarness();

    expect(adapter.identity()).toEqual({
      provider: "google-calendar",
      workspaceId: "workspace:real-ming",
      accountReference: "google-calendar:account:real-ming",
    });
    expect(adapter.capabilities()).toEqual(["read", "write"]);
  });

  it("returns normalized events with provenance and an as-of time", async () => {
    const harness = createCalendarContractHarness();

    const result = await harness.adapter.listEvents(calendarId);

    expect(result.kind).toBe("ok");
    if (result.kind === "failed") throw new Error("expected a read");
    expect(result.provenance).toMatchObject({
      sourceIdentity: "google-calendar",
      sourceReference: calendarId,
      retrievedAt: "2026-08-27T09:00:00.000Z",
      freshness: "current",
    });
    expect(result.value).toEqual([
      {
        id: "contract-event",
        calendarId,
        title: "Contract event",
        start: "2026-09-02T02:00:00.000Z",
        end: "2026-09-02T03:00:00.000Z",
        allDay: false,
        status: "confirmed",
        updatedAt: "2026-08-27T09:00:00.000Z",
        sourceReference: `google-calendar:${calendarId}:contract-event`,
      },
    ]);
  });

  it("separates stale data, an empty calendar and an unavailable calendar", async () => {
    const stale = await createCalendarContractHarness({
      asOf: "2026-08-20T09:00:00.000Z",
    }).adapter.listEvents(calendarId);
    expect(stale.kind).toBe("stale");
    if (stale.kind !== "failed") {
      expect(stale.value).toHaveLength(1);
      expect(stale.provenance.asOf).toBe("2026-08-20T09:00:00.000Z");
    }

    const empty = await createCalendarContractHarness({
      emptyValue: true,
    }).adapter.listEvents(calendarId);
    expect(empty.kind).toBe("ok");
    if (empty.kind !== "failed") expect(empty.value).toEqual([]);

    const unavailable = await createCalendarContractHarness({
      failure: "unavailable",
    }).adapter.listEvents(calendarId);
    expect(unavailable).toMatchObject({
      kind: "failed",
      failure: { class: "unavailable", retryable: true },
    });
  });

  it("refuses a response it cannot date rather than calling it a fresh empty calendar", async () => {
    // Without an as-of time there is no basis for claiming the data is current.
    // Reporting it as a healthy empty calendar is the exact failure criterion 4
    // of RM-12 forbids.
    const undatable = await createCalendarContractHarness({
      omitAsOf: true,
      emptyValue: true,
    }).adapter.listEvents(calendarId);

    expect(undatable).toMatchObject({
      kind: "failed",
      failure: { class: "provider-error" },
    });

    // With events present the newest event still dates the read.
    const dated = await createCalendarContractHarness({
      omitAsOf: true,
    }).adapter.listEvents(calendarId);
    expect(dated.kind).toBe("ok");
    if (dated.kind !== "failed") {
      expect(dated.provenance.asOf).toBe("2026-08-27T09:00:00.000Z");
    }
  });

  it("reports a retry hint when the calendar rate limits the call", async () => {
    const result = await createCalendarContractHarness({
      failure: "rate-limited",
    }).adapter.listEvents(calendarId);

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "rate-limited", retryable: true, retryAfterMs: 1000 },
    });
  });

  it("rejects an empty calendar reference before contacting the provider", async () => {
    const harness = createCalendarContractHarness();

    const result = await harness.adapter.read({ reference: "  " });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(harness.providerCallCount()).toBe(0);
  });

  it("performs one external effect and does not repeat it on retry", async () => {
    const harness = createCalendarContractHarness();
    const change = {
      calendarId,
      eventId: "contract-event",
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
      idempotencyKey: "calendar-effect:1",
    };

    const first = await harness.adapter.changeEventTime(change);
    const retried = await harness.adapter.changeEventTime(change);

    expect(first).toMatchObject({ kind: "ok", deduplicated: false });
    expect(retried).toMatchObject({ kind: "ok", deduplicated: true });
    expect(harness.externalEffectCount()).toBe(1);
  });

  it("records no external effect when the calendar write fails", async () => {
    const harness = createCalendarContractHarness({ failure: "unavailable" });

    const result = await harness.adapter.changeEventTime({
      calendarId,
      eventId: "contract-event",
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
      idempotencyKey: "calendar-effect:1",
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "unavailable", retryable: true },
    });
    expect(harness.externalEffectCount()).toBe(0);
  });

  it("rejects a write payload carrying a Sensitive Secret before any effect", async () => {
    const harness = createCalendarContractHarness();

    const result = await harness.adapter.write({
      idempotencyKey: "calendar-effect:1",
      reference: calendarId,
      payload: { transactionPassword: contractSecretFixture },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain(contractSecretFixture);
    expect(harness.externalEffectCount()).toBe(0);
    expect(harness.providerCallCount()).toBe(0);
  });

  it("rejects an invalid write before contacting the provider", async () => {
    const harness = createCalendarContractHarness();

    const result = await harness.adapter.write({
      idempotencyKey: "",
      reference: calendarId,
      payload: { eventId: "contract-event", start: "a", end: "b" },
    });

    expect(result).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(harness.providerCallCount()).toBe(0);
  });

  it("returns a typed failure instead of throwing on an unreadable response", async () => {
    // Every caller branches on result.kind. A thrown error escapes that
    // contract and would crash a Work Item action instead of naming an outcome.
    const malformedRead = await createCalendarContractHarness({
      malformedBody: true,
    }).adapter.listEvents(calendarId);
    expect(malformedRead).toMatchObject({
      kind: "failed",
      failure: { class: "provider-error" },
    });

    const unreadableEvent = await createCalendarContractHarness({
      unreadableEvent: true,
    }).adapter.listEvents(calendarId);
    expect(unreadableEvent).toMatchObject({
      kind: "failed",
      failure: { class: "provider-error" },
    });

    const malformedWrite = await createCalendarContractHarness({
      malformedBody: true,
    }).adapter.changeEventTime({
      calendarId,
      eventId: "contract-event",
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
      idempotencyKey: "calendar-effect:1",
    });
    expect(malformedWrite).toMatchObject({ kind: "failed" });
    expect(JSON.stringify(malformedWrite)).not.toContain(contractSecretFixture);
  });

  it("refuses an idempotency key reused for a different change", async () => {
    // Returning deduplicated:true here would silently drop the requested
    // change, which is harder to notice than an outright failure.
    const harness = createCalendarContractHarness();
    await harness.adapter.changeEventTime({
      calendarId,
      eventId: "contract-event",
      start: "2026-09-02T04:00:00.000Z",
      end: "2026-09-02T05:00:00.000Z",
      idempotencyKey: "calendar-effect:1",
    });

    const reused = await harness.adapter.changeEventTime({
      calendarId,
      eventId: "contract-event",
      start: "2026-09-09T04:00:00.000Z",
      end: "2026-09-09T05:00:00.000Z",
      idempotencyKey: "calendar-effect:1",
    });

    expect(reused).toMatchObject({
      kind: "failed",
      failure: { class: "invalid-input", retryable: false },
    });
    expect(harness.externalEffectCount()).toBe(1);
  });

  it("scopes the read to a requested window instead of the whole calendar", async () => {
    // Google returns at most 250 events, ordered from the beginning of time.
    // An unscoped read of a calendar with recurring history returns the OLDEST
    // events and omits today entirely, while still looking healthy.
    const harness = createCalendarContractHarness();

    await harness.adapter.listEvents(calendarId, {
      timeMin: "2026-08-28T16:00:00.000Z",
      timeMax: "2026-08-29T16:00:00.000Z",
    });

    const request = harness.listRequests()[0];
    expect(request?.searchParams.get("timeMin")).toBe(
      "2026-08-28T16:00:00.000Z",
    );
    expect(request?.searchParams.get("timeMax")).toBe(
      "2026-08-29T16:00:00.000Z",
    );
    expect(request?.searchParams.get("maxResults")).not.toBeNull();
  });

  it("follows every page rather than reporting the first one as the whole calendar", async () => {
    const harness = createCalendarContractHarness({ paged: true });

    const result = await harness.adapter.listEvents(calendarId);

    if (result.kind === "failed") throw new Error("expected a successful read");
    expect(result.value.map((event) => event.id)).toEqual([
      "contract-event",
      "contract-event-2",
    ]);
    expect(harness.listRequests()).toHaveLength(2);
    expect(harness.listRequests()[1]?.searchParams.get("pageToken")).toBe(
      "page-2",
    );
  });

  it("never reports the access token in a failure", async () => {
    const result = await createCalendarContractHarness({
      failure: "authentication-failed",
    }).adapter.listEvents(calendarId);

    expect(JSON.stringify(result)).not.toContain(contractSecretFixture);
  });
});
