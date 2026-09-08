import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import { isCeoActor } from "../operations/actor-identity.js";
import {
  buildDashboardOverview,
  type DashboardOverview,
  type NativeHermesDashboardStatus,
} from "./dashboard-read-model.js";
import { renderDashboardPage } from "./dashboard-page.js";
import type {
  CalendarAgendaResult,
  MailReadResult,
  MailSearchResult,
  ProviderWriteOutcome,
} from "../integration/real-ming-tools.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type { ProjectEvidenceBroker } from "../evidence/evidence-broker.js";
import type { RepositoryCenterView } from "../portfolio/repository-center.js";
import type { DeploymentCandidateStore } from "../portfolio/deployment-candidate.js";
import type {
  DeploymentPromotionApprovalRequest,
  DeploymentPromotionCoordinator,
  DeploymentPromotionRequest,
} from "../portfolio/deployment-promotion.js";
import type { SchedulerJobDefinition } from "../operations/daily-operations-scheduler.js";
import type { KnowledgeDomainHealth } from "../knowledge/knowledge-operations.js";
import type { NativeKnowledgeRunHealth } from "../knowledge/native-consolidation/contracts.js";
import type { HermesConversationOverview } from "../hermes/hermes-turn-coordinator.js";
import type {
  NativeScheduledReportRequest,
  NativeScheduledReportResult,
} from "../operations/native-scheduled-reports.js";

const nativeCronJobs = new Set([
  "morning-brief",
  "executive-roll-up",
] as const);

export const dashboardSessionCookie = "real_ming_session";

const maxRequestBodyBytes = 64 * 1024;
// Fetch refuses these otherwise valid TCP destinations. An operating system
// may assign one when tests or a smoke process request port 0.
const fetchForbiddenPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6697, 10080,
]);

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface DashboardSession {
  readonly actorId: string;
  readonly workspaceId: string;
}

export interface DashboardCredential extends DashboardSession {
  readonly accessToken: string;
}

