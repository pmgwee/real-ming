import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";
import type { DuitSiniAdapter } from "../../src/providers/duitsini-adapter.js";

const now = "2026-09-03T04:00:00.000Z";
const recordId = "subscription:netflix";

describe("RM-34 Personal CFO DuitSini Record Change", () => {
  const harnesses: RealMingSystemHarness[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function duitsini(
    overrides: { readonly readBackDrifts?: boolean } = {},
  ): DuitSiniAdapter & { writeCount(): number } {
    const identity = {
      provider: "duitsini",
      workspaceId: "workspace:real-ming",
      accountReference: "duitsini:real-ming",
    } as const;
    const provenance = {
      sourceIdentity: "duitsini",
      sourceReference: `duitsini:${recordId}`,
      asOf: "2026-09-03T03:30:00.000Z",
      retrievedAt: now,
      freshness: "current" as const,
    };
    const records = new Map([
      [
        "subscription:spotify",
        {
          id: "subscription:spotify",
          kind: "recurring-subscription" as const,
          label: "Spotify",
          renewalSchedule: "monthly on the 9th",
          paymentMethodLabel: "Visa ending 4242",
          updatedAt: "2026-09-03T03:30:00.000Z",
          sourceReference: "duitsini:subscription:spotify",
        },
      ],
      [
        recordId,
        {
          id: recordId,
          kind: "recurring-subscription" as const,
          label: "Netflix",
          renewalSchedule: "monthly on the 4th",
          paymentMethodLabel: "Visa ending 4242",
          updatedAt: "2026-09-03T03:30:00.000Z",
          sourceReference: `duitsini:${recordId}`,
        },
      ],
    ]);
    let writes = 0;
    const ledger = new Map<string, string>();
    return {
      identity: () => identity,
      capabilities: () => ["read", "write"],
      read: async () => ({
        kind: "ok",
        identity,
        provenance,
        value: [...records.values()],
      }),
      write: async () => ({
        kind: "failed",
        failure: {
          class: "unsupported-capability",
          retryable: false,
          message: "Use changeRecordMetadata.",
        },
      }),
      readRecord: async ({ id }) => {
        const record = records.get(id);
        return record === undefined
          ? {
              kind: "failed",
              failure: {
                class: "invalid-input",
                retryable: false,
                message: "Unknown record.",
              },
            }
          : { kind: "ok", identity, provenance, value: record };
      },
      changeRecordMetadata: async (request) => {
        const replay = ledger.get(request.idempotencyKey);
        if (replay !== undefined) {
          return {
            kind: "ok",
            identity,
            provenance,
            effectReference: replay,
            deduplicated: true,
          };
        }
        writes += 1;
        const record = records.get(request.id);
        if (record !== undefined) {
          records.set(request.id, {
            ...record,
            ...(overrides.readBackDrifts === true
              ? { label: "Something else entirely" }
              : { label: request.label ?? record.label }),
            updatedAt: now,
          });
        }
        const effectReference = `duitsini:${request.id}:change:${writes}`;
        ledger.set(request.idempotencyKey, effectReference);
        return {
          kind: "ok",
          identity,
          provenance,
          effectReference,
          deduplicated: false,
        };
      },
      writeCount: () => writes,
    };
  }

  function start(
    adapter: DuitSiniAdapter & { writeCount(): number } = duitsini(),
  ): RealMingSystemHarness {
    const directory = mkdtempSync(join(tmpdir(), "real-ming-rm34-"));
    directories.push(directory);
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "state.sqlite"),
      now: () => now,
      duitsini: { adapter },
    });
    harnesses.push(harness);
    return harness;
  }

  it("keeps DuitSini the Source of Record for the subscription", async () => {
    const harness = start();

    const record = await harness.readDuitSiniRecord(recordId);

    expect(record.kind).toBe("ok");
    if (record.kind !== "ok") return;
    expect(record.value).toMatchObject({
      kind: "recurring-subscription",
      renewalSchedule: "monthly on the 4th",
      paymentMethodLabel: "Visa ending 4242",
      sourceReference: `duitsini:${recordId}`,
    });
    expect(record.provenance.asOf).toBe("2026-09-03T03:30:00.000Z");
  });

  it("requires an Approval bound to that exact record before changing it", async () => {
    const adapter = duitsini();
    const harness = start(adapter);

    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });

    expect(requested.kind).toBe("approval-required");
    expect(adapter.writeCount()).toBe(0);
  });

  it("performs the change and reads it back before the Work Item is Review-Ready", async () => {
    const adapter = duitsini();
    const harness = start(adapter);
    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });
    if (requested.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const changed = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });

    expect(changed.kind).toBe("changed");
    if (changed.kind !== "changed") return;
    expect(changed.verifiedRecord.label).toBe("Netflix Standard");
    expect(adapter.writeCount()).toBe(1);
    expect(harness.workItem(changed.workItem.id)?.state).toBe(
      "Ready for CEO Review",
    );
  });

  it("refuses to call the change verified when the read-back disagrees", async () => {
    const adapter = duitsini({ readBackDrifts: true });
    const harness = start(adapter);
    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });
    if (requested.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const changed = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });

    expect(changed).toMatchObject({
      kind: "verification-failed",
      reason: "read-back-mismatch",
    });
  });

  it("has no payment capability to call in the first place", () => {
    const adapter = duitsini();

    // Structural, not a runtime guard: there is nothing to invoke.
    expect(adapter.capabilities()).toEqual(["read", "write"]);
    expect("payBill" in adapter).toBe(false);
    expect("transfer" in adapter).toBe(false);
    expect("chargeCard" in adapter).toBe(false);
    expect("bankLogin" in adapter).toBe(false);
    expect(Object.keys(adapter)).not.toContain("moveMoney");
  });

  it("denies a Money Movement capability outright", async () => {
    const harness = start();
    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });
    if (requested.kind !== "approval-required") throw new Error("expected approval");

    const decision = await harness.requestAction({
      workItemId: requested.workItemId,
      executive: "Personal CFO",
      trustDomain: "Finance",
      operation: "write",
      reversibility: "irreversible",
      riskClass: "high",
      capability: "money-movement",
    });

    expect(decision).toMatchObject({
      kind: "denied",
      reason: "capability-not-grantable",
    });
  });

  it("refuses a change that would put a Sensitive Secret into the record", async () => {
    const adapter = duitsini();
    const harness = start(adapter);

    const refused = await harness.changeDuitSiniRecord({
      recordId,
      paymentMethodLabel: "4111 1111 1111 1111",
      reason: "Card replaced",
    });

    expect(refused).toMatchObject({ kind: "denied", reason: "sensitive-change" });
    expect(adapter.writeCount()).toBe(0);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("refuses payment material too short for the generic secret heuristic", async () => {
    // A ten-digit bank account number slips the 13-19 digit card pattern, but a
    // payment-method LABEL still has no business carrying one. Left unchecked it
    // would reach the Approval target, the audit log and the Outcome Report.
    const adapter = duitsini();
    const harness = start(adapter);

    const refused = await harness.changeDuitSiniRecord({
      recordId,
      paymentMethodLabel: "Maybank 1234567890",
      reason: "Account changed",
    });

    expect(refused).toMatchObject({ kind: "denied", reason: "sensitive-change" });
    expect(adapter.writeCount()).toBe(0);
    expect(harness.workItems()).toHaveLength(0);
  });

  it("still accepts an ordinary payment-method label", async () => {
    const harness = start();

    const requested = await harness.changeDuitSiniRecord({
      recordId,
      paymentMethodLabel: "Visa ending 4242",
      reason: "Card reissued",
    });

    expect(requested.kind).toBe("approval-required");
  });

  it("will not let one record's Approval authorize a change to another", async () => {
    const adapter = duitsini();
    const harness = start(adapter);
    // Deliberately the SAME field and value on both records, so the only thing
    // that can distinguish them is the record identity itself.
    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Premium",
      reason: "Plan renamed",
    });
    if (requested.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const other = await harness.changeDuitSiniRecord({
      recordId: "subscription:spotify",
      label: "Premium",
      reason: "Plan renamed",
    });

    expect(other.kind).toBe("approval-required");
    expect(adapter.writeCount()).toBe(0);
  });

  it("does not duplicate the change on retry and keeps secrets out of the report", async () => {
    const adapter = duitsini();
    const harness = start(adapter);
    const requested = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });
    if (requested.kind !== "approval-required") throw new Error("expected approval");
    await harness.grantApproval({
      approvalId: requested.approvalId,
      actorId: "ceo:ming",
      expiresAt: "2026-09-03T21:00:00.000Z",
    });

    const first = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });
    const retry = await harness.changeDuitSiniRecord({
      recordId,
      label: "Netflix Standard",
      reason: "Plan renamed",
    });

    expect(first.kind).toBe("changed");
    expect(retry.kind).toBe("changed");
    expect(adapter.writeCount()).toBe(1);
    if (first.kind !== "changed") return;
    const report = harness.outcomeReport(first.workItem.id);
    expect(JSON.stringify(report)).not.toContain("4242");
    expect(report?.completedEffect.value).toContain(recordId);
  });
});
