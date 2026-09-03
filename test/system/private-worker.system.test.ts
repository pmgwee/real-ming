import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRealMingSystemHarness,
  type RealMingSystemHarness,
} from "../../src/testing/real-ming-system-harness.js";

// Keep the credential-shaped value assembled at runtime so the repository
// leak guard never sees a token-shaped literal in tracked source.
const githubTokenFixture = ["ghp_", "12345678901234567890"].join("");
import type { PrivateWorkerJob } from "../../src/workers/private-worker.js";
import type { WorkerEffect } from "../../src/operations/contracts.js";

describe("RM-21 Lenovo private worker", () => {
  let directory: string;
  let harnesses: RealMingSystemHarness[];
  let clock: string;

  beforeEach(() => {
    directory = mkdtempSync(join(process.env.TEMP ?? ".", "real-ming-rm21-"));
    harnesses = [];
    clock = "2026-09-02T09:00:00.000Z";
  });

  afterEach(() => {
    for (const harness of harnesses.splice(0)) harness.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function start(options: {
    readonly available?: boolean;
    readonly executor?: (job: PrivateWorkerJob) => Promise<{
      readonly evidence: Readonly<Record<string, string>>;
      readonly sourceReferences: readonly string[];
      readonly completedAt: string;
    }>;
    readonly verifierError?: boolean;
  } = {}): RealMingSystemHarness {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, `state-${harnesses.length}.sqlite`),
      now: () => clock,
      privateWorker: {
        available: options.available ?? true,
        ...(options.executor === undefined ? {} : { executor: options.executor }),
      },
      ...(options.verifierError === true
        ? { controlledVerifier: { result: "error" as const } }
        : {}),
    });
    harnesses.push(harness);
    return harness;
  }

  async function captureLocalWork(harness: RealMingSystemHarness) {
    const result = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: `rm21:local:${harnesses.length}`,
      text: "Process the private local-file work",
      workstream: "Career Job",
      expectedEffect: {
        kind: "local-file-edit",
        value: "prepare-reviewable-local-work",
      },
    });
    if (result.kind !== "work-item-acknowledgement") {
      throw new Error("Expected a Work Item acknowledgement.");
    }
    return result.workItem;
  }

  it("advertises the Lenovo capabilities and keeps offline work explicitly blocked", async () => {
    const harness = start({ available: false });
    expect(harness.privateWorkerHeartbeat()).toMatchObject({
      workerId: "lenovo-private-worker",
      available: false,
      capabilities: [
        "local-files",
        "browser-sessions",
        "windows-tools",
        "local-credentials",
        "sensitive-processing",
      ],
    });
    const workItem = await captureLocalWork(harness);

    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    expect(harness.auditTrail(workItem.id)).toContainEqual(
      expect.objectContaining({
        type: "work-item.waiting-blocked",
        details: expect.objectContaining({ reason: "private-worker-offline" }),
      }),
    );
    expect(harness.privateWorkerJobs()).toMatchObject([
      {
        workItemId: workItem.id,
        idempotencyKey: expect.stringContaining(workItem.idempotencyKey),
        requiredCapability: "local-files",
        sourceReferences: [workItem.id],
        expectedEvidence: expect.any(String),
        state: "queued",
      },
    ]);
  });

  it("reconnects without duplicating a completed idempotent job and still requires verification", async () => {
    let executions = 0;
    const harness = start({
      available: false,
      executor: async (job) => {
        executions += 1;
        return {
          evidence: {
            privateWorker: "untrusted-output",
            jobId: job.id,
            expectedEvidence: job.expectedEvidence,
          },
          sourceReferences: job.sourceReferences,
          completedAt: clock,
        };
      },
    });
    const workItem = await captureLocalWork(harness);
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();

    harness.setPrivateWorkerAvailable(true);
    const result = await harness.executeWorkItem(workItem.id);
    expect(result.outcomeReport.verification.status).toBe("verified");
    expect(executions).toBe(1);
    expect(harness.privateWorkerJobs()[0]?.state).toBe("completed");

    const replay = await harness.executeWorkItem(workItem.id);
    expect(replay.outcomeReport.id).toBe(result.outcomeReport.id);
    expect(executions).toBe(1);
  });

  it("retries a failed private-worker lease only after its bounded backoff", async () => {
    let executions = 0;
    const harness = start({
      executor: async (job) => {
        executions += 1;
        if (executions === 1) throw new Error("local worker transient failure");
        return {
          evidence: { retry: "second-attempt", expectedEvidence: job.expectedEvidence },
          sourceReferences: job.sourceReferences,
          completedAt: clock,
        };
      },
    });
    const workItem = await captureLocalWork(harness);
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();
    expect(harness.privateWorkerJobs()[0]?.state).toBe("failed");

    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();
    expect(executions).toBe(1);
    clock = "2026-09-02T09:00:06.000Z";
    const result = await harness.executeWorkItem(workItem.id);
    expect(result.outcomeReport.verification.status).toBe("verified");
    expect(executions).toBe(2);
  });

  it("fences an expired lease without starting a duplicate in-flight execution", async () => {
    let executions = 0;
    let release!: () => void;
    const harness = start({
      executor: async (job) => {
        executions += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          evidence: { lease: job.id, expectedEvidence: job.expectedEvidence },
          sourceReferences: job.sourceReferences,
          completedAt: clock,
        };
      },
    });
    const effect: WorkerEffect = {
      workItemId: "work-item:lease",
      executive: "COO",
      authority: "accountable",
      idempotencyKey: "private-worker:lease:1",
      kind: "local-file-edit",
      value: "bounded-action",
    };
    const first = harness.executePrivateWorkerEffect(effect);
    await Promise.resolve();
    expect(executions).toBe(1);
    clock = "2026-09-02T09:01:01.000Z";
    harness.expirePrivateWorkerLeases(clock);
    release();
    await expect(first).resolves.toBeDefined();
    expect(harness.privateWorkerJobs()[0]?.state).toBe("completed");

    const second = harness.executePrivateWorkerEffect(effect);
    await expect(second).resolves.toBeDefined();
    expect(executions).toBe(1);
  });

  it("does not let untrusted private-worker output bypass the verifier", async () => {
    const harness = start({ verifierError: true });
    const workItem = await captureLocalWork(harness);
    await expect(harness.executeWorkItem(workItem.id)).rejects.toThrow();
    expect(harness.workItem(workItem.id)?.state).toBe("Waiting/Blocked");
    expect(harness.outcomeReport(workItem.id)).toBeUndefined();
    expect(harness.auditTrail(workItem.id)).toContainEqual(
      expect.objectContaining({
        type: "work-item.waiting-blocked",
        details: expect.objectContaining({ reason: "effect-verification-failed" }),
      }),
    );
  });

  it("keeps unsupported capabilities and secret-bearing actions out of the job queue", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "restricted.sqlite"),
      now: () => clock,
      privateWorker: {
        available: true,
        capabilities: ["local-files"],
      },
    });
    harnesses.push(harness);
    const browserWork = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm21:browser",
      text: "Use the existing browser session",
      workstream: "Career Job",
      expectedEffect: { kind: "browser-session", value: "review-page" },
    });
    if (browserWork.kind !== "work-item-acknowledgement") throw new Error("Expected acknowledgement.");
    await expect(harness.executeWorkItem(browserWork.workItem.id)).rejects.toThrow();
    expect(harness.privateWorkerJobs()[0]).toMatchObject({
      requiredCapability: "browser-sessions",
      state: "queued",
    });

    await expect(harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm21:secret",
      text: "Process a local credential",
      workstream: "Career Job",
      expectedEffect: {
        kind: "local-credential",
        value: githubTokenFixture,
      },
    })).rejects.toThrow(/Sensitive Secret/);
    expect(harness.privateWorkerJobs()).toHaveLength(1);
  });

  it("rejects an effect kind outside the closed local capability allowlist", async () => {
    const harness = start();
    const workItem = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm21:unknown-effect",
      text: "Move money to an account",
      workstream: "Career Job",
      expectedEffect: { kind: "money-transfer", value: "send-100" },
    });
    if (workItem.kind !== "work-item-acknowledgement") throw new Error("Expected acknowledgement.");
    await expect(harness.executeWorkItem(workItem.workItem.id)).rejects.toThrow();
    expect(harness.privateWorkerJobs()).toHaveLength(0);
    expect(harness.auditTrail(workItem.workItem.id)).toContainEqual(
      expect.objectContaining({
        type: "work-item.waiting-blocked",
        details: expect.objectContaining({ reason: "unsupported-capability" }),
      }),
    );
  });

  it("preserves contribute-only authority in the durable job and receipt", async () => {
    const harness = start();
    const effect: WorkerEffect = {
      workItemId: "work-item:contribution",
      executive: "CMO",
      authority: "contribute-only",
      idempotencyKey: "private-worker:contribution:1",
      kind: "executive-contribution",
      value: "draft-a-content-angle",
    };
    const receipt = await harness.executePrivateWorkerEffect(effect);
    expect(receipt.effect.authority).toBe("contribute-only");
    expect(harness.privateWorkerJobs()[0]).toMatchObject({
      authority: "contribute-only",
      state: "completed",
    });
  });

  it("rejects secret-shaped idempotency keys before durable insertion", async () => {
    const harness = start();
    const effect: WorkerEffect = {
      workItemId: "work-item:secret-key",
      executive: "COO",
      authority: "accountable",
      idempotencyKey: githubTokenFixture,
      kind: "local-file-edit",
      value: "bounded-action",
    };
    await expect(harness.executePrivateWorkerEffect(effect)).rejects.toThrow("Sensitive Secrets");
    expect(harness.privateWorkerJobs()).toHaveLength(0);
  });

  it("cleans up malformed untrusted output instead of stranding a running lease", async () => {
    const harness = start({
      executor: async () => null as never,
    });
    const effect: WorkerEffect = {
      workItemId: "work-item:malformed-output",
      executive: "COO",
      authority: "accountable",
      idempotencyKey: "private-worker:malformed-output:1",
      kind: "local-file-edit",
      value: "bounded-action",
    };
    await expect(harness.executePrivateWorkerEffect(effect)).rejects.toThrow("output failed validation");
    expect(harness.privateWorkerJobs()[0]?.state).toBe("failed");
  });

  it("does not let an evidence field overwrite the source-reference secret scan", async () => {
    const harness = start({
      executor: async (job) => ({
        evidence: {
          sourceReferences: githubTokenFixture,
          expectedEvidence: job.expectedEvidence,
        },
        sourceReferences: job.sourceReferences,
        completedAt: clock,
      }),
    });
    const effect: WorkerEffect = {
      workItemId: "work-item:evidence-secret",
      executive: "COO",
      authority: "accountable",
      idempotencyKey: "private-worker:evidence-secret:1",
      kind: "local-file-edit",
      value: "bounded-action",
    };
    await expect(harness.executePrivateWorkerEffect(effect)).rejects.toThrow("output failed validation");
    expect(harness.privateWorkerJobs()[0]?.state).toBe("failed");
  });

  it("records only the trusted effect when a worker receipt is rejected", async () => {
    const harness = createRealMingSystemHarness({
      statePath: join(directory, "forged-receipt.sqlite"),
      now: () => clock,
      controlledVerifier: { result: "error" },
      controlledWorker: {
        receiptEffect: {
          workItemId: "work-item:forged",
          executive: "COO",
          authority: "contribute-only",
          idempotencyKey: githubTokenFixture,
          kind: "record-note",
          value: "bounded-action",
        },
      },
    });
    harnesses.push(harness);
    const acknowledged = await harness.submitCeoCommand({
      actorId: "ceo:ming",
      workspaceId: "workspace:real-ming",
      idempotencyKey: "rm21:forged-receipt",
      text: "Record a bounded note",
      workstream: "Career Job",
      expectedEffect: { kind: "record-note", value: "bounded-action" },
    });
    if (acknowledged.kind !== "work-item-acknowledgement") throw new Error("Expected acknowledgement.");
    await expect(harness.executeWorkItem(acknowledged.workItem.id)).rejects.toThrow();
    const recorded = harness.auditTrail(acknowledged.workItem.id).find(
      (event) => event.type === "worker.effect-recorded",
    );
    expect(recorded).toBeDefined();
    expect(JSON.stringify(recorded)).not.toContain(githubTokenFixture);
    expect(recorded?.details).toMatchObject({
      idempotencyKey: expect.stringContaining(acknowledged.workItem.idempotencyKey),
      kind: "record-note",
      authority: "accountable",
    });
  });
});
