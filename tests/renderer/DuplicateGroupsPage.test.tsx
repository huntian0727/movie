import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DuplicateGroupsPage } from "../../src/renderer/components/DuplicateGroupsPage";
import type { DuplicateCleanupJob, DuplicateGroup, VideoRecord } from "../../src/shared/videoTypes";

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
const preferredDirectory = {
  id: "preferred-1", path: "D:\\Movies", enabled: true,
  createdAt: "2026-07-09T00:00:00.000Z", updatedAt: "2026-07-09T00:00:00.000Z"
};

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

function cleanupJob(overrides: Partial<DuplicateCleanupJob> = {}): DuplicateCleanupJob {
  return {
    id: "job-1", requestId: "request-1", status: "running", sourceView: "duplicates-all-filtered",
    totalGroups: 1, totalItems: 1, processedItems: 0, successItems: 0, failedItems: 0, skippedItems: 0,
    plannedReclaimableBytes: 4096, reclaimedBytes: 0, createdAt: "2026-09-03T00:00:00.000Z",
    startedAt: "2026-09-03T00:00:01.000Z", completedAt: null, updatedAt: "2026-09-03T00:00:01.000Z", errorSummary: null,
    workflowVersion: 3, phase: "deletion", verificationRevision: null, verificationProcessedItems: 0,
    identicalItems: 0, differentItems: 0, unverifiableItems: 0, verificationCompletedAt: null,
    authorizedRevision: null, authorizedAt: null, ...overrides
  };
}

