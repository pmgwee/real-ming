import type {
  Approval,
  AuditEvent,
  ExecutiveRole,
  OutcomeReport,
  WorkItem,
  WorkItemState,
} from "../operations/contracts.js";
import type { OperationsState } from "../operations/operations-state.js";
import type {
  ControlPlaneHealth,
  ProviderObservation,
} from "../operations/operations-state.js";
import {
  schedulerHealth,
  schedulerJobInventory,
  type SchedulerJobHealth,
  type SchedulerJobDefinition,
} from "../operations/daily-operations-scheduler.js";
import type { ProjectPortfolio } from "../portfolio/project-portfolio.js";
import type { RepositoryCenterView } from "../portfolio/repository-center.js";
import type { DeploymentCandidate, DeploymentCandidateStore } from "../portfolio/deployment-candidate.js";
import type { KnowledgeDomainHealth } from "../knowledge/knowledge-operations.js";
import type { HermesConversationOverview } from "../hermes/hermes-turn-coordinator.js";

export interface DashboardWorkItemView {
  readonly id: string;
  readonly intent: string;
  readonly state: WorkItemState;
  readonly accountableExecutive: ExecutiveRole;
  readonly workstream: string | null;
  readonly collaboratingExecutives: readonly ExecutiveRole[];
  readonly blockers: readonly string[];
  readonly pendingApprovalId: string | null;
  readonly outcomeReportRevision: number | null;
  readonly confirmedCommitment: string | null;
  readonly proposedCommitment: string | null;
  readonly updatedAt: string;
}

export interface DashboardApprovalView {
  readonly id: string;
  readonly workItemId: string;
  readonly scope: Approval["scope"];
  readonly targetType: string;
  readonly targetIdentity: string;
  readonly targetVersion: string;
  readonly riskClass: Approval["riskClass"];
  readonly requestedAt: string;
  readonly expiresAt: string | null;
  readonly state: Approval["state"];
}

export interface DashboardOutcomeReportView {
  readonly id: string;
  readonly workItemId: string;
  readonly revision: number;
  readonly requestedIntent: string;
  readonly verificationStatus: OutcomeReport["verification"]["status"];
  readonly remainingRisks: readonly string[];
  readonly requiredDecisions: readonly string[];
  readonly createdAt: string;
}

export interface DashboardDeploymentCandidateView {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workItemId: string;
  readonly exactCommitSha: string;
  readonly productionBranch: string;
  readonly repositorySourceReference: string;
  readonly pullRequestSourceReference: string;
  readonly pullRequestNumber: number;
  readonly previewDeploymentId: string;
  readonly previewDomain: string;
  readonly verificationStatus: DeploymentCandidate["previewVerification"]["status"];
  readonly rollbackCommitSha: string;
  readonly requiredDecisions: readonly string[];
  readonly approvals: readonly {
    readonly id: string;
    readonly scope: Approval["scope"];
    readonly targetType: string;
    readonly targetIdentity: string;
    readonly targetVersion: string;
    readonly state: Approval["state"];
    readonly expiresAt: string | null;
  }[];
  readonly createdAt: string;
}

export interface DashboardAuditView {
  readonly sequence: number;
  readonly workItemId: string;
  readonly type: AuditEvent["type"];
  readonly occurredAt: string;
}

export interface DashboardExecutiveView {
  readonly executive: ExecutiveRole;
  readonly accountableWorkItems: number;
  readonly awaitingApproval: number;
  readonly readyForCeoReview: number;
}

export interface DashboardPortfolioProjectView {
  readonly id: string;
  readonly name: string;
  readonly portfolioState: string;
  readonly repository: string | null;
  readonly productionBranch: string | null;
  readonly deploymentIdentifiers: Readonly<{
    readonly github: string | null;
    readonly vercel: string | null;
  }>;
  readonly evidenceIdentity: string | null;
  readonly operatingInstructions: string | null;
  readonly responsibleRoles: readonly ExecutiveRole[];
  readonly sensitivity: string;
  readonly health: string;
  readonly remoteReady: boolean;
  readonly remoteReadyReasons: readonly string[];
  readonly reconciled: boolean;
  readonly reconciliationIssues: readonly string[];
  readonly sourceLinks: readonly {
    readonly kind: string;
    readonly reference: string;
    readonly asOf: string;
    readonly freshness: "current" | "stale";
  }[];
  readonly sourceFreshness: Readonly<Record<string, "current" | "stale">>;
  /** Read-only GitHub/Git lineage when the provider observations are available. */
  readonly repositoryCenter: RepositoryCenterView | null;
  readonly updatedAt: string;
}