export interface DashboardServer {
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

export interface NativeCronEndpoint {
  /** Loopback-only shared secret inherited by the Hermes MCP process. */
  readonly apiKey: string;
  readonly run: (
    request: NativeScheduledReportRequest,
  ) => Promise<NativeScheduledReportResult>;
}

/**
 * The provider reads the Real-Ming MCP process cannot perform for itself.
 *
 * Hermes gives an MCP child only its own declared environment, so that process
 * holds no Key Vault access and no Google credential. Routing the read back
 * through this loopback endpoint keeps every Google secret in the one process
 * that already has them, rather than copying them into Hermes configuration
 * where they would live in a second place and drift.
 */
export interface ProviderReadEndpoint {
  /** The same loopback secret the native cron endpoint uses. */
  readonly apiKey: string;
  readonly calendarEvents?: (request: {
    readonly calendarId: string;
    readonly from?: string;
    readonly to?: string;
  }) => Promise<CalendarAgendaResult>;
  readonly mailboxes?: readonly string[];
  readonly searchMail?: (request: {
    readonly mailbox: string;
    readonly query?: string;
    readonly limit?: number;
  }) => Promise<MailSearchResult>;
  readonly createCalendarEvent?: (request: {
    readonly calendarId: string;
    readonly title: string;
    readonly start: string;
    readonly end: string;
    readonly description?: string;
    readonly location?: string;
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteOutcome>;
  /** Writes a draft. There is deliberately no send endpoint. */
  readonly draftMail?: (request: {
    readonly mailbox: string;
    readonly to: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly cc?: readonly string[];
    readonly idempotencyKey: string;
  }) => Promise<ProviderWriteOutcome>;
  readonly readMail?: (request: {
    readonly mailbox: string;
    readonly messageId: string;
  }) => Promise<MailReadResult>;
}

function matchesToken(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function presentedToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const cookie = request.headers.cookie;
  if (typeof cookie !== "string") {
    return undefined;
  }

  return cookie
    .split(";")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === dashboardSessionCookie)
    ?.slice(1)
    .join("=");
}

function presentedBearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : undefined;
}

function resolveSession(
  request: IncomingMessage,
  credentials: readonly DashboardCredential[],
): DashboardSession | undefined {
  const token = presentedToken(request);
  if (token === undefined || token.length === 0) {
    return undefined;
  }

  const decoded = decodeURIComponent(token);
  const credential = credentials.find(
    (entry) =>
      matchesToken(token, entry.accessToken) ||
      matchesToken(decoded, entry.accessToken),
  );

  return credential === undefined || !isCeoActor(credential.actorId)
    ? undefined
    : { actorId: credential.actorId, workspaceId: credential.workspaceId };
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes) {
    request.resume();
    throw new RequestBodyError(413, "request-body-too-large");
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > maxRequestBodyBytes) {
      request.resume();
      throw new RequestBodyError(413, "request-body-too-large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RequestBodyError(400, "invalid-request-body");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw error instanceof RequestBodyError
      ? error
      : new RequestBodyError(400, "invalid-request-body");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, { error: "authentication-required" });
}

export function createDashboardServer(options: {
  readonly state: OperationsState;
  readonly gateway: OperationsGateway;
  readonly portfolio?: ProjectPortfolio;
  /** Controlled, read-only GitHub/Git lineage projections for portfolio projects. */
  readonly repositoryCenters?: ReadonlyMap<string, RepositoryCenterView>;
  /** Refreshes provider-backed Repository Center snapshots for each read. */
  readonly refreshRepositoryCenters?: () => Promise<ReadonlyMap<string, RepositoryCenterView>>;
  /** Optional CEO-governed binding and evidence capture boundary. */
  readonly projectEvidence?: ProjectEvidenceBroker;
  readonly deploymentCandidates?: DeploymentCandidateStore;
  readonly deploymentPromotion?: DeploymentPromotionCoordinator;
  readonly schedulerJobs?: readonly SchedulerJobDefinition[];
  readonly knowledgeHealth?: () => readonly KnowledgeDomainHealth[];
  /** Read-only payload-free health for the optional native knowledge extension. */
  readonly nativeKnowledgeHealth?: () => NativeKnowledgeRunHealth | Promise<NativeKnowledgeRunHealth>;
  /** Read-only Hermes runtime/session status. Prompts are never exposed. */
  readonly hermesHealth?: () => HermesConversationOverview;
  /** Read-only native Hermes gateway reachability. Session details stay native. */
  readonly nativeHermesHealth?:
    () => NativeHermesDashboardStatus | Promise<NativeHermesDashboardStatus>;
  /** Optional private endpoint used by native Hermes cron, never rendered. */
  readonly nativeCron?: NativeCronEndpoint;
  /** Optional private endpoint serving provider reads to the MCP process. */
  readonly providerReads?: ProviderReadEndpoint;
  readonly credentials: readonly DashboardCredential[];
  /**
   * The operating clock. Without it the dashboard would report scheduler
   * timing against wall-clock time while the rest of the system runs on the
   * injected one, so the two would disagree about when a job next runs.
   */
  readonly now?: () => string;
  readonly host?: string;
  readonly port?: number;
}): Promise<DashboardServer> {
  const now = options.now ?? (() => new Date().toISOString());
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const overviewFor = async (session: DashboardSession): Promise<DashboardOverview> => {
    const nativeHermes =
      options.nativeHermesHealth === undefined
        ? undefined
        : await options.nativeHermesHealth();
    const nativeKnowledge =
      options.nativeKnowledgeHealth === undefined
        ? undefined
        : await options.nativeKnowledgeHealth();
    return buildDashboardOverview(
      options.state,
      { ...session, now: now() },
      options.portfolio,
      options.refreshRepositoryCenters === undefined
        ? options.repositoryCenters
        : await options.refreshRepositoryCenters(),
      options.deploymentCandidates,
      options.schedulerJobs,
      options.knowledgeHealth?.() ?? [],
      options.hermesHealth?.(),
      nativeHermes,
      nativeKnowledge,
    );
  };

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://dashboard.local");

      // Native Hermes cron is the sole caller of this loopback endpoint. It
      // receives composed text and owns Telegram delivery; it never receives
      // a CEO session cookie or a dashboard write capability.
      if (request.method === "POST" && url.pathname === "/internal/native-cron/run") {
        if (
          options.nativeCron === undefined ||
          presentedBearerToken(request) === undefined ||
          !matchesToken(
            presentedBearerToken(request) ?? "",
            options.nativeCron.apiKey,
          )
        ) {
          sendUnauthorized(response);
          return;
        }
        try {
          const body = await readJsonBody(request);
          const job = body["job"];
          if (typeof job !== "string" || !nativeCronJobs.has(job as never)) {
            sendJson(response, 400, {
              error: "job-must-be-morning-brief-or-executive-roll-up",
            });
            return;
          }
          const runId = body["runId"];
          const occurrenceDate = body["occurrenceDate"];
          const result = await options.nativeCron.run({
            job: job as NativeScheduledReportRequest["job"],
            ...(typeof runId === "string" ? { runId } : {}),
            ...(typeof occurrenceDate === "string" ? { occurrenceDate } : {}),
          });
          sendJson(response, 200, result);
        } catch (error) {
          if (error instanceof RequestBodyError) {
            sendJson(response, error.status, { error: error.code });
            return;
          }
          sendJson(response, 422, {
            error: "native-cron-rejected",
            message: error instanceof Error ? error.message : "Unknown failure.",
          });
        }
        return;
      }
      // The Real-Ming MCP process is the sole caller of these loopback reads.
      // Like the cron endpoint they carry no CEO session and grant no write.
      if (
        request.method === "POST" &&
        (url.pathname === "/internal/provider/calendar-events" ||
          url.pathname === "/internal/provider/search-mail" ||
          url.pathname === "/internal/provider/create-calendar-event" ||
          url.pathname === "/internal/provider/draft-mail" ||
          url.pathname === "/internal/provider/read-mail")
      ) {
        const endpoint = options.providerReads;
        if (
          endpoint === undefined ||
          presentedBearerToken(request) === undefined ||
          !matchesToken(presentedBearerToken(request) ?? "", endpoint.apiKey)
        ) {
          sendUnauthorized(response);
          return;
        }
        try {
          const body = await readJsonBody(request);
          if (url.pathname === "/internal/provider/calendar-events") {
            if (endpoint.calendarEvents === undefined) {
              sendJson(response, 404, { error: "calendar-not-configured" });
              return;
            }
            const calendarId = body["calendarId"];
            if (typeof calendarId !== "string" || calendarId.trim() === "") {
              sendJson(response, 400, { error: "calendar-id-required" });
              return;
            }
            const from = body["from"];
            const to = body["to"];
            sendJson(
              response,
              200,
              await endpoint.calendarEvents({
                calendarId,
                ...(typeof from === "string" ? { from } : {}),
                ...(typeof to === "string" ? { to } : {}),
              }),
            );
            return;
          }
          if (url.pathname === "/internal/provider/create-calendar-event") {
            if (endpoint.createCalendarEvent === undefined) {
              sendJson(response, 404, { error: "calendar-write-not-configured" });
              return;
            }
            const calendarId = body["calendarId"];
            const title = body["title"];
            const start = body["start"];
            const end = body["end"];
            const idempotencyKey = body["idempotencyKey"];
            if (
              typeof calendarId !== "string" ||
              typeof title !== "string" ||
              typeof start !== "string" ||
              typeof end !== "string" ||
              typeof idempotencyKey !== "string"
            ) {
              sendJson(response, 400, { error: "event-fields-required" });
              return;
            }
            const description = body["description"];
            const location = body["location"];
            sendJson(
              response,
              200,
              await endpoint.createCalendarEvent({
                calendarId,
                title,
                start,
                end,
                ...(typeof description === "string" ? { description } : {}),
                ...(typeof location === "string" ? { location } : {}),
                idempotencyKey,
              }),
            );
            return;
          }
          if (url.pathname === "/internal/provider/read-mail") {
            if (endpoint.readMail === undefined) {
              sendJson(response, 404, { error: "mail-not-configured" });
              return;
            }
            const mailbox = body["mailbox"];
            const messageId = body["messageId"];
            if (typeof mailbox !== "string" || typeof messageId !== "string") {
              sendJson(response, 400, { error: "mailbox-and-message-required" });
              return;
            }
            if (!(endpoint.mailboxes ?? []).includes(mailbox)) {
              sendJson(response, 403, { error: "mailbox-not-configured" });
              return;
            }
            sendJson(response, 200, await endpoint.readMail({ mailbox, messageId }));
            return;
          }
          if (url.pathname === "/internal/provider/draft-mail") {
            if (endpoint.draftMail === undefined) {
              sendJson(response, 404, { error: "drafting-not-configured" });
              return;
            }
            const mailbox = body["mailbox"];
            const to = body["to"];
            const subject = body["subject"];
            const draftBody = body["body"];
            const idempotencyKey = body["idempotencyKey"];
            if (
              typeof mailbox !== "string" ||
              !Array.isArray(to) ||
              typeof subject !== "string" ||
              typeof draftBody !== "string" ||
              typeof idempotencyKey !== "string"
            ) {
              sendJson(response, 400, { error: "draft-fields-required" });
              return;
            }
            // The allowlist lives with the credentials. A mailbox this process
            // holds no token for must never be drafted into.
            if (!(endpoint.mailboxes ?? []).includes(mailbox)) {
              sendJson(response, 403, { error: "mailbox-not-configured" });
              return;
            }
            const cc = body["cc"];
            sendJson(
              response,
              200,
              await endpoint.draftMail({
                mailbox,
                to: to.filter((entry): entry is string => typeof entry === "string"),
                subject,
                body: draftBody,
                ...(Array.isArray(cc)
                  ? {
                      cc: cc.filter(
                        (entry): entry is string => typeof entry === "string",
                      ),
                    }
                  : {}),
                idempotencyKey,
              }),
            );
            return;
          }
          if (endpoint.searchMail === undefined) {
            sendJson(response, 404, { error: "mail-not-configured" });
            return;
          }
          const mailbox = body["mailbox"];
          if (typeof mailbox !== "string" || mailbox.trim() === "") {
            sendJson(response, 400, { error: "mailbox-required" });
            return;
          }
          // The allowlist lives with the credentials, not with the caller. A
          // mailbox this process holds no token for must never be attempted.
          if (!(endpoint.mailboxes ?? []).includes(mailbox)) {
            sendJson(response, 403, { error: "mailbox-not-configured" });
            return;
          }
          const query = body["query"];
          const limit = body["limit"];
          sendJson(
            response,
            200,
            await endpoint.searchMail({
              mailbox,
              ...(typeof query === "string" ? { query } : {}),
              ...(typeof limit === "number" ? { limit } : {}),
            }),
          );
        } catch (error) {
          if (error instanceof RequestBodyError) {
            sendJson(response, error.status, { error: error.code });
            return;
          }
          sendJson(response, 422, {
            error: "provider-read-rejected",
            message: error instanceof Error ? error.message : "Unknown failure.",
          });
        }
        return;
      }

      const session = resolveSession(request, options.credentials);

      if (session === undefined) {
        sendUnauthorized(response);
        return;
      }

      const ownsWorkItem = (workItemId: unknown): boolean =>
        typeof workItemId === "string" &&
        options.state.workItem(workItemId)?.workspaceId ===
          session.workspaceId;

      try {
        if (request.method === "GET" && url.pathname === "/") {
          const page = renderDashboardPage(await overviewFor(session));
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(page),
          });
          response.end(page);
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/overview") {
          sendJson(response, 200, await overviewFor(session));
          return;
        }

