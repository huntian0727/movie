import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScanFailureReviewItem, ScanFailureReviewPage, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";
import { ScanFailuresPage } from "../../src/renderer/components/ScanFailuresPage";

const folder: SourceFolder = { id: "folder-1", path: "D:\\Movies", recursive: true, enabled: true, lastScannedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", scanError: "failed" };
const video: VideoRecord = {
  id: "video-1", sourceFolderId: folder.id, path: "D:\\Movies\\clip.mp4", directory: folder.path,
  filename: "clip.mp4", basename: "clip", extension: ".mp4", sizeBytes: 1024, durationMs: 5000,
  width: 1920, height: 1080, format: "mp4", videoCodec: null, videoProfile: null, pixelFormat: null, audioCodec: null, codecProbeStatus: "ready",
  modifiedAt: "2026-01-01", importedAt: "2026-01-01", updatedAt: "2026-01-01",
  isFavorite: false, isPendingDelete: false, isMissing: false, metadataStatus: "ready", thumbnailStatus: "ready", timelinePreviewStatus: "pending",
  coverCachePath: null, contentFingerprint: null, fingerprintStatus: "pending", fingerprintUpdatedAt: null, fingerprintError: null
};

function item(kind: ScanFailureReviewItem["kind"]): ScanFailureReviewItem {
  const objectPath = kind === "directory" ? "D:\\Movies\\blocked" : kind === "video" ? video.path : "D:\\Movies\\unknown.mp4";
  return {
    kind,
    video: kind === "video" ? video : null,
    failure: { id: `failure-${kind}`, sourceFolderId: folder.id, scanTaskId: "task", objectType: kind === "directory" ? "directory" : "file", objectPath, normalizedPath: objectPath.toLowerCase(), failureStage: "file-processing", errorCode: "EIO", errorSummary: kind === "video" ? "moov atom not found" : "network read failed: ETIMEDOUT", firstFailedAt: "2026-01-01", lastFailedAt: "2026-01-02", retryCount: 2, status: "unresolved", resolvedAt: null }
  };
}

const page: ScanFailureReviewPage = {
  items: [item("video"), item("unindexed-file"), item("directory")], page: 1, pageSize: 30, totalPages: 1, totalCount: 3,
  counts: { all: 3, video: 1, unindexedFile: 1, directory: 1 }
};

describe("ScanFailuresPage", () => {
  it("does not reload merely because the parent passes a new callback instance", async () => {
    const firstLoadPage = vi.fn().mockResolvedValue(page);
    const { rerender } = render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={firstLoadPage} onRetry={vi.fn()} onDeleteFile={vi.fn()} onOpenLocation={vi.fn()} />);
    await screen.findByText("clip.mp4");

    const replacementLoadPage = vi.fn().mockResolvedValue(page);
    rerender(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={replacementLoadPage} onRetry={vi.fn()} onDeleteFile={vi.fn()} onOpenLocation={vi.fn()} />);

    await Promise.resolve();
    expect(firstLoadPage).toHaveBeenCalledTimes(1);
    expect(replacementLoadPage).not.toHaveBeenCalled();
  });

  it("loads scoped failures, exposes filters and never offers directory deletion", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    render(<ScanFailuresPage folders={[folder]} initialSourceFolderId={folder.id} refreshSequence={0} loadPage={loadPage} onRetry={vi.fn()} onDeleteFile={vi.fn()} onOpenLocation={vi.fn()} />);
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(loadPage).toHaveBeenCalledWith(expect.objectContaining({ sourceFolderId: folder.id, kind: "all", page: 1, pageSize: 30 }));
    expect(screen.getAllByTitle("永久删除文件")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("异常类型"), { target: { value: "directory" } });
    await waitFor(() => expect(loadPage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "directory", page: 1 })));
  });

  it("selects confirmed corrupt indexed videos and submits permanent cleanup directly", async () => {
    const onCleanup = vi.fn().mockResolvedValue({ action: "permanent-delete", successCount: 1, skippedCount: 0, failureCount: 0, reclaimedBytes: 1024, items: [] });
    render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} onDeleteFile={vi.fn()} onCleanup={onCleanup} onOpenLocation={vi.fn()} />);
    await screen.findByText("clip.mp4");
    expect(screen.getByText("确认损坏，可清理")).toBeInTheDocument();
    expect(screen.getAllByText("访问异常，不可清理")).toHaveLength(1);
    expect(screen.getByText("目录访问异常")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全选当前页可清理项" }));
    expect(screen.getByText("已选 2 个可处理项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /永久删除损坏项/ }));
    await waitFor(() => expect(onCleanup).toHaveBeenCalledWith(["failure-video"], "permanent-delete"));
    expect(await screen.findByText(/永久删除完成/)).toBeInTheDocument();
  });

  it("permanently deletes a confirmed corrupt item directly and refreshes afterwards", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    const onDeleteFile = vi.fn().mockResolvedValue(true);
    render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={loadPage} onRetry={vi.fn()} onDeleteFile={onDeleteFile} onOpenLocation={vi.fn()} />);
    await screen.findByText("clip.mp4");
    fireEvent.click(screen.getAllByTitle("永久删除文件")[0]);
    await waitFor(() => expect(onDeleteFile).toHaveBeenCalledWith("failure-video"));
    await waitFor(() => expect(loadPage.mock.calls.length).toBeGreaterThan(1));
  });

  it("cleans a missing CloudDrive record without offering permanent file deletion", async () => {
    const missing = item("unindexed-file");
    missing.failure.errorCode = "ENOENT";
    missing.failure.errorSummary = "ENOENT: no such file or directory";
    const missingPage = { ...page, items: [missing], totalCount: 1 };
    const onCleanup = vi.fn().mockResolvedValue({ action: "remove-missing-record", successCount: 1, skippedCount: 0, failureCount: 0, reclaimedBytes: 0, items: [{ failureId: missing.failure.id, status: "record-removed", message: "ok" }] });
    render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(missingPage)} onRetry={vi.fn()} onDeleteFile={vi.fn()} onCleanup={onCleanup} onOpenLocation={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "清理失效记录" }));
    await waitFor(() => expect(onCleanup).toHaveBeenCalledWith([missing.failure.id], "remove-missing-record"));
    expect(screen.queryByTitle("永久删除文件")).not.toBeInTheDocument();
  });

  it("submits all filtered results as a backend batch instead of only visible ids", async () => {
    const onSubmitBatch = vi.fn().mockResolvedValue({
      id: "job-1", operation: "analyze-metadata", status: "completed", totalCount: 250,
      processedCount: 250, successCount: 250, skippedCount: 0, failureCount: 0,
      currentPath: null, message: "done", createdAt: "2026-01-01", completedAt: "2026-01-01"
    });
    render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRetry={vi.fn()} onDeleteFile={vi.fn()} onSubmitBatch={onSubmitBatch} onOpenLocation={vi.fn()} />);
    await screen.findByText("clip.mp4");
    fireEvent.click(screen.getByRole("button", { name: "全选全部筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "分析元数据" }));

    await waitFor(() => expect(onSubmitBatch).toHaveBeenCalledWith({
      operation: "analyze-metadata",
      scope: { mode: "filtered", query: { kind: "all", cleanupCategory: "all" } }
    }));
  });

  it("runs a single-item retry and reports action failures", async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error("网盘仍不可用"));
    render(<ScanFailuresPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue({ ...page, items: [item("directory")], totalCount: 1 })} onRetry={onRetry} onDeleteFile={vi.fn()} onOpenLocation={vi.fn()} />);
    fireEvent.click(await screen.findByTitle("仅重试此项"));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("failure-directory"));
    expect(await screen.findByText("网盘仍不可用")).toBeInTheDocument();
  });
});
