import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  executionLinkStatePath,
  SqliteExecutionLinkStore,
} from "../integration/execution-link.js";
import { serveMcpOverStdio } from "../integration/mcp-stdio.js";
import { createNativeCronReportClient } from "../integration/native-cron-client.js";
import {
  createBridgedCalendarClient,
  createBridgedMailboxClient,
} from "../integration/provider-read-client.js";
import { createRealMingTools } from "../integration/real-ming-tools.js";
import { OperationsState } from "../operations/operations-state.js";
import { createNativeKnowledgeRegistry, type NativeKnowledgeRegistry } from "../knowledge/native-consolidation/registry.js";
import { stageGeneration as stageNativeGeneration } from "../knowledge/native-consolidation/publication.js";
import { createAzureBlobTombstoneHeadStore } from "../providers/azure-blob-tombstone-head-store.js";
import type {
  NativeKnowledgeCandidate,
  SourceSnapshot,
  StagedPage,
  TombstoneHeadStore,
} from "../knowledge/native-consolidation/contracts.js";
import type { CalendarAgendaClient, MailboxClient, NativeKnowledgeToolContext, RealMingToolResult, RealMingTools } from "../integration/real-ming-tools.js";

/**
 * The Real-Ming extension as an MCP server, which is how native Hermes reaches
 * it under Architecture Revision 6.
 *
 * It opens the operations state read-only in spirit: the only write it performs
 * is an append-only execution link. Everything else Hermes needs, it already
 * does better itself.
 */
export interface RealMingMcpComposition {
  readonly tools: RealMingTools;
  close(): void;
}

/**
 * Enforce a reviewed MCP surface at the composition boundary. Environment
 * strings are only configuration; the server itself filters definitions and
 * rejects calls so a client cannot self-attest a broader or narrower set.
 */
export function restrictRealMingTools(
  tools: RealMingTools,
  allowedNames: readonly string[],
): RealMingTools {
  const allowed = new Set(allowedNames);
  const denied = (name: string): RealMingToolResult => ({
    kind: "failed",
    reason: `MCP operation ${name} is not permitted for this job`,
  });
  return {
    list: () => tools.list().filter((tool) => allowed.has(tool.name)),
    call: (name, args) => allowed.has(name) ? tools.call(name, args) : denied(name),
    ...(tools.callAsync === undefined ? {} : {
      callAsync: async (name: string, args: Record<string, unknown>) =>
        allowed.has(name) ? await tools.callAsync?.(name, args) ?? denied(name) : denied(name),
    }),
  };
}

export interface RealMingMcpCompositionOptions {
  readonly statePath?: string;
  readonly knowledgeStatePath?: string;
  readonly knowledgeGeneratedRoot?: string;
  readonly knowledgeStagingRoot?: string;
  readonly knowledgeRegistry?: NativeKnowledgeRegistry;
  readonly knowledgeHeadStore?: TombstoneHeadStore;
  /** Candidates admitted by the configured production route at startup. */
  readonly knowledgeCandidates?: readonly NativeKnowledgeCandidate[];
  readonly knowledgeReadSource?: NativeKnowledgeToolContext["readSource"];
  readonly knowledgeIsolationEligible?: () => boolean;
  readonly scheduledReports?: import("../integration/native-cron-client.js").NativeCronReportClient;
  readonly calendar?: CalendarAgendaClient;
  readonly mail?: MailboxClient;
  readonly defaultCalendarId?: string;
  readonly now?: () => string;
}

function nonEmptyEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function requiredFiniteInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
}

/**
 * Read one bounded, explicitly configured source route. The route is a local
 * JSON adapter in the controlled build; a provider-backed deployment may
 * replace it at the composition boundary without changing the MCP contract.
 */
