import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetCenterPage } from "../../src/renderer/components/AssetCenterPage";
import { LibraryShell } from "../../src/renderer/components/LibraryShell";
import type { AssetCenterSourcePage, AssetCenterSummary, FolderScanStatus } from "../../src/shared/videoTypes";

const summary: AssetCenterSummary = {
  generatedAt: "2026-09-04T10:00:00.000Z",
  totalVideoCount: 205_798,
  totalSizeBytes: 18.6 * 1024 ** 4,
  sourceCount: 6,
  enabledSourceCount: 5,
  reachableSourceCount: 3,
  offlineSourceCount: 1,
  checkFailedSourceCount: 0,
  unknownSourceCount: 1,
  latestScannedAt: "2026-09-04T09:00:00.000Z",
  latestCompletedScan: {
    taskId: "task-1",
    sourceFolderId: "source-1",
    mode: "current-folder",
    status: "completed-with-errors",
    startedAt: "2026-09-04T08:59:00.000Z",
    completedAt: "2026-09-04T09:00:00.000Z",
    addedVideos: 235,
    updatedVideos: 18,
    missingVideos: 2,
    failureCount: 1,
    errorSummary: null
  },
  scanFailureCount: 1,
  missingVideoCount: 2,
  metadataIssueCount: 4,
  playbackRiskCount: 7,
  duplicateCandidateGroupCount: 12
};

const sourcePage: AssetCenterSourcePage = {
  items: [{
    id: "source-1",
    path: "F:\\Cloud",
    providerName: "Cloud archive",
    sourceType: "clouddrive",
    enabled: true,
    availability: "reachable",
    lastCheckAt: "2026-09-04T09:00:00.000Z",
    videoCount: 12_000,
    sizeBytes: 1024 ** 4,
    missingVideoCount: 2,
    metadataIssueCount: 4,
    scanFailureCount: 1,
    issueCount: 7,
    lastScannedAt: "2026-09-04T09:00:00.000Z",
    scanError: "one file failed"
  }],
  page: 1,
  pageSize: 30,
  totalPages: 1,
  totalCount: 1
};