export interface DashboardOverview {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly workItems: readonly DashboardWorkItemView[];
  readonly pendingApprovals: readonly DashboardApprovalView[];
  readonly outcomeReports: readonly DashboardOutcomeReportView[];
  readonly deploymentCandidates: readonly DashboardDeploymentCandidateView[];
  readonly auditEvents: readonly DashboardAuditView[];
  readonly executives: readonly DashboardExecutiveView[];
  readonly projectPortfolio: readonly DashboardPortfolioProjectView[];
  readonly scheduler: readonly SchedulerJobHealth[];
  readonly controlPlane: readonly ControlPlaneHealth[];
  /** Provider degradation is separate from binary process health. */
  readonly providerObservations: readonly ProviderObservation[];
  /** Payload-free per-domain Knowledge Compiler health. */
  readonly knowledge: readonly KnowledgeDomainHealth[];
  /** Payload-free Hermes session and turn health; prompts and chain-of-thought never enter the view. */
  readonly hermes?: HermesConversationOverview;
}

const executiveRoles: readonly ExecutiveRole[] = [
  "COO",
  "CTO",
  "Personal CFO",
  "CAO",
  "CMO",
];

const blockedStates: readonly WorkItemState[] = [
  "Awaiting Approval",
  "Waiting/Blocked",
  "Changes Requested",
];

/**
 * The one definition of "this Approval is waiting on the CEO", shared by the
 * dashboard, the Morning Brief and the Executive Roll-Up so the three can never
 * disagree about what he still owes a decision on.
 */
export function pendingApprovalsFor(
  approvals: readonly Approval[],
): readonly Approval[] {
  return approvals.filter((approval) => approval.state === "requested");
}

/**
 * Shared with the Morning Brief so the dashboard and the 07:30 message never
 * give two different answers to "is this waiting on me, and why".
 */
export function blockersFor(
  workItem: WorkItem,
  approvals: readonly Approval[],
  auditEvents: readonly AuditEvent[],
): readonly string[] {
  if (!blockedStates.includes(workItem.state)) {
    return [];
  }

  if (workItem.state === "Awaiting Approval") {
    const standing = approvals.at(-1);
    return standing === undefined || standing.state !== "granted"
      ? [`Awaiting CEO Approval for ${standing?.scope ?? "an unrecorded scope"}`]
      : [];
  }

  const reason = auditEvents
    .filter(
      (event) =>
        event.type === "work-item.waiting-blocked" ||
        event.type === "work-item.changes-requested",
    )
    .at(-1)?.details["reason"];

  return [
    typeof reason === "string"
      ? reason
      : `Blocked in ${workItem.state} without a recorded reason`,
  ];
}

