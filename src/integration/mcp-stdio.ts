import type { RealMingTools } from "./real-ming-tools.js";

/**
 * A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0.
 *
 * Written by hand rather than pulled from a package because this repository has
 * zero runtime dependencies and the protocol surface Hermes actually uses is
 * three methods. A dependency here would be a supply-chain and audit obligation
 * out of all proportion to ~100 lines of message plumbing.
 *
 * The transport holds no domain logic. Everything it can answer comes from the
 * tool registry, which is what the System Harness exercises.
 */

const defaultProtocolVersion = "2024-11-05";

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export interface McpResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/**
 * Handle one decoded request. Returns undefined for notifications, which by
 * JSON-RPC must not be answered — replying to one desynchronises the client.
 */
export function handleMcpRequest(
  request: JsonRpcRequest,
  tools: RealMingTools,
  serverName = "real-ming",
): McpResponse | undefined {
  const id = request.id ?? null;
  const method = request.method ?? "";

  if (method.startsWith("notifications/")) return undefined;

  switch (method) {
    case "initialize": {
      const requested = request.params?.["protocolVersion"];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            typeof requested === "string" && requested.length > 0
              ? requested
              : defaultProtocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version: "1.0.0" },
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: tools.list() } };
    case "tools/call": {
      const name = request.params?.["name"];
      const rawArguments = request.params?.["arguments"];
      if (typeof name !== "string") {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "tools/call requires a tool name." },
        };
      }
      const args =
        typeof rawArguments === "object" && rawArguments !== null
          ? (rawArguments as Record<string, unknown>)
          : {};
      const result = tools.call(name, args);
      // A tool failure is a result, not a protocol error: the agent needs to
      // read the reason and decide, not see the connection fault.
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                result.kind === "ok"
                  ? JSON.stringify(result.value, null, 2)
                  : result.reason,
            },
          ],
          isError: result.kind === "failed",
        },
      };
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method ${method}.` },
      };
  }
}

/** Split a growing buffer into complete lines, returning the unfinished tail. */
export function splitFramedLines(buffer: string): {
  readonly lines: readonly string[];
  readonly rest: string;
} {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter((line) => line.length > 0), rest };
}

export function serveMcpOverStdio(options: {
  readonly tools: RealMingTools;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly serverName?: string;
}): void {
  let buffer = "";
  options.input.setEncoding?.("utf8");
  options.input.on("data", (chunk: string) => {
    buffer += chunk;
    const { lines, rest } = splitFramedLines(buffer);
    buffer = rest;
    for (const line of lines) {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        options.output.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error." },
          })}\n`,
        );
        continue;
      }
      const response = handleMcpRequest(request, options.tools, options.serverName);
      if (response !== undefined) {
        options.output.write(`${JSON.stringify(response)}\n`);
      }
    }
  });
}