        const candidateApprovalMatch = url.pathname.match(/^\/api\/deployment-candidates\/([^/]+)\/approval$/u);
        if (request.method === "POST" && candidateApprovalMatch !== null) {
          if (options.deploymentPromotion === undefined) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const candidateId = decodeURIComponent(candidateApprovalMatch[1] ?? "");
          const candidate = options.deploymentCandidates?.candidate(candidateId);
          if (candidate === undefined || !ownsWorkItem(candidate.workItemId)) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const body = await readJsonBody(request);
          const result = await options.deploymentPromotion.requestApproval({
            candidateId,
            ...(Array.isArray(body["additionalPlans"])
              ? { additionalPlans: body["additionalPlans"] as NonNullable<DeploymentPromotionApprovalRequest["additionalPlans"]> }
              : {}),
          });
          sendJson(response, 200, result);
          return;
        }

        const candidatePromotionMatch = url.pathname.match(/^\/api\/deployment-candidates\/([^/]+)\/promote$/u);
        if (request.method === "POST" && candidatePromotionMatch !== null) {
          if (options.deploymentPromotion === undefined) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const candidateId = decodeURIComponent(candidatePromotionMatch[1] ?? "");
          const candidate = options.deploymentCandidates?.candidate(candidateId);
          if (candidate === undefined || !ownsWorkItem(candidate.workItemId)) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const body = await readJsonBody(request);
          const result = await options.deploymentPromotion.promote({
            ...(body as unknown as DeploymentPromotionRequest),
            candidateId,
          });
          sendJson(response, 200, result);
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/actions") {
          const body = await readJsonBody(request);
          if (!ownsWorkItem(body["workItemId"])) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const decision = await options.gateway.requestAction(body as never);
          sendJson(response, 200, decision);
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/approvals") {
          const body = await readJsonBody(request);
          const approvalId = String(body["approvalId"]);
          if (
            !ownsWorkItem(options.state.approval(approvalId)?.workItemId)
          ) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const approval = await options.gateway.grantApproval({
            approvalId,
            actorId: session.actorId,
            expiresAt: String(body["expiresAt"]),
          });
          sendJson(response, 200, approval);
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/reviews") {
          const body = await readJsonBody(request);
          if (!ownsWorkItem(body["workItemId"])) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const workItem = await options.gateway.reviewWorkItem({
            ...(body as Record<string, unknown>),
            actorId: session.actorId,
          } as never);
          sendJson(response, 200, workItem);
          return;
        }

