import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createRealMingMcpComposition } from "../../src/config/real-ming-mcp-cli.js";
import { sha256ContentHash } from "../../src/knowledge/native-consolidation/evidence.js";

describe("native knowledge production source routing", () => {
  it("wires the configured source route through the actual MCP composition", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-source-route-"));
    const source = "source bytes from the configured route\n";
    const routePath = join(directory, "sources.json");
    writeFileSync(routePath, JSON.stringify({
      sourceIdentity: "project:route",
      sourceReference: "route:source",
      sourceVersion: "v1",
      content: source,
      contentHash: sha256ContentHash(source),
      asOf: "2026-09-09T00:00:00.000Z",
      retrievedAt: "2026-09-09T02:00:00.000Z",
    }), "utf8");
    const previous = process.env.REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE;
    process.env.REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE = routePath;
    const composition = createRealMingMcpComposition({
      statePath: join(directory, "operations.sqlite"),
      knowledgeStatePath: join(directory, "knowledge.sqlite"),
      knowledgeGeneratedRoot: join(directory, "generated"),
      knowledgeStagingRoot: join(directory, "staging"),
      knowledgeIsolationEligible: () => true,
    });
    try {
      expect(composition.tools.list().map((tool) => tool.name)).toContain("real_ming_read_knowledge_source");
      const result = await composition.tools.callAsync?.("real_ming_read_knowledge_source", {
        sourceIdentity: "project:route",
        sourceReference: "route:source",
        sourceVersion: "v1",
      });
      expect(result).toMatchObject({ kind: "ok", value: { sourceIdentity: "project:route", content: source } });
    } finally {
      composition.close();
      if (previous === undefined) delete process.env.REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE;
      else process.env.REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the configured route is missing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-source-route-missing-"));
    try {
      const reader = (await import("../../src/config/real-ming-mcp-cli.js")).createFileKnowledgeSourceReader(
        join(directory, "missing.json"),
      );
      await expect(reader({ sourceIdentity: "project:none", sourceReference: "none" }))
        .resolves.toMatchObject({ kind: "unavailable" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
