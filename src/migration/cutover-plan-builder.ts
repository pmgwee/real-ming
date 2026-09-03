import type { ExecutiveRole, Workstream } from "../operations/contracts.js";
import { executiveRoles, workstreams } from "../operations/contracts.js";
import {
  cutoverSourceReference,
  migrationImportLifecycles,
  validateCutoverPlan,
  type CutoverBindings,
  type CutoverCommitmentProvenance,
  type CutoverDecision,
  type CutoverDisposition,
  type CutoverPlan,
  type MigrationLifecycle,
} from "./master-tasks-cutover.js";

/**
 * A record the reviewed backup holds, reduced to what the plan needs. Titles
 * stay out of the plan itself; only the page identity and payload hash travel.
 */
export interface CutoverEvidenceRecord {
  readonly pageId: string;
  readonly title: string;
  readonly payloadHash: string;
}

export interface CutoverEvidenceSource {
  readonly dataSourceId: string;
  readonly records: readonly CutoverEvidenceRecord[];
}

/**
 * How a digest row was matched to the backup record at the same position.
 * `descriptive-label` covers a row the CEO reviewed under a description rather
 * than its literal title, such as a link-only or malformed record.
 */
export type CutoverTitleMatch = "exact" | "blank-source" | "descriptive-label";

export interface CutoverTitleMatchCounts {
  readonly exact: number;
  readonly blankSource: number;
  readonly descriptiveLabel: number;
}

export interface CutoverPlanBuildResult {
  readonly plan: CutoverPlan;
  readonly titleMatches: CutoverTitleMatchCounts;
  readonly descriptiveLabelRefs: readonly string[];
}

const refPrefixOrder = ["CC", "MS", "AC", "JL"] as const;
type RefPrefix = (typeof refPrefixOrder)[number];

interface DigestRow {
  readonly prefix: RefPrefix;
  readonly ref: string;
  readonly index: number;
  readonly title: string;
  readonly lifecycle: MigrationLifecycle | "Cancelled";
  readonly workstream: Workstream;
  readonly accountableExecutive: ExecutiveRole;
  readonly commitmentProvenance: CutoverCommitmentProvenance;
  readonly disposition: CutoverDisposition;
}

function decisionIdentity(row: DigestRow): string {
  return [
    row.disposition,
    row.lifecycle,
    row.workstream,
    row.accountableExecutive,
    row.commitmentProvenance,
  ].join("|");
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function parseLifecycle(value: string): MigrationLifecycle | "Cancelled" {
  const trimmed = value.trim();
  if (trimmed === "Cancelled") return "Cancelled";
  const found = migrationImportLifecycles.find(
    (lifecycle) => lifecycle === trimmed,
  );
  if (found === undefined) {
    throw new Error(`The digest names an unknown lifecycle: ${value}.`);
  }
  return found;
}

function parseWorkstream(value: string): Workstream {
  const found = workstreams.find((workstream) => workstream === value.trim());
  if (found === undefined) {
    throw new Error(`The digest names an unknown Workstream: ${value}.`);
  }
  return found;
}

function parseExecutive(value: string): ExecutiveRole {
  const found = executiveRoles.find((role) => role === value.trim());
  if (found === undefined) {
    throw new Error(`The digest names an unknown Executive Role: ${value}.`);
  }
  return found;
}

function parseProvenance(value: string): CutoverCommitmentProvenance {
  const normalized = normalizeTitle(value);
  if (normalized === "none in source" || normalized === "none-in-source") {
    return "none-in-source";
  }
  if (normalized.includes("ceo")) return "ceo-set-date";
  if (normalized.includes("source")) return "source-date";
  throw new Error(`The digest names an unknown commitment provenance: ${value}.`);
}

function parseDisposition(value: string): CutoverDisposition {
  const normalized = normalizeTitle(value);
  if (normalized === "migrate") return "migrate";
  if (normalized === "archive-only" || normalized === "archive only") {
    return "archive-only";
  }
  throw new Error(`The digest names an unknown disposition: ${value}.`);
}

function parseDigestRows(digest: string): readonly DigestRow[] {
  const rows: DigestRow[] = [];
  for (const line of digest.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 8) continue;
    const match = /^([A-Z]{2})-(\d+)$/.exec(cells[0] ?? "");
    if (match === null) continue;
    const prefix = refPrefixOrder.find((candidate) => candidate === match[1]);
    if (prefix === undefined) {
      throw new Error(`The digest names an unknown batch prefix: ${match[1]}.`);
    }
    rows.push({
      prefix,
      ref: cells[0] ?? "",
      index: Number(match[2]),
      title: cells[1] ?? "",
      lifecycle: parseLifecycle(cells[3] ?? ""),
      workstream: parseWorkstream(cells[4] ?? ""),
      accountableExecutive: parseExecutive(cells[5] ?? ""),
      commitmentProvenance: parseProvenance(cells[6] ?? ""),
      disposition: parseDisposition(cells[7] ?? ""),
    });
  }
  return rows;
}

