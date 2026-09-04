import { detectSensitiveFields } from "../operations/sensitive-secret.js";
import { providerFailure, type ProviderFailure } from "../providers/adapter-contract.js";
import {
  executiveRoles,
  riskClasses,
  trustDomains,
  workstreams,
  type ApprovalScope,
  type ExecutiveRole,
  type ExpectedEffect,
} from "../operations/contracts.js";
import {
  type HermesApprovalProposal,
  type HermesContextRequest,
  hermesIntentKinds,
  type HermesRuntimeClient,
  type HermesToolRequest,
  type HermesTurnPlan,
  type HermesTurnRequest,
  type HermesTurnResponse,
  type HermesUsage,
  type HermesWorkItemProposal,
} from "./contracts.js";

type JsonRecord = Readonly<Record<string, unknown>>;

export class HermesRuntimeError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure.message);
    this.name = "HermesRuntimeError";
  }
}

export interface HermesRuntimeClientOptions {
  /** The loopback/private Hermes API-server URL, never a public browser URL. */
  readonly baseUrl: string;
  /** Hermes API_SERVER_KEY. The value is read from the environment/secret store. */
  readonly sharedSecret: string;
  /** Optional per-conversation memory scope. Defaults to a Real-Ming session key. */
  readonly sessionKeyPrefix?: string;
  /** Pin the model/provider configured in Hermes for the Real-Ming runtime. */
  readonly model?: string;
  readonly provider?: string;
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
}

const defaultTimeoutMs = 120_000;
const defaultMaxResponseBytes = 256 * 1024;
const maxTextChars = 64_000;
const maxRequests = 32;
const maxInputFields = 32;

const outputSchemaInstruction = [
  "You are Hermes, the intelligence runtime inside the Real-Ming control plane.",
  "Interpret the CEO request first. Do not pretend Real-Ming is the reasoning engine.",
  "Return ONLY one JSON object (no Markdown, no preamble) with this exact shape:",
  '{"intent":"answer|clarification|research|work","answer":"optional final answer","executive":"optional COO|CTO|Personal CFO|CAO|CMO","workItem":"optional {intent,expectedEffect:{kind,value},accountableExecutive?,workstream?,collaboratingExecutives?,riskClass?}","contextRequests":[{"purpose","workItemId?","executive?","allowedTrustDomains":["Personal|Ming Creatives|Academic|Entertainment|Finance"]}],"toolRequests":[{"id","capability":"context.read|evidence.read|workspace.read|workspace.write|workspace.test|provider.write","purpose","input":{},"requiresApproval":true|false}],"approvalRequest":"optional {scope,target:{type,identity,version},riskClass}"}',
  "Use empty arrays when no context or tools are needed. Never include credentials, tokens, secrets, raw cross-domain memory, chain-of-thought, or hidden reasoning.",
  "For work, explain the proposed outcome in workItem and put the concise user-facing status in answer when possible.",
  "Real-Ming will validate every role, Work Item, projection, approval and tool request before anything executes.",
].join("\n");

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, failureClass: "provider-error" | "invalid-input" = "provider-error"): never {
  throw new HermesRuntimeError(providerFailure(failureClass, message));
}

function nonEmptyText(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail(`Hermes returned an invalid ${field}.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, max = maxTextChars): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max) {
    fail(`Hermes returned an invalid ${field}.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`Hermes returned an invalid ${field}.`);
  }
  return value as T;
}

function validateExpectedEffect(value: unknown): ExpectedEffect {
  if (!isRecord(value)) fail("Hermes returned an invalid Work Item effect.");
  return {
    kind: nonEmptyText(value["kind"], "Work Item effect kind", 128),
    value: nonEmptyText(value["value"], "Work Item effect value", 4_000),
  };
}

function validateCollaborators(value: unknown): HermesWorkItemProposal["collaboratingExecutives"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5) fail("Hermes returned invalid collaborating executives.");
  return value.map((entry) => {
    if (!isRecord(entry)) fail("Hermes returned an invalid collaborating executive.");
    return {
      executive: enumValue(entry["executive"], executiveRoles, "collaborating executive"),
      contribution: nonEmptyText(entry["contribution"], "collaborator contribution", 2_000),
    };
  });
}

