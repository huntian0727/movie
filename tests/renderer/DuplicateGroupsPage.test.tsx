import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateGroupsPage } from "../../src/renderer/components/DuplicateGroupsPage";
import type { DuplicateGroup, DuplicateResolveResult, VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "keep", sourceFolderId: "f1", path: "D:\\Movies\\clip.mp4", directory: "D:\\Movies", filename: "clip.mp4",
  basename: "clip", extension: ".mp4", sizeBytes: 1024, durationMs: 90000, width: 1920, height: 1080, format: "mp4",
  videoCodec: null, videoProfile: null, pixelFormat: null, audioCodec: null, codecProbeStatus: "ready",
  modifiedAt: "2026-07-09T00:00:00.000Z", importedAt: "2026-07-09T00:00:00.000Z", updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: true, isPendingDelete: false, isMissing: false, metadataStatus: "ready", thumbnailStatus: "ready",
  timelinePreviewStatus: "ready", coverCachePath: null, contentFingerprint: "fp-1", fingerprintStatus: "ready",
  fingerprintUpdatedAt: "2026-07-09T00:00:00.000Z", fingerprintError: null
};
const duplicateVideo: VideoRecord = { ...video, id: "delete", path: "D:\\Backup\\clip.mp4", directory: "D:\\Backup", filename: "clip-copy.mp4", basename: "clip-copy", sizeBytes: 4096, isFavorite: false };
const groups: DuplicateGroup[] = [{
  groupKey: "fp-1", identityStatus: "size_duration_match", recommendedKeepVideoId: video.id,
  reclaimableBytes: duplicateVideo.sizeBytes,
  items: [{ video, isRecommendedToKeep: true, keepReason: "已收藏" }, { video: duplicateVideo, isRecommendedToKeep: false, keepReason: null }]
}];

function baseProps() {
  return { groups, onOpen: vi.fn(), onViewDetails: vi.fn() };
}

function taskCenterProps() {
  return {
    onLoadCleanupJobs: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1, activeCount: 0 }),
    onLoadCleanupItems: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }),
    onCancelCleanup: vi.fn(), onResumeCleanup: vi.fn(), onRetryCleanup: vi.fn(), onClearCleanup: vi.fn()
  };
}

