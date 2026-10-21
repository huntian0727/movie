import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DuplicateGroupsPage } from "../../src/renderer/components/DuplicateGroupsPage";
import type { DuplicateCleanupJob, DuplicateGroup, DuplicateResolvePlan, VideoRecord } from "../../src/shared/videoTypes";

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

afterEach(() => vi.unstubAllGlobals());

describe("DuplicateGroupsPage staged safety flow", () => {
  it("shows loading instead of an empty conclusion, and read retry never submits deletion", () => {
    const onRefresh = vi.fn(); const onAutoDeleteFiltered = vi.fn();
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} groups={[]} loading onRefresh={onRefresh} onAutoDeleteFiltered={onAutoDeleteFiltered} />);
    expect(screen.getByText("正在整理候选项...")).toBeInTheDocument();
    expect(screen.queryByText("暂时没有同大小文件")).not.toBeInTheDocument();
    rerender(<DuplicateGroupsPage {...baseProps()} groups={[]} loadError="worker unavailable" onRefresh={onRefresh} onAutoDeleteFiltered={onAutoDeleteFiltered} />);
    expect(screen.getByRole("alert")).toHaveTextContent("worker unavailable");
    expect(screen.queryByText("暂时没有同大小文件")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(onRefresh).toHaveBeenCalledOnce(); expect(onAutoDeleteFiltered).not.toHaveBeenCalled();
  });

  it("keeps action errors visible even after all groups leave the page", async () => {
    const onAutoDelete = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'duplicate:submit': Error: CloudDrive unavailable"));
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} onAutoDelete={onAutoDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /批量删除当前页/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CloudDrive unavailable");
    rerender(<DuplicateGroupsPage {...baseProps()} groups={[]} onAutoDelete={onAutoDelete} />);
    expect(screen.getByRole("alert")).toHaveTextContent("CloudDrive unavailable");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Error invoking remote method");
  });

  it("reports preferred-directory persistence failures rather than silently ignoring them", async () => {
    const onPreferredDirectoryPathChange = vi.fn().mockRejectedValue(new Error("cannot save preference"));
    render(<DuplicateGroupsPage {...baseProps()} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} />);
    fireEvent.click(screen.getByRole("button", { name: /优先保留 D:\\Movies 及其所有子目录/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot save preference");
  });

  it("prevents cleanup of stale displayed groups while a new query is loading", () => {
    const onAutoDelete = vi.fn(); const onAutoDeleteFiltered = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} loading onAutoDelete={onAutoDelete} onAutoDeleteFiltered={onAutoDeleteFiltered} onPreviewResolve={vi.fn()} onManualDelete={vi.fn()} onManualBatchDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /批量删除当前页/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /批量删除全部筛选结果/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除 clip-copy.mp4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /清理当前页（1 个文件）/ })).toBeDisabled();
  });

  it("reads the submitted job by identity even when it leaves the first task page", async () => {
    const failedJob = cleanupJob({ status: "completed_with_errors", phase: "finished", failedItems: 1 });
    const onGetCleanupJob = vi.fn().mockResolvedValue(failedJob);
    const onAutoDeleteFiltered = vi.fn().mockResolvedValue({ jobId: failedJob.id, reused: false });
    render(<DuplicateGroupsPage {...baseProps()} {...taskCenterProps()} onAutoDeleteFiltered={onAutoDeleteFiltered} onGetCleanupJob={onGetCleanupJob} />);
    fireEvent.click(screen.getByRole("button", { name: /批量删除全部筛选结果/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("失败 1 项");
    expect(onGetCleanupJob).toHaveBeenCalledWith(failedJob.id);
    expect(screen.queryByText(/已对全部筛选结果启动/)).not.toBeInTheDocument();
  });
  it("rerenders only the changed card when a group's planned keep item changes", () => {
    const otherKeep = { ...video, id: "other-keep", get filename() { return "untouched-keep.mp4"; } };
    const otherDelete = { ...duplicateVideo, id: "other-delete", get filename() { return "untouched-delete.mp4"; } };
    const keepName = vi.spyOn(otherKeep, "filename", "get");
    const deleteName = vi.spyOn(otherDelete, "filename", "get");
    const otherGroup: DuplicateGroup = { ...groups[0], groupKey: "other-group", recommendedKeepVideoId: otherKeep.id,
      items: [{ ...groups[0].items[0], video: otherKeep }, { ...groups[0].items[1], video: otherDelete }] };
    try {
      const { container } = render(<DuplicateGroupsPage {...baseProps()} groups={[...groups, otherGroup]} />);
      keepName.mockClear(); deleteName.mockClear();
      const firstCard = container.querySelector<HTMLElement>('[data-group-key="fp-1"]')!;
      const candidateRow = within(firstCard).getByText("clip-copy.mp4").closest(".duplicate-item")!;
      fireEvent.click(within(candidateRow as HTMLElement).getByRole("button", { name: "设为计划保留" }));
      expect(keepName).not.toHaveBeenCalled();
      expect(deleteName).not.toHaveBeenCalled();
    } finally { keepName.mockRestore(); deleteName.mockRestore(); }
  });

  it("mounts only nearby large-page cards while the cleanup plan still covers every group", async () => {
    let notifyVisibility: IntersectionObserverCallback | undefined;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { notifyVisibility = callback; }
      observe() { /* controlled by this test */ }
      disconnect() { /* controlled by this test */ }
      unobserve() { /* controlled by this test */ }
    });
    const pageGroups = Array.from({ length: 100 }, (_, index) => ({
      ...groups[0],
      groupKey: `large-group-${index}`,
      recommendedKeepVideoId: `keep-${index}`,
      items: [
        { ...groups[0].items[0], video: { ...video, id: `keep-${index}` } },
        { ...groups[0].items[1], video: { ...duplicateVideo, id: `delete-${index}` } }
      ]
    }));
    const onAutoDelete = vi.fn().mockResolvedValue({ jobId: "job-large", requestId: "request-large", status: "queued", totalGroups: 100, totalItems: 100, plannedReclaimableBytes: 409600 });
    const { container } = render(<DuplicateGroupsPage {...baseProps()} groups={pageGroups} pageSize={100} onAutoDelete={onAutoDelete} />);
    expect(container.querySelectorAll(".duplicate-group-slot")).toHaveLength(100);
    expect(container.querySelectorAll(".duplicate-group-card")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "批量删除当前页（100 组）" }));
    await waitFor(() => expect(onAutoDelete).toHaveBeenCalledOnce());
    expect(onAutoDelete.mock.calls[0][0].groups).toHaveLength(100);
    const distantSlot = container.querySelector<HTMLElement>('[data-group-key="large-group-90"]');
    expect(distantSlot).not.toBeNull();
    act(() => notifyVisibility?.([{ target: distantSlot!, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(distantSlot!.querySelector(".duplicate-group-card")).not.toBeNull();
    expect(container.querySelectorAll(".duplicate-group-card").length).toBeLessThan(100);
    act(() => notifyVisibility?.([{ target: distantSlot!, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(distantSlot!.querySelector(".duplicate-group-card")).toBeNull();
  });

  it("keeps the directory ranking collapsed by default and expands it on demand", () => {
    const onPreferredDirectoryPathChange = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange}
      directoryOptions={[{ path: "D:\\Ranked", groupCount: 2, estimatedCleanupFileCount: 3, estimatedReclaimableBytes: 4096 }]} />);

    expect(screen.getByRole("button", { name: "展开（1 个目录）" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("搜索排行目录")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从排行优先保留 D:\\Ranked" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开（1 个目录）" }));
    expect(screen.getByRole("button", { name: "收起（1 个目录）" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("搜索排行目录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "从排行优先保留 D:\\Ranked" }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("D:\\Ranked");
  });
  it("keeps candidate browsing metadata-only and explains size-duration review with confirmation", () => {
    const { container } = render(<DuplicateGroupsPage {...baseProps()} />);
    expect(screen.getByText("候选组 01")).toBeInTheDocument();
    expect(screen.getByText("clip-copy.mp4")).toBeInTheDocument();
    expect(screen.getByText(/候选按大小与整秒时长识别/)).toHaveTextContent(/不计算文件哈希/);
    expect(container).toHaveTextContent(/计划保留/);
    expect(container).toHaveTextContent(/共 2 份 · 计划保留 1 份 · 可删除 1 份/);
    expect(container).toHaveTextContent(/可释放/);
    expect(container.textContent).not.toMatch(/重复组|拟删除|待删除|预计可释放|待删文件/);
  });

  it("submits every candidate removal item for verified automatic deletion without a confirmation dialog", async () => {
    const onAutoDelete = vi.fn().mockResolvedValue({ jobId: "job-1", requestId: "request-1", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectories={[preferredDirectory]} onAutoDelete={onAutoDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "批量删除当前页（1 组）" }));

    await waitFor(() => expect(onAutoDelete).toHaveBeenCalledOnce());
    expect(onAutoDelete).toHaveBeenCalledWith({
      groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }]
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(/当前第 1 页清理：已启动 CloudDrive API批量删除任务/)).toBeInTheDocument();
  });

  it("submits exactly the duplicate groups displayed on the current page", async () => {
    const pageGroups = Array.from({ length: 20 }, (_, index) => ({
      ...groups[0],
      groupKey: `page-group-${index}`,
      recommendedKeepVideoId: `keep-${index}`,
      items: [
        { ...groups[0].items[0], video: { ...video, id: `keep-${index}`, path: `D:\\Movies\\keep-${index}.mp4`, filename: `keep-${index}.mp4` } },
        { ...groups[0].items[1], video: { ...duplicateVideo, id: `delete-${index}`, path: `D:\\Backup\\delete-${index}.mp4`, filename: `delete-${index}.mp4` } }
      ]
    }));
    const onAutoDelete = vi.fn().mockResolvedValue({ jobId: "job-page", requestId: "request-page", status: "queued", totalGroups: 20, totalItems: 20, plannedReclaimableBytes: 81920 });
    render(<DuplicateGroupsPage {...baseProps()} groups={pageGroups} page={3} pageSize={20} totalPages={8} totalGroups={153} onAutoDelete={onAutoDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "批量删除当前页（20 组）" }));

    await waitFor(() => expect(onAutoDelete).toHaveBeenCalledOnce());
    expect(onAutoDelete.mock.calls[0][0].groups).toHaveLength(20);
    expect(onAutoDelete.mock.calls[0][0].groups[0]).toEqual({
      groupKey: "page-group-0",
      keepVideoId: "keep-0",
      deleteVideoIds: ["delete-0"]
    });
    expect(screen.getByRole("status")).toHaveTextContent(/当前第 3 页清理/);
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
    const onCleanupFinished = vi.fn();
    const { rerender } = render(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} onLoadCleanupJobs={onLoadCleanupJobs} onCleanupFinished={onCleanupFinished} cleanupRefreshSequence={1} />);

    fireEvent.click(screen.getByRole("button", { name: /批量删除全部筛选结果/ }));
    expect(await screen.findByText(/已对全部筛选结果启动 CloudDrive API 批量删除任务/)).toBeInTheDocument();
    await waitFor(() => expect(onLoadCleanupJobs).toHaveBeenCalledTimes(2));

    rerender(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} onLoadCleanupJobs={onLoadCleanupJobs} onCleanupFinished={onCleanupFinished} cleanupRefreshSequence={2} />);

    await waitFor(() => expect(screen.queryByText(/已对全部筛选结果启动 CloudDrive API 批量删除任务/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /后台任务 0/ })).toBeInTheDocument();
    expect(onCleanupFinished).toHaveBeenCalledWith(completedJob);
  });

  it("hides submitted filtered candidates immediately and notifies the shell after acceptance", async () => {
    let accept!: (value: { jobId: string; requestId: string; status: "queued"; totalGroups: number; totalItems: number; plannedReclaimableBytes: number }) => void;
    const pending = new Promise<Parameters<typeof accept>[0]>((resolve) => { accept = resolve; });
    const onAutoDeleteFiltered = vi.fn(() => pending);
    const onFilteredCleanupAccepted = vi.fn();
    const { container } = render(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} onFilteredCleanupAccepted={onFilteredCleanupAccepted} />);

    fireEvent.click(container.querySelector("button.danger")!);

    expect(screen.queryByText("clip-copy.mp4")).not.toBeInTheDocument();
    expect(onFilteredCleanupAccepted).not.toHaveBeenCalled();
    accept({ jobId: "job-1", requestId: "request-1", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    await waitFor(() => expect(onFilteredCleanupAccepted).toHaveBeenCalledOnce());
  });

  it("restores optimistically hidden candidates when filtered task creation fails", async () => {
    const onAutoDeleteFiltered = vi.fn().mockRejectedValue(new Error("task creation failed"));
    const { container } = render(<DuplicateGroupsPage {...baseProps()} totalDeletableFiles={1}
      onAutoDeleteFiltered={onAutoDeleteFiltered} />);

    fireEvent.click(container.querySelector("button.danger")!);

    await waitFor(() => expect(screen.getByText("clip-copy.mp4")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("task creation failed");
  });

  it("starts only size-duration review after an explicit preflight and does not claim deletion", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 4096 });
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    const opener = screen.getByRole("button", { name: "验证当前页" });
    expect(opener).not.toHaveClass("danger");
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "开始核对大小与时长？" });
    expect(dialog).toHaveTextContent(/只核对数据库元数据及文件系统的大小、修改时间、路径和身份/);
    expect(dialog).not.toHaveTextContent(/待删文件|待删除|拟删除/);
    expect(dialog).toHaveTextContent(/单独进行第二次永久删除确认/);
    fireEvent.click(screen.getByRole("button", { name: "开始核对" }));
    await waitFor(() => expect(onSubmitCleanup).toHaveBeenCalledOnce());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/核对阶段.*不会删除文件/);
    expect(status).toHaveTextContent(/候选移除文件/);
    expect(status).not.toHaveTextContent(/待删文件|待删除|拟删除/);
  });

  it("cancels the verification preflight with Escape and restores focus without submitting", async () => {
    const onSubmitCleanup = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    const opener = screen.getByRole("button", { name: "验证当前页" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "开始核对大小与时长？" });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "开始核对大小与时长？" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(onSubmitCleanup).not.toHaveBeenCalled();
  });

  it("submits the currently selected keep file in the verification plan", async () => {
    const onSubmitCleanup = vi.fn().mockResolvedValue({ jobId: "j", requestId: "r", status: "queued", totalGroups: 1, totalItems: 1, plannedReclaimableBytes: 1024 });
    render(<DuplicateGroupsPage {...baseProps()} onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getAllByRole("button", { name: "设为计划保留" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "验证当前页" }));
    fireEvent.click(screen.getByRole("button", { name: "开始核对" }));
    await waitFor(() => expect(onSubmitCleanup).toHaveBeenCalledOnce());
    expect(onSubmitCleanup.mock.calls[0][1]).toEqual({ groups: [{ groupKey: "fp-1", keepVideoId: "delete", deleteVideoIds: ["keep"] }] });
  });

  it("restores one-confirmation manual single deletion with an automatic size-duration preflight", async () => {
    const onManualDelete = vi.fn().mockResolvedValue(undefined);
    const onSubmitCleanup = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1, reclaimableBytes: 4096, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} onManualDelete={onManualDelete} onPreviewResolve={onPreviewResolve} onSubmitCleanup={onSubmitCleanup} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 clip-copy.mp4" }));
    expect(screen.getByRole("alertdialog", { name: "确认删除这一个重复文件？" })).toHaveTextContent("clip-copy.mp4");
    expect(onManualDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除此文件" }));
    await waitFor(() => expect(onManualDelete).toHaveBeenCalledWith(duplicateVideo));
    expect(onPreviewResolve).toHaveBeenCalledWith({ groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }] });
    expect(onSubmitCleanup).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "确认删除这一个重复文件？" })).not.toBeInTheDocument();
  });

  it("can delete the planned keep file only while retaining a different copy", async () => {
    const onManualDelete = vi.fn().mockResolvedValue(undefined);
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1, reclaimableBytes: 1024, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} onManualDelete={onManualDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 clip.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除此文件" }));
    await waitFor(() => expect(onManualDelete).toHaveBeenCalledWith(video));
    expect(onPreviewResolve).toHaveBeenCalledWith({ groups: [{ groupKey: "fp-1", keepVideoId: "delete", deleteVideoIds: ["keep"] }] });
  });

  it("cleans only the displayed page after one confirmation and preserves the chosen keep item", async () => {
    const onManualBatchDelete = vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, reclaimedBytes: 1024, failures: [] });
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1, reclaimableBytes: 1024, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} page={3} totalPages={5} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getAllByRole("button", { name: "设为计划保留" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（1 个文件）" }));

    const confirmation = screen.getByRole("alertdialog", { name: "确认清理当前页重复文件？" });
    expect(confirmation).toHaveTextContent("当前第 3 页");
    expect(confirmation).toHaveTextContent("每组保留计划选中的一份");
    expect(onManualBatchDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认清理 1 个文件" }));
    await waitFor(() => expect(onManualBatchDelete).toHaveBeenCalledWith([video]));
    expect(onPreviewResolve).toHaveBeenCalledWith({ groups: [{ groupKey: "fp-1", keepVideoId: "delete", deleteVideoIds: ["keep"] }] });
    expect(await screen.findByRole("dialog", { name: "批量清理结果" })).toHaveTextContent("已确认删除 1 个文件");
  });

  it("uses the trusted duplicate-only reviewed IPC instead of ordinary video deletion", async () => {
    const onReviewedDelete = vi.fn().mockResolvedValue({
      groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0,
      reclaimedBytes: duplicateVideo.sizeBytes, failures: []
    });
    const onManualDelete = vi.fn();
    const onManualBatchDelete = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({
      status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1,
        reclaimableBytes: duplicateVideo.sizeBytes, verificationStatus: "file_versions_current" }
    });
    render(<DuplicateGroupsPage {...baseProps()} onReviewedDelete={onReviewedDelete}
      onManualDelete={onManualDelete} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 clip-copy.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除此文件" }));
    await waitFor(() => expect(onReviewedDelete).toHaveBeenCalledWith({
      groups: [{ groupKey: "fp-1", keepVideoId: "keep", deleteVideoIds: ["delete"] }]
    }));
    expect(onManualDelete).not.toHaveBeenCalled();
    expect(onManualBatchDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "确认删除这一个重复文件？" })).not.toBeInTheDocument();
  });

  it("stops after CloudDrive returns an uncertain remote outcome without replaying unknown files", async () => {
    const onReviewedDelete = vi.fn().mockResolvedValue({
      groupCount: 1, keepCount: 1, successCount: 0, failureCount: 0, reclaimedBytes: 0,
      failures: [], uncertainCount: 1, unsubmittedCount: 0,
      uncertainMessage: "网盘请求中断，当前文件结果未知"
    });
    const onPreviewResolve = vi.fn().mockResolvedValue({
      status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1,
        reclaimableBytes: 4096, verificationStatus: "file_versions_current" }
    });
    render(<DuplicateGroupsPage {...baseProps()} onReviewedDelete={onReviewedDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（1 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 1 个文件" }));
    const dialog = await screen.findByRole("dialog", { name: "批量清理结果" });
    expect(dialog).toHaveTextContent("当前文件结果未知");
    expect(dialog).toHaveTextContent("不能直接重试结果未知的文件");
    expect(screen.queryByRole("button", { name: /重新核对失败项/ })).not.toBeInTheDocument();
    expect(onReviewedDelete).toHaveBeenCalledTimes(1);
  });

  it("skips redundant mounted-filesystem preflight when the reviewed main-process route is available", async () => {
    const onPreviewResolve = vi.fn().mockRejectedValue(new Error("Mounted filesystem stat too slow"));
    const onReviewedDelete = vi.fn().mockResolvedValue({
      groupCount: 1, keepCount: 1, successCount: 1, failureCount: 0,
      reclaimedBytes: duplicateVideo.sizeBytes, failures: []
    });
    render(<DuplicateGroupsPage {...baseProps()} onReviewedDelete={onReviewedDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（1 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 1 个文件" }));
    await waitFor(() => expect(onReviewedDelete).toHaveBeenCalledOnce());
    expect(onPreviewResolve).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "批量清理结果" })).toHaveTextContent("已确认删除 1 个文件");
  });

  it("shows reviewed main-process safety rejections as acknowledged failures, not unknown transport errors", async () => {
    const onReviewedDelete = vi.fn().mockResolvedValue({
      groupCount: 1, keepCount: 1, successCount: 0, failureCount: 1,
      reclaimedBytes: 0,
      failures: [{ groupKey: "fp-1", videoId: "delete", path: duplicateVideo.path,
        message: "File version changed after indexing; rescan before permanent deletion." }]
    });
    const onManualBatchDelete = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({
      status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1,
        reclaimableBytes: 4096, verificationStatus: "file_versions_current" }
    });
    render(<DuplicateGroupsPage {...baseProps()} onReviewedDelete={onReviewedDelete}
      onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（1 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 1 个文件" }));
    const dialog = await screen.findByRole("dialog", { name: "批量清理结果" });
    expect(dialog).toHaveTextContent("确认失败 1 个");
    expect(dialog).toHaveTextContent("File version changed");
    expect(dialog).not.toHaveTextContent("通信异常");
    expect(dialog).not.toHaveTextContent("结果未知");
    expect(onManualBatchDelete).not.toHaveBeenCalled();
  });

  it("keeps per-batch selected keep IDs when using reviewed deletion for many files", async () => {
    const batchGroups: DuplicateGroup[] = Array.from({ length: 101 }, (_, i) => ({
      ...groups[0], groupKey: `group-${i}`, recommendedKeepVideoId: `keep-${i}`,
      items: [
        { ...groups[0].items[0], video: { ...video, id: `keep-${i}` } },
        { ...groups[0].items[1], video: { ...duplicateVideo, id: `delete-${i}` } }
      ]
    }));
    const onReviewedDelete = vi.fn(async (plan: DuplicateResolvePlan) => ({
      groupCount: plan.groups.length, keepCount: plan.groups.length, successCount: plan.groups.length,
      failureCount: 0, reclaimedBytes: plan.groups.length * 4096, failures: []
    }));
    const onManualBatchDelete = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({
      status: "ready", preview: { groupCount: 101, keepCount: 101, deleteCount: 101,
        reclaimableBytes: 413696, verificationStatus: "file_versions_current" }
    });
    render(<DuplicateGroupsPage {...baseProps()} groups={batchGroups} pageSize={200} totalGroups={101}
      onReviewedDelete={onReviewedDelete} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（101 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 101 个文件" }));
    await waitFor(() => expect(onReviewedDelete).toHaveBeenCalledTimes(2));
    expect(onReviewedDelete.mock.calls[0][0].groups).toHaveLength(100);
    expect(onReviewedDelete.mock.calls[1][0].groups).toHaveLength(1);
    expect(onReviewedDelete.mock.calls.flatMap(([plan]) => plan.groups).every((group: { keepVideoId: string; deleteVideoIds: string[] }) =>
      group.keepVideoId.startsWith("keep-") && group.deleteVideoIds.every((id) => id.startsWith("delete-")))).toBe(true);
    expect(onManualBatchDelete).not.toHaveBeenCalled();
  });

  it("splits a large current-page cleanup into bounded batches without touching keep items", async () => {
    const pageGroups = Array.from({ length: 101 }, (_, i) => ({
      ...groups[0], groupKey: `group-${i}`, recommendedKeepVideoId: `keep-${i}`,
      items: [
        { ...groups[0].items[0], video: { ...video, id: `keep-${i}`, filename: `keep-${i}.mp4` } },
        { ...groups[0].items[1], video: { ...duplicateVideo, id: `delete-${i}`, filename: `delete-${i}.mp4` } }
      ]
    }));
    const onManualBatchDelete = vi.fn(async (videos: VideoRecord[]) => ({ successCount: videos.length, failureCount: 0, reclaimedBytes: videos.reduce((sum, v) => sum + v.sizeBytes, 0), failures: [] }));
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 101, keepCount: 101, deleteCount: 101, reclaimableBytes: 101 * 4096, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} groups={pageGroups} pageSize={200} totalGroups={101} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（101 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 101 个文件" }));
    await waitFor(() => expect(onManualBatchDelete).toHaveBeenCalledTimes(2));
    expect(onManualBatchDelete.mock.calls[0][0]).toHaveLength(100);
    expect(onManualBatchDelete.mock.calls[1][0]).toHaveLength(1);
    expect(onManualBatchDelete.mock.calls.flatMap(([videos]) => videos).every((video: VideoRecord) => video.id.startsWith("delete-"))).toBe(true);
  });

  it("shows confirmed batch progress while the backend request is pending", async () => {
    let resolveBatch!: (result: { successCount: number; failureCount: number; reclaimedBytes: number; failures: [] }) => void;
    const onManualBatchDelete = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveBatch = resolve; }));
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 1, keepCount: 1, deleteCount: 1, reclaimableBytes: 4096, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（1 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 1 个文件" }));
    await waitFor(() => expect(onManualBatchDelete).toHaveBeenCalledOnce());
    expect(screen.getByRole("progressbar", { name: "本次清理进度" })).toHaveAttribute("value", "0");
    expect(screen.getByText(/已确认处理 0 \/ 1/)).toBeInTheDocument();
    await act(async () => { resolveBatch({ successCount: 1, failureCount: 0, reclaimedBytes: 4096, failures: [] }); });
    expect(await screen.findByRole("dialog", { name: "批量清理结果" })).toHaveTextContent("已确认删除 1 个文件");
  });

  it("keeps advanced maintenance collapsed for normal manual cleanup and opens it only on demand", () => {
    render(<DuplicateGroupsPage {...baseProps()} onManualBatchDelete={vi.fn()} onPreviewResolve={vi.fn()} onSubmitCleanup={vi.fn()} />);
    const advanced = screen.getByText("高级核对与维护工具（可选）").closest("details");
    expect(advanced).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "清理当前页（1 个文件）" })).toBeVisible();
    fireEvent.click(screen.getByText("高级核对与维护工具（可选）"));
    expect(advanced).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "验证当前页" })).toBeVisible();
  });

  it("retries only explicitly failed batch items after a second confirmation and a fresh preflight", async () => {
    const secondKeep = { ...video, id: "keep2", filename: "keep2.mp4" };
    const secondDelete = { ...duplicateVideo, id: "delete2", filename: "delete2.mp4" };
    const twoGroups: DuplicateGroup[] = [...groups, {
      ...groups[0], groupKey: "fp-2", recommendedKeepVideoId: "keep2",
      items: [{ ...groups[0].items[0], video: secondKeep }, { ...groups[0].items[1], video: secondDelete }]
    }];
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 2, keepCount: 2, deleteCount: 2, reclaimableBytes: 8192, verificationStatus: "file_versions_current" } });
    const onManualBatchDelete = vi.fn()
      .mockResolvedValueOnce({ successCount: 1, failureCount: 1, reclaimedBytes: 4096, failures: [{ videoId: "delete2", path: secondDelete.path, message: "EACCES: permission denied" }] })
      .mockResolvedValueOnce({ successCount: 1, failureCount: 0, reclaimedBytes: 4096, failures: [] });
    render(<DuplicateGroupsPage {...baseProps()} groups={twoGroups} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（2 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 2 个文件" }));

    const firstResult = await screen.findByRole("dialog", { name: "批量清理结果" });
    expect(firstResult).toHaveTextContent("确认失败 1 个");
    fireEvent.click(screen.getByRole("button", { name: "仅重新核对失败项（1）" }));
    expect(screen.getByRole("alertdialog", { name: "确认重新核对失败项？" })).toHaveTextContent("明确返回失败的 1 个文件");
    expect(onManualBatchDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认重试 1 个失败项" }));
    await waitFor(() => expect(onManualBatchDelete).toHaveBeenCalledTimes(2));
    expect(onManualBatchDelete.mock.calls[1][0]).toEqual([secondDelete]);
    expect(onPreviewResolve.mock.calls[1][0]).toEqual({ groups: [{ groupKey: "fp-2", keepVideoId: "keep2", deleteVideoIds: ["delete2"] }] });
  });

  it("preserves acknowledged batches and marks transport-interrupted batches UNKNOWN without automatic replay", async () => {
    const manyGroups: DuplicateGroup[] = Array.from({ length: 101 }, (_, i) => ({
      ...groups[0], groupKey: `group-${i}`, recommendedKeepVideoId: `keep-${i}`,
      items: [
        { ...groups[0].items[0], video: { ...video, id: `keep-${i}`, filename: `keep-${i}.mp4` } },
        { ...groups[0].items[1], video: { ...duplicateVideo, id: `delete-${i}`, filename: `delete-${i}.mp4` } }
      ]
    }));
    const onManualBatchDelete = vi.fn()
      .mockResolvedValueOnce({ successCount: 100, failureCount: 0, reclaimedBytes: 409600, failures: [] })
      .mockRejectedValueOnce(new Error("CloudDrive connection lost"));
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "ready", preview: { groupCount: 101, keepCount: 101, deleteCount: 101, reclaimableBytes: 413696, verificationStatus: "file_versions_current" } });
    render(<DuplicateGroupsPage {...baseProps()} groups={manyGroups} pageSize={200} totalGroups={101} onManualBatchDelete={onManualBatchDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "清理当前页（101 个文件）" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理 101 个文件" }));
    const result = await screen.findByRole("dialog", { name: "批量清理结果" });
    expect(result).toHaveTextContent("已确认删除 100 个文件");
    expect(result).toHaveTextContent("第 2 批（1 项）通信异常，处理结果未知");
    expect(result).toHaveTextContent("不能直接重试结果未知的文件");
    expect(screen.queryByRole("button", { name: /重新核对失败项/ })).not.toBeInTheDocument();
    expect(onManualBatchDelete).toHaveBeenCalledTimes(2);
  });

  it("aborts manual deletion when the preflight finds changed media", async () => {
    const changedItem = {
      videoId: "delete", filename: "clip-copy.mp4", path: duplicateVideo.path, changeType: "size-changed",
      previousSizeBytes: duplicateVideo.sizeBytes, currentSizeBytes: 123,
      previousModifiedAt: duplicateVideo.modifiedAt, currentModifiedAt: duplicateVideo.modifiedAt, message: "大小变化"
    };
    const onManualDelete = vi.fn();
    const onPreviewResolve = vi.fn().mockResolvedValue({ status: "stale", changedItems: [changedItem] });
    render(<DuplicateGroupsPage {...baseProps()} onManualDelete={onManualDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 clip-copy.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除此文件" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "检测到文件状态变化" })).toBeInTheDocument());
    expect(onManualDelete).not.toHaveBeenCalled();
  });

  it("keeps manual deletion available for mounted files without a CloudDrive API identity", () => {
    const unboundGroups: DuplicateGroup[] = [{ ...groups[0], items: [
      groups[0].items[0], { ...groups[0].items[1], canAutoDelete: false }
    ] }];
    render(<DuplicateGroupsPage {...baseProps()} groups={unboundGroups} onManualDelete={vi.fn()} onPreviewResolve={vi.fn()} onManualBatchDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "删除 clip-copy.mp4" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "清理当前页（1 个文件）" })).toBeEnabled();
  });

  it("never deletes a manually selected file when its confirmation is cancelled", () => {
    const onManualDelete = vi.fn();
    const onPreviewResolve = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} onManualDelete={onManualDelete} onPreviewResolve={onPreviewResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 clip-copy.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onPreviewResolve).not.toHaveBeenCalled();
    expect(onManualDelete).not.toHaveBeenCalled();
  });

  it("does not expose the retired direct resolve fallback", () => {
    render(<DuplicateGroupsPage {...baseProps()} onPreviewResolve={vi.fn()} onResolve={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "清理当前页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认删除/ })).not.toBeInTheDocument();
  });

  it("delegates duplicate group field and direction sorting without reordering files inside a group", () => {
    const onSortField = vi.fn();
    const onSortDirection = vi.fn();
    const { container } = render(<DuplicateGroupsPage {...baseProps()} onSortField={onSortField} onSortDirection={onSortDirection} />);
    const filenames = () => [...container.querySelectorAll(".duplicate-item-heading strong")].map((element) => element.textContent);
    expect(filenames()).toEqual(["clip-copy.mp4", "clip.mp4"]);
    fireEvent.change(screen.getByLabelText("候选组排序依据"), { target: { value: "duplicateCount" } });
    fireEvent.change(screen.getByLabelText("候选组排序方向"), { target: { value: "asc" } });
    expect(onSortField).toHaveBeenCalledWith("duplicateCount");
    expect(onSortDirection).toHaveBeenCalledWith("asc");
    expect(filenames()).toEqual(["clip-copy.mp4", "clip.mp4"]);
  });

  it("delegates pagination and directory filters", () => {
    const onPage = vi.fn(); const onPageSize = vi.fn(); const onPreferredDirectoryPathChange = vi.fn();
    render(<DuplicateGroupsPage {...baseProps()} page={2} pageSize={20} totalPages={4} totalGroups={63}
      directoryOptions={[{ path: "D:\\Backup", groupCount: 1, estimatedCleanupFileCount: 1, estimatedReclaimableBytes: 4096 }]}
      onPage={onPage} onPageSize={onPageSize} onPreferredDirectoryPathChange={onPreferredDirectoryPathChange} />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByLabelText("候选项每页数量"), { target: { value: "500" } });
    expect(onPageSize).toHaveBeenCalledWith(500);
    fireEvent.click(screen.getByLabelText("选择候选项计划保留目录（包含所有子目录）"));
    fireEvent.click(screen.getByRole("option", { name: /Backup/ }));
    expect(onPreferredDirectoryPathChange).toHaveBeenCalledWith("D:\\Backup");
  });

  it("ranks preferred directories by reclaimable space or cleanup count and applies presets", () => {
    const directoryOptions = [
      { path: "D:\\Many files", groupCount: 80, estimatedCleanupFileCount: 200, estimatedReclaimableBytes: 5 * 1024 ** 3 },
      { path: "D:\\Most space", groupCount: 12, estimatedCleanupFileCount: 20, estimatedReclaimableBytes: 200 * 1024 ** 3 },
      { path: "D:\\Middle", groupCount: 30, estimatedCleanupFileCount: 50, estimatedReclaimableBytes: 50 * 1024 ** 3 }
    ];
    const { container } = render(<DuplicateGroupsPage {...baseProps()} directoryOptions={directoryOptions} />);
    fireEvent.click(screen.getByLabelText("选择候选项计划保留目录（包含所有子目录）"));
    const orderedPaths = () => [...container.querySelectorAll(".directory-picker-menu [role='option']")]
      .map((option) => option.getAttribute("title"));

    expect(orderedPaths()).toEqual(["D:\\Most space", "D:\\Middle", "D:\\Many files"]);
    fireEvent.change(screen.getByLabelText("优先保留目录排序"), { target: { value: "files" } });
    expect(orderedPaths()).toEqual(["D:\\Many files", "D:\\Middle", "D:\\Most space"]);
    fireEvent.change(screen.getByLabelText("优先保留目录筛选"), { target: { value: "files-100" } });
    expect(orderedPaths()).toEqual(["D:\\Many files"]);
    expect(screen.getByText(/显示 1 \/ 3 个目录/)).toBeInTheDocument();
  });

  it("shows the estimated cleanup impact for the active preferred directory", () => {
    render(<DuplicateGroupsPage {...baseProps()} preferredDirectories={[preferredDirectory]} directoryOptions={[
      { path: "D:\\Movies", groupCount: 41, estimatedCleanupFileCount: 64, estimatedReclaimableBytes: 12 * 1024 ** 3 }
    ]} />);

    expect(screen.getByLabelText("当前优先保留目录")).toHaveTextContent("候选清理 64 个 · 释放 12.00 GB");
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
    fireEvent.click(screen.getByRole("button", { name: "开始核对" }));

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

  it("renders only the first 200 directory choices until the user narrows the search", () => {
    const directoryOptions = Array.from({ length: 250 }, (_, index) => ({
      path: `D:\\Library\\Folder ${String(index).padStart(3, "0")}`,
      groupCount: 1,
      estimatedCleanupFileCount: 1,
      estimatedReclaimableBytes: 1024
    }));
    const { container } = render(<DuplicateGroupsPage {...baseProps()} directoryOptions={directoryOptions} />);

    fireEvent.click(screen.getByLabelText("选择候选项计划保留目录（包含所有子目录）"));

    expect(container.querySelectorAll(".directory-picker-menu [role='option']")).toHaveLength(200);
    expect(screen.getByText("还有 50 个目录，请输入关键词缩小范围。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索目录"), { target: { value: "Folder 249" } });
    expect(container.querySelectorAll(".directory-picker-menu [role='option']")).toHaveLength(1);
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
    fireEvent.click(screen.getByRole("button", { name: "清除当前优先保留目录 D:\\Movies" }));
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
