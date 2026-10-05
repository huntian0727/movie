import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetadataIssuesPage } from "../../src/renderer/components/MetadataIssuesPage";
import type { MetadataIssuePage, MetadataSizeRefreshResult, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";

const folder: SourceFolder = {
  id: "source-1", path: "F:\\Cloud", recursive: true, enabled: true, lastScannedAt: null,
  createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z", scanError: null,
  providerType: "clouddrive", providerName: "115"
};

const baseVideo: VideoRecord = {
  id: "video-failed", sourceFolderId: folder.id, path: "F:\\Cloud\\failed.mp4", directory: "F:\\Cloud",
  filename: "failed.mp4", basename: "failed", extension: ".mp4", sizeBytes: 1024,
  durationMs: null, width: null, height: null, format: null, videoCodec: null, videoProfile: null,
  pixelFormat: null, audioCodec: null, codecProbeStatus: "failed", modifiedAt: "2026-09-07T00:00:00.000Z",
  importedAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:01:00.000Z",
  isFavorite: false, isPendingDelete: false, isMissing: false, metadataStatus: "failed", thumbnailStatus: "pending",
  timelinePreviewStatus: "pending", coverCachePath: null, contentFingerprint: null, fingerprintStatus: "pending",
  fingerprintUpdatedAt: null, fingerprintError: null
};

const zeroVideo: VideoRecord = {
  ...baseVideo,
  id: "video-zero",
  path: "F:\\Cloud\\zero.mp4",
  filename: "zero.mp4",
  basename: "zero",
  sizeBytes: 0
};

const page: MetadataIssuePage = {
  items: [{
    video: baseVideo, analysisState: "failed", queueState: null, errorCode: "TIMEOUT",
    errorSummary: "ffprobe timed out", lastFailedAt: "2026-09-07T00:01:00.000Z", retryCount: 2
  }, {
    video: { ...baseVideo, id: "video-pending", path: "F:\\Cloud\\pending.mp4", filename: "pending.mp4", basename: "pending", metadataStatus: "pending", codecProbeStatus: "unprobed" },
    analysisState: "deferred", queueState: null, errorCode: null, errorSummary: null, lastFailedAt: null, retryCount: 0
  }, {
    video: zeroVideo, analysisState: "failed", queueState: null, errorCode: "EMPTY_FILE",
    errorSummary: "文件大小为 0B", lastFailedAt: "2026-09-07T00:02:00.000Z", retryCount: 0
  }],
  page: 1, pageSize: 30, totalPages: 1, totalCount: 3,
  automaticCount: 0, deferredCount: 1, failedCount: 2, zeroByteCount: 1, queuedCount: 0, activeCount: 0
};

const refreshed: MetadataSizeRefreshResult = {
  requestedCount: 1, updatedCount: 1, stillZeroCount: 0, missingCount: 0, skippedCount: 0, failureCount: 0,
  items: [{ videoId: zeroVideo.id, path: zeroVideo.path, status: "updated", previousSizeBytes: 0, currentSizeBytes: 2048, message: "已更新" }]
};

describe("MetadataIssuesPage", () => {
  it("shows honest deferred, failed, and zero-byte states", async () => {
    render(<MetadataIssuesPage folders={[folder]} initialSourceFolderId={folder.id} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} onRefreshSizes={vi.fn().mockResolvedValue(refreshed)} />);

    await waitFor(() => expect(screen.getByText("failed.mp4")).toBeInTheDocument());
    expect(screen.getAllByText("分析失败").length).toBeGreaterThan(0);
    expect(screen.getAllByText("暂缓分析").length).toBeGreaterThan(0);
    expect(screen.getByText("0B 待确认")).toBeInTheDocument();
    expect(screen.getByText("ffprobe timed out")).toBeInTheDocument();
    expect(screen.getByText(/读取超时，重试 2 次/)).toBeInTheDocument();
    expect(screen.getByText("当前仅查看：F:\\Cloud")).toBeInTheDocument();
  });

  it("filters by derived state and retries only non-zero selected rows", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={onRetry} onRefreshSizes={vi.fn().mockResolvedValue(refreshed)} />);
    await waitFor(() => expect(screen.getByText("failed.mp4")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("分析状态"), { target: { value: "deferred" } });
    await waitFor(() => expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "deferred", zeroBytesOnly: false })));
    fireEvent.click(screen.getByRole("button", { name: "全选当前页" }));
    fireEvent.click(screen.getByRole("button", { name: /优先重新分析/ }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByText("已将 2 条记录优先加入分析队列。")).toBeInTheDocument();
  });

  it("refreshes CloudDrive size for a zero-byte row and exposes the 0B filter", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    const onRefreshSizes = vi.fn().mockResolvedValue(refreshed);
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={vi.fn()} onRefreshSizes={onRefreshSizes} />);
    await waitFor(() => expect(screen.getByText("zero.mp4")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /仅看 0B/ }));
    await waitFor(() => expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ zeroBytesOnly: true })));
    fireEvent.click(screen.getByRole("button", { name: "重新读取大小" }));

    await waitFor(() => expect(onRefreshSizes).toHaveBeenCalledWith([zeroVideo.id]));
    expect(screen.getByText(/恢复并排队 1 条/)).toBeInTheDocument();
  });

  it("renders query failures and the filtered empty state", async () => {
    const emptyPage = { ...page, items: [], totalCount: 0, automaticCount: 0, deferredCount: 0, failedCount: 0, zeroByteCount: 0 };
    const loadPage = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(emptyPage);
    const props = { folders: [folder], loadPage, onRetry: vi.fn(), onRefreshSizes: vi.fn().mockResolvedValue(refreshed) };
    const { rerender } = render(<MetadataIssuesPage {...props} refreshSequence={0} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database busy"));

    rerender(<MetadataIssuesPage {...props} refreshSequence={1} />);
    await waitFor(() => expect(screen.getByText("当前筛选下没有元数据异常")).toBeInTheDocument(), { timeout: 2_500 });
  });

  it("offers a read-only query retry without pretending a failed read is empty", async () => {
    const loadPage = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(page);
    const onRetry = vi.fn(); const onRefreshSizes = vi.fn();
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={onRetry} onRefreshSizes={onRefreshSizes} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("database busy");
    expect(screen.queryByText("当前筛选下没有元数据异常")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await screen.findByText("failed.mp4");
    expect(onRetry).not.toHaveBeenCalled(); expect(onRefreshSizes).not.toHaveBeenCalled();
  });

  it("does not clear an operation failure when the list is refreshed", async () => {
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} onRefreshSizes={vi.fn().mockRejectedValue(new Error("cloud unavailable"))} />);
    fireEvent.click(await screen.findByRole("button", { name: "重新读取大小" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cloud unavailable");
    fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新列表" })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("cloud unavailable");
  });

  it("handles synchronous queue rejection as a partial failure with retained detail", async () => {
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={() => { throw new Error("queue unavailable"); }} onRefreshSizes={vi.fn()} />);
    await screen.findByText("failed.mp4");
    fireEvent.click(screen.getByRole("button", { name: "全选当前页" }));
    fireEvent.click(screen.getByRole("button", { name: /优先重新分析/ }));
    expect(await screen.findByText(/失败 2 条/)).toBeInTheDocument();
    expect(screen.getAllByText("queue unavailable")).toHaveLength(2);
  });

  it("reports failed open-location actions instead of leaving an unhandled rejection", async () => {
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} onRefreshSizes={vi.fn()} onOpenLocation={vi.fn().mockRejectedValue(new Error("path unavailable"))} />);
    await screen.findByText("failed.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "打开位置" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("path unavailable");
  });
});