describe("DuplicateGroupsPage staged safety flow", () => {
  it("keeps candidate browsing metadata-only and explains immediate fast deletion", () => {
    const { container } = render(<DuplicateGroupsPage {...baseProps()} />);
    expect(screen.getByText("候选组 01")).toBeInTheDocument();
    expect(screen.getByText("clip-copy.mp4")).toBeInTheDocument();
    expect(screen.getByText(/快速删除按数据库/)).toHaveTextContent(/不计算 SHA-256，也不再二次确认/);
    expect(container).toHaveTextContent(/计划保留/);
    expect(container).toHaveTextContent(/候选移除/);
    expect(container).toHaveTextContent(/候选可释放空间/);
    expect(container.textContent).not.toMatch(/重复组|拟删除|待删除|预计可释放|待删文件/);
  });

  it("fast-deletes every candidate removal item immediately without opening a confirmation", async () => {
    const onFastDelete = vi.fn().mockResolvedValue({
      groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0, reclaimedBytes: 4096, failures: []
    });
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectoryPath="D:\\Movies" onFastDelete={onFastDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "一键永久删除候选移除项（1）" }));

    await waitFor(() => expect(onFastDelete).toHaveBeenCalledOnce());
    expect(onFastDelete).toHaveBeenCalledWith({
      groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }]
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "批量清理结果" })).toHaveTextContent(/成功删除 1 个文件/);
  });

  it("starts only full verification after an explicit preflight and does not claim deletion", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    const opener = screen.getByRole("button", { name: "验证当前页" });
    expect(opener).not.toHaveClass("danger");
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "开始完整内容验证？" });
    expect(dialog).toHaveTextContent(/完整读取每个计划保留文件和候选移除文件/);
    expect(dialog).not.toHaveTextContent(/待删文件|待删除|拟删除/);
    expect(dialog).toHaveTextContent(/仍需单独的第二次永久删除确认/);
    fireEvent.click(screen.getByRole("button", { name: "开始完整验证" }));
    await waitFor(() => expect(onSubmitCleanup).toHaveBeenCalledOnce());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/验证阶段不会删除文件/);
    expect(status).toHaveTextContent(/候选移除文件/);
    expect(status).not.toHaveTextContent(/待删文件|待删除|拟删除/);
  });

  it("cancels the verification preflight with Escape and restores focus without submitting", async () => {
    const onSubmitCleanup = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    const opener = screen.getByRole("button", { name: "验证当前页" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "开始完整内容验证？" });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "开始完整内容验证？" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(onSubmitCleanup).not.toHaveBeenCalled();
  });

  it("submits the currently selected keep file in the verification plan", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 1024 });
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getAllByRole("button", { name: "设为计划保留" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "验证当前页" }));
    fireEvent.click(screen.getByRole("button", { name: "开始完整验证" }));
    await waitFor(() => expect(onSubmitCleanup).toHaveBeenCalledOnce());
    expect(onSubmitCleanup.mock.calls[0][1]).toEqual({ groups: [{ groupKey: "fp-1", keepVideoId: "delete", deleteVideoIds: ["keep"] }] });
  });

  it("does not expose the former single-item permanent-delete control", () => {
    render(<DuplicateGroupsPage {...baseProps()} />);
    expect(screen.queryByRole("button", { name: /手动删除/ })).not.toBeInTheDocument();
  });

  it("does not expose the retired direct resolve fallback", () => {
    render(<DuplicateGroupsPage {...baseProps()} onPreviewResolve={vi.fn()} onResolve={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "清理当前页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认删除/ })).not.toBeInTheDocument();
  });

  it("sorts duplicate files by size in both directions", () => {
    const { container } = render(<DuplicateGroupsPage {...baseProps()} />);
    const filenames = () => [...container.querySelectorAll(".duplicate-item-heading strong")].map((element) => element.textContent);
    expect(filenames()).toEqual(["clip-copy.mp4", "clip.mp4"]);
    fireEvent.change(screen.getByLabelText("候选项大小排序"), { target: { value: "asc" } });
    expect(filenames()).toEqual(["clip.mp4", "clip-copy.mp4"]);
  });

  it("delegates pagination and directory filters", () => {
    const onPage = vi.fn(); const onPageSize = vi.fn(); const onPreferredDirectoryPathChange = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} page={2} pageSize={20} totalPages={4} totalGroups={63}
      directoryOptions={[{ path: "D:\\Backup", groupCount: 1, estimatedReclaimableBytes: 4096 }]}
      onPage={onPage} onPageSize={onPageSize} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByLabelText("候选项每页数量"), { target: { value: "500" } });
    expect(onPageSize).toHaveBeenCalledWith(500);
    fireEvent.click(screen.getByLabelText("选择候选项计划保留目录（包含所有子目录）"));
    fireEvent.click(screen.getByRole("option", { name: /Backup/ }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("D:\\Backup");
  });

  it("uses a candidate directory as the recursive preferred directory without starting verification", () => {
    const onPreferredDirectoryPathChange = vi.fn();
    const onSubmitCleanup = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} onSubmitCleanup={onSubmitCleanup} />);

    const shortcut = screen.getByRole("button", { name: "优先保留 D:\\Backup 及其所有子目录（来自 clip-copy.mp4）" });
    expect(shortcut).not.toHaveClass("danger");
    fireEvent.click(shortcut);

    expect(onPreferredDirectoryPathChange).toHaveBeenCalledOnce();
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("D:\\Backup");
    expect(onSubmitCleanup).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("候选项目录范围")).not.toBeInTheDocument();
  });

  it("shows the full recursive preferred path and clears it directly", () => {
    const onPreferredDirectoryPathChange = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectoryPath={"D:\\Movies\\Archive"} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} />);

    expect(screen.getByRole("status")).toHaveTextContent("D:\\Movies\\Archive");
    expect(screen.getByRole("status")).toHaveTextContent("所有子目录");
    fireEvent.click(screen.getByRole("button", { name: "清除优先目录" }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("");
  });

  it("preserves an explicit per-group keep choice when directory recommendations reload", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 1024 });
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getAllByRole("button", { name: "设为计划保留" })[1]);

    rerender(<DuplicateGroupsPage {...baseProps()} groups={[{ ...groups[0], recommendedKeepVideoId: "delete", items: [...groups[0].items] }]} preferredDirectoryPath="D:\\Backup" onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getByRole("button", { name: "验证当前页" }));
    fireEvent.click(screen.getByRole("button", { name: "开始完整验证" }));

    await waitFor(() => expect(onSubmitCleanup).toHaveBeenCalledOnce());
    expect(onSubmitCleanup.mock.calls[0][1]).toEqual({ groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }] });
  });

  it("checks missing files without running full hashes or deletion", async () => {
    const onRefresh = vi.fn();
    const onCheckMissing = vi.fn().mockResolvedValue({ checkedFileCount: 2, removedCount: 1, changedCount: 0 });
    render(<DuplicateGroupsPage {...baseProps()} onRefresh={onRefresh} onCheckMissing={onCheckMissing} />);
    fireEvent.click(screen.getByRole("button", { name: "检查缺失文件" }));
    await waitFor(() => expect(onCheckMissing).toHaveBeenCalledOnce());
    expect(screen.getByText(/已从列表移除 1 个已删除文件/)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("returns to all groups when a directory filter has no results", () => {
    const onPreferredDirectoryPathChange = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} groups={[]} preferredDirectoryPath="D:\\None" onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} />);
    fireEvent.click(screen.getByRole("button", { name: "返回全部候选项" }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("");
  });

  it("does not offer verification when there are no candidate groups", () => {
    render(<DuplicateGroupsPage {...baseProps()} groups={[]} onSubmitCleanup={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "验证当前页" })).not.toBeInTheDocument();
  });

  it("reports when a missing-file check finds no missing or changed files", async () => {
    const onCheckMissing = vi.fn().mockResolvedValue({ checkedFileCount: 2, removedCount: 0, changedCount: 0 });
    render(<DuplicateGroupsPage {...baseProps()} onCheckMissing={onCheckMissing} />);
    fireEvent.click(screen.getByRole("button", { name: "检查缺失文件" }));
    expect(await screen.findByRole("status")).toHaveTextContent("未发现缺失文件（共复查 2 个）");
  });

  it("surfaces missing-check errors without removing the retry control", async () => {
    const onCheckMissing = vi.fn().mockRejectedValue(new Error("mapped drive offline"));
    render(<DuplicateGroupsPage {...baseProps()} onCheckMissing={onCheckMissing} />);
    fireEvent.click(screen.getByRole("button", { name: "检查缺失文件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/mapped drive offline/);
    expect(screen.getByRole("button", { name: "检查缺失文件" })).toBeEnabled();
  });

  it("delegates play and detail actions for the selected duplicate item", () => {
    const onOpen = vi.fn();
    const onViewDetails = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onOpen={onOpen} onViewDetails={onViewDetails} />);
    fireEvent.click(screen.getByRole("button", { name: "播放 clip-copy.mp4" }));
    expect(onOpen).toHaveBeenCalledWith(duplicateVideo, [duplicateVideo, video]);
    fireEvent.click(screen.getByRole("button", { name: "查看 clip-copy.mp4 详情" }));
    expect(onViewDetails).toHaveBeenCalledWith(duplicateVideo);
  });

  it("restores focus to the exact task-center opener after Escape, header close, and backdrop close", async () => {
    const { container } = render(<DuplicateGroupsPage {...baseProps()} {...taskCenterProps()} />);
    const opener = screen.getByRole("button", { name: /后台任务 0/ });

    for (const closeBy of ["escape", "button", "backdrop"] as const) {
      opener.focus();
      fireEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "候选文件安全任务" });
      if (closeBy === "escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else if (closeBy === "button") fireEvent.click(screen.getByRole("button", { name: "关闭任务中心" }));
      else fireEvent.mouseDown(container.querySelector(".task-center-backdrop")!);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "候选文件安全任务" })).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    }
  });

  it("keeps the isolated task-center DOM complete at a 900px fixture width", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const { container } = render(<DuplicateGroupsPage {...baseProps()} {...taskCenterProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /后台任务 0/ }));
    const dialog = await screen.findByRole("dialog", { name: "候选文件安全任务" });
    expect(dialog).toHaveClass("duplicate-task-center");
    const layout = container.querySelector(".duplicate-task-layout")!;
    expect(layout.children).toHaveLength(2);
    expect(layout.querySelector(".duplicate-task-list")).toBeInTheDocument();
    expect(layout.querySelector(".duplicate-task-detail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭任务中心" })).toBeVisible();
  });

  describe("per-file delete button", () => {
    it("does not render the per-file delete button when onFastDelete is absent", () => {
      render(<DuplicateGroupsPage {...baseProps()} />);
      expect(screen.queryByRole("button", { name: "永久删除 clip.mp4" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "永久删除 clip-copy.mp4" })).not.toBeInTheDocument();
    });

    it("opens a confirmation dialog showing the file name and path when the trash icon is clicked", () => {
      render(<DuplicateGroupsPage {...baseProps()} onFastDelete={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "永久删除 clip-copy.mp4" }));
      const dialog = screen.getByRole("alertdialog", { name: "永久删除此文件？" });
      expect(dialog).toHaveTextContent("clip-copy.mp4");
      expect(dialog).toHaveTextContent("D:\\Backup\\clip.mp4");
      expect(dialog).toHaveTextContent("4 KB");
      expect(dialog).toHaveTextContent(/永久删除.*无法撤销/);
    });

    it("deletes the clicked non-keep file with a single-file plan when confirmed", async () => {
      const onFastDelete = vi.fn().mockResolvedValue({
        groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0, reclaimedBytes: 4096, failures: []
      });
      render(<DuplicateGroupsPage {...baseProps()} onFastDelete={onFastDelete} />);

      fireEvent.click(screen.getByRole("button", { name: "永久删除 clip-copy.mp4" }));
      fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

      await waitFor(() => expect(onFastDelete).toHaveBeenCalledOnce());
      expect(onFastDelete).toHaveBeenCalledWith({
        groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }]
      });
      expect(screen.queryByRole("alertdialog", { name: "永久删除此文件？" })).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "批量清理结果" })).toHaveTextContent(/成功删除 1 个文件/);
    });

    it("auto-selects another file as keep when deleting the current keep file", async () => {
      const onFastDelete = vi.fn().mockResolvedValue({
        groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0, reclaimedBytes: 1024, failures: []
      });
      render(<DuplicateGroupsPage {...baseProps()} onFastDelete={onFastDelete} />);

      // clip.mp4 (id "keep") is the current recommended keep; delete it
      fireEvent.click(screen.getByRole("button", { name: "永久删除 clip.mp4" }));
      fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

      await waitFor(() => expect(onFastDelete).toHaveBeenCalledOnce());
      expect(onFastDelete).toHaveBeenCalledWith({
        groups: [{ groupKey: "fp-1", keepVideoId: "delete", deleteVideoIds: ["keep"] }]
      });
    });

    it("cancels the confirmation dialog without calling onFastDelete", () => {
      const onFastDelete = vi.fn();
      render(<DuplicateGroupsPage {...baseProps()} onFastDelete={onFastDelete} />);
      fireEvent.click(screen.getByRole("button", { name: "永久删除 clip-copy.mp4" }));
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByRole("alertdialog", { name: "永久删除此文件？" })).not.toBeInTheDocument();
      expect(onFastDelete).not.toHaveBeenCalled();
    });

    it("does not render per-file delete buttons in a single-item group", () => {
      const singleItemGroups: DuplicateGroup[] = [{
        groupKey: "fp-solo", identityStatus: "size_duration_match", recommendedKeepVideoId: video.id,
        reclaimableBytes: 0,
        items: [{ video, isRecommendedToKeep: true, keepReason: "已收藏" }]
      }];
      render(<DuplicateGroupsPage {...baseProps()} groups={singleItemGroups} onFastDelete={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "永久删除 clip.mp4" })).not.toBeInTheDocument();
    });

    it("disables the per-file delete button while another action is pending", async () => {
      const result: DuplicateResolveResult = {
        groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0, reclaimedBytes: 4096, failures: []
      };
      const onFastDelete = vi.fn(
        () => new Promise<DuplicateResolveResult>((resolve) => setTimeout(() => resolve(result), 50))
      );
      render(<DuplicateGroupsPage {...baseProps()} onFastDelete={onFastDelete} />);

      fireEvent.click(screen.getByRole("button", { name: "永久删除 clip-copy.mp4" }));
      fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

      // While the promise is pending the other per-file delete button should be disabled
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "永久删除 clip.mp4" })).toBeDisabled();
      });

      await waitFor(() => expect(onFastDelete).toHaveBeenCalledOnce());
    });
  });
});
