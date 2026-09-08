import type { DashboardOverview } from "./dashboard-read-model.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(value: string): string {
  return `<td>${escapeHtml(value)}</td>`;
}

export function renderDashboardPage(overview: DashboardOverview): string {
  const workItemRows = overview.workItems
    .map(
      (workItem) =>
        `<tr data-work-item-id="${escapeHtml(workItem.id)}">` +
        cell(workItem.intent) +
        `<td data-field="state">${escapeHtml(workItem.state)}</td>` +
        `<td data-field="accountableExecutive">${escapeHtml(workItem.accountableExecutive)}</td>` +
        `<td data-field="blockers">${escapeHtml(workItem.blockers.join("; "))}</td>` +
        `<td data-field="outcomeReportRevision">${escapeHtml(String(workItem.outcomeReportRevision ?? ""))}</td>` +
        "</tr>",
    )
    .join("");

  const approvalRows = overview.pendingApprovals
    .map(
      (approval) =>
        `<tr data-approval-id="${escapeHtml(approval.id)}">` +
        `<td data-field="scope">${escapeHtml(approval.scope)}</td>` +
        `<td data-field="targetIdentity">${escapeHtml(approval.targetIdentity)}</td>` +
        `<td data-field="targetVersion">${escapeHtml(approval.targetVersion)}</td>` +
        `<td data-field="riskClass">${escapeHtml(approval.riskClass)}</td>` +
        "</tr>",
    )
    .join("");

  const executiveRows = overview.executives
    .map(
      (executive) =>
        `<tr data-executive="${escapeHtml(executive.executive)}">` +
        `<td data-field="accountableWorkItems">${executive.accountableWorkItems}</td>` +
        `<td data-field="awaitingApproval">${executive.awaitingApproval}</td>` +
        `<td data-field="readyForCeoReview">${executive.readyForCeoReview}</td>` +
        "</tr>",
    )
    .join("");

  const auditRows = overview.auditEvents
    .map(
      (event) =>
        `<tr data-audit-sequence="${event.sequence}">` +
        `<td data-field="type">${escapeHtml(event.type)}</td>` +
        `<td data-field="workItemId">${escapeHtml(event.workItemId)}</td>` +
        "</tr>",
    )
    .join("");

  const deploymentCandidateRows = overview.deploymentCandidates
    .map(
      (candidate) =>
        `<tr data-deployment-candidate-id="${escapeHtml(candidate.id)}">` +
        cell(candidate.projectName) +
        `<td data-field="repositorySourceReference">${escapeHtml(candidate.repositorySourceReference)}</td>` +
        `<td data-field="pullRequestSourceReference">${escapeHtml(candidate.pullRequestSourceReference)}</td>` +
        `<td data-field="exactCommitSha">${escapeHtml(candidate.exactCommitSha)}</td>` +
        `<td data-field="pullRequestNumber">#${candidate.pullRequestNumber}</td>` +
        `<td data-field="preview">${escapeHtml(`${candidate.previewDeploymentId} ${candidate.previewDomain}`)}</td>` +
        `<td data-field="verificationStatus">${escapeHtml(candidate.verificationStatus)}</td>` +
        `<td data-field="rollbackCommitSha">${escapeHtml(candidate.rollbackCommitSha)}</td>` +
        `<td data-field="requiredDecisions">${escapeHtml(candidate.requiredDecisions.join("; "))}</td>` +
        `<td data-field="approvals">${escapeHtml(candidate.approvals.map((approval) => `${approval.scope}:${approval.id}:${approval.state}:${approval.targetVersion}${approval.expiresAt === null ? "" : ` exp=${approval.expiresAt}`}`).join("; "))}</td>` +
        `</tr>`,
    )
    .join("");

  const controlPlaneRows = overview.controlPlane
    .map(
      (component) =>
        `<tr data-control-plane-component="${escapeHtml(component.component)}">` +
        `<td data-field="lastOutcome">${escapeHtml(component.lastOutcome)}</td>` +
        `<td data-field="lastCheckedAt">${escapeHtml(component.lastCheckedAt)}</td>` +
        `<td data-field="consecutiveFailures">${component.consecutiveFailures}</td>` +
        `<td data-field="lastRecoveredAt">${escapeHtml(component.lastRecoveredAt ?? "")}</td>` +
        "</tr>",
    )
    .join("");

  const schedulerRows = overview.scheduler
    .map(
      (job) =>
        `<tr data-scheduler-job="${escapeHtml(job.job)}">` +
        `<td data-field="provider">${escapeHtml(job.provider)}</td>` +
        `<td data-field="expectedCadence">${escapeHtml(job.expectedCadence)}</td>` +
        `<td data-field="criticality">${escapeHtml(job.criticality)}</td>` +
        `<td data-field="accountableExecutive">${escapeHtml(job.accountableExecutive)}</td>` +
        `<td data-field="owner">${escapeHtml(job.owner)}</td>` +
        `<td data-field="lastRunId">${escapeHtml(job.lastRunId ?? "")}</td>` +
        `<td data-field="lastRunOwner">${escapeHtml(job.lastRunOwner ?? "")}</td>` +
        `<td data-field="lastSchedulerHeartbeat">${escapeHtml(job.lastSchedulerHeartbeat ?? "")}</td>` +
        `<td data-field="lastSuccess">${escapeHtml(job.lastSuccess ?? "")}</td>` +
        `<td data-field="nextExpectedRun">${escapeHtml(job.nextExpectedRun)}</td>` +
        `<td data-field="durationMs">${escapeHtml(String(job.durationMs ?? ""))}</td>` +
        `<td data-field="failureStreak">${job.failureStreak}</td>` +
        `<td data-field="failureHistory">${escapeHtml(job.failureHistory.map((failure) => `${failure.occurrenceDate} (${failure.evidenceLink})`).join(", "))}</td>` +
        `<td data-field="evidenceLink">${escapeHtml(job.evidenceLink)}</td>` +
        `<td data-field="lastOutcome">${escapeHtml(job.lastOutcome ?? "")}</td>` +
        "</tr>",
    )
    .join("");

  const knowledgeRows = overview.knowledge
    .map(
      (health) =>
        `<tr data-knowledge-domain="${escapeHtml(health.domain)}">` +
        `<td data-field="status">${escapeHtml(health.status)}</td>` +
        `<td data-field="lastIngest">${escapeHtml(health.lastIngest ?? "")}</td>` +
        `<td data-field="lastCompile">${escapeHtml(health.lastCompile ?? "")}</td>` +
        `<td data-field="lastPublish">${escapeHtml(health.lastPublish ?? "")}</td>` +
        `<td data-field="lastLint">${escapeHtml(health.lastLint ?? "")}</td>` +
        `<td data-field="lastRetention">${escapeHtml(health.lastRetention ?? "")}</td>` +
        `<td data-field="generation">${escapeHtml(health.currentGenerationId ?? "")}</td>` +
        `<td data-field="backlog">${health.backlog}</td>` +
        `<td data-field="stalePages">${health.stalePages}</td>` +
        `<td data-field="citationFailures">${health.citationFailures}</td>` +
        `<td data-field="quarantinedConflicts">${health.quarantinedConflicts}</td>` +
        `<td data-field="purgedRecords">${health.purgedRecords}</td>` +
        `</tr>`,
    )
    .join("");

  const providerObservationRows = overview.providerObservations
    .map(
      (observation) =>
        `<tr data-provider-observation-id="${escapeHtml(observation.observationId)}">` +
        `<td data-field="provider">${escapeHtml(observation.provider)}</td>` +
        `<td data-field="sourceReference">${escapeHtml(observation.sourceReference)}</td>` +
        `<td data-field="status">${escapeHtml(observation.status)}</td>` +
        `<td data-field="failureClass">${escapeHtml(observation.failureClass ?? "")}</td>` +
        `<td data-field="attemptCount">${observation.attemptCount}</td>` +
        `<td data-field="lastObservedAt">${escapeHtml(observation.lastObservedAt)}</td>` +
        `<td data-field="recoveredAt">${escapeHtml(observation.recoveredAt ?? "active")}</td>` +
        `<td data-field="workItemId">${escapeHtml(observation.workItemId ?? "")}</td>` +
        `<td data-field="auditSequence">${escapeHtml(String(observation.auditSequence ?? ""))}</td>` +
        "</tr>",
    )
    .join("");

  const hermesRows = overview.hermes === undefined
    ? `<tr data-hermes-status="disabled"><td data-field="status">disabled</td><td data-field="model"></td><td data-field="sessionCount">0</td><td data-field="turnCount">0</td><td data-field="lastTurnAt"></td><td data-field="lastIntent"></td><td data-field="lastWorkItemId"></td><td data-field="lastFailure"></td></tr>`
    : `<tr data-hermes-status="${escapeHtml(overview.hermes.status)}">` +
      `<td data-field="status">${escapeHtml(overview.hermes.status)}</td>` +
      `<td data-field="model">${escapeHtml(overview.hermes.model ?? "")}</td>` +
      `<td data-field="sessionCount">${overview.hermes.sessionCount}</td>` +
      `<td data-field="turnCount">${overview.hermes.turnCount}</td>` +
      `<td data-field="lastTurnAt">${escapeHtml(overview.hermes.lastTurnAt ?? "")}</td>` +
      `<td data-field="lastIntent">${escapeHtml(overview.hermes.lastIntent ?? "")}</td>` +
      `<td data-field="lastWorkItemId">${escapeHtml(overview.hermes.lastWorkItemId ?? "")}</td>` +
      `<td data-field="lastFailure">${escapeHtml(overview.hermes.lastFailure ?? "")}</td>` +
      "</tr>";

  const nativeHermesRows = overview.nativeHermes === undefined
    ? `<tr data-native-hermes-status="not-configured"><td data-field="status">not-configured</td><td data-field="owner"></td><td data-field="model"></td><td data-field="checkedAt"></td><td data-field="lastFailure"></td></tr>`
    : `<tr data-native-hermes-status="${escapeHtml(overview.nativeHermes.status)}">` +
      `<td data-field="status">${escapeHtml(overview.nativeHermes.status)}</td>` +
      `<td data-field="owner">${escapeHtml(overview.nativeHermes.owner)}</td>` +
      `<td data-field="model">${escapeHtml(overview.nativeHermes.model ?? "")}</td>` +
      `<td data-field="checkedAt">${escapeHtml(overview.nativeHermes.checkedAt)}</td>` +
      `<td data-field="lastFailure">${escapeHtml(overview.nativeHermes.lastFailure ?? "")}</td>` +
      "</tr>";

  const portfolioRows = overview.projectPortfolio
    .map(
      (project) =>
        `<tr data-portfolio-project-id="${escapeHtml(project.id)}">` +
        cell(project.name) +
        `<td data-field="portfolioState">${escapeHtml(project.portfolioState)}</td>` +
        `<td data-field="remoteReady">${project.remoteReady ? "ready" : "not-ready"}</td>` +
        `<td data-field="health">${escapeHtml(project.health)}</td>` +
        `<td data-field="operatingInstructions">${escapeHtml(project.operatingInstructions ?? "")}</td>` +
        `<td data-field="sourceFreshness">${escapeHtml(JSON.stringify(project.sourceFreshness))}</td>` +
        "</tr>",
    )
    .join("");

  const repositoryCenterRows = overview.projectPortfolio
    .filter((project) => project.repositoryCenter !== null)
    .map((project) => {
      const center = project.repositoryCenter!;
      const branchSummary = center.git.branches
        .map((branch) => `${branch.name} ${branch.sha} ${branch.divergence} (+${branch.ahead}/-${branch.behind})`)
        .join(", ");
      const pullSummary = center.github.pullRequests
        .map((pull) => `#${pull.number} ${pull.title} ${pull.head.sha}`)
        .join(", ");
      const checkSummary = center.github.checks
        .map((check) => `${check.name}:${check.conclusion ?? check.status} ${check.sha}`)
        .join(", ");
      const reviewSummary = center.github.reviews
        .map((review) => `#${review.pullRequestNumber} ${review.reviewer}:${review.state} ${review.commitSha}`)
        .join(", ");
      const releaseSummary = center.github.releases
        .map((release) => `${release.tag} ${release.targetSha}`)
        .join(", ");
      const incidentSummary = center.github.incidents
        .map((incident) => `#${incident.number} ${incident.title}`)
        .join(", ");
      const tagSummary = center.git.tags.map((tag) => `${tag.name} ${tag.sha}`).join(", ");
      const deploymentSummary = center.git.deploymentAssociations
        .map((association) => `${association.provider}:${association.reference} ${association.commitSha}`)
        .join(", ");
      const vercelSummary = center.vercel?.deployments
        .map((deployment) => `${deployment.environment}:${deployment.status} ${deployment.commitSha ?? "unknown"} ${deployment.lineageStatus} ${deployment.verificationStatus}${deployment.rollbackCandidate ? " rollback-candidate" : ""} pr#${deployment.pullRequestNumber ?? "none"} branch=${deployment.branch ?? "unknown"} source=${deployment.sourceReference} asOf=${deployment.readyAt ?? deployment.createdAt ?? "unknown"} evidence=${deployment.verificationEvidence?.reference ?? "none"} ${deployment.domain ?? ""}`)
        .join(", ") ?? "not configured";
      return (
        `<tr data-repository-center-project-id="${escapeHtml(project.id)}">` +
        cell(center.repository.fullName ?? center.repository.reference ?? "") +
        `<td data-field="githubStatus">${escapeHtml(center.github.observation.status)}</td>` +
        `<td data-field="githubSource">${escapeHtml(center.github.observation.sourceReference)} @ ${escapeHtml(center.github.observation.asOf ?? "unknown")}</td>` +
        `<td data-field="gitStatus">${escapeHtml(center.git.observation.status)}</td>` +
        `<td data-field="gitSource">${escapeHtml(center.git.observation.sourceReference)} @ ${escapeHtml(center.git.observation.asOf ?? "unknown")}</td>` +
        `<td data-field="productionHeadSha">${escapeHtml(center.repository.productionHeadSha ?? "")}</td>` +
        `<td data-field="currentHead">${escapeHtml(`${center.git.currentBranch ?? "unknown"} ${center.git.currentHeadSha ?? "unknown"}`)}</td>` +
        `<td data-field="branches">${escapeHtml(branchSummary)}</td>` +
        `<td data-field="pullRequests">${escapeHtml(pullSummary || "none")}</td>` +
        `<td data-field="checks">${escapeHtml(checkSummary || "none")}</td>` +
        `<td data-field="reviews">${escapeHtml(reviewSummary || "none")}</td>` +
        `<td data-field="releases">${escapeHtml(releaseSummary || "none")}</td>` +
        `<td data-field="incidents">${escapeHtml(incidentSummary || "none")}</td>` +
        `<td data-field="tags">${escapeHtml(tagSummary || "none")}</td>` +
        `<td data-field="deployments">${escapeHtml(deploymentSummary || "none")}</td>` +
        `<td data-field="vercelStatus">${escapeHtml(center.vercel?.observation.status ?? "not configured")}</td>` +
        `<td data-field="vercelSource">${escapeHtml(center.vercel === null ? "not configured" : `${center.vercel.observation.sourceReference} @ ${center.vercel.observation.asOf ?? "unknown"}`)}</td>` +
        `<td data-field="vercelDeployments">${escapeHtml(vercelSummary)}</td>` +
        `<td data-field="workerAvailability">${escapeHtml(center.git.worker.availability)}</td>` +
        `<td data-field="workerDirty">${escapeHtml(center.git.worker.dirty === null ? "unknown" : String(center.git.worker.dirty))}</td>` +
        `<td data-field="deploymentAssociations">${center.git.deploymentAssociations.length}</td>` +
        "</tr>"
      );
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Real-Ming CEO Operations</title>
</head>
<body>
<main>
<h1>Real-Ming CEO Operations</h1>
<p data-field="actorId">${escapeHtml(overview.actorId)}</p>
<p data-field="workspaceId">${escapeHtml(overview.workspaceId)}</p>
<p data-field="refresh-policy">Live read model · refreshes every 15 seconds · prompts and chain-of-thought are never rendered.</p>

<section aria-labelledby="work-items-title">
<h2 id="work-items-title">Work Items</h2>
<table id="work-items"><tbody>${workItemRows}</tbody></table>
</section>

<section aria-labelledby="approvals-title">
<h2 id="approvals-title">Pending Approvals</h2>
<table id="pending-approvals"><tbody>${approvalRows}</tbody></table>
</section>

<section aria-labelledby="executives-title">
<h2 id="executives-title">Executive Roles</h2>
<table id="executives"><tbody>${executiveRows}</tbody></table>
</section>

<section aria-labelledby="audit-title">
<h2 id="audit-title">Audit</h2>
<table id="audit-events"><tbody>${auditRows}</tbody></table>
</section>

<section aria-labelledby="deployment-candidates-title">
<h2 id="deployment-candidates-title">Approve Promotion · Deployment Candidates</h2>
<p>Each row is the exact repository, pull request, commit, preview, rollback target, and Approval identity. Promotion is available only through the candidate-bound API.</p>
<table id="deployment-candidates"><tbody>${deploymentCandidateRows}</tbody></table>
</section>

<section aria-labelledby="portfolio-title">
<h2 id="portfolio-title">Project Portfolio</h2>
<table id="project-portfolio"><tbody>${portfolioRows}</tbody></table>
</section>

<section aria-labelledby="repository-center-title">
<h2 id="repository-center-title">GitHub Repository Center and Git Lineage</h2>
<table id="repository-center"><tbody>${repositoryCenterRows}</tbody></table>
</section>

<section aria-labelledby="control-plane-title">
<h2 id="control-plane-title">Control Plane Health and Recovery</h2>
<table id="control-plane-health"><tbody>${controlPlaneRows}</tbody></table>
</section>

<section aria-labelledby="scheduler-health-title">
<h2 id="scheduler-health-title">Scheduler Heartbeats</h2>
<table id="scheduler-health"><tbody>${schedulerRows}</tbody></table>
</section>

<section aria-labelledby="knowledge-health-title">
<h2 id="knowledge-health-title">Knowledge Compiler Health</h2>
<p>Per-domain status and counters only; raw knowledge content is never rendered here.</p>
<table id="knowledge-health"><tbody>${knowledgeRows}</tbody></table>
</section>

<section aria-labelledby="provider-observations-title">
<h2 id="provider-observations-title">Provider Observations</h2>
<table id="provider-observations"><tbody>${providerObservationRows}</tbody></table>
</section>

<section aria-labelledby="hermes-runtime-title">
<h2 id="hermes-runtime-title">Hermes Runtime and Conversations</h2>
<p>Only operational metadata is shown. Telegram prompts, provider payloads, and chain-of-thought are not rendered.</p>
<table id="hermes-runtime"><tbody>${hermesRows}</tbody></table>
</section>

<section aria-labelledby="native-hermes-title">
<h2 id="native-hermes-title">Native Hermes Gateway</h2>
<p>The native gateway owns Telegram transport, slash commands, tools, plugins, MCP and conversation sessions. Session details remain in Hermes; this panel shows only Real-Ming's read-only reachability check.</p>
<table id="native-hermes"><tbody>${nativeHermesRows}</tbody></table>
</section>
</main>
<script>
  window.setTimeout(() => window.location.reload(), 15000);
</script>
</body>
</html>`;
}
