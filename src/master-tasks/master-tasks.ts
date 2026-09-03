import type {
  ExecutiveRole, RiskClass, TrustDomain, WorkItem, WorkItemPriority,
  WorkItemState, Workstream,
} from "../operations/contracts.js";
import type { OperationsGateway } from "../operations/operations-gateway.js";
import { OperationsState } from "../operations/operations-state.js";
import { routeTrustDomain } from "../operations/executive-role-router.js";

export type MasterTaskPriority = WorkItemPriority;
export type MasterTaskPropertyType =
  | "title" | "rich_text" | "select" | "multi_select" | "checkbox"
  | "created_time" | "last_edited_time";

export interface MasterTaskSchemaProperty {
  readonly name: string;
  readonly type: MasterTaskPropertyType;
}

export const masterTasksSchema: readonly MasterTaskSchemaProperty[] = [
  { name: "Title", type: "title" },
  { name: "Work Item ID", type: "rich_text" },
  { name: "Workspace", type: "rich_text" },
  { name: "Source", type: "rich_text" },
  { name: "Source Reference", type: "rich_text" },
  { name: "Intent", type: "rich_text" },
  { name: "Trust Domain", type: "select" },
  { name: "Workstream", type: "select" },
  { name: "Accountable Executive", type: "select" },
  { name: "Collaborating Executives", type: "multi_select" },
  { name: "Lifecycle", type: "select" },
  { name: "Priority", type: "select" },
  { name: "Commitment Value", type: "rich_text" },
  { name: "Commitment Provenance", type: "rich_text" },
  { name: "Risk Class", type: "select" },
  { name: "Approval Required", type: "checkbox" },
  { name: "Approval Reference", type: "rich_text" },
  { name: "Portfolio Project", type: "rich_text" },
  { name: "Evidence References", type: "rich_text" },
  { name: "Outcome Report Reference", type: "rich_text" },
  { name: "Created At", type: "created_time" },
  { name: "Updated At", type: "last_edited_time" },
] as const;

export type MasterTasksViewName =
  | "CEO All Work" | "COO Work View" | "Personal CFO Work View"
  | "CAO Work View" | "CTO Work View" | "CMO Work View";

export interface WorkViewDefinition {
  readonly name: MasterTasksViewName;
  readonly accountableExecutive: ExecutiveRole | null;
}

export const masterTasksViewDefinitions: readonly WorkViewDefinition[] = [
  { name: "CEO All Work", accountableExecutive: null },
  { name: "COO Work View", accountableExecutive: "COO" },
  { name: "Personal CFO Work View", accountableExecutive: "Personal CFO" },
  { name: "CAO Work View", accountableExecutive: "CAO" },
  { name: "CTO Work View", accountableExecutive: "CTO" },
  { name: "CMO Work View", accountableExecutive: "CMO" },
] as const;

export interface MasterTasksWorkView {
  readonly id: string;
  readonly name: MasterTasksViewName;
  readonly dataSourceId: string;
  readonly accountableExecutive: ExecutiveRole | null;
  readonly filter: Readonly<Record<string, unknown>> | null;
}

export interface MasterTasksProvisioning {
  readonly parentPageId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly dataSourceName: "Master Tasks";
  readonly schema: readonly MasterTaskSchemaProperty[];
  readonly views: readonly MasterTasksWorkView[];
}

export interface MasterTaskRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly intent: string;
  readonly source: string;
  readonly sourceReference: string;
  readonly trustDomain: TrustDomain;
  readonly workstream: Workstream | null;
  readonly accountableExecutive: ExecutiveRole;
  readonly collaboratingExecutives: readonly ExecutiveRole[];
  readonly lifecycle: WorkItemState;
  readonly priority: WorkItemPriority | null;
  readonly commitmentValue: string | null;
  readonly commitmentProvenance: string | null;
  readonly riskClass: RiskClass | null;
  readonly approvalRequired: boolean;
  readonly approvalReference: string | null;
  readonly portfolioProject: string | null;
  readonly evidenceReferences: readonly string[];
  readonly outcomeReportReference: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EditMasterTaskThroughViewRequest {
  readonly viewName: MasterTasksViewName;
  readonly workItemId: string;
  readonly idempotencyKey: string;
  readonly priority: WorkItemPriority;
}

export interface MasterTasksStore {
  records(): Promise<readonly MasterTaskRecord[]>;
  upsert(record: MasterTaskRecord): Promise<MasterTaskRecord>;
}

