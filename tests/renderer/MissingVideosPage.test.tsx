import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MissingVideosPage } from "../../src/renderer/components/MissingVideosPage";
import type { MissingVideoActionResult, MissingVideoPage, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";

const folder: SourceFolder = {
  id: "sccm", path: "D:\\sccm", recursive: true, enabled: true, lastScannedAt: "2026-09-06T15:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-06T15:00:00.000Z", scanError: null, providerType: "local"
};

const missingVideo = createVideo();
const page: MissingVideoPage = { items: [missingVideo], page: 1, pageSize: 30, totalPages: 1, totalCount: 64 };

describe("MissingVideosPage", () => {
  it("loads a source-scoped missing list and rechecks selected records", async () => {
    const loadPage = vi.fn().mockResolvedValue(page);
    const onRecheck = vi.fn().mockResolvedValue(actionResult("recheck", { restoredCount: 0, stillMissingCount: 1 }));
    render(<MissingVideosPage folders={[folder]} initialSourceFolderId={folder.id} refreshSequence={0} loadPage={loadPage} onRecheck={onRecheck} onForget={vi.fn()} />);

    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(loadPage).toHaveBeenCalledWith(expect.objectContaining({ sourceFolderId: folder.id, page: 1, pageSize: 30 }));
    expect(screen.getByText("64 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 clip.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: /复查可访问性/ }));
    await waitFor(() => expect(onRecheck).toHaveBeenCalledWith([missingVideo.id]));
    expect(await screen.findByText(/仍缺失 1 条/)).toBeInTheDocument();
  });

  it("requires confirmation and explains that cleanup only removes database records", async () => {
    const onForget = vi.fn().mockResolvedValue(actionResult("forget", { removedCount: 1 }));
    render(<MissingVideosPage folders={[folder]} refreshSequence={0} loadPage={vi.fn().mockResolvedValue(page)} onRecheck={vi.fn()} onForget={onForget} />);

    await screen.findByText("clip.mp4");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 clip.mp4" }));
    fireEvent.click(screen.getByRole("button", { name: "仅移除资料库记录" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("不会删除或修改任何磁盘文件");
    fireEvent.click(screen.getByRole("button", { name: "确认仅移除记录" }));

    await waitFor(() => expect(onForget).toHaveBeenCalledWith([missingVideo.id]));
    expect(await screen.findByText(/仅移除 1 条资料库记录/)).toBeInTheDocument();
  });

  it("shows loader, error, and empty states", async () => {
    const never = new Promise<MissingVideoPage>(() => undefined);
    const { rerender } = render(<MissingVideosPage folders={[folder]} refreshSequence={0} loadPage={() => never} onRecheck={vi.fn()} onForget={vi.fn()} />);
    expect(screen.getByRole("status", { name: "正在读取缺失记录" })).toBeInTheDocument();

    rerender(<MissingVideosPage folders={[folder]} refreshSequence={1} loadPage={vi.fn().mockRejectedValue(new Error("database busy"))} onRecheck={vi.fn()} onForget={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("database busy");
  });
});

function actionResult(operation: "recheck" | "forget", overrides: Partial<MissingVideoActionResult>): MissingVideoActionResult {
  return { operation, requestedCount: 1, restoredCount: 0, stillMissingCount: 0, removedCount: 0, skippedCount: 0, failureCount: 0, items: [], ...overrides };
}

function createVideo(): VideoRecord {
  return {
    id: "missing-1", sourceFolderId: folder.id, path: "D:\\sccm\\clip.mp4", directory: folder.path, filename: "clip.mp4", basename: "clip", extension: ".mp4",
    sizeBytes: 4096, durationMs: 5000, width: 1920, height: 1080, format: "mp4", videoCodec: "h264", videoProfile: null, pixelFormat: null, audioCodec: "aac",
    codecProbeStatus: "ready", modifiedAt: "2026-09-01T00:00:00.000Z", importedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
    metadataStatus: "ready", thumbnailStatus: "ready", timelinePreviewStatus: "ready", contentFingerprint: null, fingerprintStatus: "pending", fingerprintUpdatedAt: null,
    fingerprintError: null, coverCachePath: null, isFavorite: false, isPendingDelete: false, isMissing: true, providerFileId: null, providerPath: null, durationSource: "local-probe"
  };
}
