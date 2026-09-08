import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createHermesRuntimeClient,
} from "../../src/hermes/hermes-runtime-client.js";
import {
  createHermesSessionStore,
} from "../../src/hermes/hermes-session-store.js";

const response = {
  sessionId: "hermes:session:ming",
  turnId: "turn-1",
  plan: {
    intent: "answer",
    answer: "The governed answer.",
    contextRequests: [],
    toolRequests: [],
  },
};

describe("Hermes runtime boundary", () => {
  it("creates a durable Hermes session and sends a bounded authenticated chat", async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const client = createHermesRuntimeClient({
      baseUrl: "http://127.0.0.1:18181/",
      sharedSecret: "hermes-test-shared-secret",
      fetch: async (input, init) => {
        const url = String(input);
        calls.push(init === undefined ? { url } : { url, init });
        if (url.endsWith("/api/sessions")) {
          return Response.json(
            { object: "hermes.session", session: { id: response.sessionId } },
            { status: 201 },
          );
        }
        if (url.endsWith("/api/sessions/hermes%3Asession%3Aming/chat")) {
          return Response.json({
            object: "hermes.session.chat.completion",
            session_id: response.sessionId,
            message: {
              role: "assistant",
              content: JSON.stringify(response.plan),
            },
            usage: { input_tokens: 12, output_tokens: 7 },
            runtime: { model: "gpt-5.6-sol" },
          });
        }
        throw new Error(`Unexpected Hermes request: ${url}`);
      },
    });

    const result = await client.turn({
      sessionId: response.sessionId,
      turnId: response.turnId,
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      text: "What is the current plan?",
    });

    expect(result).toMatchObject(response);
    expect(result.usage).toMatchObject({
      provider: "other",
      model: "gpt-5.6-sol",
      inputTokens: 12,
      outputTokens: 7,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("http://127.0.0.1:18181/api/sessions");
    expect(calls[1]?.url).toBe(
      "http://127.0.0.1:18181/api/sessions/hermes%3Asession%3Aming/chat",
    );
    expect((calls[1]?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer hermes-test-shared-secret",
    );
    expect(
      (calls[1]?.init?.headers as Record<string, string>)[
        "X-Hermes-Session-Key"
      ],
    ).toBe("real-ming:telegram:hermes:session:ming");
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(JSON.parse(String(body["message"]))).toMatchObject({
      schema: "real-ming.hermes.turn.v1",
      turnId: response.turnId,
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      request: "What is the current plan?",
    });
    expect(body["system_message"]).toEqual(expect.any(String));
  });

  it("returns a classified provider failure without leaking the shared secret", async () => {
    const client = createHermesRuntimeClient({
      baseUrl: "http://127.0.0.1:18181",
      sharedSecret: "hermes-test-shared-secret",
      fetch: async (input) =>
        String(input).endsWith("/api/sessions")
          ? Response.json({ error: "upstream unavailable" }, { status: 503 })
          : new Response("upstream hermes-test-shared-secret failed", {
              status: 503,
            }),
    });

    await expect(
      client.turn({
        sessionId: response.sessionId,
        turnId: response.turnId,
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        text: "Hello",
      }),
    ).rejects.toMatchObject({
      failure: {
        class: "unavailable",
        retryable: true,
        message: "Hermes is temporarily unavailable.",
      },
    });
  });

  it("rejects malformed model plans before they can reach the control plane", async () => {
    const client = createHermesRuntimeClient({
      baseUrl: "http://127.0.0.1:18181",
      sharedSecret: "hermes-test-shared-secret",
      fetch: async (input) =>
        String(input).endsWith("/api/sessions")
          ? Response.json(
              { object: "hermes.session", session: { id: response.sessionId } },
              { status: 201 },
            )
          : Response.json({
              session_id: response.sessionId,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  intent: "answer",
                  answer: "",
                  contextRequests: [],
                  toolRequests: [],
                }),
              },
            }),
    });

    await expect(
      client.turn({
        sessionId: response.sessionId,
        turnId: response.turnId,
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
        text: "Hello",
      }),
    ).rejects.toMatchObject({
      failure: { class: "provider-error", retryable: true },
    });
  });
});

describe("Hermes conversation persistence", () => {
  it("reopens the Telegram-to-Hermes session mapping after a process restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-hermes-store-"));
    const path = join(directory, "hermes.sqlite");
    try {
      const store = createHermesSessionStore(path);
      store.bindTelegramSession("telegram-chat:100000001", "hermes:session:ming", "2026-09-04T10:00:00.000Z");
      store.recordTurn({
        sessionId: "hermes:session:ming",
        turnId: "turn-1",
        updateId: 7,
        textDigest: "sha256:turn",
        mode: "answer",
        answer: "The governed answer.",
        occurredAt: "2026-09-04T10:00:01.000Z",
      });
      store.close();

      const restarted = createHermesSessionStore(path);
      expect(restarted.sessionForTelegram("telegram-chat:100000001")).toEqual(
        "hermes:session:ming",
      );
      expect(restarted.turn("turn-1")).toMatchObject({
        sessionId: "hermes:session:ming",
        mode: "answer",
        answer: "The governed answer.",
      });
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