function validateWorkItem(value: unknown): HermesWorkItemProposal | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail("Hermes returned an invalid Work Item proposal.");
  const accountableExecutive = value["accountableExecutive"] === undefined
    ? undefined
    : enumValue(value["accountableExecutive"], executiveRoles, "Work Item executive");
  const workstream = value["workstream"] === undefined || value["workstream"] === null
    ? value["workstream"] === null ? null : undefined
    : enumValue(value["workstream"], workstreams, "Work Item workstream");
  const riskClass = value["riskClass"] === undefined
    ? undefined
    : enumValue(value["riskClass"], riskClasses, "Work Item risk class");
  const collaborators = validateCollaborators(value["collaboratingExecutives"]);
  const proposal: HermesWorkItemProposal = {
    intent: nonEmptyText(value["intent"], "Work Item intent", 4_000),
    expectedEffect: validateExpectedEffect(value["expectedEffect"]),
    ...(accountableExecutive === undefined ? {} : { accountableExecutive }),
    ...(workstream === undefined ? {} : { workstream }),
    ...(collaborators === undefined ? {} : { collaboratingExecutives: collaborators }),
    ...(riskClass === undefined ? {} : { riskClass }),
  };
  if (detectSensitiveFields({ intent: proposal.intent, effect: JSON.stringify(proposal.expectedEffect) }).length > 0) {
    fail("Hermes proposed a Work Item containing a Sensitive Secret.", "invalid-input");
  }
  return proposal;
}

const approvalScopes: readonly ApprovalScope[] = [
  "code-promotion",
  "database-migration",
  "production-data-change",
  "external-communication",
  "destructive-action",
  "permission-change",
  "purchase",
  "financial-record-change",
];

function validateApproval(value: unknown): HermesApprovalProposal | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !isRecord(value["target"])) fail("Hermes returned an invalid Approval proposal.");
  const target = value["target"];
  const proposal = {
    scope: enumValue(value["scope"], approvalScopes, "Approval scope"),
    target: {
      type: nonEmptyText(target["type"], "Approval target type", 128),
      identity: nonEmptyText(target["identity"], "Approval target identity", 512),
      version: nonEmptyText(target["version"], "Approval target version", 512),
    },
    riskClass: enumValue(value["riskClass"], riskClasses, "Approval risk class"),
  };
  if (detectSensitiveFields({
    targetType: proposal.target.type,
    targetIdentity: proposal.target.identity,
    targetVersion: proposal.target.version,
  }).length > 0) {
    fail("Hermes proposed an Approval containing a Sensitive Secret.", "invalid-input");
  }
  return proposal;
}

function validateContextRequest(value: unknown): HermesContextRequest {
  if (!isRecord(value)) fail("Hermes returned an invalid context request.");
  const purpose = nonEmptyText(value["purpose"], "context request purpose", 2_000);
  if (detectSensitiveFields({ purpose }).length > 0) {
    fail("Hermes requested Sensitive Secret context.", "invalid-input");
  }
  const allowed = value["allowedTrustDomains"];
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.length > trustDomains.length) {
    fail("Hermes returned an invalid context scope.");
  }
  const allowedTrustDomains = allowed.map((entry) => enumValue(entry, trustDomains, "context Trust Domain"));
  const workItemId = optionalText(value["workItemId"], "context Work Item", 256);
  const executive = value["executive"] === undefined
    ? undefined
    : enumValue(value["executive"], executiveRoles, "context executive");
  return {
    purpose,
    ...(workItemId === undefined ? {} : { workItemId }),
    ...(executive === undefined ? {} : { executive }),
    allowedTrustDomains,
  };
}

function validateToolRequest(value: unknown): HermesToolRequest {
  if (!isRecord(value)) fail("Hermes returned an invalid tool request.");
  const capability = enumValue(
    value["capability"],
    ["context.read", "evidence.read", "workspace.read", "workspace.write", "workspace.test", "provider.write"] as const,
    "tool capability",
  );
  const inputValue = value["input"];
  if (!isRecord(inputValue) || Object.keys(inputValue).length > maxInputFields) {
    fail("Hermes returned an invalid tool input.");
  }
  const input = Object.fromEntries(
    Object.entries(inputValue).map(([key, entry]) => [
      nonEmptyText(key, "tool input key", 128),
      nonEmptyText(entry, "tool input value", 4_000),
    ]),
  );
  const purpose = nonEmptyText(value["purpose"], "tool purpose", 2_000);
  if (detectSensitiveFields({ purpose, input: JSON.stringify(input) }).length > 0) {
    fail("Hermes requested a tool with Sensitive Secret data.", "invalid-input");
  }
  return {
    id: nonEmptyText(value["id"], "tool request id", 256),
    capability,
    purpose,
    input,
    requiresApproval: value["requiresApproval"] === true,
  };
}

