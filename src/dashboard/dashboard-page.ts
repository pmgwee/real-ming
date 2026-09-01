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

<section aria-labelledby="portfolio-title">
<h2 id="portfolio-title">Project Portfolio</h2>
<table id="project-portfolio"><tbody>${portfolioRows}</tbody></table>
</section>

<section aria-labelledby="control-plane-title">
<h2 id="control-plane-title">Control Plane Health and Recovery</h2>
<table id="control-plane-health"><tbody>${controlPlaneRows}</tbody></table>
</section>
</main>
</body>
</html>`;
}
