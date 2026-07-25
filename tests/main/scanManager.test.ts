// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SourceFolder } from "../../src/shared/videoTypes";
import type { VideoRepository } from "../../src/main/db/videoRepository";
import { ScanManager } from "../../src/main/media/scanManager";
import type { MetadataQueue } from "../../src/main/media/metadataQueue";

const folder: SourceFolder = {
  id: "folder-1",
  path: "Z:\\Cloud",
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "",
  updatedAt: "",
  scanError: null
};

describe("ScanManager", () => {
  it("pauses between files, resumes, and records completed progress", async () => {
    let releaseCurrentFile: (() => void) | undefined;
    const currentFile = new Promise<void>((resolve) => { releaseCurrentFile = resolve; });
    const scan = vi.fn(async (_repo, _folder, dependencies) => {
      dependencies.onProgress?.({ phase: "processing", totalFiles: 2, processedFiles: 0, currentPath: "a.mp4" });
      await currentFile;
      await dependencies.waitIfPaused?.();
      dependencies.onProgress?.({ phase: "processing", totalFiles: 2, processedFiles: 2, currentPath: "b.mp4" });
      return { state: "completed" as const, totalFiles: 2, processedFiles: 2, failureCount: 0, message: null };
    });
    const manager = new ScanManager({} as VideoRepository, scan);
    const task = manager.start(folder);
    await vi.waitFor(() => expect(manager.listStatuses()[0]?.state).toBe("scanning"));

    expect(manager.pause(folder.id)).toBe(true);
    releaseCurrentFile?.();
    await vi.waitFor(() => expect(manager.listStatuses()[0]?.state).toBe("paused"));
    expect(manager.resume(folder.id)).toBe(true);
    await task;

    expect(manager.listStatuses()[0]).toMatchObject({ state: "completed", totalFiles: 2, processedFiles: 2 });
  });

  it("records a temporarily offline result for retry", async () => {
    const manager = new ScanManager({} as VideoRepository, async () => ({
      state: "offline",
      totalFiles: 0,
      processedFiles: 0,
      failureCount: 1,
      message: "network unavailable"
    }));

    await manager.start(folder);
    expect(manager.listStatuses()[0]).toMatchObject({ state: "offline", message: "network unavailable" });
  });

  it("forwards newly indexed videos to the background metadata queue", async () => {
    const enqueue = vi.fn();
    const metadataQueue = { enqueue } as unknown as MetadataQueue;
    const manager = new ScanManager({} as VideoRepository, async (_repo, _folder, dependencies) => {
      dependencies.onMetadataPending?.("video-1");
      expect(enqueue).not.toHaveBeenCalled();
      return { state: "completed", totalFiles: 1, processedFiles: 1, failureCount: 0, message: null };
    }, metadataQueue);

    await manager.start(folder);

    expect(enqueue).toHaveBeenCalledWith("video-1");
  });
});
