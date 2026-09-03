import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("RM-07 private Telegram front door", () => {
  it("silently denies a non-CEO sender and records a safe audit event", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 7001,
        message: {
          messageId: 81,
          senderId: "200000002",
          chatId: "200000002",
          text: "Show me the private operating picture",
        },
      });

      expect(result).toEqual({
        kind: "denied",
        reason: "ceo-identity-required",
      });
      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([]);

      const audit = harness.telegramAuditTrail();
      expect(audit).toMatchObject([
        {
          actorId: expect.stringMatching(/^external:telegram:[0-9a-f]{24}$/u),
          workspaceId: "workspace:real-ming",
          type: "telegram.ingress-denied",
          details: {
            updateId: 7001,
            reason: "ceo-identity-required",
          },
        },
      ]);
      expect(JSON.stringify(audit)).not.toContain("200000002");
      expect(JSON.stringify(audit)).not.toContain(
        "Show me the private operating picture",
      );

      await harness.receiveTelegramUpdate({
        updateId: 7008,
        message: {
          messageId: 88,
          senderId: "200000002",
          chatId: "200000002",
          text: "Try the private operating picture again",
        },
      });
      expect(harness.telegramAuditTrail()[1]?.actorId).toBe(audit[0]?.actorId);
    } finally {
      harness.close();
    }
  });

  it("rejects a Sensitive Secret before Telegram text reaches Work or audit", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });
    const sensitive = `sk-${"a".repeat(20)}`;

    try {
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7009,
          message: {
            messageId: 89,
            senderId: "100000001",
            chatId: "100000001",
            text: `/do Store ${sensitive} for later`,
          },
        }),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "sensitive-secret-rejected",
      });
      expect(harness.workItems()).toEqual([]);
      expect(JSON.stringify(harness.telegramAuditTrail())).not.toContain(
        sensitive,
      );
      expect(JSON.stringify(harness.telegramMessages())).not.toContain(
        sensitive,
      );
      expect(harness.telegramAuditTrail()).toContainEqual(
        expect.objectContaining({
          actorId: "ceo:ming",
          type: "telegram.ingress-rejected",
          details: expect.objectContaining({
            updateId: 7009,
            reason: "sensitive-secret-rejected",
          }),
        }),
      );
    } finally {
      harness.close();
    }
  });

  it("rejects a Telegram bot token before it reaches Work or audit", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });
    const botToken = `${"123456789"}:${"A".repeat(35)}`;

    try {
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 70090,
          message: {
            messageId: 890,
            senderId: "100000001",
            chatId: "100000001",
            text: `/do Store ${botToken} for later`,
          },
        }),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "sensitive-secret-rejected",
      });
      expect(harness.workItems()).toEqual([]);
      expect(JSON.stringify(harness.telegramAuditTrail())).not.toContain(
        botToken,
      );
    } finally {
      harness.close();
    }
  });

  it("routes an allowlisted CEO question through the Operations Gateway", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledQuestionAnswer: "Tracer 1 is the Daily Operations Loop.",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 7002,
        message: {
          messageId: 82,
          senderId: "100000001",
          chatId: "100000001",
          text: "Which tracer comes first?",
        },
      });

      expect(result).toEqual({
        kind: "handled",
        response: {
          kind: "information-answer",
          answer: "Tracer 1 is the Daily Operations Loop.",
        },
      });
      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([
        {
          chatId: "100000001",
          text: "Tracer 1 is the Daily Operations Loop.",
        },
      ]);
      expect(harness.telegramAuditTrail().at(-1)).toMatchObject({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        type: "telegram.ingress-accepted",
        details: {
          updateId: 7002,
          responseKind: "information-answer",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("does not persist a Sensitive Secret returned by a question responder", async () => {
    const sensitive = `sk-${"d".repeat(20)}`;
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledQuestionAnswer: `Provider returned ${sensitive}`,
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 70020,
          message: {
            messageId: 820,
            senderId: "100000001",
            chatId: "100000001",
            text: "What did the provider return?",
          },
        }),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "sensitive-secret-rejected",
      });
      expect(JSON.stringify(harness.telegramAuditTrail())).not.toContain(
        sensitive,
      );
      expect(JSON.stringify(harness.telegramMessages())).not.toContain(
        sensitive,
      );
    } finally {
      harness.close();
    }
  });

  it("does not repeat an accepted update or its reply after a process restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-ingress-"));
    const statePath = join(directory, "operations.sqlite");
    const update = {
      updateId: 7006,
      message: {
        messageId: 86,
        senderId: "100000001",
        chatId: "100000001",
        text: "Which tracer comes first?",
      },
    } as const;

    try {
      const first = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "The Daily Operations Loop.",
        telegram: { ceoTelegramId: "100000001" },
      });
      await expect(first.receiveTelegramUpdate(update)).resolves.toMatchObject({
        kind: "handled",
        response: { answer: "The Daily Operations Loop." },
      });
      expect(first.telegramMessages()).toHaveLength(1);
      first.close();

      const restarted = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "A duplicated, recomputed answer.",
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(restarted.receiveTelegramUpdate(update)).resolves.toMatchObject({
          kind: "handled",
          response: { answer: "The Daily Operations Loop." },
        });
        expect(restarted.telegramMessages()).toEqual([]);
        expect(restarted.telegramAuditTrail()).toHaveLength(3);
        expect(restarted.telegramAuditTrail()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "telegram.ingress-replayed",
              details: expect.objectContaining({
                updateId: 7006,
                resultKind: "handled",
              }),
            }),
            expect.objectContaining({
              type: "telegram.delivery-deduplicated",
              details: expect.objectContaining({
                idempotencyKey: "telegram:reply:update:7006",
              }),
            }),
          ]),
        );
      } finally {
        restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the authoritative reply across a crash after delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-reply-crash-"));
    const statePath = join(directory, "operations.sqlite");
    const update = {
      updateId: 70060,
      message: {
        messageId: 860,
        senderId: "100000001",
        chatId: "100000001",
        text: "What is the authoritative recovery answer?",
      },
    } as const;

    try {
      const interrupted = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "The original delivered answer.",
        telegram: {
          ceoTelegramId: "100000001",
          afterReplyDeliveredError: "simulated crash after reply delivery",
        },
      });
      await expect(interrupted.receiveTelegramUpdate(update)).rejects.toThrow(
        "simulated crash after reply delivery",
      );
      expect(interrupted.telegramMessages()).toEqual([
        { chatId: "100000001", text: "The original delivered answer." },
      ]);
      interrupted.close();

      const restarted = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "A different recomputed answer.",
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(restarted.receiveTelegramUpdate(update)).resolves.toEqual({
          kind: "handled",
          response: {
            kind: "information-answer",
            answer: "The original delivered answer.",
          },
        });
        expect(restarted.telegramMessages()).toEqual([]);
      } finally {
        restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retries the exact saved reply after a delivery failure and restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-recovery-"));
    const statePath = join(directory, "operations.sqlite");
    const update = {
      updateId: 7007,
      message: {
        messageId: 87,
        senderId: "100000001",
        chatId: "100000001",
        text: "What is the recovery state?",
      },
    } as const;

    try {
      const unavailable = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "Recovery remains explicit and durable.",
        telegram: {
          ceoTelegramId: "100000001",
          deliveryFailure: {
            class: "unavailable",
            retryable: true,
            message: "Telegram is temporarily unavailable.",
          },
        },
      });
      await expect(unavailable.receiveTelegramUpdate(update)).resolves.toMatchObject({
        kind: "handled",
        response: { answer: "Recovery remains explicit and durable." },
      });
      expect(unavailable.telegramMessages()).toEqual([]);
      unavailable.close();

      const recovered = createRealMingSystemHarness({
        statePath,
        controlledQuestionAnswer: "This answer must not replace the saved result.",
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(recovered.receiveTelegramUpdate(update)).resolves.toMatchObject({
          kind: "handled",
          response: { answer: "Recovery remains explicit and durable." },
        });
        expect(recovered.telegramMessages()).toEqual([
          {
            chatId: "100000001",
            text: "Recovery remains explicit and durable.",
          },
        ]);
      } finally {
        recovered.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("denies an allowlisted CEO sender outside the allowlisted private chat", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: {
        ceoTelegramId: "100000001",
        ceoTelegramChatId: "100000001",
      },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 7005,
        message: {
          messageId: 85,
          senderId: "100000001",
          chatId: "-100900000005",
          text: "/do Disclose the private operating picture here",
        },
      });

      expect(result).toEqual({
        kind: "denied",
        reason: "private-chat-required",
      });
      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([]);
      const audit = harness.telegramAuditTrail();
      expect(audit).toMatchObject([
        {
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          type: "telegram.ingress-denied",
          details: { updateId: 7005, reason: "private-chat-required" },
        },
      ]);
      expect(JSON.stringify(audit)).not.toContain("-100900000005");
      expect(JSON.stringify(audit)).not.toContain(
        "Disclose the private operating picture here",
      );
    } finally {
      harness.close();
    }
  });

  it("denies a matching chat identifier when Telegram says it is not private", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: {
        ceoTelegramId: "100000001",
        ceoTelegramChatId: "100000001",
      },
    });

    try {
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 70050,
          message: {
            messageId: 850,
            senderId: "100000001",
            chatId: "100000001",
            chatType: "supergroup",
            text: "/do This group must not become the private front door",
          },
        }),
      ).resolves.toEqual({
        kind: "denied",
        reason: "private-chat-required",
      });
      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("handles unsupported Telegram media without poisoning identity enforcement", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7010,
          unsupported: {
            senderId: "200000002",
            chatId: "200000002",
            kind: "unsupported-message",
          },
        }),
      ).resolves.toEqual({
        kind: "denied",
        reason: "ceo-identity-required",
      });
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7011,
          unsupported: {
            senderId: "100000001",
            chatId: "100000001",
            kind: "unsupported-message",
          },
        }),
      ).resolves.toEqual({ kind: "rejected", reason: "unsupported-update" });
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7012,
          unattributed: { kind: "unsupported-update" },
        }),
      ).resolves.toEqual({
        kind: "denied",
        reason: "ceo-identity-required",
      });

      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([
        {
          chatId: "100000001",
          text: "This Telegram update type is not supported.",
        },
      ]);
      expect(harness.telegramAuditTrail()).toContainEqual(
        expect.objectContaining({
          type: "telegram.ingress-rejected",
          details: expect.objectContaining({
            updateId: 7011,
            reason: "unsupported-update",
          }),
        }),
      );
      expect(harness.telegramAuditTrail()).toContainEqual(
        expect.objectContaining({
          actorId: "external:telegram:unattributed",
          type: "telegram.ingress-denied",
          details: expect.objectContaining({ updateId: 7012 }),
        }),
      );
    } finally {
      harness.close();
    }
  });

  it("returns one focused clarification for an ambiguous Telegram request", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 7003,
        message: {
          messageId: 83,
          senderId: "100000001",
          chatId: "100000001",
          text: "Handle the project situation",
        },
      });

      expect(result).toEqual({
        kind: "handled",
        response: {
          kind: "clarification",
          question:
            "What specific outcome should Real-Ming produce for this request?",
        },
      });
      expect(harness.workItems()).toEqual([]);
      expect(harness.telegramMessages()).toEqual([
        {
          chatId: "100000001",
          text: "What specific outcome should Real-Ming produce for this request?",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("acknowledges a Telegram action and defaults it to the COO", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 7004,
        message: {
          messageId: 84,
          senderId: "100000001",
          chatId: "100000001",
          text: "/do Record the current Daily Operations status",
        },
      });

      expect(result).toMatchObject({
        kind: "handled",
        response: {
          kind: "work-item-acknowledgement",
          workItem: {
            intent: "Record the current Daily Operations status",
            accountableExecutive: "COO",
            state: "Captured",
            expectedEffect: {
              kind: "telegram-request",
              value: "Record the current Daily Operations status",
            },
          },
        },
      });
      expect(harness.workItems()).toHaveLength(1);
      expect(harness.controlledEffects()).toEqual([]);
      if (
        result.kind !== "handled" ||
        result.response.kind !== "work-item-acknowledgement"
      ) {
        throw new Error("Expected a Telegram Work Item acknowledgement.");
      }
      expect(harness.telegramMessages()).toEqual([
        {
          chatId: "100000001",
          text: `Acknowledged as Work Item ${result.response.workItem.id} · COO · Captured.`,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it.each([
    ["COO", "COO"],
    ["CTO", "CTO"],
    ["CFO", "Personal CFO"],
    ["CAO", "CAO"],
    ["CMO", "CMO"],
  ] as const)(
    "routes an explicitly addressed %s Telegram action directly to the %s",
    async (address, accountableExecutive) => {
      const harness = createRealMingSystemHarness({
        statePath: ":memory:",
        telegram: { ceoTelegramId: "100000001" },
      });

      try {
        const result = await harness.receiveTelegramUpdate({
          updateId: 7100 + address.length,
          message: {
            messageId: 90 + address.length,
            senderId: "100000001",
            chatId: "100000001",
            text: `${address}: Prepare one bounded executive outcome`,
          },
        });

        expect(result).toMatchObject({
          kind: "handled",
          response: {
            kind: "work-item-acknowledgement",
            workItem: {
              intent: "Prepare one bounded executive outcome",
              accountableExecutive,
              state: "Captured",
            },
          },
        });
      } finally {
        harness.close();
      }
    },
  );

  it("applies an exact approve control once and rejects its replay", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-08-28T07:00:00.000Z",
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:approve",
        text: "Prepare one reviewable outcome",
        expectedEffect: {
          kind: "record-note",
          value: "Reviewable outcome prepared",
        },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);

      const controls = await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      await expect(
        harness.publishTelegramReviewControls({
          workItemId: acknowledgement.workItem.id,
        }),
      ).resolves.toEqual(controls);
      expect(harness.telegramMessages()).toHaveLength(1);
      expect(controls.map((control) => control.decision)).toEqual([
        "approve",
        "request-changes",
        "reject",
        "cancel",
      ]);
      const approve = controls.find(
        (control) => control.decision === "approve",
      );
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }

      const applied = await harness.receiveTelegramUpdate({
        updateId: 7201,
        callbackQuery: {
          queryId: "callback:approve:1",
          senderId: "100000001",
          chatId: "100000001",
          data: approve.callbackData,
        },
      });
      expect(applied).toMatchObject({
        kind: "control-applied",
        decision: "approve",
        workItem: { state: "Completed" },
      });

      const replayed = await harness.receiveTelegramUpdate({
        updateId: 7202,
        callbackQuery: {
          queryId: "callback:approve:2",
          senderId: "100000001",
          chatId: "100000001",
          data: approve.callbackData,
        },
      });
      expect(replayed).toEqual({
        kind: "control-rejected",
        reason: "control-used",
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Completed",
      );
      expect(harness.telegramAuditTrail().at(-1)).toMatchObject({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        type: "telegram.review-control-rejected",
        details: { updateId: 7202, reason: "control-used" },
      });
    } finally {
      harness.close();
    }
  });

  it("recovers an exact review decision after a crash between review and control finalization", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-review-recovery-"));
    const statePath = join(directory, "operations.sqlite");
    let workItemId = "";
    let callbackData = "";
    const callbackUpdate = () => ({
      updateId: 7249,
      callbackQuery: {
        queryId: "callback:approve:recovery",
        senderId: "100000001",
        chatId: "100000001",
        data: callbackData,
      },
    });

    try {
      const interrupted = createRealMingSystemHarness({
        statePath,
        telegram: {
          ceoTelegramId: "100000001",
          afterReviewAppliedError: "simulated review-finalization crash",
        },
        now: () => "2026-08-28T07:00:00.000Z",
      });
      const acknowledgement = await interrupted.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:crash-recovery",
        text: "Prepare a review result that survives finalization failure",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      workItemId = acknowledgement.workItem.id;
      await interrupted.executeWorkItem(workItemId);
      const controls = await interrupted.publishTelegramReviewControls({
        workItemId,
      });
      const approve = controls.find((entry) => entry.decision === "approve");
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }
      callbackData = approve.callbackData;

      await expect(
        interrupted.receiveTelegramUpdate(callbackUpdate()),
      ).rejects.toThrow("simulated review-finalization crash");
      expect(interrupted.workItem(workItemId)?.state).toBe("Completed");
      interrupted.close();

      const recovered = createRealMingSystemHarness({
        statePath,
        telegram: { ceoTelegramId: "100000001" },
        now: () => "2026-08-28T07:01:00.000Z",
      });
      try {
        await expect(
          recovered.receiveTelegramUpdate(callbackUpdate()),
        ).resolves.toMatchObject({
          kind: "control-applied",
          decision: "approve",
          workItem: { id: workItemId, state: "Completed" },
        });
        expect(
          recovered
            .auditTrail(workItemId)
            .filter((event) => event.type === "work-item.completed"),
        ).toHaveLength(1);
        expect(recovered.telegramAuditTrail()).toContainEqual(
          expect.objectContaining({
            type: "telegram.review-control-applied",
            details: expect.objectContaining({ workItemId, state: "used" }),
          }),
        );
      } finally {
        recovered.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not resume an unexecuted claimed review after its policy expiry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-claim-expiry-"));
    const statePath = join(directory, "operations.sqlite");
    let clock = "2026-08-28T07:00:00.000Z";
    let workItemId = "";
    let callbackData = "";
    const update = () => ({
      updateId: 72490,
      callbackQuery: {
        queryId: "callback:approve:expired-claim",
        senderId: "100000001",
        chatId: "100000001",
        data: callbackData,
      },
    });

    try {
      const interrupted = createRealMingSystemHarness({
        statePath,
        now: () => clock,
        telegram: {
          ceoTelegramId: "100000001",
          afterReviewControlClaimedError: "simulated crash after control claim",
        },
      });
      const acknowledgement = await interrupted.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:expired-claim",
        text: "Prepare a review that must not outlive its authority",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      workItemId = acknowledgement.workItem.id;
      await interrupted.executeWorkItem(workItemId);
      const controls = await interrupted.publishTelegramReviewControls({
        workItemId,
      });
      const approve = controls.find((entry) => entry.decision === "approve");
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }
      callbackData = approve.callbackData;
      await expect(interrupted.receiveTelegramUpdate(update())).rejects.toThrow(
        "simulated crash after control claim",
      );
      expect(interrupted.workItem(workItemId)?.state).toBe(
        "Ready for CEO Review",
      );
      interrupted.close();

      clock = "2026-08-28T07:16:00.000Z";
      const restarted = createRealMingSystemHarness({
        statePath,
        now: () => clock,
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(restarted.receiveTelegramUpdate(update())).resolves.toEqual({
          kind: "control-rejected",
          reason: "control-expired",
        });
        expect(restarted.workItem(workItemId)?.state).toBe(
          "Ready for CEO Review",
        );
      } finally {
        restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not let a foreign Telegram identity consume a valid review control", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-08-28T07:00:00.000Z",
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:foreign",
        text: "Prepare an outcome protected from foreign callbacks",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);
      const controls = await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      const approve = controls.find((entry) => entry.decision === "approve");
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }

      const denied = await harness.receiveTelegramUpdate({
        updateId: 7251,
        callbackQuery: {
          queryId: "callback:foreign",
          senderId: "200000002",
          chatId: "200000002",
          data: approve.callbackData,
        },
      });
      expect(denied).toEqual({
        kind: "denied",
        reason: "ceo-identity-required",
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Ready for CEO Review",
      );

      const applied = await harness.receiveTelegramUpdate({
        updateId: 7252,
        callbackQuery: {
          queryId: "callback:ceo",
          senderId: "100000001",
          chatId: "100000001",
          data: approve.callbackData,
        },
      });
      expect(applied).toMatchObject({
        kind: "control-applied",
        workItem: { state: "Completed" },
      });
      expect(JSON.stringify(harness.telegramAuditTrail())).not.toContain(
        "200000002",
      );
    } finally {
      harness.close();
    }
  });

  it.each([
    ["reject", "Cancelled"],
    ["cancel", "Cancelled"],
  ] as const)(
    "applies a one-time %s control to the exact Review-Ready target",
    async (decision, expectedState) => {
      const harness = createRealMingSystemHarness({
        statePath: ":memory:",
        telegram: { ceoTelegramId: "100000001" },
        now: () => "2026-08-28T07:00:00.000Z",
      });

      try {
        const acknowledgement = await harness.submitCeoCommand({
          actorId: "ceo:ming",
          workspaceId: "workspace:real-ming",
          idempotencyKey: `telegram:review-control:${decision}`,
          text: `Prepare the ${decision} outcome`,
          expectedEffect: {
            kind: "record-note",
            value: `${decision} outcome prepared`,
          },
        });
        if (acknowledgement.kind !== "work-item-acknowledgement") {
          throw new Error("Expected a Work Item acknowledgement.");
        }
        await harness.executeWorkItem(acknowledgement.workItem.id);
        const controls = await harness.publishTelegramReviewControls({
          workItemId: acknowledgement.workItem.id,
        });
        const control = controls.find((entry) => entry.decision === decision);
        if (control === undefined) {
          throw new Error(`Expected the ${decision} control.`);
        }

        const result = await harness.receiveTelegramUpdate({
          updateId: 7300 + decision.length,
          callbackQuery: {
            queryId: `callback:${decision}`,
            senderId: "100000001",
            chatId: "100000001",
            data: control.callbackData,
          },
        });

        expect(result).toMatchObject({
          kind: "control-applied",
          decision,
          workItem: { state: expectedState },
        });
        expect(harness.auditTrail(acknowledgement.workItem.id).at(-1)).toMatchObject({
          details: { decision },
        });
      } finally {
        harness.close();
      }
    },
  );

  it("collects an actionable CEO reason before applying Request Changes", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-08-28T07:00:00.000Z",
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:reason",
        text: "Prepare an outcome that needs a precise revision",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);
      const controls = await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      const requestChanges = controls.find(
        (entry) => entry.decision === "request-changes",
      );
      if (requestChanges === undefined) {
        throw new Error("Expected a Request Changes control.");
      }
      const controlId = requestChanges.callbackData.replace("rm-review:", "");

      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7351,
          callbackQuery: {
            queryId: "callback:request-changes:reason",
            senderId: "100000001",
            chatId: "100000001",
            data: requestChanges.callbackData,
          },
        }),
      ).resolves.toMatchObject({
        kind: "control-awaiting-reason",
        decision: "request-changes",
        workItemId: acknowledgement.workItem.id,
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Ready for CEO Review",
      );

      const sensitive = `sk-${"b".repeat(20)}`;
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7352,
          message: {
            messageId: 152,
            senderId: "100000001",
            chatId: "100000001",
            text: `/changes ${controlId} Replace it with ${sensitive}`,
          },
        }),
      ).resolves.toEqual({
        kind: "rejected",
        reason: "sensitive-secret-rejected",
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Ready for CEO Review",
      );
      expect(JSON.stringify(harness.telegramAuditTrail())).not.toContain(
        sensitive,
      );

      const reason = "Replace the unsupported estimate with cited evidence.";
      await expect(
        harness.receiveTelegramUpdate({
          updateId: 7353,
          message: {
            messageId: 153,
            senderId: "100000001",
            chatId: "100000001",
            text: `/changes ${controlId} ${reason}`,
          },
        }),
      ).resolves.toMatchObject({
        kind: "control-applied",
        decision: "request-changes",
        workItem: { state: "Changes Requested" },
      });
      expect(harness.auditTrail(acknowledgement.workItem.id).at(-1)).toMatchObject({
        details: { decision: "request-changes", reason },
      });
    } finally {
      harness.close();
    }
  });

  it("derives review-control expiry from the high-risk Telegram policy", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-08-28T07:00:00.000Z",
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:policy-expiry",
        text: "Prepare an outcome for policy expiry validation",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);

      await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      expect(harness.telegramAuditTrail()).toContainEqual(
        expect.objectContaining({
          type: "telegram.review-controls-issued",
          details: expect.objectContaining({
            expiresAt: "2026-08-28T07:15:00.000Z",
            expiryPolicy: "high-risk-exact-target-15m",
          }),
        }),
      );
    } finally {
      harness.close();
    }
  });

  it("rejects an expired review control without changing Review-Ready Work", async () => {
    let clock = "2026-08-28T07:00:00.000Z";
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => clock,
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:expired",
        text: "Prepare an outcome whose control will expire",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);
      const controls = await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      const approve = controls.find((entry) => entry.decision === "approve");
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }

      clock = "2026-08-28T07:15:00.000Z";
      const result = await harness.receiveTelegramUpdate({
        updateId: 7401,
        callbackQuery: {
          queryId: "callback:expired",
          senderId: "100000001",
          chatId: "100000001",
          data: approve.callbackData,
        },
      });

      expect(result).toEqual({
        kind: "control-rejected",
        reason: "control-expired",
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Ready for CEO Review",
      );
      expect(harness.telegramAuditTrail()).toContainEqual(
        expect.objectContaining({
          type: "telegram.review-control-rejected",
          details: expect.objectContaining({
            reason: "control-expired",
            state: "expired",
          }),
        }),
      );
    } finally {
      harness.close();
    }
  });

  it("invalidates a control when a new Outcome Report supersedes its target", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      now: () => "2026-08-28T07:00:00.000Z",
    });

    try {
      const acknowledgement = await harness.submitCeoCommand({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        idempotencyKey: "telegram:review-control:superseded",
        text: "Prepare an outcome that will be revised",
        expectedEffect: { kind: "record-note", value: "Outcome prepared" },
      });
      if (acknowledgement.kind !== "work-item-acknowledgement") {
        throw new Error("Expected a Work Item acknowledgement.");
      }
      await harness.executeWorkItem(acknowledgement.workItem.id);
      const controls = await harness.publishTelegramReviewControls({
        workItemId: acknowledgement.workItem.id,
      });
      const approve = controls.find((entry) => entry.decision === "approve");
      if (approve === undefined) {
        throw new Error("Expected an approve control.");
      }

      await harness.reviewWorkItem({
        workItemId: acknowledgement.workItem.id,
        actorId: "ceo:ming",
        decision: "request-changes",
        reason: "Produce a corrected revision",
      });
      const revised = await harness.reworkWorkItem(acknowledgement.workItem.id);
      expect(revised.outcomeReport.revision).toBe(2);

      const result = await harness.receiveTelegramUpdate({
        updateId: 7402,
        callbackQuery: {
          queryId: "callback:superseded",
          senderId: "100000001",
          chatId: "100000001",
          data: approve.callbackData,
        },
      });

      expect(result).toEqual({
        kind: "control-rejected",
        reason: "target-changed",
      });
      expect(harness.workItem(acknowledgement.workItem.id)?.state).toBe(
        "Ready for CEO Review",
      );
      expect(harness.outcomeReport(acknowledgement.workItem.id)?.revision).toBe(
        2,
      );
    } finally {
      harness.close();
    }
  });

  it("sends only configured CEO notification classes", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
    });

    try {
      const allowed = [
        ["brief", "07:30 Daily Operations brief"],
        ["approval", "Approval required for an exact target"],
        ["material-blocker", "A material blocker needs CEO action"],
        ["critical-incident", "A critical scheduler failed"],
        ["completed-outcome-report", "One Outcome Report is complete"],
        ["recovery-notice", "The scheduler recovered"],
      ] as const;

      for (const [kind, text] of allowed) {
        await expect(
          harness.notifyTelegram({
            kind,
            text,
            idempotencyKey: `telegram:notification:${kind}`,
          }),
        ).resolves.toEqual({ kind: "sent", notificationKind: kind });
      }
      await expect(
        harness.notifyTelegram({
          kind: "routine-progress",
          text: "A routine internal step finished",
          idempotencyKey: "telegram:notification:routine-progress",
        }),
      ).resolves.toEqual({
        kind: "suppressed",
        notificationKind: "routine-progress",
      });
      await expect(
        harness.notifyTelegram({
          kind: "brief",
          text: "07:30 Daily Operations brief",
          idempotencyKey: "telegram:notification:brief",
        }),
      ).resolves.toEqual({ kind: "sent", notificationKind: "brief" });

      expect(harness.telegramMessages().map((message) => message.text)).toEqual(
        allowed.map(([, text]) => text),
      );
      expect(
        harness.telegramMessages().every(
          (message) => message.chatId === "100000001",
        ),
      ).toBe(true);
    } finally {
      harness.close();
    }
  });

  it("preserves and audits a normalized Telegram delivery failure", async () => {
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: {
        ceoTelegramId: "100000001",
        deliveryFailure: {
          class: "rate-limited",
          retryable: true,
          retryAfterMs: 30_000,
          message: "Telegram rate limited the bot operation.",
        },
      },
    });

    try {
      await expect(
        harness.notifyTelegram({
          kind: "brief",
          text: "A brief that cannot be delivered yet",
          idempotencyKey: "telegram:notification:failed-brief",
        }),
      ).resolves.toEqual({
        kind: "failed",
        notificationKind: "brief",
        failure: {
          class: "rate-limited",
          retryable: true,
          retryAfterMs: 30_000,
          message: "Telegram rate limited the bot operation.",
        },
      });
      expect(harness.telegramMessages()).toEqual([]);
      expect(harness.telegramAuditTrail().at(-1)).toMatchObject({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        type: "telegram.delivery-failed",
        details: {
          idempotencyKey: "telegram:notification:failed-brief",
          failureClass: "rate-limited",
          retryable: true,
          retryAfterMs: 30_000,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("retries a retained failed delivery without replaying its originating command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-outbox-retry-"));
    const statePath = join(directory, "operations.sqlite");
    const notification = {
      kind: "material-blocker" as const,
      text: "A retained material blocker",
      idempotencyKey: "telegram:notification:retained-retry",
    };

    try {
      const unavailable = createRealMingSystemHarness({
        statePath,
        telegram: {
          ceoTelegramId: "100000001",
          deliveryFailure: {
            class: "unavailable",
            retryable: true,
            message: "Telegram is temporarily unavailable.",
          },
        },
      });
      await expect(unavailable.notifyTelegram(notification)).resolves.toMatchObject({
        kind: "failed",
      });
      unavailable.close();

      const recovered = createRealMingSystemHarness({
        statePath,
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(recovered.retryPendingTelegramDeliveries()).resolves.toEqual({
          attempted: 1,
          sent: 1,
          failed: 0,
          uncertain: 0,
        });
        expect(recovered.telegramMessages()).toEqual([
          { chatId: "100000001", text: notification.text },
        ]);
      } finally {
        recovered.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not retry a rate-limited delivery before retryAfterMs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-retry-after-"));
    const statePath = join(directory, "operations.sqlite");
    let clock = "2026-08-28T07:00:00.000Z";
    const notification = {
      kind: "brief" as const,
      text: "A rate-limited Daily Operations brief",
      idempotencyKey: "telegram:notification:retry-after",
    };

    try {
      const limited = createRealMingSystemHarness({
        statePath,
        now: () => clock,
        telegram: {
          ceoTelegramId: "100000001",
          deliveryFailure: {
            class: "rate-limited",
            retryable: true,
            retryAfterMs: 30_000,
            message: "Telegram rate limited the bot operation.",
          },
        },
      });
      await expect(limited.notifyTelegram(notification)).resolves.toMatchObject({
        kind: "failed",
      });
      limited.close();

      const recovered = createRealMingSystemHarness({
        statePath,
        now: () => clock,
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        clock = "2026-08-28T07:00:29.999Z";
        await expect(recovered.retryPendingTelegramDeliveries()).resolves.toEqual({
          attempted: 0,
          sent: 0,
          failed: 0,
          uncertain: 0,
        });
        expect(recovered.telegramMessages()).toEqual([]);

        clock = "2026-08-28T07:00:30.000Z";
        await expect(recovered.retryPendingTelegramDeliveries()).resolves.toEqual({
          attempted: 1,
          sent: 1,
          failed: 0,
          uncertain: 0,
        });
        expect(recovered.telegramMessages()).toHaveLength(1);
      } finally {
        recovered.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not repeat a delivery whose outcome became uncertain after send", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-outbox-uncertain-"));
    const statePath = join(directory, "operations.sqlite");
    const notification = {
      kind: "critical-incident" as const,
      text: "One critical incident",
      idempotencyKey: "telegram:notification:uncertain",
    };

    try {
      const interrupted = createRealMingSystemHarness({
        statePath,
        telegram: {
          ceoTelegramId: "100000001",
          crashAfterDelivery: "simulated crash after provider delivery",
        },
      });
      await expect(interrupted.notifyTelegram(notification)).resolves.toMatchObject({
        kind: "failed",
        failure: {
          class: "provider-error",
          retryable: false,
          message: expect.stringContaining("uncertain"),
        },
      });
      expect(interrupted.telegramMessages()).toHaveLength(1);
      interrupted.close();

      const restarted = createRealMingSystemHarness({
        statePath,
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(restarted.notifyTelegram(notification)).resolves.toMatchObject({
          kind: "failed",
          failure: { class: "provider-error", retryable: false },
        });
        expect(restarted.telegramMessages()).toEqual([]);
        await expect(restarted.retryPendingTelegramDeliveries()).resolves.toEqual({
          attempted: 0,
          sent: 0,
          failed: 0,
          uncertain: 1,
        });
      } finally {
        restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not repeat a delivered notification after a process restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm07-delivery-"));
    const statePath = join(directory, "operations.sqlite");
    const notification = {
      kind: "brief" as const,
      text: "One durable Daily Operations brief",
      idempotencyKey: "telegram:notification:restart-safe",
    };

    try {
      const first = createRealMingSystemHarness({
        statePath,
        telegram: { ceoTelegramId: "100000001" },
      });
      await expect(first.notifyTelegram(notification)).resolves.toMatchObject({
        kind: "sent",
      });
      expect(first.telegramMessages()).toHaveLength(1);
      first.close();

      const restarted = createRealMingSystemHarness({
        statePath,
        telegram: { ceoTelegramId: "100000001" },
      });
      try {
        await expect(restarted.notifyTelegram(notification)).resolves.toMatchObject({
          kind: "sent",
        });
        expect(restarted.telegramMessages()).toEqual([]);
        const auditTypes = restarted
          .telegramAuditTrail()
          .map((event) => event.type);
        expect(
          auditTypes.filter((type) => type === "telegram.notification-sent"),
        ).toHaveLength(1);
        expect(auditTypes.at(-1)).toBe("telegram.delivery-deduplicated");
      } finally {
        restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
