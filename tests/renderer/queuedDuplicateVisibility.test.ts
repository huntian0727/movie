import { describe, expect, it } from "vitest";
import type { DuplicateGroup, ReviewedDeleteBackgroundJob } from "../../src/shared/videoTypes";
import { hideQueuedDuplicateVideos } from "../../src/renderer/components/queuedDuplicateVisibility";

const mk = (id: string, sizeBytes = 1024) => ({ video: { id, sizeBytes }, isRecommendedToKeep: id === "keep" });
const groups = [
  { groupKey: "two", recommendedKeepVideoId: "keep", reclaimableBytes: 1024,
    items: [mk("keep"), mk("queued")] },
  { groupKey: "three", recommendedKeepVideoId: "keep2", reclaimableBytes: 2048,
    items: [mk("keep2"), mk("queued2"), mk("remaining")] },
  { groupKey: "untouched", recommendedKeepVideoId: "keep3", reclaimableBytes: 1024,
    items: [mk("keep3"), mk("remaining3")] }
] as unknown as DuplicateGroup[];

const job = (status: ReviewedDeleteBackgroundJob["status"], queuedVideoIds: string[]) =>
  ({ status, queuedVideoIds } as ReviewedDeleteBackgroundJob);

describe("optimistic duplicate-list hiding while confirmed background queue runs", () => {
  it("hides only queued videos and drops a group when only its keeper remains", () => {
    const result = hideQueuedDuplicateVideos(groups, job("running", ["queued", "queued2"]));
    expect(result).toMatchObject({ hiddenVideos: 2, hiddenGroups: 1 });
    expect(result.groups.map((group) => group.groupKey)).toEqual(["three", "untouched"]);
    expect(result.groups[0].items.map((item) => item.video.id)).toEqual(["keep2", "remaining"]);
    expect(result.groups[0].reclaimableBytes).toBe(1024);
    expect(result.groups[1]).toBe(groups[2]); // no unrelated render churn
    expect(groups[0].items).toHaveLength(2); // raw query and DB are not changed
  });
  it("does not hide anything if submit was rejected, completed or interrupted", () => {
    expect(hideQueuedDuplicateVideos(groups, null).groups).toBe(groups);
    expect(hideQueuedDuplicateVideos(groups, job("queued", ["queued"])).hiddenVideos).toBe(1);
    for (const status of ["completed", "partial", "blocked", "interrupted"] as const) {
      expect(hideQueuedDuplicateVideos(groups, job(status, ["queued"])).hiddenVideos).toBe(0);
    }
  });
  it("never hides an unplanned file or keeps a singleton duplicate group", () => {
    const result = hideQueuedDuplicateVideos(groups, job("running", ["unknown-id", "keep2", "queued"]));
    expect(result.hiddenVideos).toBe(2);
    expect(result.groups.find((group) => group.groupKey === "three")?.recommendedKeepVideoId).toBe("queued2");
    expect(result.groups.some((group) => group.groupKey === "two")).toBe(false);
  });
});
