import { describe, expect, it, vi } from "vitest";
import type { VideoRepository } from "../../src/main/db/videoRepository.js";
import { syncEnabledFolders } from "../../src/main/media/libraryScanner.js";

describe("syncEnabledFolders", () => {
  it("scans enabled folders and skips disabled folders", async () => {
    const scan = vi.fn().mockResolvedValue(undefined);
    const repo = {
      listSourceFolders: () => [
        {
          id: "enabled",
          path: "D:\\Movies",
          recursive: true,
          enabled: true,
          lastScannedAt: null,
          createdAt: "",
          updatedAt: "",
          scanError: null
        },
        {
          id: "disabled",
          path: "D:\\Old",
          recursive: true,
          enabled: false,
          lastScannedAt: null,
          createdAt: "",
          updatedAt: "",
          scanError: null
        }
      ]
    } as unknown as VideoRepository;

    await syncEnabledFolders(repo, scan);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(repo, expect.objectContaining({ id: "enabled" }));
  });
});
