import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import { providerObservationFromRead } from "../../src/providers/provider-health.js";

const telegramSecretUrl = [
  "https://api.telegram.org/bot8123456789:",
  "AAH-secret-material-that-must-never-be-recorded/sendMessage",
].join("");

describe("RM-22 provider degradation and recovery", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  function start(now = "2026-09-02T09:00:00.000Z"): {
    harness: RealMingSystemHarness;
    setNow: (value: string) => void;
  } {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm22-"));
    directories.push(directory);
    let clock = now;
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => clock,
    });
    harnesses.push(harness);
    return { harness, setNow: (value) => (clock = value) };
  }

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["unavailable", "unavailable"],
    ["stale", "stale"],
    ["missing-permission", "permission-denied"],
    ["rate-limited", "rate-limited"],
    ["unsupported", "unsupported-capability"],
    ["invalid-data", "invalid-input"],
  ] as const)("projects %s distinctly in the CEO dashboard", async (status, failureClass) => {
    const { harness } = start();
    await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: `source:${status}`,
      status,
      ...(status === "stale"
        ? {}
        : { failureClass, retryable: status === "rate-limited" }),
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: `provider-event:${status}:1`,
    });

    const view = harness
      .dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
      .providerObservations.find((observation) => observation.status === status);
    expect(view).toMatchObject({
      provider: "notion",
      sourceReference: `source:${status}`,
      status,
    });
  });

  it("groups identical provider events, keeps distinct failures visible, and uses bounded retry metadata", async () => {
    const { harness } = start();
    const base = {
      provider: "google-calendar",
      accountReference: "google-calendar:real-ming",
      sourceReference: "calendar:primary",
      status: "unavailable" as const,
      failureClass: "unavailable" as const,
      retryable: true,
    };
    const first = await harness.recordProviderObservation({
      ...base,
      attempt: 1,
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: "provider-event:calendar:1",
    });
    const duplicate = await harness.recordProviderObservation({
      ...base,
      attempt: 1,
      observedAt: "2026-09-02T09:01:00.000Z",
      idempotencyKey: "provider-event:calendar:1",
    });
    const secondAttempt = await harness.recordProviderObservation({
      ...base,
      attempt: 2,
      observedAt: "2026-09-02T09:02:00.000Z",
      idempotencyKey: "provider-event:calendar:2",
    });
    const distinct = await harness.recordProviderObservation({
      ...base,
      status: "rate-limited",
      failureClass: "rate-limited",
      retryable: true,
      attempt: 3,
      observedAt: "2026-09-02T09:03:00.000Z",
      idempotencyKey: "provider-event:calendar:3",
    });

    expect(first.isNewObservation).toBe(true);
    expect(duplicate.isNewObservation).toBe(false);
    expect(secondAttempt.observation.attemptCount).toBe(2);
    expect(distinct.observation.retryable).toBe(false);
    expect(harness.providerObservations()).toHaveLength(2);
    expect(harness.telegramMessages()).toHaveLength(2);
    await expect(
      harness.recordProviderObservation({
        ...base,
        status: "unsupported",
        failureClass: "unsupported-capability",
        retryable: false,
        observedAt: "2026-09-02T09:03:30.000Z",
        idempotencyKey: "provider-event:calendar:1",
      }),
    ).rejects.toThrow("conflicts with a different event");
    const linked = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm22-link-conflict",
      intent: "Link a provider failure",
      expectedEffect: { kind: "observe", value: "provider" },
      accountableExecutive: "COO",
    });
    await expect(
      harness.recordProviderObservation({
        ...base,
        workItemId: linked.workItem.id,
        observedAt: "2026-09-02T09:03:45.000Z",
        idempotencyKey: "provider-event:calendar:1",
      }),
    ).rejects.toThrow("conflicts with a different event");
    await expect(
      harness.recordProviderObservation({
        ...base,
        attempt: 4,
        observedAt: "2026-09-02T09:04:00.000Z",
        idempotencyKey: "provider-event:calendar:4",
      }),
    ).rejects.toThrow("between 1 and 3");
  });

  it("records one recovery notice and links the provider observation to Work Item audit evidence", async () => {
    const { harness, setNow } = start();
    const acknowledged = await harness.submitCeoAction({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm22-work-item",
      intent: "Refresh the canonical task projection",
      expectedEffect: { kind: "projection-refresh", value: "master-tasks" },
      accountableExecutive: "COO",
      workstream: "Personal Life",
    });
    const workItemId = acknowledged.workItem.id;
    const failure = await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:refresh",
      workItemId,
      status: "unavailable",
      failureClass: "unavailable",
      retryable: true,
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: "provider-event:notion:1",
    });
    setNow("2026-09-02T09:05:00.000Z");
    const recovery = await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:refresh",
      workItemId,
      status: "healthy",
      observedAt: "2026-09-02T09:05:00.000Z",
      idempotencyKey: "provider-event:notion:2",
    });

    expect(failure.observation.auditSequence).toEqual(expect.any(Number));
    expect(failure.observation.affectedWorkItemIds).toEqual([workItemId]);
    expect(recovery.recovered).toHaveLength(1);
    expect(recovery.recovered[0]?.workItemId).toBe(workItemId);
    expect(recovery.recovered[0]?.auditSequence).toBe(failure.observation.auditSequence);
    expect(recovery.recovered[0]?.auditSequences).toContain(
      failure.observation.auditSequence,
    );
    expect(harness.telegramMessages()).toHaveLength(2);
    expect(harness.telegramMessages()[1]?.text).toContain("Provider recovered");
    expect(
      harness.auditTrail(workItemId).map((event) => event.type),
    ).toEqual(expect.arrayContaining(["provider.observed", "provider.recovered"]));
    expect(
      harness.dashboardOverview({ actorId: "ceo:ming", workspaceId: "workspace:real-ming" })
        .providerObservations,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "unavailable", recoveredAt: "2026-09-02T09:05:00.000Z" }),
      expect.objectContaining({ status: "healthy", auditSequence: expect.any(Number) }),
    ]));
  });

  it("keeps every affected Work Item and audit link in one grouped recovery notice", async () => {
    const { harness } = start();
    const makeWorkItem = (idempotencyKey: string) =>
      harness.submitCeoAction({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey,
        intent: "Refresh the canonical task projection",
        expectedEffect: { kind: "projection-refresh", value: "master-tasks" },
        accountableExecutive: "COO",
      });
    const first = (await makeWorkItem("rm22-linked-one")).workItem.id;
    const second = (await makeWorkItem("rm22-linked-two")).workItem.id;
    const failure = {
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:shared-incident",
      status: "unavailable" as const,
      failureClass: "unavailable" as const,
      retryable: true,
    };
    const firstFailure = await harness.recordProviderObservation({
      ...failure,
      workItemId: first,
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: "provider-event:shared-incident:1",
    });
    const secondFailure = await harness.recordProviderObservation({
      ...failure,
      workItemId: second,
      observedAt: "2026-09-02T09:01:00.000Z",
      idempotencyKey: "provider-event:shared-incident:2",
    });
    await harness.recordProviderObservation({
      provider: failure.provider,
      accountReference: failure.accountReference,
      sourceReference: failure.sourceReference,
      status: "healthy",
      observedAt: "2026-09-02T09:02:00.000Z",
      idempotencyKey: "provider-event:shared-incident:3",
    });

    expect(secondFailure.observation.affectedWorkItemIds).toEqual([first, second]);
    expect(secondFailure.observation.auditSequences).toEqual([
      firstFailure.observation.auditSequence,
      secondFailure.observation.auditSequence,
    ]);
    expect(harness.telegramMessages()).toHaveLength(2);
    const recoveryText = harness.telegramMessages()[1]?.text ?? "";
    expect(recoveryText).toContain(first);
    expect(recoveryText).toContain(second);
    expect(recoveryText).toContain(String(firstFailure.observation.auditSequence));
    expect(recoveryText).toContain(String(secondFailure.observation.auditSequence));
  });

  it("does not let delayed observations rewrite the current incident timeline", async () => {
    const { harness } = start();
    const failure = {
      provider: "google-calendar",
      accountReference: "google-calendar:real-ming",
      sourceReference: "calendar:ordered",
      status: "unavailable" as const,
      failureClass: "unavailable" as const,
      retryable: true,
    };
    await harness.recordProviderObservation({
      ...failure,
      observedAt: "2026-09-02T10:00:00.000Z",
      idempotencyKey: "provider-event:ordered:1",
    });
    await harness.recordProviderObservation({
      provider: failure.provider,
      accountReference: failure.accountReference,
      sourceReference: failure.sourceReference,
      status: "healthy",
      observedAt: "2026-09-02T10:05:00.000Z",
      idempotencyKey: "provider-event:ordered:2",
    });
    const delayedFailure = await harness.recordProviderObservation({
      ...failure,
      observedAt: "2026-09-02T09:59:00.000Z",
      idempotencyKey: "provider-event:ordered:3",
    });

    expect(delayedFailure.incidentStarted).toBe(false);
    expect(delayedFailure.observation.recoveredAt).toBe("2026-09-02T10:05:00.000Z");
    expect(delayedFailure.observation.lastObservedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(harness.telegramMessages()).toHaveLength(2);

    const { harness: newerFailure } = start();
    const newerWorkItem = (
      await newerFailure.submitCeoAction({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "rm22-ordered-work-item",
        intent: "Read the calendar safely",
        expectedEffect: { kind: "calendar-read", value: "primary" },
        accountableExecutive: "COO",
      })
    ).workItem.id;
    await newerFailure.recordProviderObservation({
      ...failure,
      sourceReference: "calendar:ordered-healthy",
      workItemId: newerWorkItem,
      observedAt: "2026-09-02T10:05:00.000Z",
      idempotencyKey: "provider-event:ordered-healthy:1",
    });
    const delayedHealthy = await newerFailure.recordProviderObservation({
      provider: failure.provider,
      accountReference: failure.accountReference,
      sourceReference: "calendar:ordered-healthy",
      workItemId: newerWorkItem,
      status: "healthy",
      observedAt: "2026-09-02T10:00:00.000Z",
      idempotencyKey: "provider-event:ordered-healthy:2",
    });
    expect(delayedHealthy.recovered).toHaveLength(0);
    expect(newerFailure.providerObservations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceReference: "calendar:ordered-healthy",
          recoveredAt: null,
          lastObservedAt: "2026-09-02T10:05:00.000Z",
        }),
      ]),
    );
    expect(
      newerFailure.providerObservations().filter(
        (observation) =>
          observation.sourceReference === "calendar:ordered-healthy" &&
          observation.status === "healthy",
      ),
    ).toHaveLength(0);
    expect(
      newerFailure
        .auditTrail(newerWorkItem)
        .filter((event) => event.type === "provider.recovered"),
    ).toHaveLength(0);
  });

  it("reopens a grouped incident after recovery instead of leaving it permanently healthy", async () => {
    const { harness, setNow } = start();
    const failure = {
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:reopen",
      status: "unavailable" as const,
      failureClass: "unavailable" as const,
      retryable: true,
    };
    await harness.recordProviderObservation({
      ...failure,
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: "provider-event:reopen:1",
    });
    setNow("2026-09-02T09:01:00.000Z");
    await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:reopen",
      status: "healthy",
      observedAt: "2026-09-02T09:01:00.000Z",
      idempotencyKey: "provider-event:reopen:2",
    });
    setNow("2026-09-02T09:02:00.000Z");
    await harness.recordProviderObservation({
      ...failure,
      observedAt: "2026-09-02T09:02:00.000Z",
      idempotencyKey: "provider-event:reopen:3",
    });

    expect(harness.providerObservations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unavailable",
          recoveredAt: null,
          attemptCount: 1,
        }),
      ]),
    );
    expect(harness.telegramMessages()).toHaveLength(3);
  });

  it("still sends one recovery notice when the initial degradation notice could not be delivered", async () => {
    const { harness } = start();
    harness.setTelegramDeliveryFailure({
      class: "unavailable",
      retryable: true,
      message: "controlled Telegram outage",
    });
    await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:delivery-recovery",
      status: "unavailable",
      failureClass: "unavailable",
      retryable: true,
      observedAt: "2026-09-02T09:00:00.000Z",
      idempotencyKey: "provider-event:delivery-recovery:1",
    });
    expect(harness.telegramMessages()).toHaveLength(0);

    harness.setTelegramDeliveryFailure();
    await harness.recordProviderObservation({
      provider: "notion",
      accountReference: "notion:real-ming",
      sourceReference: "master-tasks:delivery-recovery",
      status: "healthy",
      observedAt: "2026-09-02T09:01:00.000Z",
      idempotencyKey: "provider-event:delivery-recovery:2",
    });
    expect(harness.telegramMessages()).toHaveLength(1);
    expect(harness.telegramMessages()[0]?.text).toContain("Provider recovered");
  });

  it("rejects a provider result that would put a Sensitive Secret in observation state", async () => {
    const { harness } = start();
    const result = {
      kind: "failed" as const,
      failure: {
        class: "unavailable" as const,
        retryable: true,
        message: "redacted",
      },
    };
    const input = providerObservationFromRead(
      { provider: "telegram", accountReference: "telegram:real-ming" },
      telegramSecretUrl,
      result,
      "2026-09-02T09:00:00.000Z",
    );
    await expect(harness.recordProviderObservation(input)).rejects.toThrow(
      "Sensitive Secrets",
    );
    expect(harness.providerObservations()).toHaveLength(0);
  });

  it("classifies an unreadable provider payload as invalid-data", async () => {
    const { harness } = start();
    const transition = await harness.recordProviderObservation(
      providerObservationFromRead(
        { provider: "google-calendar", accountReference: "google-calendar:real-ming" },
        "calendar:primary",
        {
          kind: "failed",
          failure: {
            class: "provider-error",
            retryable: true,
            message: "redacted",
          },
        },
        "2026-09-02T09:00:00.000Z",
      ),
    );
    expect(transition.observation.status).toBe("invalid-data");
  });
});
