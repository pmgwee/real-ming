import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const baselineLabel = "Real-Ming v1.1 · Architecture Revision 6";
const recordedHistoricalLabel = "Real-Ming v1.1 · Architecture Revision 5";

const repositoryRoot = new URL("../../", import.meta.url);

function repositoryPath(relative: string): string {
  return fileURLToPath(new URL(relative, repositoryRoot));
}

function readRepositoryFile(relative: string): string {
  return readFileSync(repositoryPath(relative), "utf8");
}

const currentDiagrams = [
  "docs/architecture/real-ming-agent-diagram-v6.html",
] as const;

const recordedHistoricalDiagrams = [
  "docs/architecture/real-ming-personal-agent-diagram-v5-CEO-review.html",
] as const;

describe("Real-Ming baseline synchronization", () => {
  it("publishes one baseline map naming every current artifact", () => {
    const baseline = readRepositoryFile("docs/BASELINE.md");

    expect(baseline).toContain(baselineLabel);
    expect(baseline).toContain("docs/specs/real-ming-v1.1.md");
    for (const diagram of [
      ...currentDiagrams,
      ...recordedHistoricalDiagrams,
    ]) {
      expect(baseline).toContain(diagram.replace("docs/", ""));
    }
  });

  it("states the deployed revision separately from the design baseline", () => {
    const baseline = readRepositoryFile("docs/BASELINE.md");

    expect(baseline).toMatch(/\*\*Deployed revision: Architecture Revision \d/);
  });

  it("keeps the specification on the v1.1 product baseline", () => {
    const specification = readRepositoryFile("docs/specs/real-ming-v1.1.md");

    expect(specification).toContain(
      "# Real-Ming v1.1 Personal Executive Operations Specification",
    );
    expect(specification).toContain("Version 1.1");
    expect(specification).toContain(baselineLabel);
    expect(existsSync(repositoryPath("docs/specs/real-ming-v1.md"))).toBe(false);
  });

  it("records the composition delta rather than silently rewriting clauses", () => {
    const specification = readRepositoryFile("docs/specs/real-ming-v1.1.md");

    expect(specification).toContain(
      "### Architecture Revision 6 composition delta",
    );
  });

  it("carries the architecture decision that authorizes the baseline", () => {
    expect(
      existsSync(
        repositoryPath("docs/adr/0020-run-ming-on-the-native-hermes-runtime.md"),
      ),
    ).toBe(true);
  });

  it.each(currentDiagrams)("stamps the shared baseline label on %s", (diagram) => {
    const markup = readRepositoryFile(diagram);

    expect(markup).toContain(
      `<meta name="real-ming-baseline" content="${baselineLabel}">`,
    );
  });

  it.each(recordedHistoricalDiagrams)(
    "preserves the recorded historical label on %s",
    (diagram) => {
      const markup = readRepositoryFile(diagram);

      expect(markup).toContain(
        `<meta name="real-ming-baseline" content="${recordedHistoricalLabel}">`,
      );
      expect(markup).toContain("Architecture Revision 5");
    },
  );

  it.each([...currentDiagrams, ...recordedHistoricalDiagrams])(
    "keeps a non-empty render beside %s",
    (diagram) => {
      const render = repositoryPath(diagram.replace(/\.html$/, ".png"));

      expect(existsSync(render)).toBe(true);
      expect(statSync(render).size).toBeGreaterThan(0);
    },
  );

  it("keeps superseded diagram revisions out of the current architecture folder", () => {
    for (const superseded of [
      "docs/architecture/real-ming-personal-agent-diagram.html",
      "docs/architecture/real-ming-personal-agent-diagram.png",
      "docs/architecture/real-ming-personal-agent-diagram-v2.html",
      "docs/architecture/real-ming-personal-agent-diagram-v2.png",
    ]) {
      expect(existsSync(repositoryPath(superseded))).toBe(false);
      expect(
        existsSync(
          repositoryPath(
            superseded.replace(
              "docs/architecture/",
              "docs/architecture/old_archieved/",
            ),
          ),
        ),
      ).toBe(true);
    }
    for (const superseded of [
      "docs/architecture/real-ming-personal-agent-diagram-v3.html",
      "docs/architecture/real-ming-personal-agent-diagram-v3.png",
      "docs/architecture/real-ming-personal-agent-diagram-v3-simplified.html",
      "docs/architecture/real-ming-personal-agent-diagram-v3-simplified.png",
    ]) {
      expect(existsSync(repositoryPath(superseded))).toBe(false);
    }
  });

  it("keeps the implementation graph on the v1.1 architecture decision", () => {
    const graph = JSON.parse(
      readRepositoryFile("real-ming-phase3-tickets.json"),
    ) as { readonly architectureDecision: string; readonly ticketCount: number };

    expect(graph.architectureDecision).toContain("Real-Ming v1.1");
    expect(graph.architectureDecision).toContain("Architecture Revision 6");
    expect(graph.ticketCount).toBe(44);
  });
});