export function createFileKnowledgeSourceReader(
  routePath: string,
  now: () => string = () => new Date().toISOString(),
): NonNullable<NativeKnowledgeToolContext["readSource"]> {
  const route = resolve(routePath);
  return async (args) => {
    if (!existsSync(route)) return { kind: "unavailable", reason: "configured knowledge source route is unavailable" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(route, "utf8"));
    } catch {
      return { kind: "unavailable", reason: "configured knowledge source route is invalid" };
    }
    const records = Array.isArray(parsed) ? parsed : [parsed];
    const sourceIdentity = requiredString(args, "sourceIdentity");
    const sourceReference = requiredString(args, "sourceReference");
    const sourceVersion = requiredString(args, "sourceVersion");
    if (sourceIdentity === undefined || sourceReference === undefined || sourceVersion === undefined) {
      return { kind: "unavailable", reason: "sourceIdentity, sourceReference and sourceVersion are required" };
    }
    const match = records.find((value): value is SourceSnapshot => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const record = value as Partial<SourceSnapshot>;
      return typeof record.sourceIdentity === "string" && record.sourceIdentity === sourceIdentity &&
        typeof record.sourceReference === "string" && record.sourceReference === sourceReference &&
        (sourceVersion === undefined || record.sourceVersion === sourceVersion) &&
        typeof record.sourceVersion === "string" && typeof record.content === "string" &&
        typeof record.contentHash === "string" && typeof record.asOf === "string";
    });
    if (match === undefined) return { kind: "unavailable", reason: "configured knowledge source was not found" };
    return { ...match, retrievedAt: match.retrievedAt ?? now() };
  };
}

function requiredString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function configuredKnowledgeCandidates(): readonly NativeKnowledgeCandidate[] | undefined {
  const route = nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE");
  if (route === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(route), "utf8"));
  } catch {
    throw new Error("REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE is unavailable or invalid");
  }
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>)["candidates"])
      ? (parsed as Record<string, unknown>)["candidates"] as unknown[]
      : undefined;
  if (values === undefined) throw new Error("configured knowledge candidates must be an array");
  return values.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`configured knowledge candidate ${index} is invalid`);
    const candidate = value as Partial<NativeKnowledgeCandidate>;
    const required = ["candidateId", "kind", "claimClass", "claim", "sourceIdentity", "sourceReference", "sourceVersion", "excerpt", "contentHash", "capturedAt", "asOf", "trustDomain", "sensitivity", "retentionClass"] as const;
    if (!required.every((key) => typeof candidate[key] === "string" && candidate[key]!.trim().length > 0) || !Array.isArray(candidate.dependencies) || !candidate.dependencies.every((item) => typeof item === "string" && item.trim().length > 0)) {
      throw new Error(`configured knowledge candidate ${index} is missing required fields`);
    }
    return candidate as NativeKnowledgeCandidate;
  });
}

function parseRun(value: unknown): import("../knowledge/native-consolidation/contracts.js").RunLease {
  const record = requiredRecord(value, "run");
  return {
    runId: requiredText(record["runId"], "run.runId"),
    leaseToken: requiredText(record["leaseToken"], "run.leaseToken"),
    leaseEpoch: requiredFiniteInteger(record["leaseEpoch"], "run.leaseEpoch"),
    expiresAt: requiredText(record["expiresAt"], "run.expiresAt"),
    operatingDate: requiredText(record["operatingDate"], "run.operatingDate"),
  };
}

function parsePage(value: unknown): StagedPage {
  const record = requiredRecord(value, "page");
  const sourceCandidateIds = record["sourceCandidateIds"];
  if (!Array.isArray(sourceCandidateIds) || sourceCandidateIds.length === 0 || !sourceCandidateIds.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error("page.sourceCandidateIds must be a non-empty string array");
  }
  const disposition = requiredText(record["disposition"], "page.disposition") as StagedPage["disposition"];
  if (!["supported", "unsupported", "conflicting", "unavailable", "stale", "quarantined"].includes(disposition)) throw new Error("page.disposition is invalid");
  const uncertainty = requiredText(record["uncertainty"], "page.uncertainty") as StagedPage["uncertainty"];
  if (uncertainty !== "none" && uncertainty !== "uncertain") throw new Error("page.uncertainty is invalid");
  const dependenciesRaw = record["dependencies"];
  if (dependenciesRaw !== undefined && (!Array.isArray(dependenciesRaw) || !dependenciesRaw.every((item) => typeof item === "string" && item.trim().length > 0))) {
    throw new Error("page.dependencies must be a string array when supplied");
  }
  return {
    pageId: requiredText(record["pageId"], "page.pageId"),
    path: requiredText(record["path"], "page.path"),
    content: typeof record["content"] === "string" ? record["content"] : (() => { throw new Error("page.content is required"); })(),
    sourceCandidateIds,
    ...(dependenciesRaw === undefined ? {} : { dependencies: (dependenciesRaw as string[]).map((item) => item.trim()) }),
    claimClass: requiredText(record["claimClass"], "page.claimClass") as StagedPage["claimClass"],
    sourceReference: requiredText(record["sourceReference"], "page.sourceReference"),
    capturedAt: requiredText(record["capturedAt"], "page.capturedAt"),
    asOf: requiredText(record["asOf"], "page.asOf"),
    disposition,
    uncertainty,
  };
}

