import type {
  ExecutiveRole,
  RiskClass,
  TrustDomain,
  WorkItemState,
  Workstream,
} from "../operations/contracts.js";
import { lifecycleEventFor } from "../operations/work-item-lifecycle.js";

export type MasterTaskPriority = "Low" | "Medium" | "High" | "Critical";

export type MasterTaskPropertyType =
  | "title"
  | "rich_text"
  | "select"
  | "multi_select"
  | "checkbox"
  | "created_time"
  | "last_edited_time";

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

export const workstreamRoutes: Readonly<
  Record<
    Workstream,
    { readonly trustDomain: TrustDomain; readonly executive: ExecutiveRole }
  >
> = {
  "Personal Life": { trustDomain: "Personal", executive: "COO" },
  "Career Job": { trustDomain: "Personal", executive: "COO" },
  Finance: { trustDomain: "Finance", executive: "Personal CFO" },
  Academic: { trustDomain: "Academic", executive: "CAO" },
  MicroSaaS: { trustDomain: "Ming Creatives", executive: "CTO" },
  "Content Creation": { trustDomain: "Ming Creatives", executive: "CMO" },
};

export type MasterTasksViewName =
  | "CEO All Work"
  | "COO Work View"
  | "Personal CFO Work View"
  | "CAO Work View"
  | "CTO Work View"
  | "CMO Work View";

interface WorkViewDefinition {
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

export interface PutMasterTaskRequest {
  readonly idempotencyKey: string;
  readonly workItemId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly intent: string;
  readonly workstream: Workstream;
  readonly source: string;
  readonly sourceReference: string;
  readonly collaboratingExecutives?: readonly ExecutiveRole[];
  readonly priority?: MasterTaskPriority | null;
  readonly commitmentValue?: string | null;
  readonly commitmentProvenance?: string | null;
  readonly riskClass?: RiskClass | null;
  readonly approvalRequired?: boolean;
  readonly approvalReference?: string | null;
  readonly portfolioProject?: string | null;
  readonly evidenceReferences?: readonly string[];
  readonly outcomeReportReference?: string | null;
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
  readonly workstream: Workstream;
  readonly accountableExecutive: ExecutiveRole;
  readonly collaboratingExecutives: readonly ExecutiveRole[];
  readonly lifecycle: WorkItemState;
  readonly priority: MasterTaskPriority | null;
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
  readonly priority: MasterTaskPriority;
}

export interface TransitionMasterTaskRequest {
  readonly workItemId: string;
  readonly idempotencyKey: string;
  readonly to: WorkItemState;
}

function requireNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
}

function cloneRecord(record: MasterTaskRecord): MasterTaskRecord {
  return {
    ...record,
    collaboratingExecutives: [...record.collaboratingExecutives],
    evidenceReferences: [...record.evidenceReferences],
  };
}

