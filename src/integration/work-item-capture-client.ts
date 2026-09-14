import type { WorkItemCaptureClient } from "./real-ming-tools.js";

interface WorkItemCaptureResponse {
  readonly workItem?: unknown;
  readonly deduplicated?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
}

/**
 * Send the one governed Work Item write back to the loopback control plane.
 * The MCP child never opens the Notion credential or writes its ledger.
 */
export function createBridgedWorkItemCaptureClient(options: {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}): WorkItemCaptureClient {
  const request = options.fetch ?? fetch;
  return {
    async capture(input) {
      const response = await request(options.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as WorkItemCaptureResponse;
      if (!response.ok || body.workItem === undefined) {
        throw new Error(
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : "The control plane rejected Work Item capture.",
        );
      }
      return {
        workItem: body.workItem as Awaited<ReturnType<WorkItemCaptureClient["capture"]>>["workItem"],
        deduplicated: body.deduplicated === true,
      };
    },
  };
}
