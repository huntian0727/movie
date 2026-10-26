import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  DuplicateCleanupJob,
  DuplicateCleanupJobPage,
  FolderScanStatus,
  MetadataQueueStatus,
  MediaCacheTaskStatus,
  ReviewedDeleteBackgroundJob,
  ScanFailureBatchJob
} from "../../src/shared/videoTypes";
import { BackgroundTaskCenter } from "../../src/renderer/components/BackgroundTaskCenter";

const mediaCacheStatus: MediaCacheTaskStatus = {
  generation: { queued: 0, active: 0, interrupted: 0, playbackPaused: false, stopped: false },
  maintenance: { state: "idle", lastStartedAt: null, lastCompletedAt: null, lastError: null },
  cache: {
    totalBytes: 1536, coverBytes: 1024, timelineBytes: 512, itemCount: 3, maxBytes: 1024 * 1024,
    lastCleanup: { reason: "automatic", removedCount: 1, reclaimedBytes: 2048, failureCount: 0 }
  }
};

function createProps(overrides: Partial<ComponentProps<typeof BackgroundTaskCenter>> = {}) {
  const scan = {
    folderId: "folder-1",
    mode: "full",
    state: "scanning",
    phase: "processing",
    totalFiles: 12,
    processedFiles: 4,
    currentPath: "D:\\Videos\\movie.mp4",
    message: "正在读取目录",
    counters: {
      totalFolders: 1, currentFolderIndex: 1, completedFolders: 0, failedFolders: 0,
      checkedDirectories: 1, changedDirectories: 0, skippedDirectories: 0,
      processedVideos: 4, skippedVideos: 0, addedVideos: 4, updatedVideos: 0,
      missingVideos: 0, fileFailures: 0, directoryFailures: 0, pendingFailures: 0,
      retriedFailures: 0, resolvedFailures: 0
    },
    updatedAt: "2026-10-23T01:00:00.000Z"
  } as unknown as FolderScanStatus;
  const duplicateJob = {
    id: "duplicate-job-1",
    status: "running",
    phase: "verification",
    processedItems: 3,
    totalItems: 10,
    createdAt: "2026-10-23T01:00:00.000Z",
    errorSummary: null
  } as unknown as DuplicateCleanupJob;
  const duplicatePage = {
    items: [duplicateJob],
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
    activeCount: 1
  } as DuplicateCleanupJobPage;
  const batchJob = {
    id: "scan-batch-1",
    operation: "analyze-metadata",
    status: "running",
    scopeSummary: "选中 5 项",
    errorSummary: null,
    totalCount: 5,
    processedCount: 2,
    successCount: 2,
    skippedCount: 0,
    failureCount: 0,
    currentPath: "D:\\Videos\\problem.mp4",
    message: "处理中",
    createdAt: "2026-10-23T01:00:00.000Z",
    completedAt: null
  } as ScanFailureBatchJob;
  const metadataQueue: MetadataQueueStatus = { queued: 2, active: 1 };

  return {
    open: true,
    onClose: vi.fn(),
    folders: [],
    scanStatuses: [scan],
    pendingMetadataVideos: 42,
    loadMetadataQueueStatus: vi.fn().mockResolvedValue(metadataQueue),
    loadDuplicateCleanupJobs: vi.fn().mockResolvedValue(duplicatePage),
    loadReviewedDeleteBackground: vi.fn().mockResolvedValue(null),
    loadScanFailureBatches: vi.fn().mockResolvedValue([batchJob]),
    loadMediaCacheTaskStatus: vi.fn().mockResolvedValue(mediaCacheStatus),
    onOpenCacheSettings: vi.fn(),
    onOpenAssetCenter: vi.fn(),
    onOpenMetadataTasks: vi.fn(),
    onOpenDuplicateCleanup: vi.fn(),
    onOpenScanFailures: vi.fn(),
    ...overrides
  };
}

