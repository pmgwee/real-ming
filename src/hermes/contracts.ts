import type {
  ApprovalScope,
  ExecutiveRole,
  ExpectedEffect,
  RiskClass,
  TrustDomain,
  Workstream,
} from "../operations/contracts.js";

export const hermesIntentKinds = [
  "answer",
  "clarification",
  "research",
  "work",
] as const;
export type HermesIntent = (typeof hermesIntentKinds)[number];

export interface HermesContextRequest {
  readonly purpose: string;
  readonly workItemId?: string;
  readonly executive?: ExecutiveRole;
  readonly allowedTrustDomains: readonly (TrustDomain | "CEO")[];
}

export interface HermesContextResult {
  readonly requestPurpose: string;
  readonly sourceIdentity: string;
  readonly sourceReference: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly freshness: "current" | "stale";
}

export interface HermesToolRequest {
  readonly id: string;
  readonly capability:
    | "context.read"
    | "evidence.read"
    | "workspace.read"
    | "workspace.write"
    | "workspace.test"
    | "provider.write";
  readonly purpose: string;
  readonly input: Readonly<Record<string, string>>;
  readonly requiresApproval: boolean;
}

export interface HermesToolResult {
  readonly requestId: string;
  readonly status: "completed" | "denied" | "failed";
  readonly output?: Readonly<Record<string, string>>;
  readonly reason?: string;
}

export interface HermesWorkItemProposal {
  readonly intent: string;
  readonly expectedEffect: ExpectedEffect;
  readonly accountableExecutive?: ExecutiveRole;
  readonly workstream?: Workstream | null;
  readonly collaboratingExecutives?: readonly {
    readonly executive: ExecutiveRole;
    readonly contribution: string;
  }[];
  readonly riskClass?: RiskClass;
}

export interface HermesApprovalProposal {
  readonly scope: ApprovalScope;
  readonly target: {
    readonly type: string;
    readonly identity: string;
    readonly version: string;
  };
  readonly riskClass: RiskClass;
}

/**
 * Hermes owns interpretation. Real-Ming receives this typed plan, validates
 * it, and performs only the deterministic operations allowed by policy.
 */
export interface HermesTurnPlan {
  readonly intent: HermesIntent;
  readonly answer?: string;
  readonly executive?: ExecutiveRole;
  readonly workItem?: HermesWorkItemProposal;
  readonly contextRequests: readonly HermesContextRequest[];
  readonly toolRequests: readonly HermesToolRequest[];
  readonly approvalRequest?: HermesApprovalProposal;
}

export interface HermesUsage {
  readonly provider: "openai-codex" | "other";
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
}

export interface HermesTurnRequest {
  readonly sessionId: string;
  readonly turnId: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly text: string;
  readonly workItemId?: string;
  readonly context?: readonly HermesContextResult[];
  readonly toolResults?: readonly HermesToolResult[];
}

export interface HermesTurnResponse {
  readonly sessionId: string;
  readonly turnId: string;
  readonly plan: HermesTurnPlan;
  readonly usage?: HermesUsage;
}

export interface HermesRuntimeClient {
  turn(request: HermesTurnRequest): Promise<HermesTurnResponse>;
  health(): Promise<{
    readonly status: "healthy" | "failed";
    readonly model?: string;
    readonly failure?: string;
  }>;
}