function definitionFor(name: MasterTasksViewName): WorkViewDefinition {
  const definition = masterTasksViewDefinitions.find((view) => view.name === name);
  if (definition === undefined) throw new Error(`Unknown Work View: ${name}`);
  return definition;
}

function commitmentProjection(workItem: WorkItem): {
  readonly value: string | null;
  readonly provenance: string | null;
} {
  const commitment = workItem.confirmedCommitment ?? workItem.proposedCommitment;
  return commitment === null
    ? { value: null, provenance: null }
    : { value: commitment.value, provenance: JSON.stringify(commitment.provenance) };
}

export class MasterTasksProjection {
  constructor(
    private readonly state: OperationsState,
    private readonly store: MasterTasksStore,
  ) {}

  async sync(workItem: WorkItem): Promise<MasterTaskRecord> {
    return this.store.upsert(this.recordFor(workItem));
  }

  async view(name: MasterTasksViewName): Promise<readonly MasterTaskRecord[]> {
    const definition = definitionFor(name);
    return (await this.store.records())
      .filter((item) => definition.accountableExecutive === null ||
        item.accountableExecutive === definition.accountableExecutive);
  }

  async reconcileFromStore(gateway: OperationsGateway): Promise<void> {
    for (const record of await this.store.records()) {
      const workItem = this.state.workItem(record.workItemId);
      if (workItem === undefined) continue;
      if (
        workItem.accountableExecutive !== record.accountableExecutive ||
        workItem.workstream !== record.workstream
      ) {
        await this.sync(workItem);
        throw new Error(
          `Master Tasks authority fields drifted for Work Item ${record.workItemId}.`,
        );
      }
      if (workItem.state !== record.lifecycle) {
        await this.sync(workItem);
        throw new Error(
          `Lifecycle changes for Work Item ${record.workItemId} must go through the Operations Gateway.`,
        );
      }
      if (record.priority !== null && record.priority !== workItem.priority) {
        await gateway.recordWorkItemPriority({
          workItemId: record.workItemId,
          priority: record.priority,
          idempotencyKey: `notion:${record.workItemId}:priority:${record.priority}:${record.updatedAt}`,
        });
      }
    }
  }

  async editThroughView(
    request: EditMasterTaskThroughViewRequest,
    gateway: OperationsGateway,
  ): Promise<MasterTaskRecord> {
    const definition = definitionFor(request.viewName);
    const record = (await this.store.records()).find(
      (item) => item.workItemId === request.workItemId,
    );
    if (record === undefined || (definition.accountableExecutive !== null &&
      record.accountableExecutive !== definition.accountableExecutive)) {
      throw new Error(`Work Item ${request.workItemId} is not visible in ${request.viewName}.`);
    }
    const workItem = await gateway.recordWorkItemPriority(request);
    return (await this.store.records()).find((item) => item.workItemId === workItem.id) ??
      this.sync(workItem);
  }

  recordFor(workItem: WorkItem): MasterTaskRecord {
    const commitment = commitmentProjection(workItem);
    const approval = this.state.approvals(workItem.id).at(-1);
    const outcome = this.state.outcomeReport(workItem.id);
    return {
      id: workItem.id,
      workItemId: workItem.id,
      workspaceId: workItem.workspaceId,
      title: workItem.intent,
      intent: workItem.intent,
      source: "Operations Gateway",
      sourceReference: workItem.idempotencyKey,
      trustDomain: routeTrustDomain(
        workItem.workstream,
        workItem.accountableExecutive,
      ),
      workstream: workItem.workstream,
      accountableExecutive: workItem.accountableExecutive,
      collaboratingExecutives: workItem.collaboratingExecutives.map(({ executive }) => executive),
      lifecycle: workItem.state,
      priority: workItem.priority,
      commitmentValue: commitment.value,
      commitmentProvenance: commitment.provenance,
      riskClass: approval?.riskClass ?? null,
      approvalRequired: workItem.state === "Awaiting Approval",
      approvalReference: approval?.id ?? null,
      portfolioProject: null,
      evidenceReferences: outcome === undefined ? [] : [outcome.verification.evidence.reference],
      outcomeReportReference: outcome?.id ?? null,
      createdAt: workItem.createdAt,
      updatedAt: workItem.updatedAt,
    };
  }
}
