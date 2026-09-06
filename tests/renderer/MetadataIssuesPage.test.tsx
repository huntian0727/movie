import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetadataIssuesPage } from "../../src/renderer/components/MetadataIssuesPage";
import type { MetadataIssuePage, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";

const folder: SourceFolder = {
  id: "source-1",
  path: "F:\\Cloud",
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  scanError: null,
  providerName: "115"
};

const baseVideo: VideoRecord = {
  id: "video-failed",
  sourceFolderId: folder.id,
  path: "F:\\Cloud\\failed.mp4",
  directory: "F:\\Cloud",
  filename: "failed.mp4",
  basename: "failed",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: null,
  width: null,
  height: null,
  format: null,
  videoCodec: null,
  videoProfile: null,
  pixelFormat: null,
  audioCodec: null,
  codecProbeStatus: "failed",
  modifiedAt: "2026-09-07T00:00:00.000Z",
  importedAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:01:00.000Z",
  isFavorite: false,
  isPendingDelete: false,
  isMissing: false,
  metadataStatus: "failed",
  thumbnailStatus: "pending",
  timelinePreviewStatus: "pending",
  coverCachePath: null,
  contentFingerprint: null,
  fingerprintStatus: "pending",
  fingerprintUpdatedAt: null,
  fingerprintError: null
};

const page: MetadataIssuePage = {
  items: [{
    video: baseVideo,
    errorCode: "ETIMEDOUT",
    errorSummary: "ffprobe timed out",
    lastFailedAt: "2026-09-07T00:01:00.000Z",
    retryCount: 2
  }, {
    video: {
      ...baseVideo,
      id: "video-pending",
      path: "F:\\Cloud\\pending.mp4",
      filename: "pending.mp4",
      basename: "pending",
      metadataStatus: "pending",
      codecProbeStatus: "unprobed"
    },
    errorCode: null,
    errorSummary: null,
    lastFailedAt: null,
    retryCount: 0
  }],
  page: 1,
  pageSize: 30,
  totalPages: 1,
  totalCount: 2,
  pendingCount: 1,
  failedCount: 1
};

describe("MetadataIssuesPage", () => {
  it("shows pending and failed records with the stored failure details", async () => {
    render(<MetadataIssuesPage folders={[folder]} initialSourceFolderId={folder.id} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("failed.mp4")).toBeInTheDocument());
    expect(screen.getAllByText("分析失败").length).toBeGreaterThan(0);
    expect(screen.getAllByText("等待分析").length).toBeGreaterThan(0);
    expect(screen.getByText("ffprobe timed out")).toBeInTheDocument();
    expect(screen.getByText(/错误码 ETIMEDOUT，重试 2 次/)).toBeInTheDocument();
    expect(screen.getByText("当前仅查看：F:\\Cloud")).toBeInTheDocument();
  });

  it("filters by status and retries every selected row", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={onRetry} />);
    await waitFor(() => expect(screen.getByText("failed.mp4")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("分析状态"), { target: { value: "failed" } });
    await waitFor(() => expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" })));
    fireEvent.click(screen.getByRole("button", { name: "全选当前页" }));
    fireEvent.click(screen.getByRole("button", { name: /优先重新分析/ }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByText("已将 2 条记录优先加入分析队列。")).toBeInTheDocument();
  });

  it("renders query failures and the filtered empty state", async () => {
    const loadPage = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue({ ...page, items: [], totalCount: 0, pendingCount: 0, failedCount: 0 });
    const { rerender } = render(<MetadataIssuesPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database busy"));

    rerender(<MetadataIssuesPage folders={[folder]} refreshSequence={1} loadPage={loadPage} onRetry={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("当前筛选下没有元数据异常")).toBeInTheDocument());
  });
});
