import { describe, expect, it } from "vitest";
import type { FolderScanStatus } from "../../src/shared/videoTypes";
import { areVisibleScanStatusesEqual } from "../../src/renderer/scanStatus";

const status: FolderScanStatus = {
  folderId: "folder-1",
  mode: "current-folder",
  state: "scanning",
  phase: "processing",
  totalFiles: 100,
  processedFiles: 20,
  currentPath: "D:\\Movies\\clip.mp4",
  message: null,
  counters: {
    totalFolders: 0, currentFolderIndex: 0, completedFolders: 0, failedFolders: 0,
    checkedDirectories: 1, changedDirectories: 1, skippedDirectories: 0, processedVideos: 1,
    skippedVideos: 0, addedVideos: 0, updatedVideos: 0, missingVideos: 0,
    fileFailures: 0, directoryFailures: 0, pendingFailures: 0, retriedFailures: 0, resolvedFailures: 0
  },
  updatedAt: "2026-07-17T00:00:00.000Z"
};

describe("areVisibleScanStatusesEqual", () => {
  it("ignores timestamp-only polling changes and list order", () => {
    const second = { ...status, folderId: "folder-2" };
    expect(areVisibleScanStatusesEqual(
      [status, second],
      [{ ...second, updatedAt: "2026-07-17T00:01:00.000Z" }, { ...status, updatedAt: "2026-07-17T00:01:00.000Z" }]
    )).toBe(true);
  });

  it("detects changes that are visible in the sidebar", () => {
    expect(areVisibleScanStatusesEqual([status], [{ ...status, processedFiles: 21 }])).toBe(false);
    expect(areVisibleScanStatusesEqual([status], [{ ...status, state: "paused" }])).toBe(false);
  });
});