        if (
          request.method === "POST" &&
          url.pathname === "/api/project-evidence-bindings"
        ) {
          if (options.projectEvidence === undefined) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const body = await readJsonBody(request);
          if (!ownsWorkItem(body["workItemId"])) {
            sendJson(response, 404, { error: "not-found" });
            return;
          }
          const workItemId = String(body["workItemId"]);
          const portfolioProjectId = String(body["portfolioProjectId"]);
          options.projectEvidence.bind({
            actorId: session.actorId,
            workspaceId: session.workspaceId,
            workItemId,
            portfolioProjectId,
          });
          sendJson(response, 200, { workItemId, portfolioProjectId });
          return;
        }

        sendJson(response, 404, { error: "not-found" });
      } catch (error) {
        if (error instanceof RequestBodyError) {
          sendJson(response, error.status, { error: error.code });
          return;
        }
        sendJson(response, 422, {
          error: "rejected",
          message: error instanceof Error ? error.message : "Unknown failure.",
        });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const resolveListeningServer = (): void => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The dashboard server did not bind a port."));
        return;
      }

      if (port === 0 && fetchForbiddenPorts.has(address.port)) {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          server.listen(0, host, resolveListeningServer);
        });
        return;
      }

      resolve({
        port: address.port,
        origin: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    };
    server.listen(port, host, resolveListeningServer);
  });
}
