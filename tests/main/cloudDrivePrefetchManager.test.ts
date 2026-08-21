// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mountedScanner before importing prefetchManager
vi.mock("../../src/main/clouddrive/mountedScanner.js", () => ({
  isCloudDrivePath: vi.fn(),
  tryPrefetchFileRanges: vi.fn(),
  tryCancelFilePrefetch: vi.fn()
}));

import { CloudDrivePrefetchManager } from "../../src/main/clouddrive/prefetchManager";
import { HINT_PRIORITY } from "../../src/main/clouddrive/grpcClient";
import { isCloudDrivePath, tryPrefetchFileRanges, tryCancelFilePrefetch } from "../../src/main/clouddrive/mountedScanner";

const mockedIsCloudDrivePath = vi.mocked(isCloudDrivePath);
const mockedTryPrefetch = vi.mocked(tryPrefetchFileRanges);
const mockedTryCancel = vi.mocked(tryCancelFilePrefetch);

const CLOUD_FILE = "Z:\\Movies\\ep01.mkv";
const LOCAL_FILE = "C:\\Videos\\ep01.mkv";
const CLOUD_FILE_2 = "Z:\\Movies\\ep02.mkv";

describe("CloudDrivePrefetchManager", () => {
  let manager: CloudDrivePrefetchManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsCloudDrivePath.mockImplementation((p) => p.startsWith("Z:\\"));
    mockedTryPrefetch.mockResolvedValue(100);
    mockedTryCancel.mockResolvedValue(true);
    manager = new CloudDrivePrefetchManager();
  });

  afterEach(async () => {
    await manager.cancelAllFiles();
  });

  it("does nothing for local paths", () => {
    manager.onPlaybackStart(LOCAL_FILE);
    expect(mockedTryPrefetch).not.toHaveBeenCalled();
  });

  it("prefetches the beginning of a cloud file on playback start", () => {
    manager.onPlaybackStart(CLOUD_FILE);
    expect(mockedTryPrefetch).toHaveBeenCalledTimes(1);
    const [filePath, ranges, priority, options] = mockedTryPrefetch.mock.calls[0];
    expect(filePath).toBe(CLOUD_FILE);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(0);
    expect(priority).toBe(HINT_PRIORITY.HIGH);
    expect(options?.replaceExisting).toBe(true);
  });

  it("cancels hints for previous file when switching", () => {
    manager.onPlaybackStart(CLOUD_FILE);
    manager.onPlaybackStart(CLOUD_FILE_2, CLOUD_FILE);
    expect(mockedTryCancel).toHaveBeenCalledWith(CLOUD_FILE);
  });

  it("prefetches around seek target on seek", () => {
    manager.onSeek(CLOUD_FILE, 5_000_000, 100_000_000);
    expect(mockedTryPrefetch).toHaveBeenCalledTimes(1);
    const [, ranges, priority] = mockedTryPrefetch.mock.calls[0];
    expect(ranges[0].start).toBe(5_000_000);
    expect(priority).toBe(HINT_PRIORITY.HIGH);
  });

  it("clamps seek prefetch to file size", () => {
    manager.onSeek(CLOUD_FILE, 99_000_000, 100_000_000);
    const [, ranges] = mockedTryPrefetch.mock.calls[0];
    // Should not exceed file size
    expect(ranges[0].start + ranges[0].length).toBeLessThanOrEqual(100_000_000);
  });

  it("prefetches head of next episode at NORMAL priority", () => {
    manager.onNextEpisodeKnown(CLOUD_FILE_2);
    expect(mockedTryPrefetch).toHaveBeenCalledTimes(1);
    const [, ranges, priority, options] = mockedTryPrefetch.mock.calls[0];
    expect(ranges[0].start).toBe(0);
    expect(priority).toBe(HINT_PRIORITY.NORMAL);
    expect(options?.replaceExisting).toBe(false);
  });

  it("uses LOW priority for thumbnail batch prefetch", () => {
    manager.onThumbnailBatch(CLOUD_FILE, [{ start: 1000, length: 512 }]);
    expect(mockedTryPrefetch).toHaveBeenCalledTimes(1);
    const [, , priority] = mockedTryPrefetch.mock.calls[0];
    expect(priority).toBe(HINT_PRIORITY.LOW);
  });

  it("does not prefetch when ranges array is empty", () => {
    manager.onThumbnailBatch(CLOUD_FILE, []);
    expect(mockedTryPrefetch).not.toHaveBeenCalled();
  });

  it("never throws when prefetch RPC fails", async () => {
    mockedTryPrefetch.mockRejectedValue(new Error("network error"));
    expect(() => manager.onPlaybackStart(CLOUD_FILE)).not.toThrow();
    // Wait for the async hint to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("cancels all hints for a file", async () => {
    manager.onPlaybackStart(CLOUD_FILE);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await manager.cancelAll(CLOUD_FILE);
    expect(mockedTryCancel).toHaveBeenCalledWith(CLOUD_FILE);
  });

  it("tracks active hint count", async () => {
    expect(manager.activeHintCount(CLOUD_FILE)).toBe(0);
    manager.onPlaybackStart(CLOUD_FILE);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.activeHintCount(CLOUD_FILE)).toBe(1);
  });
});