export class InMemoryMasterTasksWorkspace {
  readonly #records = new Map<string, MasterTaskRecord>();
  readonly #idempotentResults = new Map<string, MasterTaskRecord>();
  readonly #now: () => string;
  #provisioning: MasterTasksProvisioning | undefined;
  #effects = 0;
  #recordSequence = 0;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.#now = now;
  }

  provision(request: {
    readonly parentPageId: string;
    readonly idempotencyKey: string;
  }): MasterTasksProvisioning {
    requireNonEmpty("Parent page id", request.parentPageId);
    requireNonEmpty("Idempotency key", request.idempotencyKey);
    if (this.#provisioning !== undefined) {
      if (this.#provisioning.parentPageId !== request.parentPageId) {
        throw new Error("Master Tasks is already bound to another parent page.");
      }
      return this.#provisioning;
    }

    const dataSourceId = "notion-data-source:master-tasks";
    const views = masterTasksViewDefinitions.map((view, index) => ({
      id: `notion-view:${index + 1}`,
      name: view.name,
      dataSourceId,
      accountableExecutive: view.accountableExecutive,
      filter:
        view.accountableExecutive === null
          ? null
          : {
              property: "Accountable Executive",
              select: { equals: view.accountableExecutive },
            },
    }));
    this.#provisioning = {
      parentPageId: request.parentPageId,
      databaseId: "notion-database:master-tasks",
      dataSourceId,
      dataSourceName: "Master Tasks",
      schema: masterTasksSchema,
      views,
    };
    this.#effects += 1 + views.length;
    return this.#provisioning;
  }

  put(request: PutMasterTaskRequest): MasterTaskRecord {
    this.#requireProvisioned();
    requireNonEmpty("Idempotency key", request.idempotencyKey);
    requireNonEmpty("Work Item id", request.workItemId);
    requireNonEmpty("Workspace id", request.workspaceId);
    requireNonEmpty("Title", request.title);
    requireNonEmpty("Intent", request.intent);
    requireNonEmpty("Source", request.source);
    requireNonEmpty("Source reference", request.sourceReference);

    const replay = this.#idempotentResults.get(request.idempotencyKey);
    if (replay !== undefined) {
      return cloneRecord(replay);
    }
    if (this.#records.has(request.workItemId)) {
      throw new Error(`Work Item ${request.workItemId} already exists.`);
    }

    const route = workstreamRoutes[request.workstream];
    const now = this.#now();
    const record: MasterTaskRecord = {
      id: `notion-page:${++this.#recordSequence}`,
      workItemId: request.workItemId,
      workspaceId: request.workspaceId,
      title: request.title,
      intent: request.intent,
      source: request.source,
      sourceReference: request.sourceReference,
      trustDomain: route.trustDomain,
      workstream: request.workstream,
      accountableExecutive: route.executive,
      collaboratingExecutives: request.collaboratingExecutives ?? [],
      lifecycle: "Captured",
      priority: request.priority ?? null,
      commitmentValue: request.commitmentValue ?? null,
      commitmentProvenance: request.commitmentProvenance ?? null,
      riskClass: request.riskClass ?? null,
      approvalRequired: request.approvalRequired ?? false,
      approvalReference: request.approvalReference ?? null,
      portfolioProject: request.portfolioProject ?? null,
      evidenceReferences: request.evidenceReferences ?? [],
      outcomeReportReference: request.outcomeReportReference ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.#records.set(record.workItemId, record);
    this.#idempotentResults.set(request.idempotencyKey, cloneRecord(record));
    this.#effects += 1;
    return cloneRecord(record);
  }

  view(name: MasterTasksViewName): readonly MasterTaskRecord[] {
    const definition = masterTasksViewDefinitions.find((view) => view.name === name);
    if (definition === undefined) {
      throw new Error(`Unknown Work View: ${name}`);
    }
    return [...this.#records.values()]
      .filter(
        (record) =>
          definition.accountableExecutive === null ||
          record.accountableExecutive === definition.accountableExecutive,
      )
      .map(cloneRecord);
  }

  editThroughView(request: EditMasterTaskThroughViewRequest): MasterTaskRecord {
    const replay = this.#idempotentResults.get(request.idempotencyKey);
    if (replay !== undefined) {
      return cloneRecord(replay);
    }
    const record = this.#recordVisibleInView(request.viewName, request.workItemId);
    const updated = { ...record, priority: request.priority, updatedAt: this.#now() };
    this.#records.set(updated.workItemId, updated);
    this.#idempotentResults.set(request.idempotencyKey, cloneRecord(updated));
    this.#effects += 1;
    return cloneRecord(updated);
  }

  transition(request: TransitionMasterTaskRequest): MasterTaskRecord {
    const replay = this.#idempotentResults.get(request.idempotencyKey);
    if (replay !== undefined) {
      return cloneRecord(replay);
    }
    const record = this.#records.get(request.workItemId);
    if (record === undefined) {
      throw new Error(`Unknown Work Item: ${request.workItemId}`);
    }
    if (lifecycleEventFor(record.lifecycle, request.to) === undefined) {
      throw new Error(
        `Rejected Master Tasks lifecycle transition ${record.lifecycle} -> ${request.to}.`,
      );
    }
    const updated = { ...record, lifecycle: request.to, updatedAt: this.#now() };
    this.#records.set(updated.workItemId, updated);
    this.#idempotentResults.set(request.idempotencyKey, cloneRecord(updated));
    this.#effects += 1;
    return cloneRecord(updated);
  }

  externalEffectCount(): number {
    return this.#effects;
  }

  #recordVisibleInView(
    viewName: MasterTasksViewName,
    workItemId: string,
  ): MasterTaskRecord {
    const record = this.view(viewName).find((item) => item.workItemId === workItemId);
    if (record === undefined) {
      throw new Error(`Work Item ${workItemId} is not visible in ${viewName}.`);
    }
    return record;
  }

  #requireProvisioned(): void {
    if (this.#provisioning === undefined) {
      throw new Error("Master Tasks has not been provisioned.");
    }
  }
}

