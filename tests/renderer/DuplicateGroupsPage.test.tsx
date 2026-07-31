import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateGroupsPage } from "../../src/renderer/components/DuplicateGroupsPage";
import type { DuplicateGroup, VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "keep",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90000,
  width: 1920,
  height: 1080,
  format: "mp4",
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: true,
  isPendingDelete: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "ready",
  timelinePreviewStatus: "ready",
  coverCachePath: null,
  contentFingerprint: "fp-1",
  fingerprintStatus: "ready",
  fingerprintUpdatedAt: "2026-07-09T00:00:00.000Z",
  fingerprintError: null
};

const duplicateVideo: VideoRecord = {
  ...video,
  id: "delete",
  path: "D:\\Backup\\clip.mp4",
  directory: "D:\\Backup",
  filename: "clip-copy.mp4",
  basename: "clip-copy",
  sizeBytes: 4096,
  isFavorite: false
};

const groups: DuplicateGroup[] = [
  {
    groupKey: "fp-1",
    identityStatus: "size_duration_match",
    recommendedKeepVideoId: video.id,
    reclaimableBytes: duplicateVideo.sizeBytes,
    items: [
      { video, isRecommendedToKeep: true, keepReason: "已收藏" },
      { video: duplicateVideo, isRecommendedToKeep: false, keepReason: null }
    ]
  }
];

describe("DuplicateGroupsPage", () => {
  it("renders duplicate groups and summary counts", () => {
    render(
      <DuplicateGroupsPage
        groups={groups}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={vi.fn().mockResolvedValue({
          groupCount: 1,
          keepCount: 1,
          deleteCount: 1,
          reclaimableBytes: duplicateVideo.sizeBytes
        })}
        onResolve={vi.fn().mockResolvedValue({
          groupCount: 1,
          keepCount: 1,
          successCount: 1,
          failureCount: 0,
          reclaimedBytes: duplicateVideo.sizeBytes,
          failures: []
        })}
      />
    );

    expect(screen.getByText("重复组 01")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("clip-copy.mp4")).toBeInTheDocument();
    expect(screen.getByText("大小＋时长匹配组")).toBeInTheDocument();
    expect(screen.getByText(/不读取视频内容、不计算指纹/)).toBeInTheDocument();
  });

  it("resolves duplicates after a single confirmation click", async () => {
    const onPreviewResolve = vi.fn().mockResolvedValue({
      groupCount: 1,
      keepCount: 1,
      deleteCount: 1,
      reclaimableBytes: duplicateVideo.sizeBytes
    });
    const onResolve = vi.fn().mockResolvedValue({
      groupCount: 1,
      keepCount: 1,
      successCount: 1,
      failureCount: 0,
      reclaimedBytes: duplicateVideo.sizeBytes,
      failures: []
    });

    render(
      <DuplicateGroupsPage
        groups={groups}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={onPreviewResolve}
        onResolve={onResolve}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "清理当前页" }));

    await waitFor(() => expect(onPreviewResolve).toHaveBeenCalledOnce());
    expect(screen.getByText(/未读取或比较视频内容/)).toBeInTheDocument();
    expect(screen.getByText("文件将从磁盘永久删除且无法撤销，请确认保留项选择无误。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(onResolve).toHaveBeenCalledOnce());
    expect(screen.getByText(/成功删除 1 个文件/)).toBeInTheDocument();
  });

  it("sorts duplicate files by size in both directions", () => {
    const { container } = render(
      <DuplicateGroupsPage
        groups={groups}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    const filenames = () => [...container.querySelectorAll(".duplicate-item-heading strong")].map((element) => element.textContent);
    expect(filenames()).toEqual(["clip-copy.mp4", "clip.mp4"]);

    fireEvent.change(screen.getByLabelText("重复项大小排序"), { target: { value: "asc" } });
    expect(filenames()).toEqual(["clip.mp4", "clip-copy.mp4"]);
  });

  it("confirms and manually deletes a single duplicate video", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <DuplicateGroupsPage
        groups={groups}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onDelete={onDelete}
        onPreviewResolve={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "手动删除 clip-copy.mp4" }));
    expect(screen.getByRole("alertdialog", { name: "永久删除这个重复视频？" })).toBeInTheDocument();
    expect(screen.getAllByText("D:\\Backup\\clip.mp4")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(duplicateVideo));
  });

  it("renders global counts and delegates page navigation", () => {
    const onPage = vi.fn();
    const onPageSize = vi.fn();
    render(
      <DuplicateGroupsPage
        groups={groups}
        page={2}
        pageSize={20}
        totalPages={4}
        totalGroups={63}
        totalCandidateGroups={70}
        totalCandidateFiles={150}
        totalReclaimableBytes={1024 * 1024}
        onPage={onPage}
        onPageSize={onPageSize}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    expect(screen.getByText("63")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("重复组 21")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByLabelText("重复项每页数量"), { target: { value: "500" } });
    expect(onPageSize).toHaveBeenCalledWith(500);
  });

  it("selects a directory as the preferred duplicate keep location", async () => {
    const onPreferredDirectoryPathChange = vi.fn();
    const onPreferredDirectoryScopeChange = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({ groupCount: 1, keepCount: 1, deleteCount: 1, reclaimableBytes: duplicateVideo.sizeBytes });
    render(
      <DuplicateGroupsPage
        groups={groups}
        directoryOptions={[
          { path: "D:\\Movies", groupCount: 1, estimatedReclaimableBytes: 1024 },
          { path: "D:\\Backup", groupCount: 1, estimatedReclaimableBytes: 1024 }
        ]}
        preferredDirectoryPath="D:\\Movies"
        preferredDirectoryScope="recursive"
        onPreferredDirectoryPathChange={onPreferredDirectoryPathChange}
        onPreferredDirectoryScopeChange={onPreferredDirectoryScopeChange}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={onPreviewResolve}
        onResolve={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText("选择重复项优先保留目录"));
    fireEvent.click(screen.getByRole("option", { name: /Backup/ }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("D:\\Backup");
    fireEvent.change(screen.getByLabelText("重复项目录范围"), { target: { value: "exact" } });
    expect(onPreferredDirectoryScopeChange).toHaveBeenCalledWith("exact");
    fireEvent.click(screen.getByRole("button", { name: "清理当前页" }));
    await waitFor(() => expect(screen.getByText(/每个重复组会优先保留/)).toBeInTheDocument());
  });

  it("returns to all duplicate groups when a directory filter has no results", () => {
    const onPreferredDirectoryPathChange = vi.fn();
    render(
      <DuplicateGroupsPage
        groups={[]}
        preferredDirectoryPath="D:\\NoDuplicates"
        onPreferredDirectoryPathChange={onPreferredDirectoryPathChange}
        onOpen={vi.fn()}
        onViewDetails={vi.fn()}
        onPreviewResolve={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "返回全部重复项" }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("");
  });
});
