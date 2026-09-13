import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createRoleScopedKnowledgeHarness } from "../../src/testing/real-ming-system-harness.js";

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "real-ming-role-knowledge-"));
  const harness = createRoleScopedKnowledgeHarness({
    directory,
    now: "2026-09-14T02:00:00.000Z",
  });
  return {
    directory,
    harness,
    close() {
      harness.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe("role-scoped native knowledge", () => {
  it("preserves one Trust Domain from admission through the v2 manifest and citation", async () => {
    const fixture = workspace();
    try {
      const published = await fixture.harness.publish({
        candidates: [
          {
            candidateId: "personal-decision",
            trustDomain: "Personal",
            content: "Ming chose a weekly personal planning review.",
          },
          {
            candidateId: "creative-architecture",
            trustDomain: "Ming Creatives",
            content: "The product uses the native Hermes runtime.",
          },
          {
            candidateId: "academic-plan",
            trustDomain: "Academic",
            content: "The study plan prioritizes the evidence module.",
          },
          {
            candidateId: "finance-policy",
            trustDomain: "Finance",
            content: "Financial changes require a dated successor snapshot.",
          },
        ],
      });
      expect(published.kind).toBe("succeeded");

      const manifest = fixture.harness.activeManifest();
      expect(manifest?.schema).toBe("real-ming.native-knowledge-generation.v2");
      expect(manifest?.pages.map((page) => [page.pageId, page.trustDomain])).toEqual([
        ["personal-decision", "Personal"],
        ["creative-architecture", "Ming Creatives"],
        ["academic-plan", "Academic"],
        ["finance-policy", "Finance"],
      ]);

      const matrix = [
        ["COO", "Personal", "weekly personal"],
        ["CTO", "Ming Creatives", "native Hermes"],
        ["CMO", "Ming Creatives", "native Hermes"],
        ["CAO", "Academic", "evidence module"],
        ["Personal CFO", "Finance", "successor snapshot"],
      ] as const;
      for (const [role, trustDomain, query] of matrix) {
        const result = fixture.harness.retrieve({ role, trustDomain, query });
        expect(result).toMatchObject({
          kind: "ok",
          value: {
            kind: "ok",
            results: [{ citation: { trustDomain } }],
          },
        });
      }
    } finally {
      fixture.close();
    }
  });

  it("denies missing, malformed, CEO, Entertainment, and cross-domain scope before page reads", async () => {
    const fixture = workspace();
    try {
      const published = await fixture.harness.publish({
        candidates: [
          {
            candidateId: "finance-private",
            trustDomain: "Finance",
            content: "A finance-only cited fact.",
          },
          {
            candidateId: "entertainment-digest",
            trustDomain: "Entertainment",
            content: "An isolated entertainment digest fact.",
          },
        ],
      });
      expect(published.kind).toBe("succeeded");

      const denied = [
        { query: "finance-only", trustDomain: "Finance" },
        { query: "finance-only", role: "Personal CFO" },
        { query: "finance-only", role: "CEO", trustDomain: "Finance" },
        { query: "finance-only", role: "CAO", trustDomain: "Finance" },
        { query: "finance-only", role: "Personal CFO", trustDomain: "Academic" },
        { query: "entertainment digest", role: "Entertainment Executive", trustDomain: "Entertainment" },
        { query: "entertainment digest", role: "COO", trustDomain: "Entertainment" },
        { query: "finance-only", role: ["Personal CFO"], trustDomain: "Finance" },
        { query: "finance-only", role: "Personal CFO", trustDomain: ["Finance"] },
      ];
      for (const request of denied) {
        expect(fixture.harness.retrieve(request)).toMatchObject({ kind: "failed" });
      }

      fixture.harness.removePublishedPage("finance-private");
      expect(fixture.harness.retrieve({
        query: "finance-only",
        role: "CAO",
        trustDomain: "Finance",
      })).toMatchObject({
        kind: "failed",
        reason: "knowledge role is not authorized for Trust Domain",
      });
      expect(fixture.harness.health().repairState).toBe("healthy");

      expect(fixture.harness.retrieve({
        query: "finance-only",
        role: "Personal CFO",
        trustDomain: "Finance",
      })).toMatchObject({ kind: "failed" });
      expect(fixture.harness.health().repairState).toBe("needs-repair");
    } finally {
      fixture.close();
    }
  });

  it("rejects mixed-domain synthesis before activation", async () => {
    const fixture = workspace();
    try {
      const result = await fixture.harness.publish({
        candidates: [
          {
            candidateId: "personal-source",
            trustDomain: "Personal",
            content: "Personal source.",
          },
          {
            candidateId: "finance-source",
            trustDomain: "Finance",
            content: "Finance source.",
          },
        ],
        pages: [
          {
            pageId: "mixed-page",
            trustDomain: "Personal",
            sourceCandidateIds: ["personal-source", "finance-source"],
            content: "This page must never activate.",
          },
        ],
      });
      expect(result).toMatchObject({
        kind: "failed",
        reason: "synthesis page mixed-page mixes Trust Domains",
      });
      expect(fixture.harness.activeManifest()).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  it("rejects non-canonical candidate domains and treats a changed domain as an identity conflict", () => {
    const fixture = workspace();
    try {
      expect(fixture.harness.admitCandidate({
        candidateId: "invalid-domain",
        trustDomain: "Private" as never,
        content: "This candidate must not enter the registry.",
      })).toMatchObject({
        kind: "denied",
        reason: "candidate-trust-domain-invalid",
      });

      expect(fixture.harness.admitCandidate({
        candidateId: "domain-bound-identity",
        trustDomain: "Personal",
        content: "One identity has one admitted domain.",
      })).toMatchObject({ kind: "accepted" });
      expect(fixture.harness.admitCandidate({
        candidateId: "domain-bound-identity",
        trustDomain: "Finance",
        content: "One identity has one admitted domain.",
      })).toMatchObject({
        kind: "denied",
        reason: "candidate-id-conflict",
      });
    } finally {
      fixture.close();
    }
  });

  it("rejects direct activation when page lineage is missing or belongs to another domain", async () => {
    const fixture = workspace();
    try {
      expect(fixture.harness.admitCandidate({
        candidateId: "finance-lineage",
        trustDomain: "Finance",
        content: "Finance lineage must remain Finance.",
      })).toMatchObject({ kind: "accepted" });

      expect(await fixture.harness.attemptDirectActivation({
        pageId: "cross-domain-direct",
        trustDomain: "Personal",
        sourceCandidateIds: ["finance-lineage"],
      })).toMatchObject({
        kind: "invalid",
        reason: "generation page cross-domain-direct has cross-domain candidate finance-lineage",
      });
      expect(fixture.harness.activeManifest()).toBeUndefined();

      expect(await fixture.harness.attemptDirectActivation({
        pageId: "missing-lineage-direct",
        trustDomain: "Finance",
        sourceCandidateIds: ["candidate-does-not-exist"],
      })).toMatchObject({
        kind: "invalid",
        reason: "generation page missing-lineage-direct references missing candidate candidate-does-not-exist",
      });
      expect(fixture.harness.activeManifest()).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  it("publishes Entertainment lineage without inventing an Executive Role reader", async () => {
    const fixture = workspace();
    try {
      expect((await fixture.harness.publish({
        candidates: [{
          candidateId: "entertainment-only",
          trustDomain: "Entertainment",
          content: "A role-less entertainment digest.",
        }],
      })).kind).toBe("succeeded");
      expect(fixture.harness.activeManifest()?.pages).toMatchObject([
        { pageId: "entertainment-only", trustDomain: "Entertainment" },
      ]);
      for (const role of ["COO", "CTO", "CMO", "CAO", "Personal CFO"]) {
        expect(fixture.harness.retrieve({
          query: "entertainment digest",
          role,
          trustDomain: "Entertainment",
        })).toMatchObject({ kind: "failed" });
      }
      expect(fixture.harness.health().repairState).toBe("healthy");
    } finally {
      fixture.close();
    }
  });

  it("fails closed when an active manifest omits or corrupts a page domain", async () => {
    const fixture = workspace();
    try {
      expect((await fixture.harness.publish({
        candidates: [{
          candidateId: "academic-source",
          trustDomain: "Academic",
          content: "A cited academic fact.",
        }],
      })).kind).toBe("succeeded");

      fixture.harness.corruptActivePageDomain("academic-source", undefined);
      expect(fixture.harness.retrieve({
        query: "academic fact",
        role: "CAO",
        trustDomain: "Academic",
      })).toMatchObject({ kind: "failed" });
      expect(fixture.harness.health().repairState).toBe("needs-repair");
    } finally {
      fixture.close();
    }
  });
});