function validatePlan(value: unknown): HermesTurnPlan {
  if (!isRecord(value)) fail("Hermes returned no structured plan.");
  const intent = enumValue(value["intent"], hermesIntentKinds, "turn intent");
  const answer = optionalText(value["answer"], "turn answer");
  if ((intent === "answer" || intent === "clarification") && (answer ?? "").trim().length === 0) {
    fail("Hermes returned no answer for the turn.");
  }
  const contexts = value["contextRequests"];
  const tools = value["toolRequests"];
  if (!Array.isArray(contexts) || contexts.length > maxRequests || !Array.isArray(tools) || tools.length > maxRequests) {
    fail("Hermes returned an invalid request list.");
  }
  const contextRequests = contexts.map(validateContextRequest);
  const toolRequests = tools.map(validateToolRequest);
  const executive = value["executive"] === undefined
    ? undefined
    : enumValue(value["executive"], executiveRoles, "executive");
  const workItem = validateWorkItem(value["workItem"]);
  const approvalRequest = validateApproval(value["approvalRequest"]);
  if (approvalRequest !== undefined && workItem === undefined) {
    fail("Hermes Approval proposals require a Work Item.", "invalid-input");
  }
  if (intent === "work" && workItem === undefined && (answer ?? "").trim().length === 0) {
    fail("Hermes work plans require a Work Item proposal or a user-facing answer.");
  }
  return {
    intent,
    ...(answer === undefined ? {} : { answer }),
    ...(executive === undefined ? {} : { executive }),
    ...(workItem === undefined ? {} : { workItem }),
    contextRequests,
    toolRequests,
    ...(approvalRequest === undefined ? {} : { approvalRequest }),
  };
}

function extractPlan(content: unknown): HermesTurnPlan {
  const text = nonEmptyText(content, "assistant content", maxTextChars);
  const candidates = [text];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1]?.trim();
  if (fenced !== undefined) candidates.unshift(fenced);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
    return validatePlan(parsed);
  }
  fail("Hermes returned no parseable structured plan.");
}

function boundedOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`Hermes returned an invalid ${field}.`);
  return value;
}