/**
 * Joins the CEO's reviewed decisions onto the real page identities in the
 * backup. The join is positional per batch, so every position is proved by the
 * title it carries before a single page id enters the plan.
 */
export function buildCutoverPlan(options: {
  readonly digest: string;
  readonly sources: readonly CutoverEvidenceSource[];
  readonly bindings: CutoverBindings;
  readonly expectedTitleMatches: CutoverTitleMatchCounts;
}): CutoverPlanBuildResult {
  const { bindings } = options;
  const rows = parseDigestRows(options.digest);
  if (rows.length !== bindings.reviewedRecordCount) {
    throw new Error(
      `The digest carries ${rows.length} decisions but the plan binds ${bindings.reviewedRecordCount}.`,
    );
  }

  const sourcesById = new Map(
    options.sources.map((source) => [source.dataSourceId, source]),
  );
  const decisions: CutoverDecision[] = [];
  const descriptiveLabelRefs: string[] = [];
  let exact = 0;
  let blankSource = 0;

  for (const [position, prefix] of refPrefixOrder.entries()) {
    const binding = bindings.sources[position];
    if (binding === undefined) {
      throw new Error(`No bound source exists for digest batch ${prefix}.`);
    }
    const source = sourcesById.get(binding.dataSourceId);
    if (source === undefined) {
      throw new Error(
        `The reviewed backup is missing bound source ${binding.dataSourceId}.`,
      );
    }
    const batch = rows.filter((row) => row.prefix === prefix);
    if (batch.length !== source.records.length) {
      throw new Error(
        `Digest batch ${prefix} carries ${batch.length} decisions but its source holds ${source.records.length} records.`,
      );
    }
    const seen = new Set<number>();
    // Rows whose title did not prove their position. The positional join can
    // only be trusted for them if they are interchangeable.
    const unproven: string[] = [];
    for (const row of batch) {
      if (row.index < 1 || row.index > source.records.length) {
        throw new Error(`Digest row ${row.ref} is outside its batch.`);
      }
      if (seen.has(row.index)) {
        throw new Error(`Digest row ${row.ref} repeats a position.`);
      }
      seen.add(row.index);
      const record = source.records[row.index - 1];
      if (record === undefined) {
        throw new Error(`Digest row ${row.ref} has no backup record.`);
      }
      const sourceTitle = normalizeTitle(record.title);
      const digestTitle = normalizeTitle(row.title);
      if (sourceTitle === "") {
        blankSource += 1;
        unproven.push(decisionIdentity(row));
      } else if (sourceTitle === digestTitle) {
        exact += 1;
      } else {
        descriptiveLabelRefs.push(row.ref);
        unproven.push(decisionIdentity(row));
      }
      decisions.push({
        dataSourceId: binding.dataSourceId,
        pageId: record.pageId,
        payloadHash: record.payloadHash,
        disposition: row.disposition,
        lifecycle: row.lifecycle,
        workstream: row.workstream,
        accountableExecutive: row.accountableExecutive,
        commitmentProvenance: row.commitmentProvenance,
      });
    }
    if (new Set(unproven).size > 1) {
      throw new Error(
        `The digest-to-backup join is ambiguous in batch ${prefix}: ${unproven.length} rows could not be placed by title and they do not carry the same decision.`,
      );
    }
  }

  const titleMatches: CutoverTitleMatchCounts = {
    exact,
    blankSource,
    descriptiveLabel: descriptiveLabelRefs.length,
  };
  const expected = options.expectedTitleMatches;
  if (
    titleMatches.exact !== expected.exact ||
    titleMatches.blankSource !== expected.blankSource ||
    titleMatches.descriptiveLabel !== expected.descriptiveLabel
  ) {
    throw new Error(
      `The digest-to-backup join drifted: ${titleMatches.exact} exact, ${titleMatches.blankSource} blank-source and ${titleMatches.descriptiveLabel} descriptive-label matches, but ${expected.exact}/${expected.blankSource}/${expected.descriptiveLabel} were reviewed.`,
    );
  }

  const references = new Set(
    decisions.map((decision) =>
      cutoverSourceReference(decision.dataSourceId, decision.pageId),
    ),
  );
  if (references.size !== decisions.length) {
    throw new Error("The digest-to-backup join produced a repeated page.");
  }

  const plan: CutoverPlan = { bindings, decisions };
  const problems = validateCutoverPlan(plan);
  if (problems.length > 0) {
    throw new Error(
      `The built plan does not match the approved result shape: ${problems[0]}`,
    );
  }

  return { plan, titleMatches, descriptiveLabelRefs };
}
