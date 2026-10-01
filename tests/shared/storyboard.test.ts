import { describe, expect, it } from "vitest";
import { getStoryboardFrameCount, getStoryboardFrameUrl, getStoryboardTimes } from "../../src/shared/storyboard";
import type { VideoRecord } from "../../src/shared/videoTypes";

describe("storyboard sampling", () => {
  it("samples a ten-minute video evenly without using its endpoints", () => {
    expect(getStoryboardTimes(600_000)).toEqual([50_000, 150_000, 250_000, 350_000, 450_000, 550_000]);
    expect(getStoryboardTimes(600_000, 12)).toHaveLength(12);
  });
  it.each([[60_000, 6], [60_001, 8], [300_000, 8], [300_001, 12], [1_200_001, 16], [3_600_001, 20], [9_000_001, 24]])("uses %i ms to choose %i full-preview frames", (duration, count) => {
    expect(getStoryboardFrameCount(duration)).toBe(count);
  });
  it("does not request unknown or invalid durations, or duplicate frames for submillisecond clips", () => {
    for (const duration of [null, 0, -1, Infinity, NaN]) expect(getStoryboardTimes(duration)).toEqual([]);
    expect(getStoryboardTimes(1)).toEqual([0]);
  });
  it("ignores cache writes but invalidates changed file versions", () => {
    const video = { id: "a", path: "D:\\a.mp4", sizeBytes: 100, modifiedAt: "T1" } as VideoRecord;
    const first = getStoryboardFrameUrl(video, 5000);
    expect(getStoryboardFrameUrl({ ...video, updatedAt: "T2", timelinePreviewStatus: "ready" }, 5000)).toBe(first);
    expect(getStoryboardFrameUrl({ ...video, sizeBytes: 200 }, 5000)).not.toBe(first);
    expect(getStoryboardFrameUrl({ ...video, path: "D:\\b.mp4" }, 5000)).not.toBe(first);
  });
});