function parseUsage(value: unknown, runtime: unknown, configuredModel: string | undefined, configuredProvider: string | undefined): HermesUsage | undefined {
  const usage = isRecord(value) ? value : {};
  const runtimeRecord = isRecord(runtime) ? runtime : {};
  const model = typeof runtimeRecord["model"] === "string"
    ? runtimeRecord["model"].trim()
    : configuredModel?.trim() ?? "hermes-agent";
  if (model.length === 0) return undefined;
  const providerName = typeof runtimeRecord["provider"] === "string"
    ? runtimeRecord["provider"].trim().toLowerCase()
    : configuredProvider?.trim().toLowerCase() ?? "";
  const inputTokens = boundedOptionalNumber(usage["input_tokens"] ?? usage["prompt_tokens"], "usage input tokens");
  const outputTokens = boundedOptionalNumber(usage["output_tokens"] ?? usage["completion_tokens"], "usage output tokens");
  return {
    provider: providerName.includes("codex") ? "openai-codex" : "other",
    model,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

function failureForStatus(status: number): ProviderFailure {
  if (status === 401) return providerFailure("authentication-failed", "Hermes rejected the configured service credential.");
  if (status === 403) return providerFailure("permission-denied", "Hermes denied the control-plane request.");
  if (status === 408 || status === 429) return providerFailure("rate-limited", "Hermes is temporarily rate limited.");
  if (status >= 500) return providerFailure("unavailable", "Hermes is temporarily unavailable.");
  return providerFailure("provider-error", "Hermes rejected the control-plane request.");
}

async function responseBody(response: Response, maxBytes: number): Promise<unknown> {
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) fail("Hermes returned an oversized response.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    fail("Hermes returned invalid JSON.");
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Hermes base URL must be an absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Hermes base URL must use HTTP or HTTPS.");
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0 || parsed.hash.length > 0) throw new Error("Hermes base URL may not contain credentials or query material.");
  return parsed.toString().replace(/\/$/u, "");
}

function encodedPathPart(value: string): string {
  return encodeURIComponent(value);
}

function requestBody(turnRequest: HermesTurnRequest): string {
  const context = turnRequest.context ?? [];
  const toolResults = turnRequest.toolResults ?? [];
  return JSON.stringify({
    schema: "real-ming.hermes.turn.v1",
    turnId: turnRequest.turnId,
    actorId: turnRequest.actorId,
    workspaceId: turnRequest.workspaceId,
    ...(turnRequest.workItemId === undefined ? {} : { workItemId: turnRequest.workItemId }),
    ...(context.length === 0 ? {} : { context }),
    ...(toolResults.length === 0 ? {} : { toolResults }),
    request: turnRequest.text,
  });
}

export function createHermesRuntimeClient(options: HermesRuntimeClientOptions): HermesRuntimeClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const sharedSecret = options.sharedSecret.trim();
  if (sharedSecret.length < 16) throw new Error("Hermes shared secret must be at least 16 characters.");
  const request = options.fetch ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? defaultTimeoutMs;
  const maxResponseBytes = options.maxResponseBytes ?? defaultMaxResponseBytes;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 15 * 60_000) throw new Error("Hermes request timeout must be between 1000ms and 900000ms.");
  const sessionKeyPrefix = (options.sessionKeyPrefix ?? "real-ming:telegram").trim();
  if (sessionKeyPrefix.length === 0 || sessionKeyPrefix.length > 128 || /[\r\n\x00]/u.test(sessionKeyPrefix)) throw new Error("Hermes session key prefix is invalid.");
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    Authorization: `Bearer ${sharedSecret}`,
  };

  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: Readonly<Record<string, unknown>>,
    extraHeaders?: Readonly<Record<string, string>>,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, {
        method,
        headers: { ...headers, ...(extraHeaders ?? {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new HermesRuntimeError(providerFailure("unavailable", "Hermes is temporarily unavailable."));
    }
    if (!response.ok) throw new HermesRuntimeError(failureForStatus(response.status));
    return responseBody(response, maxResponseBytes);
  };

  const ensureSession = async (sessionId: string): Promise<void> => {
    try {
      await call("POST", "/api/sessions", {
        id: sessionId,
        source: "real-ming",
        title: "Real-Ming Telegram",
        system_prompt: outputSchemaInstruction,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.provider === undefined ? {} : { provider: options.provider }),
        ...(options.reasoningEffort === undefined
          ? {}
          : { model_options: { reasoning: { enabled: options.reasoningEffort !== "none", effort: options.reasoningEffort } } }),
      });
    } catch (error) {
      if (error instanceof HermesRuntimeError && error.failure.class === "provider-error") {
        // A duplicate create is the expected restart path. A GET distinguishes
        // that from a real creation failure without accepting another session.
        try {
          await call("GET", `/api/sessions/${encodedPathPart(sessionId)}`);
          return;
        } catch {
          throw error;
        }
      }
      throw error;
    }
  };

  return {
    async turn(turnRequest): Promise<HermesTurnResponse> {
      if (turnRequest.sessionId.trim().length === 0 || turnRequest.turnId.trim().length === 0 || turnRequest.actorId.trim().length === 0 || turnRequest.workspaceId.trim().length === 0) throw new HermesRuntimeError(providerFailure("invalid-input", "Hermes turns require identity, workspace and IDs."));
      if (turnRequest.text.trim().length === 0 || turnRequest.text.length > maxTextChars) throw new HermesRuntimeError(providerFailure("invalid-input", "Hermes turns require bounded text."));
      if (detectSensitiveFields({ text: turnRequest.text }).length > 0) throw new HermesRuntimeError(providerFailure("invalid-input", "Sensitive Secrets cannot enter Hermes context."));
      await ensureSession(turnRequest.sessionId);
      const value = await call(
        "POST",
        `/api/sessions/${encodedPathPart(turnRequest.sessionId)}/chat`,
        {
          message: requestBody(turnRequest),
          system_message: outputSchemaInstruction,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.provider === undefined ? {} : { provider: options.provider }),
          ...(options.reasoningEffort === undefined
            ? {}
            : { model_options: { reasoning: { enabled: options.reasoningEffort !== "none", effort: options.reasoningEffort } } }),
        },
        { "X-Hermes-Session-Key": `${sessionKeyPrefix}:${turnRequest.sessionId}` },
      );
      if (!isRecord(value)) fail("Hermes returned an unreadable chat response.");
      const sessionId = nonEmptyText(value["session_id"], "session ID", 256);
      if (sessionId !== turnRequest.sessionId) fail("Hermes returned mismatched session ID.");
      const message = value["message"];
      if (!isRecord(message)) fail("Hermes returned no assistant message.");
      const plan = extractPlan(message["content"]);
      const usage = parseUsage(value["usage"], value["runtime"], options.model, options.provider);
      return {
        sessionId,
        turnId: turnRequest.turnId,
        plan,
        ...(usage === undefined ? {} : { usage }),
      };
    },

    async health() {
      try {
        const value = await call("GET", "/health");
        if (!isRecord(value) || (value["status"] !== "ok" && value["status"] !== "healthy")) return { status: "failed" as const, failure: "Hermes health is not healthy." };
        return {
          status: "healthy" as const,
          ...(options.model === undefined ? {} : { model: options.model }),
        };
      } catch (error) {
        return {
          status: "failed" as const,
          failure: error instanceof HermesRuntimeError ? error.failure.message : "Hermes health is unavailable.",
        };
      }
    },
  };
}
