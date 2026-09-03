import type {
  ExecutiveRole,
  TrustDomain,
  Workstream,
} from "./contracts.js";

export const workstreamRoutes: Readonly<
  Record<Workstream, { readonly executive: ExecutiveRole; readonly trustDomain: TrustDomain }>
> = {
  "Personal Life": { executive: "COO", trustDomain: "Personal" },
  "Career Job": { executive: "COO", trustDomain: "Personal" },
  Finance: { executive: "Personal CFO", trustDomain: "Finance" },
  Academic: { executive: "CAO", trustDomain: "Academic" },
  MicroSaaS: { executive: "CTO", trustDomain: "Ming Creatives" },
  "Content Creation": { executive: "CMO", trustDomain: "Ming Creatives" },
};

const trustDomainByExecutive: Readonly<Record<ExecutiveRole, TrustDomain>> = {
  COO: "Personal",
  CTO: "Ming Creatives",
  "Personal CFO": "Finance",
  CAO: "Academic",
  CMO: "Ming Creatives",
};

export interface ExecutiveRoleRoute {
  readonly explicitExecutive: ExecutiveRole | undefined;
  readonly workstream: Workstream | null | undefined;
}

export function routeAccountableExecutive(
  route: ExecutiveRoleRoute,
): ExecutiveRole {
  if (route.explicitExecutive !== undefined) {
    return route.explicitExecutive;
  }

  if (route.workstream !== undefined && route.workstream !== null) {
    return workstreamRoutes[route.workstream].executive;
  }

  return "COO";
}

export function routeTrustDomain(
  workstream: Workstream | null,
  accountableExecutive: ExecutiveRole,
): TrustDomain {
  return workstream === null
    ? trustDomainByExecutive[accountableExecutive]
    : workstreamRoutes[workstream].trustDomain;
}
