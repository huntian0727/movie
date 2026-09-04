import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackDiagnosticPage } from "../../src/renderer/components/PlaybackDiagnosticPage";
import type { LibraryPage, LibraryPageQuery, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";

const video: VideoRecord = {
  id: "v1",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90_000,
  width: 1920,
  height: 1080,
  format: "mp4",
  videoCodec: "h264",
  videoProfile: "high",
  pixelFormat: "yuv420p",
  audioCodec: null,
  codecProbeStatus: "ready",
  modifiedAt: "2026-09-04T00:00:00.000Z",
  importedAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  isFavorite: false,
  isPendingDelete: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "pending",
  timelinePreviewStatus: "pending",
  coverCachePath: null,
  contentFingerprint: null,
  fingerprintStatus: "pending",
  fingerprintUpdatedAt: null,
  fingerprintError: null
};

const folder: SourceFolder = {
  id: "f1",
  path: "D:\\Movies",
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  scanError: null
};

const emptyPage: LibraryPage = { videos: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0 };

function renderPage(overrides: Partial<ComponentProps<typeof PlaybackDiagnosticPage>> = {}) {
  const props: ComponentProps<typeof PlaybackDiagnosticPage> = {
    selectedVideoId: null,
    recentVideoIds: [],
    folders: [folder],
    playbackPreference: "auto",
    loadVideoPage: vi.fn(async () => emptyPage),
    loadVideosByIds: vi.fn(async () => []),
    onSelectVideo: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenScanFailures: vi.fn(),
    ...overrides
  };
  return { ...render(<PlaybackDiagnosticPage {...props} />), props };
}

describe("PlaybackDiagnosticPage", () => {
  it("does not enumerate the library until the user enters a search", async () => {
    const loadVideoPage = vi.fn(async (query: LibraryPageQuery) => ({ ...emptyPage, videos: [video], page: query.page, totalPages: 2, totalCount: 31 }));
    renderPage({ loadVideoPage });

    expect(loadVideoPage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("输入文件名或路径"), { target: { value: "clip" } });

    await waitFor(() => expect(loadVideoPage).toHaveBeenCalledWith({
      view: "all",
      search: "clip",
      sortField: "filename",
      sortDirection: "asc",
      page: 1,
      pageSize: 30
    }));
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(loadVideoPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 30 })));
  });

  it("loads at most ten recent records without loading the all-library page", async () => {
    const recentIds = Array.from({ length: 14 }, (_, index) => `v${index}`);
    const loadVideosByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ ...video, id, filename: `${id}.mp4` })));
    const loadVideoPage = vi.fn(async () => emptyPage);
    renderPage({ recentVideoIds: recentIds, loadVideosByIds, loadVideoPage });

    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledWith(recentIds.slice(0, 10)));
    expect(loadVideoPage).not.toHaveBeenCalled();
    expect(await screen.findByText("v0.mp4")).toBeInTheDocument();
    expect(screen.queryByText("v10.mp4")).not.toBeInTheDocument();
  });

  it("shows cached media fields, source, actual route, and null audio as unrecorded", async () => {
    const loadVideosByIds = vi.fn(async () => [video]);
    renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds });

    expect(await screen.findByText("内置播放器")).toBeInTheDocument();
    expect(screen.getByText(/h264/i)).toBeInTheDocument();
    expect(screen.getByText("本地目录 · D:\\Movies")).toBeInTheDocument();
    expect(screen.getByText("未记录")).toBeInTheDocument();
    expect(loadVideosByIds).toHaveBeenCalledWith([video.id]);
  });

  it("distinguishes audio that is not collected from a completed empty field", async () => {
    const pendingVideo = { ...video, metadataStatus: "pending" as const, codecProbeStatus: "unprobed" as const };
    renderPage({ selectedVideoId: pendingVideo.id, initialVideo: pendingVideo, loadVideosByIds: vi.fn(async () => [pendingVideo]) });

    expect((await screen.findAllByText("尚未采集")).length).toBeGreaterThan(0);
    expect(screen.queryByText("低风险")).not.toBeInTheDocument();
  });

  it("only requests metadata after the explicit action and refreshes through listVideosByIds", async () => {
    const loadVideosByIds = vi.fn(async () => [video]);
    const onRetryMetadata = vi.fn(async () => undefined);
    renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds, onRetryMetadata });
    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledTimes(1));

    expect(onRetryMetadata).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "补充元数据" }));

    await waitFor(() => expect(onRetryMetadata).toHaveBeenCalledWith(video));
    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledTimes(2));
  });

  it("disables playback and metadata retry for a missing video", async () => {
    const missingVideo = { ...video, isMissing: true };
    renderPage({ selectedVideoId: video.id, initialVideo: missingVideo, loadVideosByIds: vi.fn(async () => [missingVideo]), onOpen: vi.fn(), onRetryMetadata: vi.fn() });

    expect(await screen.findByText("资料库记录显示文件当前缺失。播放和元数据重试已停用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按当前策略播放" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "补充元数据" })).toBeDisabled();
  });

  it("shows a removed state when the selected database record no longer exists", async () => {
    renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds: vi.fn(async () => []) });

    expect(await screen.findByText("记录已移除")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看扫描异常" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "更换视频" }).length).toBeGreaterThan(0);
  });

  it("drops a late refresh response after the selected video changes", async () => {
    let resolveFirst: ((videos: VideoRecord[]) => void) | undefined;
    const firstRequest = new Promise<VideoRecord[]>((resolve) => { resolveFirst = resolve; });
    const secondVideo = { ...video, id: "v2", filename: "second.mp4", path: "D:\\Movies\\second.mp4" };
    const loadVideosByIds = vi.fn((ids: string[]) => ids[0] === video.id ? firstRequest : Promise.resolve([secondVideo]));
    const baseProps: ComponentProps<typeof PlaybackDiagnosticPage> = {
      selectedVideoId: video.id,
      initialVideo: video,
      folders: [folder],
      playbackPreference: "auto",
      loadVideoPage: vi.fn(async () => emptyPage),
      loadVideosByIds,
      onSelectVideo: vi.fn(),
      onClearSelection: vi.fn(),
      onOpenScanFailures: vi.fn()
    };
    const { rerender } = render(<PlaybackDiagnosticPage {...baseProps} />);

    rerender(<PlaybackDiagnosticPage {...baseProps} selectedVideoId={secondVideo.id} initialVideo={secondVideo} />);
    expect(await screen.findByText("second.mp4")).toBeInTheDocument();
    resolveFirst?.([video]);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByText("second.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip.mp4")).not.toBeInTheDocument();
  });

  it("contains no direct file, probe, scan, or cover-loading code", () => {
    const source = readFileSync("src/renderer/components/PlaybackDiagnosticPage.tsx", "utf8");
    expect(source).not.toMatch(/from ["']node:fs|ffprobe|getCoverUrl|scanFolder|refresh\(/);
  });
});
