import { describe, expect, it } from "vitest";
import type { FolderScanStatus } from "../../src/shared/videoTypes";
import { areVisibleScanStatusesEqual } from "../../src/renderer/scanStatus";

const status: FolderScanStatus = {
  folderId: "folder-1",
  state: "scanning",
  phase: "processing",
  totalFiles: 100,
  processedFiles: 20,
  currentPath: "D:\\Movies\\clip.mp4",
  message: null,
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