describe("BackgroundTaskCenter", () => {
  it("summarizes active scan, metadata, duplicate cleanup, scan-failure and cache work", async () => {
    const props = createProps();
    render(<BackgroundTaskCenter {...props} />);

    expect(screen.getByRole("dialog", { name: "后台任务中心" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/正在处理/)).toBeInTheDocument());

    expect(screen.getByText("正在扫描")).toBeInTheDocument();
    expect(screen.getByText(/等待队列/)).toBeInTheDocument();
    expect(screen.getByText("资料库待处理（含暂缓）", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("核对大小与时长")).toBeInTheDocument();
    expect(screen.getByText("重新分析元数据")).toBeInTheDocument();
    expect(screen.getByText("缓存与封面生成")).toBeInTheDocument();
    expect(screen.getByText(/缓存占用/)).toBeInTheDocument();
    expect(screen.getByText("活动/排队 6 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开缓存设置" }));
    fireEvent.click(screen.getByRole("button", { name: "打开元数据任务" }));
    fireEvent.click(screen.getByRole("button", { name: "打开资产中心" }));
    fireEvent.click(screen.getByRole("button", { name: "打开重复文件" }));
    fireEvent.click(screen.getByRole("button", { name: "打开扫描异常" }));
    expect(props.onClose).toHaveBeenCalledTimes(5);
    expect(props.onOpenCacheSettings).toHaveBeenCalledTimes(1);
    expect(props.onOpenMetadataTasks).toHaveBeenCalledTimes(1);
    expect(props.onOpenAssetCenter).toHaveBeenCalledTimes(1);
    expect(props.onOpenDuplicateCleanup).toHaveBeenCalledTimes(1);
    expect(props.onOpenScanFailures).toHaveBeenCalledTimes(1);
  });

  it("counts interrupted image work and surfaces cache maintenance attention without exposing paths", async () => {
    const props = createProps({
      loadMediaCacheTaskStatus: vi.fn().mockResolvedValue({
        ...mediaCacheStatus,
        generation: { queued: 2, active: 0, interrupted: 1, playbackPaused: true, stopped: false },
        maintenance: { state: "running", lastStartedAt: "2026-10-23T01:00:00.000Z", lastCompletedAt: null, lastError: "缓存维护失败，详情请查看诊断日志" },
        cache: { ...mediaCacheStatus.cache, lastCleanup: { reason: "automatic", removedCount: 2, reclaimedBytes: 4096, failureCount: 1 } }
      })
    });
    render(<BackgroundTaskCenter {...props} />);

    await waitFor(() => expect(screen.getByText("活动/排队 10 项")).toBeInTheDocument());
    expect(screen.getByText("需关注 1 项")).toBeInTheDocument();
    expect(screen.getByText(/播放优先/)).toBeInTheDocument();
    expect(screen.getByText(/上次清理存在未完成项/)).toBeInTheDocument();
    expect(screen.queryByText(/private-source-path|C:\\\\Users/)).not.toBeInTheDocument();
  });

  it("shows safe next-step guidance for interrupted and failed tasks", async () => {
    const base = createProps();
    const originalPage = await base.loadDuplicateCleanupJobs!(1, 20);
    const originalBatch = (await base.loadScanFailureBatches!())[0];
    const duplicateJob = { ...originalPage.items[0], status: "interrupted", phase: "deletion", errorSummary: "结果未知" } as DuplicateCleanupJob;
    const batchJob = { ...originalBatch, status: "completed-with-errors", failureCount: 1 } as ScanFailureBatchJob;
    const reviewedJob: ReviewedDeleteBackgroundJob = {
      id: "reviewed-interrupted", status: "interrupted", total: 2, processed: 1,
      successCount: 1, failureCount: 0, uncertainCount: 1, unsubmittedCount: 0,
      reclaimedBytes: 0, recycledCount: 0, failures: [], message: "interrupted",
      createdAt: "2026-10-23T01:00:00.000Z", updatedAt: "2026-10-23T01:01:00.000Z"
    };
    const props = createProps({
      scanStatuses: [{ ...base.scanStatuses[0], state: "offline" }],
      loadDuplicateCleanupJobs: vi.fn().mockResolvedValue({ ...originalPage, items: [duplicateJob] }),
      loadReviewedDeleteBackground: vi.fn().mockResolvedValue(reviewedJob),
      loadScanFailureBatches: vi.fn().mockResolvedValue([batchJob]),
      loadMediaCacheTaskStatus: vi.fn().mockResolvedValue({
        ...mediaCacheStatus,
        maintenance: { ...mediaCacheStatus.maintenance, lastError: "缓存维护失败，详情请查看诊断日志" }
      })
    });
    render(<BackgroundTaskCenter {...props} />);

    expect(await screen.findByText(/下一步：先恢复目录连接/)).toBeInTheDocument();
    expect(screen.getByText(/结果未知的删除项目不要直接重试/)).toBeInTheDocument();
    expect(screen.getByText(/结果未知项目不要直接重试/)).toBeInTheDocument();
    expect(screen.getByText(/打开扫描异常查看失败项/)).toBeInTheDocument();
    expect(screen.getByText(/打开缓存设置检查维护配置/)).toBeInTheDocument();
  });

  it("gives useful next steps when there are no active scans, duplicate cleanups or failure batches", async () => {
    const base = createProps();
    const originalPage = await base.loadDuplicateCleanupJobs!(1, 20);
    const props = createProps({
      scanStatuses: [],
      loadDuplicateCleanupJobs: vi.fn().mockResolvedValue({ ...originalPage, items: [], activeCount: 0, totalItems: 0, totalPages: 0 }),
      loadReviewedDeleteBackground: vi.fn().mockResolvedValue(null),
      loadScanFailureBatches: vi.fn().mockResolvedValue([])
    });
    render(<BackgroundTaskCenter {...props} />);

    expect(await screen.findByText(/需要更新资料库时，可到资产中心启动扫描/)).toBeInTheDocument();
    expect(screen.getByText(/如需处理重复候选，请打开重复文件查看候选项与历史结果/)).toBeInTheDocument();
    expect(screen.getByText(/如需处理异常记录，请打开扫描异常查看明细并选择合适操作/)).toBeInTheDocument();
  });

  it("keeps other cards usable when one status API fails and supports manual refresh", async () => {
    const props = createProps({
      loadMetadataQueueStatus: vi.fn().mockRejectedValue(new Error("queue unavailable"))
    });
    render(<BackgroundTaskCenter {...props} />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("元数据队列"));
    expect(screen.getByText("核对大小与时长")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新任务状态" }));
    await waitFor(() => expect(props.loadDuplicateCleanupJobs).toHaveBeenCalledTimes(2));
  });
  it("does not mistake failed status reads for empty duplicate or scan-failure queues", async () => {
    const props = createProps({
      loadDuplicateCleanupJobs: vi.fn().mockRejectedValue(new Error("duplicate status unavailable")),
      loadReviewedDeleteBackground: vi.fn().mockRejectedValue(new Error("reviewed status unavailable")),
      loadScanFailureBatches: vi.fn().mockRejectedValue(new Error("batch status unavailable"))
    });
    render(<BackgroundTaskCenter {...props} />);

    expect(await screen.findByText(/重复清理状态暂不可用/)).toBeInTheDocument();
    expect(screen.getByText(/扫描异常任务状态暂不可用/)).toBeInTheDocument();
    expect(screen.queryByText("当前没有活动的重复清理任务")).not.toBeInTheDocument();
    expect(screen.queryByText("当前没有活动的异常批处理")).not.toBeInTheDocument();
  });

  it("closes with Escape and does not load data while closed", async () => {
    const props = createProps({ open: false });
    const { rerender } = render(<BackgroundTaskCenter {...props} />);
    expect(screen.queryByRole("dialog", { name: "后台任务中心" })).not.toBeInTheDocument();
    expect(props.loadMetadataQueueStatus).not.toHaveBeenCalled();

    rerender(<BackgroundTaskCenter {...props} open />);
    await waitFor(() => expect(props.loadMetadataQueueStatus).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the auto-refresh timer when the center closes", async () => {
    const props = createProps();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    try {
      const { rerender } = render(<BackgroundTaskCenter {...props} />);
      await waitFor(() => expect(props.loadMetadataQueueStatus).toHaveBeenCalledTimes(1));
      const callsBeforeClose = clearTimeoutSpy.mock.calls.length;
      rerender(<BackgroundTaskCenter {...props} open={false} />);
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeClose);
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });
});
