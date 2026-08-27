import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createKnowledgeVault,
  roleVaultViews,
  validateHotRuntimeMemory,
  vaultRootEntries,
  vaultRoots,
  type KnowledgeVault,
} from "../../src/knowledge/knowledge-vault.js";

const vaultKey = "knowledge-vault-key-must-never-be-reported";

describe("RM-41 Trust-Domain Knowledge Vault contract", () => {
  const vaults: KnowledgeVault[] = [];
  const directories: string[] = [];

  function startVault(statePath = ":memory:"): KnowledgeVault {
    const vault = createKnowledgeVault({
      statePath,
      encryptionKey: vaultKey,
      now: () => "2026-08-27T09:00:00.000Z",
    });
    vaults.push(vault);
    return vault;
  }

  function fileBackedVault(): { vault: KnowledgeVault; statePath: string } {
    const statePath = join(temporaryDirectory(), "knowledge-vault.sqlite");
    return { vault: startVault(statePath), statePath };
  }

  function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-vault-"));
    directories.push(directory);
    return directory;
  }

  afterEach(() => {
    for (const vault of vaults.splice(0)) {
      vault.close();
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("names one root per Trust Domain plus a CEO Approved-Projection root", () => {
    expect(vaultRoots).toEqual([
      "Personal",
      "Ming Creatives",
      "Academic",
      "Entertainment",
      "Finance",
      "CEO",
    ]);
  });

  it("gives every domain root the LLM Wiki entry set with an append-only log", () => {
    for (const root of vaultRoots) {
      expect(vaultRootEntries(root)).toEqual([
        "SCHEMA.md",
        "AGENTS.md",
        "CLAUDE.md",
        "index.md",
        "log.md",
        "raw/",
        "wiki/",
        "daily/",
        "outputs/",
        "quarantine/",
      ]);
    }
  });

  it("scopes storage by Trust Domain rather than by Executive Role", () => {
    const views = roleVaultViews();

    expect(views.map((view) => view.executive)).toEqual([
      "COO",
      "CTO",
      "Personal CFO",
      "CAO",
      "CMO",
    ]);
    expect(
      views.find((view) => view.executive === "Personal CFO")?.roots,
    ).toEqual(["Finance"]);
    expect(views.find((view) => view.executive === "CAO")?.roots).toEqual([
      "Academic",
    ]);
    expect(
      views.every((view) => !view.roots.includes("Entertainment")),
    ).toBe(true);
  });

  it("gives the CTO and the CMO distinct views over Ming Creatives", () => {
    const views = roleVaultViews();
    const cto = views.find((view) => view.executive === "CTO");
    const cmo = views.find((view) => view.executive === "CMO");

    expect(cto?.roots).toEqual(["Ming Creatives"]);
    expect(cmo?.roots).toEqual(["Ming Creatives"]);
    expect(cto?.sections).not.toEqual(cmo?.sections);
    expect(
      cto?.sections.some((section) => cmo?.sections.includes(section)),
    ).toBe(false);
  });

  it("publishes an immutable generation identity atomically", () => {
    const vault = startVault();

    const first = vault.publishGeneration({
      root: "Ming Creatives",
      actorId: "ceo:ming",
      files: {
        "index.md": "# Ming Creatives\n",
        "wiki/engineering/duitsini.md": "# DuitSini\n\nCited page.\n",
      },
    });

    expect(first).toMatchObject({
      root: "Ming Creatives",
      sequence: 1,
      state: "verified",
      publishedAt: "2026-08-27T09:00:00.000Z",
    });
    expect(first.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(vault.currentGeneration("Ming Creatives")).toEqual(first);
  });

  it("preserves the prior generation until its successor is verified", () => {
    const vault = startVault();
    const first = vault.publishGeneration({
      root: "Academic",
      actorId: "ceo:ming",
      files: { "index.md": "# Academic\n" },
    });

    expect(() =>
      vault.publishGeneration({
        root: "Academic",
        actorId: "ceo:ming",
        files: { "index.md": "# Academic\n" },
        verify: () => false,
      }),
    ).toThrow("The successor generation could not be verified.");

    expect(vault.currentGeneration("Academic")).toEqual(first);
    expect(vault.generations("Academic")).toEqual([first]);
    expect(vault.readForCeo("Academic", "index.md", "ceo:ming")).toBe(
      "# Academic\n",
    );

    const second = vault.publishGeneration({
      root: "Academic",
      actorId: "ceo:ming",
      files: { "index.md": "# Academic\n\nSecond generation.\n" },
    });

    expect(second.sequence).toBe(2);
    expect(vault.currentGeneration("Academic")).toEqual(second);
    expect(vault.generations("Academic").map((entry) => entry.state)).toEqual([
      "superseded",
      "verified",
    ]);
  });

  it("keeps an append-only log the database itself refuses to rewrite", () => {
    const { vault, statePath } = fileBackedVault();
    vault.publishGeneration({
      root: "Personal",
      actorId: "ceo:ming",
      files: { "index.md": "# Personal\n" },
    });
    vault.publishGeneration({
      root: "Personal",
      actorId: "ceo:ming",
      files: { "index.md": "# Personal\n\nSecond.\n" },
    });

    expect(vault.log("Personal").map((entry) => entry.sequence)).toEqual([
      1, 2,
    ]);

    const inspector = new DatabaseSync(statePath);
    try {
      expect(() =>
        inspector.exec("UPDATE vault_log SET actor_id = 'tampered';"),
      ).toThrow("vault_log entries are append-only");
      expect(() => inspector.exec("DELETE FROM vault_log;")).toThrow(
        "vault_log entries are append-only",
      );
      expect(() =>
        inspector.exec("UPDATE vault_files SET ciphertext = 'tampered';"),
      ).toThrow("vault_files are immutable within a generation");
    } finally {
      inspector.close();
    }
  });

  it("stores content encrypted at rest and never records the encryption key", () => {
    const { vault, statePath } = fileBackedVault();
    const secretPage = "Ming private academic timetable detail";
    vault.publishGeneration({
      root: "Academic",
      actorId: "ceo:ming",
      files: { "wiki/timetable.md": secretPage },
    });

    const onDisk = readFileSync(statePath).toString("binary");
    expect(onDisk).not.toContain(secretPage);
    expect(onDisk).not.toContain(vaultKey);
    expect(onDisk).toContain("wiki/timetable.md");

    expect(vault.readForCeo("Academic", "wiki/timetable.md", "ceo:ming")).toBe(
      secretPage,
    );
    expect(JSON.stringify(vault.generations("Academic"))).not.toContain(
      vaultKey,
    );
  });

  it("lets Obsidian open decrypted Markdown only for the CEO", () => {
    const vault = startVault();
    vault.publishGeneration({
      root: "Personal",
      actorId: "ceo:ming",
      files: {
        "index.md": "# Personal\n",
        "wiki/routines.md": "# Routines\n",
      },
    });

    const directory = temporaryDirectory();
    vault.materializeForCeo("Personal", directory, "ceo:ming");

    expect(readdirSync(directory).sort()).toEqual(["index.md", "wiki"]);
    expect(readFileSync(join(directory, "index.md"), "utf8")).toBe(
      "# Personal\n",
    );
    expect(
      readFileSync(join(directory, "wiki", "routines.md"), "utf8"),
    ).toBe("# Routines\n");

    const denied = temporaryDirectory();
    expect(() =>
      vault.materializeForCeo("Personal", denied, "executive:COO"),
    ).toThrow("Only the CEO may open the Knowledge Vault directly.");
    expect(readdirSync(denied)).toEqual([]);
  });

  it("gives a role worker brokered access instead of universal filesystem access", () => {
    const vault = startVault();
    vault.publishGeneration({
      root: "Ming Creatives",
      actorId: "ceo:ming",
      files: {
        "wiki/engineering/duitsini.md": "# DuitSini engineering\n",
        "wiki/content/launch.md": "# Launch content\n",
      },
    });
    vault.publishGeneration({
      root: "Finance",
      actorId: "ceo:ming",
      files: { "wiki/holdings.md": "# Holdings\n" },
    });

    expect(
      vault.readForRole({
        executive: "CTO",
        root: "Ming Creatives",
        path: "wiki/engineering/duitsini.md",
        purpose: "work-item:duitsini-update",
      }),
    ).toBe("# DuitSini engineering\n");

    expect(() =>
      vault.readForRole({
        executive: "CTO",
        root: "Ming Creatives",
        path: "wiki/content/launch.md",
        purpose: "work-item:duitsini-update",
      }),
    ).toThrow("The CTO may not read wiki/content/launch.md in Ming Creatives.");

    expect(() =>
      vault.readForRole({
        executive: "CTO",
        root: "Finance",
        path: "wiki/holdings.md",
        purpose: "work-item:duitsini-update",
      }),
    ).toThrow("The CTO has no view over the Finance root.");
  });

  it("keeps Entertainment isolated from every Executive Role", () => {
    const vault = startVault();
    vault.publishGeneration({
      root: "Entertainment",
      actorId: "ceo:ming",
      files: { "wiki/watchlist.md": "# Watchlist\n" },
    });

    for (const executive of ["COO", "CTO", "Personal CFO", "CAO", "CMO"] as const) {
      expect(() =>
        vault.readForRole({
          executive,
          root: "Entertainment",
          path: "wiki/watchlist.md",
          purpose: "work-item:any",
        }),
      ).toThrow(`The ${executive} has no view over the Entertainment root.`);
    }

    expect(vault.readForCeo("Entertainment", "wiki/watchlist.md", "ceo:ming")).toBe(
      "# Watchlist\n",
    );
  });

  it("accepts only Approved Projections in the CEO root", () => {
    const vault = startVault();

    expect(() =>
      vault.publishGeneration({
        root: "CEO",
        actorId: "ceo:ming",
        files: { "raw/notes.md": "Raw personal notes.\n" },
      }),
    ).toThrow("The CEO root accepts only Approved Projections.");

    const generation = vault.publishGeneration({
      root: "CEO",
      actorId: "ceo:ming",
      files: {
        "wiki/projection-portfolio.md":
          "# Portfolio projection\n\nApproved Projection.\n",
      },
    });
    expect(generation.sequence).toBe(1);
  });
});

describe("RM-41 Hot Runtime Memory bounds", () => {
  it("accepts a bounded routing preference or vault pointer under Approval", () => {
    for (const kind of [
      "routing-preference",
      "stable-preference",
      "vault-pointer",
    ] as const) {
      expect(
        validateHotRuntimeMemory({
          file: "MEMORY.md",
          kind,
          text: "Route unqualified requests to the COO.",
        }),
      ).toEqual({ accepted: true, requiresApproval: true });
    }
  });

  it.each(["MEMORY.md", "USER.md"] as const)(
    "rejects an unbounded %s entry",
    (file) => {
      expect(
        validateHotRuntimeMemory({
          file,
          kind: "stable-preference",
          text: "x".repeat(2_001),
        }),
      ).toMatchObject({ accepted: false, reason: "entry-exceeds-bounds" });
    },
  );

  it.each([
    [
      "an email body",
      "From: someone@example.com\nTo: ming@example.com\nSubject: Invoice\n\nPlease pay.",
      "email-body",
    ],
    [
      "a raw conversation",
      "User: what is my schedule\nAssistant: here is your schedule",
      "raw-conversation",
    ],
    [
      "financial data",
      "Maybank balance RM 12,345.67 as of today",
      "financial-data",
    ],
    [
      "an academic file",
      "See Canvas submission assignment-3.pdf for the marking rubric",
      "academic-file",
    ],
    [
      "Project Evidence",
      "Agent Brain evidence duitsini/session-42 says the migration ran",
      "project-evidence",
    ],
    [
      "a domain corpus pointer",
      "Full contents of Personal/raw/notion-export.md follow below",
      "domain-corpus",
    ],
  ])("rejects %s", (_label, text, reason) => {
    expect(
      validateHotRuntimeMemory({
        file: "MEMORY.md",
        kind: "stable-preference",
        text,
      }),
    ).toMatchObject({ accepted: false, reason });
  });

  it("rejects an entry kind that is not an approved Hot Runtime Memory shape", () => {
    expect(
      validateHotRuntimeMemory({
        file: "USER.md",
        kind: "domain-corpus" as never,
        text: "Anything at all",
      }),
    ).toMatchObject({ accepted: false, reason: "unsupported-entry-kind" });
  });
});