export function buildDashboardOverview(
  state: OperationsState,
  session: {
    readonly actorId: string;
    readonly workspaceId: string;
    /** The operating clock, so scheduler health can name the next run. */
    readonly now?: string;
  },
  portfolio?: ProjectPortfolio,
  repositoryCenters?: ReadonlyMap<string, RepositoryCenterView>,
  deploymentCandidates?: DeploymentCandidateStore,
  schedulerJobs: readonly SchedulerJobDefinition[] = schedulerJobInventory,
  knowledge: readonly KnowledgeDomainHealth[] = [],
  hermes?: HermesConversationOverview,
): DashboardOverview {
  const workItems = state
    .workItems()
    .filter((workItem) => workItem.workspaceId === session.workspaceId);

  const views = workItems.map((workItem) => {
    const approvals = state.approvals(workItem.id);
    const auditEvents = state.auditTrail(workItem.id);
    const standing = approvals.at(-1);

    return {
      id: workItem.id,
      intent: workItem.intent,
      state: workItem.state,
      accountableExecutive: workItem.accountableExecutive,
      workstream: workItem.workstream,
      collaboratingExecutives: workItem.collaboratingExecutives.map(
        (assignment) => assignment.executive,
      ),
      blockers: blockersFor(workItem, approvals, auditEvents),
      pendingApprovalId:
        standing !== undefined && standing.state === "requested"
          ? standing.id
          : null,
      outcomeReportRevision:
        state.outcomeReport(workItem.id)?.revision ?? null,
      confirmedCommitment: workItem.confirmedCommitment?.value ?? null,
      proposedCommitment: workItem.proposedCommitment?.value ?? null,
      updatedAt: workItem.updatedAt,
    } satisfies DashboardWorkItemView;
  });

  const pendingApprovals = workItems.flatMap((workItem) =>
    pendingApprovalsFor(state.approvals(workItem.id))
      .map(
        (approval) =>
          ({
            id: approval.id,
            workItemId: approval.workItemId,
            scope: approval.scope,
            targetType: approval.targetType,
            targetIdentity: approval.targetIdentity,
            targetVersion: approval.targetVersion,
            riskClass: approval.riskClass,
            requestedAt: approval.requestedAt,
            expiresAt: approval.expiresAt,
            state: approval.state,
          }) satisfies DashboardApprovalView,
      ),
  );

  const outcomeReports = workItems.flatMap((workItem) =>
    state.outcomeReportRevisions(workItem.id).map(
      (report) =>
        ({
          id: report.id,
          workItemId: report.workItemId,
          revision: report.revision,
          requestedIntent: report.requestedIntent,
          verificationStatus: report.verification.status,
          remainingRisks: report.remainingRisks,
          requiredDecisions: report.requiredDecisions,
          createdAt: report.createdAt,
        }) satisfies DashboardOutcomeReportView,
    ),
  );

  const deploymentCandidateViews = (deploymentCandidates?.candidates() ?? [])
    .filter((candidate) => workItems.some((workItem) => workItem.id === candidate.workItemId))
    .map((candidate) => ({
      id: candidate.id,
      projectId: candidate.projectId,
      projectName: candidate.projectName,
      workItemId: candidate.workItemId,
      exactCommitSha: candidate.exactCommitSha,
      productionBranch: candidate.productionBranch,
      repositorySourceReference: candidate.taskBranch.sourceReference,
      pullRequestSourceReference: candidate.pullRequest.sourceReference,
      pullRequestNumber: candidate.pullRequest.number,
      previewDeploymentId: candidate.preview.deploymentId,
      previewDomain: candidate.preview.domain,
      verificationStatus: candidate.previewVerification.status,
      rollbackCommitSha: candidate.rollback.commitSha,
      requiredDecisions: candidate.outcomeReport.requiredDecisions,
      approvals: state.approvals(candidate.workItemId)
        .filter((approval) => approval.targetIdentity === candidate.id)
        .map((approval) => ({
          id: approval.id,
          scope: approval.scope,
          targetType: approval.targetType,
          targetIdentity: approval.targetIdentity,
          targetVersion: approval.targetVersion,
          state: approval.state,
          expiresAt: approval.expiresAt,
        })),
      createdAt: candidate.createdAt,
    } satisfies DashboardDeploymentCandidateView));

  const auditEvents = workItems
    .flatMap((workItem) => state.auditTrail(workItem.id))
    .sort((left, right) => left.sequence - right.sequence)
    .map(
      (event) =>
        ({
          sequence: event.sequence,
          workItemId: event.workItemId,
          type: event.type,
          occurredAt: event.occurredAt,
        }) satisfies DashboardAuditView,
    );

  const executives = executiveRoles.map((executive) => {
    const owned = views.filter(
      (view) => view.accountableExecutive === executive,
    );
    return {
      executive,
      accountableWorkItems: owned.length,
      awaitingApproval: owned.filter(
        (view) => view.state === "Awaiting Approval",
      ).length,
      readyForCeoReview: owned.filter(
        (view) => view.state === "Ready for CEO Review",
      ).length,
    } satisfies DashboardExecutiveView;
  });

  const projectPortfolio = (portfolio?.projects() ?? []).map((project) => {
    const reconciliation = portfolio?.reconcile(project.id);
    return {
      id: project.id,
      name: project.name,
      portfolioState: project.portfolioState,
      repository: project.repository,
      productionBranch: project.productionBranch,
      deploymentIdentifiers: project.deploymentIdentifiers,
      evidenceIdentity: project.evidenceIdentity,
      operatingInstructions: project.operatingInstructions,
      responsibleRoles: project.responsibleRoles,
      sensitivity: project.sensitivity,
      health: project.health,
      remoteReady: project.remoteReady.ready,
      remoteReadyReasons: project.remoteReady.reasons,
      reconciled: reconciliation?.reconciled ?? true,
      reconciliationIssues: reconciliation?.issues.map((issue) => issue.code) ?? [],
      sourceLinks: project.sourceLinks,
      sourceFreshness: Object.fromEntries(
        project.sourceLinks.map((source) => [source.kind, source.freshness]),
      ),
      repositoryCenter: repositoryCenters?.get(project.id) ?? null,
      updatedAt: project.updatedAt,
    } satisfies DashboardPortfolioProjectView;
  });

  return {
    actorId: session.actorId,
    workspaceId: session.workspaceId,
    workItems: views,
    pendingApprovals,
    outcomeReports,
    deploymentCandidates: deploymentCandidateViews,
    auditEvents,
    executives,
    projectPortfolio,
    scheduler: schedulerHealth(state, session.now ?? new Date().toISOString(), schedulerJobs),
    controlPlane: state.controlPlaneHealth(),
    providerObservations: state.providerObservations(),
    knowledge,
    ...(hermes === undefined ? {} : { hermes }),
  };
}
