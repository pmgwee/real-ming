export type ControlPlaneSmokeResult =
  | { readonly kind: "passed" }
  | {
      readonly kind: "failed";
      readonly reason:
        | "authentication-failed"
        | "dashboard-unavailable"
        | "invalid-response";
    };

/**
 * Probe the authenticated production dashboard without returning response
 * bodies, credentials, or provider errors to the caller.
 */
export async function verifyControlPlaneDashboard(options: {
  readonly origin: string;
  readonly dashboardToken: string;
  readonly fetch?: typeof fetch;
}): Promise<ControlPlaneSmokeResult> {
  const request = options.fetch ?? fetch;
  try {
    const response = await request(`${options.origin}/api/overview`, {
      headers: { Authorization: `Bearer ${options.dashboardToken}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { kind: "failed", reason: "authentication-failed" };
    }
    if (!response.ok) {
      return { kind: "failed", reason: "dashboard-unavailable" };
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("workItems" in body) ||
      !Array.isArray(body.workItems) ||
      !("auditEvents" in body) ||
      !Array.isArray(body.auditEvents) ||
      !("controlPlane" in body) ||
      !Array.isArray(body.controlPlane)
    ) {
      return { kind: "failed", reason: "invalid-response" };
    }
    return { kind: "passed" };
  } catch {
    return { kind: "failed", reason: "dashboard-unavailable" };
  }
}