describe("DuplicateGroupsPage staged safety flow", () => {
  it("keeps candidate browsing metadata-only and explains verified one-click deletion", () => {
    const { container } = render(<DuplicateGroupsPage {...baseProps()} />);
    expect(screen.getByText("候选组 01")).toBeInTheDocument();
    expect(screen.getByText("clip-copy.mp4")).toBeInTheDocument();
    expect(screen.getByText(/候选发现只使用精确文件大小/)).toHaveTextContent(/不计算 SHA-256/);
    expect(container).toHaveTextContent(/计划保留/);
    expect(container).toHaveTextContent(/候选移除/);
    expect(container).toHaveTextContent(/候选可释放空间/);
    expect(container.textContent).not.toMatch(/重复组|拟删除|待删除|预计可释放|待删文件/);
  });

  it("submits every candidate removal item for verified automatic deletion without a confirmation dialog", async () => {
    const onAutoDelete = vi.fn().mockResolvedValue({ jobId: "job-1", requestId: "request-1", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectories={[preferredDirectory]} onAutoDelete={onAutoDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "批量删除候选项（1）" }));

    await waitFor(() => expect(onAutoDelete).toHaveBeenCalledOnce());
    expect(onAutoDelete).toHaveBeenCalledWith({
      groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }]
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(/批量清理：已启动 CloudDrive API批量删除任务/)).toBeInTheDocument();
  });

  it("clears the submitted cleanup banner as soon as that background job finishes", async () => {
    const runningJob = cleanupJob();
    const completedJob = cleanupJob({
      status: "completed", phase: "finished", processedItems: 1, successItems: 1,
      reclaimedBytes: 4096, completedAt: "2026-09-03T00:00:02.000Z", updatedAt: "2026-09-03T00:00:02.000Z"
    });
    const onLoadCleanupJobs = vi.fn()
      .mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1, activeCount: 0 })
      .mockResolvedValueOnce({ items: [runningJob], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, activeCount: 1 })
      .mockResolvedValue({ items: [completedJob], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, activeCount: 0 });
    const onAutoDeleteFiltered = vi.fn().mockResolvedValue({
      jobId: "job-1", requestId: "request-1", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096
    });
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} onLoadCleanupJobs={onLoadCleanupJobs} cleanupRefreshSequence={1} />);

    fireEvent.click(screen.getByRole("button", { name: /批量删除全部筛选结果/ }));
    expect(await screen.findByText(/已对全部筛选结果启动 CloudDrive API 批量删除任务/)).toBeInTheDocument();
    await waitFor(() => expect(onLoadCleanupJobs).toHaveBeenCalledTimes(2));

    rerender(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} onLoadCleanupJobs={onLoadCleanupJobs} cleanupRefreshSequence={2} />);

    await waitFor(() => expect(screen.queryByText(/已对全部筛选结果启动 CloudDrive API 批量删除任务/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /后台任务 0/ })).toBeInTheDocument();
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

  it("submits one candidate for verified automatic deletion", async () => {
    const onAutoDelete = vi.fn().mockResolvedValue({ jobId: "job-2", requestId: "request-2", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    render(<DuplicateGroupsPage {...baseProps()} onAutoDelete={onAutoDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "验证并永久删除 clip-copy.mp4" }));
    await waitFor(() => expect(onAutoDelete).toHaveBeenCalledWith({ groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }] }));
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

  it("shows the active directory filter separately and clears it directly", () => {
    const onClearDirectoryFilter = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} filterDirectoryPath={"D:\\Movies\\Archive"} overallTotalGroups={41} onClearDirectoryFilter={onClearDirectoryFilter} />);

    expect(screen.getByRole("status")).toHaveTextContent("D:\\Movies\\Archive");
    expect(screen.getByRole("status")).toHaveTextContent("所有子目录");
    fireEvent.click(screen.getByRole("button", { name: "显示全部 41 组" }));
    expect(onClearDirectoryFilter).toHaveBeenCalledOnce();
  });

  it("preserves an explicit per-group keep choice when directory recommendations reload", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 1024 });
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getAllByRole("button", { name: "设为计划保留" })[1]);

    rerender(<DuplicateGroupsPage {...baseProps()} groups={[{ ...groups[0], recommendedKeepVideoId: "delete", items: [...groups[0].items] }]} preferredDirectories={[{ ...preferredDirectory, path: "D:\\Backup" }]} onSubmitCleanup={onSubmitCleanup} />);
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

  it("quickly binds legacy duplicate candidates through CloudDrive metadata only", async () => {
    const onRefresh = vi.fn();
    const onBindLegacyCloudDrive = vi.fn().mockResolvedValue({
      sourceFolderCount: 1,
      boundSourceFolderCount: 1,
      unmappedSourceFolderCount: 0,
      unmappedCandidateFileCount: 0,
      scannedDirectoryCount: 1,
      failedDirectoryCount: 0,
      candidateFileCount: 2,
      matchedFileCount: 2,
      missingFileCount: 0,
      sizeMismatchFileCount: 0,
      ambiguousFileCount: 0,
      cancelled: false,
      errors: []
    });
    render(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={0} totalUnboundDeletionCandidateFiles={1}
      onRefresh={onRefresh} onBindLegacyCloudDrive={onBindLegacyCloudDrive} />);

    fireEvent.click(screen.getByRole("button", { name: /快速绑定旧资料库/ }));

    await waitFor(() => expect(onBindLegacyCloudDrive).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("已绑定 2 个重复候选");
    expect(screen.getByRole("status")).toHaveTextContent("未读取任何视频内容");
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps same-directory API duplicates deletable when that directory is preferred", () => {
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectories={[preferredDirectory]}
      totalReclaimableBytes={4096} totalDeletableFiles={1}
      totalUnboundDeletionCandidateFiles={0} onAutoDeleteFiltered={vi.fn()} onBindLegacyCloudDrive={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /快速绑定旧资料库/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /批量删除全部筛选结果/ })).toBeEnabled();
    expect(screen.queryByText(/批量删除暂不可用/)).not.toBeInTheDocument();
  });

  it("keeps filtered deletion enabled when the backend reports deletable API files", () => {
    render(<DuplicateGroupsPage {...baseProps()} totalReclaimableBytes={0} totalDeletableFiles={1}
      totalUnboundDeletionCandidateFiles={0} onAutoDeleteFiltered={vi.fn()} onBindLegacyCloudDrive={vi.fn()} />);

    expect(screen.getByRole("button", { name: /批量删除全部筛选结果/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /快速绑定旧资料库/ })).not.toBeInTheDocument();
  });

  it("shows live legacy-binding progress and allows cancellation", async () => {
    const running = {
      state: "running" as const,
      totalDirectoryCount: 3208,
      processedDirectoryCount: 640,
      scannedDirectoryCount: 639,
      failedDirectoryCount: 1,
      candidateFileCount: 31559,
      matchedFileCount: 6100,
      missingFileCount: 20,
      sizeMismatchFileCount: 2,
      ambiguousFileCount: 0,
      currentConcurrency: 24,
      elapsedMs: 10_000,
      directoriesPerSecond: 64,
      estimatedRemainingMs: 40_125,
      errorMessage: null
    };
    const onGetLegacyCloudDriveBindingStatus = vi.fn().mockResolvedValue(running);
    const onCancelLegacyCloudDriveBinding = vi.fn().mockResolvedValue({ ...running, state: "cancelling" as const });

    render(<DuplicateGroupsPage
      {...baseProps()}
      onBindLegacyCloudDrive={vi.fn()}
      onGetLegacyCloudDriveBindingStatus={onGetLegacyCloudDriveBindingStatus}
      onCancelLegacyCloudDriveBinding={onCancelLegacyCloudDriveBinding}
    />);

    expect(await screen.findByText("640 / 3,208 个目录")).toBeInTheDocument();
    expect(screen.getByText(/64.0 目录\/秒 · 并发 24/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消绑定" }));
    await waitFor(() => expect(onCancelLegacyCloudDriveBinding).toHaveBeenCalledOnce());
  });

  it("returns to all groups when a directory filter has no results", () => {
    const onClearDirectoryFilter = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} groups={[]} totalGroups={0} overallTotalGroups={2035} filterDirectoryPath="D:\\None" onClearDirectoryFilter={onClearDirectoryFilter} />);
    fireEvent.click(screen.getByRole("button", { name: "显示全部 2035 组重复项" }));
    expect(onClearDirectoryFilter).toHaveBeenCalledOnce();
  });

  it("keeps preferred-directory management visible in an empty result state", () => {
    const onRemovePreferredDirectory = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} groups={[]} totalGroups={0} overallTotalGroups={2035}
      preferredDirectories={[preferredDirectory]} onRemovePreferredDirectory={onRemovePreferredDirectory} />);

    expect(screen.getByText("当前无匹配")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除优先保留目录 D:\\Movies" }));
    expect(onRemovePreferredDirectory).toHaveBeenCalledWith("preferred-1");
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
      const dialog = await screen.findByRole("dialog", { name: "重复文件清理任务" });
      if (closeBy === "escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else if (closeBy === "button") fireEvent.click(screen.getByRole("button", { name: "关闭任务中心" }));
      else fireEvent.mouseDown(container.querySelector(".task-center-backdrop")!);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "重复文件清理任务" })).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    }
  });

  it("keeps the isolated task-center DOM complete at a 900px fixture width", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const { container } = render(<DuplicateGroupsPage {...baseProps()} {...taskCenterProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /后台任务 0/ }));
    const dialog = await screen.findByRole("dialog", { name: "重复文件清理任务" });
    expect(dialog).toHaveClass("duplicate-task-center");
    const layout = container.querySelector(".duplicate-task-layout")!;
    expect(layout.children).toHaveLength(2);
    expect(layout.querySelector(".duplicate-task-list")).toBeInTheDocument();
    expect(layout.querySelector(".duplicate-task-detail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭任务中心" })).toBeVisible();
  });
});
