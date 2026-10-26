import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateGroupsPage } from "../../src/renderer/components/DuplicateGroupsPage";
import { hideQueuedDuplicateVideos } from "../../src/renderer/components/queuedDuplicateVisibility";
import type { DuplicateGroup, ReviewedDeleteBackgroundJob, VideoRecord } from "../../src/shared/videoTypes";

const makeVideo = (id: string, path: string, directory: string, filename: string, sizeBytes: number) => ({
  id, path, directory, filename, sizeBytes, durationMs: 90000, width: 1920, height: 1080,
  modifiedAt: "2026-07-09T00:00:00.000Z", isFavorite: false, isPendingDelete: false
} as unknown as VideoRecord);
const keeper = makeVideo("keep", "D:\\Movies\\clip.mp4", "D:\\Movies", "clip.mp4", 1024);
const copyOne = makeVideo("copy-one", "D:\\Backup\\clip.mp4", "D:\\Backup", "clip-copy.mp4", 4096);
const copyTwo = makeVideo("copy-two", "D:\\Other\\clip.mp4", "D:\\Other", "clip-other.mp4", 2048);
const group: DuplicateGroup = {
  groupKey: "group-1", identityStatus: "size_duration_match", recommendedKeepVideoId: keeper.id,
  reclaimableBytes: copyOne.sizeBytes + copyTwo.sizeBytes,
  items: [
    { video: keeper, isRecommendedToKeep: true, keepReason: "已收藏" },
    { video: copyOne, isRecommendedToKeep: false, keepReason: null },
    { video: copyTwo, isRecommendedToKeep: false, keepReason: null }
  ]
};
const baseProps = () => ({ groups: [group], onOpen: vi.fn(), onViewDetails: vi.fn() });

describe("group cleanup button", () => {
  it("allows a new confirmed group queue while another background cleanup is running", async () => {
    const accepted = { id: "group-task", status: "running" as const, total: 2, processed: 0, successCount: 0, failureCount: 0, uncertainCount: 0, unsubmittedCount: 2, queuedVideoIds: ["copy-one", "copy-two"], reclaimedBytes: 0, recycledCount: 0, failures: [], message: "accepted", createdAt: "2026-10-22", updatedAt: "2026-10-22" };
    const submit = vi.fn().mockResolvedValue(accepted);
    const acceptedCallback = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} backgroundRunning onStartReviewedBackground={submit} onBackgroundAccepted={acceptedCallback} onPreviewResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "清理本组" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认清理本候选组？" });
    expect(dialog).toHaveTextContent("本组共 3 份");
    expect(dialog).toHaveTextContent("计划保留");
    expect(dialog).toHaveTextContent("clip-copy.mp4");
    expect(dialog).toHaveTextContent("clip-other.mp4");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认并加入后台队列（2 个文件）" }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(acceptedCallback).toHaveBeenCalledWith(expect.objectContaining({ queuedVideoIds: ["copy-one", "copy-two"] }));
    expect(screen.queryByRole("alertdialog", { name: "确认清理本候选组？" })).not.toBeInTheDocument();
  });

  it("keeps the group visible and confirmation open when the queue rejects submission", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("待执行队列已达到 20 个任务上限"));
    render(<DuplicateGroupsPage {...baseProps()} onStartReviewedBackground={submit} onPreviewResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "清理本组" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认清理本候选组？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认并加入后台队列（2 个文件）" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("20 个任务上限");
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "清理本组" })).toBeInTheDocument();
  });

  it("hides the whole group only after all non-keeper files are acknowledged by the queue", () => {
    const job = {
      id: "group-task", status: "running", total: 2, processed: 0, successCount: 0, failureCount: 0,
      uncertainCount: 0, unsubmittedCount: 2, queuedVideoIds: ["copy-one", "copy-two"],
      reclaimedBytes: 0, recycledCount: 0, failures: [], message: "accepted", createdAt: "2026-10-22", updatedAt: "2026-10-22"
    } as ReviewedDeleteBackgroundJob;
    const result = hideQueuedDuplicateVideos([group], job);
    expect(result.groups).toEqual([]);
    expect(result.hiddenGroups).toBe(1);
    expect(result.hiddenVideos).toBe(2);
  });
});