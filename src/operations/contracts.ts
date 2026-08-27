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
}

export interface WorkItem {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly intent: string;
  readonly expectedEffect: ExpectedEffect;
  readonly state: WorkItemState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkerEffect {
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

export interface ControlledWorker {
  execute(effect: WorkerEffect): Promise<WorkerReceipt>;
}

export interface EffectVerifier {
  verify(
    receipt: WorkerReceipt,
    expectedEffect: ExpectedEffect,
  ): Promise<VerifierResult>;
}
