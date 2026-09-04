import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createObsidianMaterializer } from "../../src/knowledge/obsidian-materializer.js";
import { createKnowledgeVault } from "../../src/knowledge/knowledge-vault.js";

describe("Obsidian materialization boundary", () => {
  it("atomically exports the CEO Approved-Projection root with a generation manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-obsidian-"));
    const vaultPath = join(directory, "vault.sqlite");
    const target = join(directory, "vault-view");
    const vault = createKnowledgeVault({ statePath: vaultPath, encryptionKey: "controlled-knowledge-vault-key" });
    try {
      vault.publishGeneration({
        root: "CEO",
        actorId: "ceo:ming",
        files: {
          "index.md": "# Approved CEO view\n",
          "wiki/brief.md": "Approved projection with citations.\n",
        },
      });
      const materializer = createObsidianMaterializer({ vault });
      const result = materializer.materialize({
        directory: target,
        actorId: "ceo:ming",
        generatedAt: "2026-09-04T10:00:00.000Z",
      });

      expect(result.roots).toEqual([expect.objectContaining({ root: "CEO", generationSequence: 1, fileCount: 2 })]);
      expect(readFileSync(join(target, "CEO", "index.md"), "utf8")).toBe("# Approved CEO view\n");
      expect(JSON.parse(readFileSync(result.manifestPath, "utf8"))).toMatchObject({
        schema: "real-ming.obsidian.materialization.v1",
        generatedAt: "2026-09-04T10:00:00.000Z",
      });
    } finally {
      vault.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects non-CEO actors and filesystem-root targets before writing", () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-obsidian-safe-"));
    const vault = createKnowledgeVault({ statePath: join(directory, "vault.sqlite"), encryptionKey: "controlled-knowledge-vault-key" });
    try {
      const materializer = createObsidianMaterializer({ vault });
      expect(() => materializer.materialize({ directory: join(directory, "view"), actorId: "worker:lenovo" })).toThrow("Only the CEO");
      expect(() => materializer.materialize({ directory: "/", actorId: "ceo:ming" })).toThrow("filesystem root");
    } finally {
      vault.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