function knowledgeContext(options: RealMingMcpCompositionOptions, defaultNow: () => string): {
  readonly context?: NativeKnowledgeToolContext;
  readonly close?: () => void;
} {
  const statePath = options.knowledgeStatePath ?? nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH");
  const generatedRoot = options.knowledgeGeneratedRoot ?? nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT");
  const stagingRoot = options.knowledgeStagingRoot ?? nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT");
  if (statePath === undefined || generatedRoot === undefined || stagingRoot === undefined) return {};
  const registry = options.knowledgeRegistry ?? createNativeKnowledgeRegistry({ statePath, now: defaultNow });
  const headStore = options.knowledgeHeadStore ?? (() => {
    const accountName = nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_AZURE_ACCOUNT");
    const containerName = nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_AZURE_CONTAINER");
    return accountName === undefined || containerName === undefined
      ? undefined
      : createAzureBlobTombstoneHeadStore({ accountName, containerName });
  })();
  const sourceRoute = nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE");
  const readSource = options.knowledgeReadSource ?? (sourceRoute === undefined ? undefined : createFileKnowledgeSourceReader(sourceRoute, defaultNow));
  const context: NativeKnowledgeToolContext = {
    registry,
    generatedRoot: resolve(generatedRoot),
    isolationEligible: options.knowledgeIsolationEligible ?? (() => nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE") === "true"),
    ...(readSource === undefined ? {} : { readSource }),
    ...(headStore === undefined ? {} : { headStore }),
    stageGeneration: async (args) => {
      const run = parseRun(args["run"]);
      const pagesRaw = args["pages"];
      if (!Array.isArray(pagesRaw) || pagesRaw.length === 0) throw new Error("pages must be a non-empty array");
      const pages = pagesRaw.map(parsePage);
      const sourceEpoch = requiredFiniteInteger(args["sourceEpoch"], "sourceEpoch");
      const tombstoneEpoch = requiredFiniteInteger(args["tombstoneEpoch"], "tombstoneEpoch");
      const now = requiredText(args["now"], "now");
      const staged = await stageNativeGeneration({ run, generatedRoot: resolve(generatedRoot), stagingRoot: resolve(stagingRoot), pages, sourceEpoch, tombstoneEpoch, now });
      registry.recordStagedGeneration(staged);
      return { generationId: staged.generationId, manifestHash: staged.manifestHash, immutablePath: staged.immutablePath, activated: false };
    },
  };
  // The production candidate route is an explicit, bounded admission input.
  // Admission remains the registry's own production operation; this avoids
  // granting the isolated Hermes job the separate capture mutation while
  // ensuring list_candidates returns only candidates actually admitted in
  // this state database. Re-running is idempotent via admitCandidate().
  for (const candidate of options.knowledgeCandidates ?? []) {
    const admitted = registry.admitCandidate(candidate);
    if (admitted.kind === "denied") throw new Error(`configured knowledge candidate was rejected: ${admitted.reason}`);
  }
  return {
    context,
    ...(options.knowledgeRegistry === undefined ? { close: () => registry.close() } : {}),
  };
}

/** Production MCP composition used by the stdio server and controlled tests. */
export function createRealMingMcpComposition(options: RealMingMcpCompositionOptions = {}): RealMingMcpComposition {
  const statePath = options.statePath ?? nonEmptyEnvironment("REAL_MING_STATE_PATH") ?? join(process.cwd(), "var", "state.sqlite");
  mkdirSync(dirname(statePath), { recursive: true });

  const state = new OperationsState(statePath);
  const links = new SqliteExecutionLinkStore(executionLinkStatePath(statePath));
  const now = options.now ?? (() => new Date().toISOString());
  const knowledge = knowledgeContext(options, now);
  const close = (): void => {
    try {
      links.close();
    } finally {
      try {
        state.close();
      } finally {
        knowledge.close?.();
      }
    }
  };
  return {
    tools: createRealMingTools({
      workItems: () => state.workItems(),
      workItem: (id) => state.workItem(id),
      links,
      now,
      ...(options.scheduledReports === undefined ? {} : { scheduledReports: options.scheduledReports }),
      ...(options.calendar === undefined ? {} : { calendar: options.calendar }),
      ...(options.mail === undefined ? {} : { mail: options.mail }),
      ...(options.defaultCalendarId === undefined ? {} : { defaultCalendarId: options.defaultCalendarId }),
      ...(knowledge.context === undefined ? {} : { knowledge: knowledge.context }),
    }),
    close,
  };
}

function main(): void {
  const statePath = nonEmptyEnvironment("REAL_MING_STATE_PATH") || join(process.cwd(), "var", "state.sqlite");

  const knowledgePaths = [
    "REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH",
    "REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT",
    "REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT",
  ];
  const anyKnowledgePath = knowledgePaths.some((name) => nonEmptyEnvironment(name) !== undefined);
  if (anyKnowledgePath && nonEmptyEnvironment("REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE") === undefined) {
    throw new Error("REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE is required when native knowledge is configured");
  }

  const nativeCronEnabled =
    (process.env["REAL_MING_NATIVE_CRON_ENABLED"] ?? "").trim().toLowerCase() ===
    "true";
  const bridgeKey =
    process.env["REAL_MING_HERMES_API_KEY"]?.trim() ??
    process.env["API_SERVER_KEY"]?.trim();
  const scheduledReports =
    nativeCronEnabled && bridgeKey !== undefined && bridgeKey.length > 0
      ? createNativeCronReportClient({
          endpoint:
            process.env["REAL_MING_NATIVE_CRON_ENDPOINT"]?.trim() ||
            "http://127.0.0.1:8787/internal/native-cron/run",
          apiKey: bridgeKey,
        })
      : undefined;

  // Provider reads travel back over the same loopback bridge the cron tool
  // uses, because this process holds no Google credential of its own.
  const bridgeBase =
    process.env["REAL_MING_CONTROL_PLANE_URL"]?.trim() || "http://127.0.0.1:8787";
  const calendarId = process.env["REAL_MING_GOOGLE_CALENDAR_ID"]?.trim();
  const mailboxes = (process.env["REAL_MING_MAILBOXES"] ?? "")
    .split(",")
    .map((mailbox) => mailbox.trim())
    .filter((mailbox) => mailbox.length > 0);
  const configuredCandidates = configuredKnowledgeCandidates();
  const bridged =
    bridgeKey === undefined || bridgeKey.length === 0
      ? undefined
      : { endpoint: bridgeBase, apiKey: bridgeKey };

  const composition = createRealMingMcpComposition({
    statePath,
    ...(configuredCandidates === undefined ? {} : { knowledgeCandidates: configuredCandidates }),
    ...(scheduledReports === undefined ? {} : { scheduledReports }),
    ...(bridged === undefined || calendarId === undefined
        ? {}
        : {
            defaultCalendarId: calendarId,
            calendar: createBridgedCalendarClient({
              endpoint: `${bridged.endpoint}/internal/provider/calendar-events`,
              createEndpoint: `${bridged.endpoint}/internal/provider/create-calendar-event`,
              apiKey: bridged.apiKey,
            }),
          }),
    ...(bridged === undefined || mailboxes.length === 0
        ? {}
        : {
            mail: createBridgedMailboxClient({
              endpoint: `${bridged.endpoint}/internal/provider/search-mail`,
              draftEndpoint: `${bridged.endpoint}/internal/provider/draft-mail`,
              readEndpoint: `${bridged.endpoint}/internal/provider/read-mail`,
              apiKey: bridged.apiKey,
              mailboxes,
            }),
          }),
  });
  const jobTools = nonEmptyEnvironment("REAL_MING_KNOWLEDGE_JOB") === "1"
    ? restrictRealMingTools(
        composition.tools,
        (nonEmptyEnvironment("HERMES_MCP_TOOLS") ?? "").split(",").map((name) => name.trim()).filter(Boolean),
      )
    : composition.tools;
  process.once("SIGINT", () => {
    composition.close();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    composition.close();
    process.exit(0);
  });
  // Hermes closes the pipe when it shuts the server down. Exiting on that keeps
  // no orphan holding the SQLite file open.
  process.stdin.once("end", () => {
    composition.close();
    process.exit(0);
  });
  serveMcpOverStdio({
    tools: jobTools,
    input: process.stdin,
    output: process.stdout,
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
