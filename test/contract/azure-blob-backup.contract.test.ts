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
    expect(JSON.stringify(failed)).not.toContain(harnessBearerToken);
  });
});
