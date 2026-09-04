import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetCenterPage } from "../../src/renderer/components/AssetCenterPage";
import { LibraryShell } from "../../src/renderer/components/LibraryShell";
import type { AssetCenterSourcePage, AssetCenterSummary } from "../../src/shared/videoTypes";

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
        onSelectSource={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database busy"));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("没有符合筛选条件的资料库")).toBeInTheDocument());
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect(loadSources).toHaveBeenCalledTimes(2);
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
    fireEvent.click(screen.getByRole("button", { name: "刷新资产数据" }));
    await waitFor(() => expect(loadSummary).toHaveBeenCalledTimes(2));
    expect(onLoadVideoPage).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