describe("AssetCenterPage", () => {
  it("shows cached statistics, current scan state, latest scan counters, and source availability", async () => {
    const onNavigate = vi.fn();
    const onSelectSource = vi.fn();
    const onOpenMissing = vi.fn();
    const onOpenMetadata = vi.fn();
    render(
      <AssetCenterPage
        scanStatuses={[{
          folderId: "source-1",
          mode: "current-folder",
          state: "scanning",
          phase: "processing",
          totalFiles: 100,
          processedFiles: 40,
          currentPath: "F:\\Cloud",
          message: null,
          counters: {
            totalFolders: 1, currentFolderIndex: 1, completedFolders: 0, failedFolders: 0,
            checkedDirectories: 4, changedDirectories: 1, skippedDirectories: 3,
            processedVideos: 40, skippedVideos: 0, addedVideos: 0, updatedVideos: 0,
            missingVideos: 0, fileFailures: 0, directoryFailures: 0, pendingFailures: 0,
            retriedFailures: 0, resolvedFailures: 0
          },
          updatedAt: "2026-09-04T10:00:00.000Z"
        }]}
        refreshSequence={0}
        loadSummary={vi.fn().mockResolvedValue(summary)}
        loadSources={vi.fn().mockResolvedValue(sourcePage)}
        onNavigate={onNavigate}
        onOpenMissing={onOpenMissing}
        onOpenMetadata={onOpenMetadata}
        onSelectSource={onSelectSource}
      />
    );

    expect(screen.getByText("正在读取资料库统计…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("205,798")).toBeInTheDocument());
    expect(screen.getByText("18.60 TB")).toBeInTheDocument();
    expect(screen.getByText("正在处理媒体信息")).toBeInTheDocument();
    expect(screen.getByText("235")).toBeInTheDocument();
    expect(screen.getAllByText("最近可访问").length).toBeGreaterThan(0);
    expect(screen.getByText("Cloud archive")).toBeInTheDocument();
    expect(screen.getByText(/问题数量与可访问性分别统计/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重复候选/ }));
    expect(onNavigate).toHaveBeenCalledWith("duplicates");
    fireEvent.click(screen.getByRole("button", { name: /Cloud archive/ }));
    expect(onSelectSource).toHaveBeenCalledWith("F:\\Cloud");
    fireEvent.click(screen.getByRole("button", { name: "查看 F:\\Cloud 的 2 条缺失记录" }));
    expect(onOpenMissing).toHaveBeenCalledWith("source-1");
    fireEvent.click(screen.getByRole("button", { name: "查看 F:\\Cloud 的 4 条元数据异常" }));
    expect(onOpenMetadata).toHaveBeenCalledWith("source-1");
  });

  it("keeps source errors local, supports empty results, and retries only read-only loaders", async () => {
    const loadSummary = vi.fn().mockResolvedValue(summary);
    const loadSources = vi.fn()
      .mockRejectedValueOnce(new Error("database busy"))
      .mockResolvedValueOnce({ ...sourcePage, items: [], totalCount: 0 });
    render(
      <AssetCenterPage
        scanStatuses={[]}
        refreshSequence={0}
        loadSummary={loadSummary}
        loadSources={loadSources}
        onNavigate={vi.fn()}
        onOpenMissing={vi.fn()}
        onOpenMetadata={vi.fn()}
        onSelectSource={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database busy"));
    expect(screen.queryByText("没有符合筛选条件的资料库")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("没有符合筛选条件的资料库")).toBeInTheDocument());
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect(loadSources).toHaveBeenCalledTimes(2);
  });

  it("uses metric and six-row source skeletons during the initial read", () => {
    const neverSummary = new Promise<AssetCenterSummary>(() => undefined);
    const neverSources = new Promise<AssetCenterSourcePage>(() => undefined);
    const { container } = render(
      <AssetCenterPage
        scanStatuses={[]}
        refreshSequence={0}
        loadSummary={() => neverSummary}
        loadSources={() => neverSources}
        onNavigate={vi.fn()}
        onOpenMissing={vi.fn()}
        onOpenMetadata={vi.fn()}
        onSelectSource={vi.fn()}
      />
    );

    expect(screen.getAllByRole("button", { name: /读取中/ })).toHaveLength(4);
    expect(screen.getByRole("status", { name: "正在读取资料库" })).toBeInTheDocument();
    expect(container.querySelectorAll(".asset-source-skeleton > div")).toHaveLength(6);
    expect(screen.queryByText("正在聚合资产数据…")).not.toBeInTheDocument();
  });

  it("keeps the previous summary and source rows visible while refreshing", async () => {
    let resolveSummary: ((value: AssetCenterSummary) => void) | undefined;
    let resolveSources: ((value: AssetCenterSourcePage) => void) | undefined;
    const nextSummary = new Promise<AssetCenterSummary>((resolve) => { resolveSummary = resolve; });
    const nextSources = new Promise<AssetCenterSourcePage>((resolve) => { resolveSources = resolve; });
    const loadSummary = vi.fn().mockResolvedValueOnce(summary).mockImplementationOnce(() => nextSummary);
    const loadSources = vi.fn().mockResolvedValueOnce(sourcePage).mockImplementationOnce(() => nextSources);
    render(
      <AssetCenterPage
        scanStatuses={[]}
        refreshSequence={0}
        loadSummary={loadSummary}
        loadSources={loadSources}
        onNavigate={vi.fn()}
        onOpenMissing={vi.fn()}
        onOpenMetadata={vi.fn()}
        onSelectSource={vi.fn()}
      />
    );

    expect(await screen.findByText("205,798")).toBeInTheDocument();
    expect(screen.getByText("Cloud archive")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取缓存" }));
    expect(screen.getByText("205,798")).toBeInTheDocument();
    expect(screen.getByText("Cloud archive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在重新读取缓存" })).toBeDisabled();

    await act(async () => {
      resolveSummary?.(summary);
      resolveSources?.(sourcePage);
      await Promise.all([nextSummary, nextSources]);
    });
  });

  it("shows four active scan rows and summarizes the remaining tasks", async () => {
    const { container } = render(
      <AssetCenterPage
        scanStatuses={Array.from({ length: 6 }, (_, index) => activeScan(index))}
        refreshSequence={0}
        loadSummary={vi.fn().mockResolvedValue(summary)}
        loadSources={vi.fn().mockResolvedValue(sourcePage)}
        onNavigate={vi.fn()}
        onOpenMissing={vi.fn()}
        onOpenMetadata={vi.fn()}
        onSelectSource={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText("另有 2 个活动任务")).toBeInTheDocument());
    expect(container.querySelectorAll(".asset-active-scans article")).toHaveLength(4);
  });

  it("keeps the standalone asset view out of video paging, batch tools, shortcuts, and scan refresh", async () => {
    const onLoadVideoPage = vi.fn().mockResolvedValue({ videos: [], page: 1, pageSize: 100, totalPages: 1, totalCount: 0 });
    const onRefresh = vi.fn();
    const loadSummary = vi.fn().mockResolvedValue(summary);
    const loadSources = vi.fn().mockResolvedValue(sourcePage);
    render(
      <LibraryShell
        videos={[]}
        onLoadVideoPage={onLoadVideoPage}
        onLoadAssetCenterSummary={loadSummary}
        onLoadAssetCenterSources={loadSources}
        onRefresh={onRefresh}
      />
    );
    await waitFor(() => expect(onLoadVideoPage).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "查看资产中心" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "资产中心" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "多选" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("搜索文件名")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.click(screen.getByRole("button", { name: "重新读取缓存" }));
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2));
    expect(onLoadVideoPage).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

function activeScan(index: number): FolderScanStatus {
  return {
    folderId: `source-${index}`,
    mode: "current-folder",
    state: "scanning",
    phase: "processing",
    totalFiles: 100,
    processedFiles: index,
    currentPath: `F:\\Source-${index}`,
    message: null,
    counters: {
      totalFolders: 1, currentFolderIndex: 1, completedFolders: 0, failedFolders: 0,
      checkedDirectories: 1, changedDirectories: 0, skippedDirectories: 1,
      processedVideos: index, skippedVideos: 0, addedVideos: 0, updatedVideos: 0,
      missingVideos: 0, fileFailures: 0, directoryFailures: 0, pendingFailures: 0,
      retriedFailures: 0, resolvedFailures: 0
    },
    updatedAt: "2026-09-04T10:00:00.000Z"
  };
}
