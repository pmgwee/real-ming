export type WorkItemState =
  | "Captured"
  | "Triaged"
  | "Planned"
  | "Awaiting Approval"
  | "Executing"
  | "Verifying"
  | "Waiting/Blocked"
  | "Ready for CEO Review"
  | "Changes Requested"
  | "Cancelled"
  | "Completed";

export type ExecutiveRole = "COO" | "CTO" | "Personal CFO" | "CAO" | "CMO";

export type Workstream =
  | "Personal Life"
  | "Career Job"
  | "Finance"
  | "Academic"
  | "MicroSaaS"
  | "Content Creation";

export interface CollaboratingExecutiveRequest {
  readonly executive: ExecutiveRole;
  readonly contribution: string;
}

export interface CollaboratingExecutiveAssignment
  extends CollaboratingExecutiveRequest {
  readonly authority: "contribute-only";
  readonly mayApproveParent: false;
  readonly mayCompleteParent: false;
}

export interface ExpectedEffect {
  readonly kind: string;
  readonly value: string;
}

export interface NormalizedCeoAction {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly intent: string;
  readonly expectedEffect: ExpectedEffect;
  readonly accountableExecutive?: ExecutiveRole;
  readonly workstream?: Workstream | null;
  readonly collaboratingExecutives?: readonly CollaboratingExecutiveRequest[];
}

export interface CeoCommand {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly text: string;
  readonly expectedEffect?: ExpectedEffect;
  readonly addressedExecutive?: ExecutiveRole;
  readonly workstream?: Workstream;
  readonly collaboratingExecutives?: readonly CollaboratingExecutiveRequest[];
}

export interface InformationAnswer {
  readonly kind: "information-answer";
  readonly answer: string;
}

export interface Clarification {
  readonly kind: "clarification";
  readonly question: string;
}

export type CommandClassification =
  | { readonly kind: "information-question" }
  | { readonly kind: "action" }
  | { readonly kind: "ambiguous" };

export type CeoCommandResult =
  | InformationAnswer
  | Clarification
  | WorkItemAcknowledgement;

export interface WorkItem {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly intent: string;
  readonly expectedEffect: ExpectedEffect;
  readonly accountableExecutive: ExecutiveRole;
  readonly workstream: Workstream | null;
  readonly collaboratingExecutives: readonly CollaboratingExecutiveAssignment[];
  readonly state: WorkItemState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkerEffect {
  readonly workItemId: string;
  readonly executive: ExecutiveRole;
  readonly authority: "accountable" | "contribute-only";
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly value: string;
}

export interface WorkerReceipt {
  readonly effect: WorkerEffect;
  readonly evidence: Readonly<Record<string, string>>;
}

export interface EffectVerification {
  readonly status: "verified";
  readonly evidence: {
    readonly kind: "controlled-effect-reference";
    readonly reference: string;
  };
}

export interface VerifierResult {
  readonly status: "verified";
  readonly evidence: Readonly<Record<string, string>>;
}

export interface OutcomeReport {
  readonly id: string;
  readonly workItemId: string;
  readonly requestedIntent: string;
  readonly completedEffect: WorkerEffect;
  readonly verification: EffectVerification;
  readonly remainingRisks: readonly string[];
  readonly requiredDecisions: readonly string[];
  readonly createdAt: string;
}

export interface AuditEvent {
  readonly sequence: number;
  readonly workItemId: string;
  readonly type:
    | "work-item.captured"
    | "work-item.executing"
    | "worker.effect-recorded"
    | "worker.effect-failed"
    | "worker.effect-verification-failed"
    | "work-item.verifying"
    | "work-item.waiting-blocked"
    | "worker.effect-verified"
    | "outcome-report.recorded"
    | "work-item.ready-for-ceo-review"
    | "work-item.completed";
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface OperationsResult {
  readonly workItem: WorkItem;
  readonly outcomeReport: OutcomeReport;
}

export interface WorkItemAcknowledgement {
  readonly kind: "work-item-acknowledgement";
  readonly workItem: WorkItem;
}

export interface ControlledWorker {
  execute(effect: WorkerEffect): Promise<WorkerReceipt>;
}

export interface EffectVerifier {
  verify(
    receipt: WorkerReceipt,
    expectedEffect: ExpectedEffect,
  ): Promise<VerifierResult>;
}

export interface QuestionResponder {
  answer(command: CeoCommand): Promise<string>;
}

export interface CommandClassifier {
  classify(command: CeoCommand): CommandClassification;
}
