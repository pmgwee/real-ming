import type {
  ExecutiveRole,
  Workstream,
} from "./contracts.js";

const accountableExecutiveByWorkstream: Readonly<
  Record<Workstream, ExecutiveRole>
> = {
  "Personal Life": "COO",
  "Career Job": "COO",
  Finance: "Personal CFO",
  Academic: "CAO",
  MicroSaaS: "CTO",
  "Content Creation": "CMO",
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
    return accountableExecutiveByWorkstream[route.workstream];
  }

  return "COO";
}
