import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type { OperationsGateway } from "../operations/operations-gateway.js";
import type { OperationsState } from "../operations/operations-state.js";
import { isCeoActor } from "../operations/actor-identity.js";
import {
  buildDashboardOverview,
  type DashboardOverview,
} from "./dashboard-read-model.js";
import { renderDashboardPage } from "./dashboard-page.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type { ProjectEvidenceBroker } from "../evidence/evidence-broker.js";

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
  /** Optional CEO-governed binding and evidence capture boundary. */
  readonly projectEvidence?: ProjectEvidenceBroker;
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
  const overviewFor = (session: DashboardSession): DashboardOverview =>
    buildDashboardOverview(options.state, { ...session, now: now() }, options.portfolio);

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://dashboard.local");
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
          const page = renderDashboardPage(overviewFor(session));
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-length": Buffer.byteLength(page),
          });
          response.end(page);
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/overview") {
          sendJson(response, 200, overviewFor(session));
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
