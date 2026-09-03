import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { CandidateEnvelope } from "../../src/evidence/evidence-broker.js";

const now = "2026-09-03T10:00:00.000Z";

describe("RM-43 role-scoped Compiled Knowledge through Hermes", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function candidate(
    overrides: Partial<CandidateEnvelope> = {},
  ): CandidateEnvelope {
    return {
      id: "candidate:duitsini-engineering",
      sourceSystem: "agent-brain",
      sourceIdentity: "agent-brain:ming-creatives",
      sourceReference: "wiki/engineering/duitsini.md",
      canonicalEvidenceId: "agent-brain:ming-creatives:evidence:11",
      capturedAt: "2026-09-03T09:30:00.000Z",
      asOf: "2026-09-03T09:00:00.000Z",
      contentHash: "sha256:duitsini-engineering-v1",
      trustDomain: "Ming Creatives",
      sensitivity: "internal",
      allowedRoles: ["CTO"],
      retentionClass: "project-evidence-30d",
      mode: "snapshot",
      content: "DuitSini deploys from main with preview verification.",
      citations: ["agent-brain://ming-creatives/evidence/11"],
      freshness: "current",
      ...overrides,
    };
  }

  function start(): RealMingSystemHarness {
    const harness = startEmpty();
    harness.compileKnowledgeCandidate(candidate());
    harness.compileKnowledgeCandidate(
      candidate({
        id: "candidate:duitsini-content",
        sourceReference: "wiki/content/duitsini.md",
        canonicalEvidenceId: "agent-brain:ming-creatives:evidence:12",
        contentHash: "sha256:duitsini-content-v1",
        allowedRoles: ["CMO"],
        content: "DuitSini launch posts run on Tuesdays.",
        citations: ["agent-brain://ming-creatives/evidence/12"],
      }),
    );
    return harness;
  }

  function startEmpty(): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm43-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      knowledgeVault: { encryptionKey: "rm43-hermes-key-not-a-real-secret" },
    });
    harnesses.push(harness);
    return harness;
  }

  async function workItemFor(
    harness: RealMingSystemHarness,
    workstream: "MicroSaaS" | "Content Creation" | "Finance",
    key: string,
  ): Promise<string> {
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: key,
      text: "Prepare the DuitSini update",
      workstream,
      expectedEffect: { kind: "record-note", value: "Prepare" },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("expected acknowledgement");
    }
    return acknowledgement.workItem.id;
  }

  async function collaboratingWorkItemFor(
    harness: RealMingSystemHarness,
    key: string,
  ): Promise<string> {
    const acknowledgement = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: key,
      text: "Review finance context with engineering",
      workstream: "Finance",
      collaboratingExecutives: [
        { executive: "CTO", contribution: "review integration impact" },
      ],
      expectedEffect: { kind: "record-note", value: "Review" },
    });
    if (acknowledgement.kind !== "work-item-acknowledgement") {
      throw new Error("expected acknowledgement");
    }
    return acknowledgement.workItem.id;
  }

  it("refuses a query that does not identify its full scope", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:scope");

    const refused = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "   ",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(refused).toMatchObject({ kind: "denied", reason: "incomplete-scope" });

    const missingWorkItem = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId: "   ",
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });
    expect(missingWorkItem).toMatchObject({
      kind: "denied",
      reason: "incomplete-scope",
    });

    const secretPurpose = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "use token sk-live-abcdefghijklmnopqrstuv for context",
      allowedTrustDomains: ["Ming Creatives"],
    });
    expect(secretPurpose).toMatchObject({
      kind: "denied",
      reason: "incomplete-scope",
    });
  });

  it("denies a compiled page whose Candidate Envelope excludes the requesting role", async () => {
    const harness = startEmpty();
    harness.compileKnowledgeCandidate(
      candidate({
        allowedRoles: ["CMO"],
      }),
    );
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:role-boundary");

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("bounds the context Hermes receives while retaining provenance", async () => {
    const harness = startEmpty();
    harness.compileKnowledgeCandidate(
      candidate({
        content: "D".repeat(5_000),
      }),
    );
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:bounded");

    const served = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(served.kind).toBe("served");
    if (served.kind !== "served") return;
    expect(served.brief.text.length).toBeLessThanOrEqual(2_000);
    expect(served.brief.text.endsWith("…")).toBe(true);
    expect(served.brief.citations).toContain(
      "agent-brain://ming-creatives/evidence/11",
    );
  });

  it("serves the published page after the compiler and vault are reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm43-restart-"));
    directories.push(directory);
    const vaultStatePath = join(directory, "knowledge.sqlite");
    const first = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => now,
      knowledgeVault: {
        encryptionKey: "rm43-restart-key-not-a-real-secret",
        statePath: vaultStatePath,
      },
    });
    harnesses.push(first);
    first.compileKnowledgeCandidate(candidate());
    const workItemId = await workItemFor(first, "MicroSaaS", "rm43:restart");
    first.close();
    harnesses.splice(harnesses.indexOf(first), 1);

    const reopened = createRealMingSystemHarness({
      statePath: join(directory, "operations.sqlite"),
      now: () => now,
      knowledgeVault: {
        encryptionKey: "rm43-restart-key-not-a-real-secret",
        statePath: vaultStatePath,
      },
    });
    harnesses.push(reopened);

    const served = reopened.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context after restart",
      allowedTrustDomains: ["Ming Creatives"],
    });
    expect(served.kind).toBe("served");
    if (served.kind !== "served") return;
    expect(served.brief.sourceIdentity).toBe("agent-brain:ming-creatives");
    expect(served.brief.citations).toContain(
      "agent-brain://ming-creatives/evidence/11",
    );
    expect(served.brief.generation).toBe(1);
  });

  it("serves cited Compiled Knowledge with its generation and freshness", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:cto");

    const served = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context for the DuitSini update",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(served.kind).toBe("served");
    if (served.kind !== "served") return;
    expect(served.brief).toMatchObject({
      sourceIdentity: "agent-brain:ming-creatives",
      contentHash: "sha256:duitsini-engineering-v1",
      asOf: "2026-09-03T09:00:00.000Z",
      freshness: "current",
      contested: false,
    });
    expect(served.brief.generation).toBe(2);
    expect(served.brief.citations).toContain(
      "agent-brain://ming-creatives/evidence/11",
    );
  });

  it("preserves stale freshness at the Hermes serving boundary", async () => {
    const harness = startEmpty();
    harness.compileKnowledgeCandidate(
      candidate({
        freshness: "stale",
        contentHash: "sha256:duitsini-engineering-stale",
      }),
    );
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:stale");

    const served = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(served.kind).toBe("served");
    if (served.kind !== "served") return;
    expect(served.brief.freshness).toBe("stale");
    expect(served.brief.text).toContain("STALE");
  });

  it("reports a page as contested once a contradiction is quarantined", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:contested");

    const before = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });
    expect(before.kind).toBe("served");
    if (before.kind !== "served") return;
    expect(before.brief.contested).toBe(false);

    const quarantined = harness.compileKnowledgeCandidate(
      candidate({
        id: "candidate:duitsini-engineering-v2",
        contentHash: "sha256:duitsini-engineering-v2",
        canonicalEvidenceId: "agent-brain:ming-creatives:evidence:13",
        content: "DuitSini deploys from a release branch after manual sign-off.",
        citations: ["agent-brain://ming-creatives/evidence/13"],
      }),
    );
    expect(quarantined.kind).toBe("quarantined");

    // The page still serves -- the disagreement is disclosed, not resolved by
    // hiding one side of it.
    const after = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });
    expect(after.kind).toBe("served");
    if (after.kind !== "served") return;
    expect(after.brief.contested).toBe(true);
    expect(after.brief.generation).toBe(3);
    expect(after.brief.text).toContain("deploys from main");
  });

  it("gives the CTO and the CMO different task-scoped projections", async () => {
    const harness = start();
    const ctoItem = await workItemFor(harness, "MicroSaaS", "rm43:cto2");
    const cmoItem = await workItemFor(harness, "Content Creation", "rm43:cmo");

    const cto = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId: ctoItem,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });
    const cmo = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CMO",
      workItemId: cmoItem,
      purpose: "content context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(cto.kind).toBe("served");
    expect(cmo.kind).toBe("served");
    if (cto.kind !== "served" || cmo.kind !== "served") return;
    expect(cto.brief.generation).toBe(2);
    expect(cmo.brief.generation).toBe(2);
    // Same Trust Domain, different sections. The CTO does not read the content
    // plan and the CMO does not read the deployment notes.
    expect(cto.brief.text).toContain("deploys from main");
    expect(cto.brief.text).not.toContain("launch posts");
    expect(cmo.brief.text).toContain("launch posts");
    expect(cmo.brief.text).not.toContain("deploys from main");
  });

  it("denies an unrelated role without leaking that anything exists", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "Finance", "rm43:cfo");

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "Personal CFO",
      workItemId,
      purpose: "unrelated review",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
    // No path, no page name, no count: a denial that says what exists is a leak.
    expect(JSON.stringify(denied)).not.toContain("duitsini");
    expect(JSON.stringify(denied)).not.toContain("wiki/");
  });

  it("denies a query naming a Work Item that does not exist", async () => {
    const harness = start();

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId: "work-item:never-created",
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    // Same denial as an unauthorized one. "No such Work Item" is itself a fact
    // about the workspace that a caller has not earned.
    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("denies a query naming a workspace the Work Item does not belong to", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:workspace");

    // Right role, right Trust Domain, right Work Item id -- wrong workspace.
    // A query carried over from another workspace must not read this one.
    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:other",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("denies a role whose current Work Item is not its own", async () => {
    const harness = start();
    // The CMO owns this Work Item. The CTO's role view does permit the
    // Ming Creatives root, so nothing but Work Item scope stands between the
    // CTO and a page it has no current reason to read.
    const cmoItem = await workItemFor(harness, "Content Creation", "rm43:scope2");

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId: cmoItem,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("denies a cross-domain query the Work Item does not allow", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:cross");

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Finance"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("denies a scope that mixes the role's domain with an unrelated domain", async () => {
    const harness = start();
    const workItemId = await workItemFor(
      harness,
      "MicroSaaS",
      "rm43:mixed-domains",
    );

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives", "Finance"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("does not turn cross-domain collaboration into raw Trust Domain access", async () => {
    const harness = start();
    const workItemId = await collaboratingWorkItemFor(
      harness,
      "rm43:collaboration-domain",
    );

    const denied = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(denied).toEqual({ kind: "denied", reason: "not-authorized" });
  });

  it("gives the CEO root only approved projections, never raw notes", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:ceo");

    const ceo = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "COO",
      workItemId,
      purpose: "CEO roll-up",
      allowedTrustDomains: ["CEO"],
    });

    expect(ceo.kind).toBe("denied");
    if (ceo.kind !== "denied") return;
    expect(ceo.reason).toBe("ceo-root-is-projection-only");
  });

  it("hands Hermes a bounded pointer and copies nothing into hot memory", async () => {
    const harness = start();
    const workItemId = await workItemFor(harness, "MicroSaaS", "rm43:hermes");

    const served = harness.serveCompiledKnowledge({
      workspaceId: "workspace:real-ming",
      executive: "CTO",
      workItemId,
      purpose: "engineering context",
      allowedTrustDomains: ["Ming Creatives"],
    });

    expect(served.kind).toBe("served");
    if (served.kind !== "served") return;
    expect(served.brief.vaultPointer).toBe(
      "Ming Creatives:wiki/engineering/duitsini.md",
    );
    // The corpus stays in the vault. Neither the dashboard nor the audit trail
    // may carry the compiled text.
    const dashboard = JSON.stringify(
      harness.dashboardOverview({
        actorId: "ceo:ming",
        workspaceId: "workspace:real-ming",
      }),
    );
    expect(dashboard).not.toContain("deploys from main");
    expect(JSON.stringify(harness.auditTrail(workItemId))).not.toContain(
      "deploys from main",
    );
  });
});
