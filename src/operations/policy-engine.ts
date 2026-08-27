import type {
  ActionOperation,
  Approval,
  ApprovalRequiredReason,
  ProhibitedCapability,
  RequestedAction,
  StandingAuthority,
} from "./contracts.js";

const automaticBaselineOperations: readonly ActionOperation[] = [
  "read",
  "monitor",
  "classify",
  "summarize",
  "draft",
];

const prohibitedCapabilities: readonly ProhibitedCapability[] = [
  "money-movement",
  "brokerage-trading",
];

export type PolicyOutcome =
  | { readonly kind: "automatic-baseline" }
  | {
      readonly kind: "capability-not-grantable";
      readonly capability: ProhibitedCapability;
    }
  | {
      readonly kind: "standing-authority";
      readonly standingAuthority: StandingAuthority;
    }
  | { readonly kind: "approval"; readonly approval: Approval }
  | {
      readonly kind: "approval-required";
      readonly reason: ApprovalRequiredReason;
      readonly invalidatedApproval: Approval | undefined;
    };

export function isAutomaticBaseline(operation: ActionOperation): boolean {
  return automaticBaselineOperations.includes(operation);
}

export function isProhibitedCapability(
  capability: ProhibitedCapability | undefined,
): capability is ProhibitedCapability {
  return (
    capability !== undefined && prohibitedCapabilities.includes(capability)
  );
}

export function requiresStandingAuthority(action: RequestedAction): boolean {
  return action.reversibility === "reversible" && action.riskClass === "low";
}

function matchesStandingAuthority(
  action: RequestedAction,
  standingAuthority: StandingAuthority,
): boolean {
  return (
    standingAuthority.executive === action.executive &&
    standingAuthority.trustDomain === action.trustDomain &&
    standingAuthority.targetType === action.target?.type
  );
}

function matchesApprovalTarget(
  action: RequestedAction,
  approval: Approval,
): boolean {
  return (
    approval.scope === action.scope &&
    approval.targetType === action.target?.type &&
    approval.targetIdentity === action.target.identity
  );
}

export function findEffectiveApproval(
  approvals: readonly Approval[],
  now: string,
): Approval | undefined {
  const standing = approvals.at(-1);
  if (
    standing === undefined ||
    standing.state !== "granted" ||
    (standing.expiresAt !== null && standing.expiresAt <= now)
  ) {
    return undefined;
  }
  return standing;
}

export function evaluateAction(input: {
  readonly action: RequestedAction;
  readonly standingAuthorities: readonly StandingAuthority[];
  readonly approvals: readonly Approval[];
  readonly now: string;
}): PolicyOutcome {
  const { action, now } = input;

  if (isProhibitedCapability(action.capability)) {
    return {
      kind: "capability-not-grantable",
      capability: action.capability,
    };
  }

  if (isAutomaticBaseline(action.operation)) {
    return { kind: "automatic-baseline" };
  }

  const granted = input.approvals.find(
    (approval) =>
      approval.state === "granted" && matchesApprovalTarget(action, approval),
  );

  if (granted !== undefined) {
    if (granted.targetVersion !== action.target?.version) {
      return {
        kind: "approval-required",
        reason: "target-changed",
        invalidatedApproval: granted,
      };
    }
    if (granted.expiresAt !== null && granted.expiresAt <= now) {
      return {
        kind: "approval-required",
        reason: "approval-expired",
        invalidatedApproval: granted,
      };
    }
    return { kind: "approval", approval: granted };
  }

  if (requiresStandingAuthority(action)) {
    const matching = input.standingAuthorities.filter((standingAuthority) =>
      matchesStandingAuthority(action, standingAuthority),
    );
    const unexpired = matching.find(
      (standingAuthority) => standingAuthority.expiresAt > now,
    );

    if (unexpired !== undefined) {
      return { kind: "standing-authority", standingAuthority: unexpired };
    }

    return {
      kind: "approval-required",
      reason:
        matching.length > 0
          ? "standing-authority-expired"
          : "standing-authority-required",
      invalidatedApproval: undefined,
    };
  }

  return {
    kind: "approval-required",
    reason: "approval-required",
    invalidatedApproval: undefined,
  };
}
