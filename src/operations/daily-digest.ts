import type { WorkItem } from "./contracts.js";

/** Presentation only: source records and full evidence entries stay intact. */
export function digestLabel(value: string, limit = 180): string {
  const plain = value.replace(/\s+/gu, " ").trim();
  const bounded = plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
  return bounded.replace(/[\\`*_\[\]<>]/gu, "\\$&");
}

export function digestBlocker(reason: string): string {
  return /^Migrated at the CEO-approved lifecycle Waiting\/Blocked from legacy status .+\. The clearing action has not been recorded yet\.$/u.test(
    reason,
  )
    ? "Blocker details not recorded. What is blocking this, and what would clear it?"
    : reason;
}

export function digestSection(
  title: string,
  entries: readonly { readonly label: string }[],
  limit = 3,
): string {
  if (entries.length === 0) return "";
  return [
    `**${title}**`,
    ...entries.slice(0, limit).map((item) => `• ${digestLabel(item.label)}`),
    ...(entries.length > limit ? [`+ ${entries.length - limit} more; ask for the full ${title.toLowerCase()} list.`] : []),
  ].join("\n");
}

/** Eligible options, never an instruction to execute or a newly set deadline. */
export function dailyReadyOptions(items: readonly WorkItem[]): WorkItem[] {
  const priorities = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const date = (item: WorkItem): number => {
    const parsed = Date.parse(item.confirmedCommitment?.value ?? "");
    return Number.isFinite(parsed) ? parsed : Infinity;
  };
  return items
    .filter(
      (item) =>
        item.workstream !== null &&
        ["Planned", "Executing", "Verifying"].includes(item.state),
    )
    .sort(
      (a, b) =>
        (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : 0) ||
        (priorities[b.priority ?? "Low"] - priorities[a.priority ?? "Low"]) ||
        (Number(b.state !== "Planned") - Number(a.state !== "Planned")) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function readyOptionLabel(item: WorkItem): string {
  const basis = [
    item.confirmedCommitment === null ? "" : `confirmed ${item.confirmedCommitment.value}`,
    item.priority === null ? "" : `${item.priority.toLowerCase()} priority`,
    item.state === "Planned" ? "ready to start" : "already in progress",
  ].filter(Boolean).join("; ");
  return `${item.workstream} · ${item.intent} — ${basis}`;
}
