import { describe, expect, it } from "vitest";

import type { HermesRuntimeClient, HermesTurnRequest } from "../../src/hermes/contracts.js";
import { createRealMingSystemHarness } from "../../src/testing/real-ming-system-harness.js";

describe("Hermes-first Telegram coordination", () => {
  it("lets Hermes choose work, creates the governed Work Item, and denies unbound tools", async () => {
    const calls: HermesTurnRequest[] = [];
    const runtime: HermesRuntimeClient = {
      async turn(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            sessionId: request.sessionId,
            turnId: request.turnId,
            plan: {
              intent: "work",
              executive: "CTO",
              answer: "I will inspect the DuitSini feature and prepare the coding loop.",
              workItem: {
                intent: "Implement the DuitSini feature",
                expectedEffect: {
                  kind: "duitsini-feature",
                  value: "Implement, test and report the feature.",
                },
                accountableExecutive: "CTO",
                workstream: "MicroSaaS",
              },
              contextRequests: [],
              toolRequests: [{
                id: "workspace-read-1",
                capability: "workspace.read",
                purpose: "Inspect the project repository.",
                input: { project: "DuitSini" },
                requiresApproval: false,
              }],
            },
          };
        }
        expect(request.toolResults).toEqual([
          {
            requestId: "workspace-read-1",
            status: "denied",
            reason: "This Hermes capability has no governed executor in the current deployment.",
          },
        ]);
        return {
          sessionId: request.sessionId,
          turnId: request.turnId,
          plan: {
            intent: "answer",
            answer: "The coding plan is captured and ready for the governed worker loop.",
            contextRequests: [],
            toolRequests: [],
          },
        };
      },
      async health() {
        return { status: "healthy", model: "controlled-hermes" };
      },
    };

    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      controlledQuestionAnswer: "This must not be used for a Hermes turn.",
      telegram: { ceoTelegramId: "100000001" },
      hermes: { runtime, model: "controlled-hermes" },
    });

    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 8801,
        message: {
          messageId: 91,
          senderId: "100000001",
          chatId: "100000001",
          text: "Develop the new DuitSini feature and run the tests.",
        },
      });

      expect(harness.hermesOverview()).toMatchObject({ status: "healthy" });

      expect(result).toMatchObject({
        kind: "handled",
        response: {
          kind: "hermes-answer",
          intent: "answer",
          answer: "The coding plan is captured and ready for the governed worker loop.",
          workItem: {
            accountableExecutive: "CTO",
            workstream: "MicroSaaS",
            state: "Captured",
          },
        },
      });
      expect(calls).toHaveLength(2);
      expect(harness.workItems()).toMatchObject([
        {
          intent: "Implement the DuitSini feature",
          accountableExecutive: "CTO",
          state: "Captured",
        },
      ]);
      expect(harness.telegramMessages()).toEqual([{
        chatId: "100000001",
        text: "The coding plan is captured and ready for the governed worker loop.",
      }]);

      const replay = await harness.receiveTelegramUpdate({
        updateId: 8801,
        message: {
          messageId: 91,
          senderId: "100000001",
          chatId: "100000001",
          text: "Develop the new DuitSini feature and run the tests.",
        },
      });
      expect(replay).toEqual(result);
      expect(calls).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("keeps raw Hermes failures out of the operator overview", async () => {
    const runtime: HermesRuntimeClient = {
      async turn() {
        throw new Error("provider URL https://example.test/api?token=secret-shaped-value");
      },
      async health() {
        return { status: "failed", failure: "provider URL https://example.test/api?token=secret-shaped-value" };
      },
    };
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      hermes: { runtime, model: "controlled-hermes" },
    });
    try {
      await harness.receiveTelegramUpdate({
        updateId: 8802,
        message: {
          messageId: 92,
          senderId: "100000001",
          chatId: "100000001",
          text: "Please answer this safely.",
        },
      });
      expect(harness.hermesOverview()).toMatchObject({
        status: "failed",
        lastFailure: "provider-error",
      });
      expect(harness.hermesOverview()?.lastFailure).not.toContain("secret-shaped-value");
    } finally {
      harness.close();
    }
  });

  it("records an exact Hermes-proposed Approval before consequential work", async () => {
    const calls: HermesTurnRequest[] = [];
    const runtime: HermesRuntimeClient = {
      async turn(request) {
        calls.push(request);
        if (calls.length === 1) {
          return {
            sessionId: request.sessionId,
            turnId: request.turnId,
            plan: {
              intent: "work",
              executive: "CTO",
              answer: "I will prepare the reviewed deployment candidate.",
              workItem: {
                intent: "Prepare a DuitSini deployment candidate",
                expectedEffect: {
                  kind: "deployment-candidate",
                  value: "Prepare and verify the exact candidate; do not deploy.",
                },
                accountableExecutive: "CTO",
                workstream: "MicroSaaS",
              },
              approvalRequest: {
                scope: "code-promotion",
                target: {
                  type: "github-commit",
                  identity: "pmgwee/duit-sini",
                  version: "abc123",
                },
                riskClass: "high",
              },
              contextRequests: [],
              toolRequests: [],
            },
          };
        }
        expect(request.toolResults).toEqual([{
          requestId: expect.stringContaining(":approval"),
          status: "completed",
          output: {
            state: "awaiting-approval",
            approvalId: expect.any(String),
            scope: "code-promotion",
            targetVersion: "abc123",
          },
        }]);
        return {
          sessionId: request.sessionId,
          turnId: request.turnId,
          plan: {
            intent: "answer",
            answer: "The candidate is waiting for your exact approval.",
            contextRequests: [],
            toolRequests: [],
          },
        };
      },
      async health() {
        return { status: "healthy", model: "controlled-hermes" };
      },
    };
    const harness = createRealMingSystemHarness({
      statePath: ":memory:",
      telegram: { ceoTelegramId: "100000001" },
      hermes: { runtime },
    });
    try {
      const result = await harness.receiveTelegramUpdate({
        updateId: 8803,
        message: {
          messageId: 93,
          senderId: "100000001",
          chatId: "100000001",
          text: "Prepare the exact DuitSini deployment candidate.",
        },
      });
      expect(result).toMatchObject({
        kind: "handled",
        response: {
          kind: "hermes-answer",
          answer: "The candidate is waiting for your exact approval.",
          workItem: { state: "Awaiting Approval", accountableExecutive: "CTO" },
        },
      });
      const workItem = harness.workItems()[0];
      if (workItem === undefined) throw new Error("Expected a Work Item.");
      expect(harness.approvals(workItem.id)).toEqual([
        expect.objectContaining({
          scope: "code-promotion",
          targetIdentity: "pmgwee/duit-sini",
          targetVersion: "abc123",
          riskClass: "high",
          state: "requested",
        }),
      ]);
      expect(calls).toHaveLength(2);
    } finally {
      harness.close();
    }
  });
});
