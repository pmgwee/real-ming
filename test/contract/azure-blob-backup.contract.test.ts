import { describe, expect, it } from "vitest";

import {
  createAzureBlobBackupContractHarness,
  harnessBearerToken,
} from "../../src/testing/provider-adapter-contract-harness.js";

describe("RM-15 Azure Blob backup contract", () => {
  it("uploads one SQLite backup through the VM managed identity", async () => {
    const harness = createAzureBlobBackupContractHarness();

    const result = await harness.uploader.upload({
      blobName: "2026-08-31/state.sqlite",
      content: new TextEncoder().encode("controlled-sqlite-backup"),
    });

    expect(result).toEqual({ kind: "ok" });
    expect(harness.tokenRequestCount()).toBe(1);
    expect(harness.uploads()).toEqual([
      expect.objectContaining({
        url: "https://realmingbackup.blob.core.windows.net/state/2026-08-31/state.sqlite",
        authorization: `Bearer ${harnessBearerToken}`,
        blobType: "BlockBlob",
        content: "controlled-sqlite-backup",
      }),
    ]);
  });

  it("separates missing storage authority from a temporary outage", async () => {
    const forbidden = createAzureBlobBackupContractHarness({ uploadStatus: 403 });
    const unavailable = createAzureBlobBackupContractHarness({
      uploadStatus: 503,
      errorBody: `credential=${harnessBearerToken}`,
    });

    expect(
      await forbidden.uploader.upload({
        blobName: "state.sqlite",
        content: new Uint8Array([1]),
      }),
    ).toEqual({ kind: "failed", reason: "forbidden" });
    const failed = await unavailable.uploader.upload({
      blobName: "state.sqlite",
      content: new Uint8Array([1]),
    });
    expect(failed).toEqual({ kind: "failed", reason: "unavailable" });
  });

  it("returns every failure rather than throwing one", async () => {
    // The previous leak assertion here could not fail: the result type is a
    // closed union of {kind:"ok"} and {kind:"failed", reason}, so no
    // type-checking implementation could put a token in it. The real exposure
    // is a thrown Error, whose message would carry the blob URL and bearer
    // token straight into the service journal -- so what is worth proving is
    // that no failure path throws at all.
    for (const scenario of [
      { tokenStatus: 403 },
      { tokenStatus: 500 },
      { uploadStatus: 403 },
      { uploadStatus: 503 },
      { unreachable: true },
      { errorBody: `credential=${harnessBearerToken}` , uploadStatus: 500 },
    ] as const) {
      const harness = createAzureBlobBackupContractHarness(scenario);
      const result = await harness.uploader.upload({
        blobName: "state.sqlite",
        content: new Uint8Array([1]),
      });
      expect(result.kind).toBe("failed");
      expect(Object.keys(result).sort()).toEqual(["kind", "reason"]);
    }
  });
});
