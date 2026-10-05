import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackDiagnosticPage } from "../../src/renderer/components/PlaybackDiagnosticPage";
import type { LibraryPage, MissingVideoActionResult, PlaybackDiagnosticSearchQuery, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";

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

const availableResult: MissingVideoActionResult = {
  operation: "recheck",
  requestedCount: 1,
  restoredCount: 0,
  stillMissingCount: 0,
  removedCount: 0,
  skippedCount: 1,
  failureCount: 0,
  items: [{
    videoId: video.id,
    path: video.path,
    status: "skipped",
    message: "已确认文件存在，文件大小与修改时间未变化"
  }]
};

function renderPage(overrides: Partial<ComponentProps<typeof PlaybackDiagnosticPage>> = {}) {
  const props: ComponentProps<typeof PlaybackDiagnosticPage> = {
    selectedVideoId: null,
    recentVideoIds: [],
    folders: [folder],
    playbackPreference: "auto",
    searchVideos: vi.fn(async () => emptyPage),
    loadVideosByIds: vi.fn(async () => []),
    onSelectVideo: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenScanFailures: vi.fn(),
    onCheckFileAvailability: vi.fn(async () => availableResult),
    ...overrides
  };
  return { ...render(<PlaybackDiagnosticPage {...props} />), props };
}

describe("PlaybackDiagnosticPage", () => {
  it("does not enumerate the library until the user enters a search", async () => {
    const searchVideos = vi.fn(async (query: PlaybackDiagnosticSearchQuery) => ({ ...emptyPage, videos: [video], page: query.page, totalPages: 2, totalCount: 31 }));
    renderPage({ searchVideos });

    expect(searchVideos).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("输入文件名或路径"), { target: { value: "clip" } });

    await waitFor(() => expect(searchVideos).toHaveBeenCalledWith({
      search: "clip",
      page: 1,
      pageSize: 30
    }));
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(document.querySelector("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(searchVideos).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 30 })));
  });

  it("loads at most ten recent records without loading the all-library page", async () => {
    const recentIds = Array.from({ length: 14 }, (_, index) => `v${index}`);
    const loadVideosByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ ...video, id, filename: `${id}.mp4` })));
    const searchVideos = vi.fn(async () => emptyPage);
    renderPage({ recentVideoIds: recentIds, loadVideosByIds, searchVideos });

    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledWith(recentIds.slice(0, 10)));
    expect(searchVideos).not.toHaveBeenCalled();
    expect(await screen.findByText("v0.mp4")).toBeInTheDocument();
    expect(screen.queryByText("v10.mp4")).not.toBeInTheDocument();
  });

  it("shows search errors instead of an empty state and retries only the search", async () => {
    const searchVideos = vi.fn()
      .mockRejectedValueOnce(new Error("database busy\n    at hidden-stack"))
      .mockResolvedValueOnce(emptyPage);
    renderPage({ searchVideos });

    fireEvent.change(screen.getByPlaceholderText("输入文件名或路径"), { target: { value: "clip" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("搜索失败：database busy");
    expect(alert).not.toHaveTextContent("hidden-stack");
    expect(screen.queryByText("没有找到匹配视频")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

    await waitFor(() => expect(searchVideos).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("没有找到匹配视频")).toBeInTheDocument();
  });

  it("reports when all recent record ids are no longer valid", async () => {
    renderPage({ recentVideoIds: ["removed-1", "removed-2"], loadVideosByIds: vi.fn(async () => []) });

    expect(await screen.findByText("最近播放记录已失效")).toBeInTheDocument();
    expect(screen.getByText("这些记录已从资料库移除，请搜索其他视频。")).toBeInTheDocument();
  });

  it("retries a recent-record failure without starting a search", async () => {
    const loadVideosByIds = vi.fn()
      .mockRejectedValueOnce(new Error("recent cache busy"))
      .mockResolvedValueOnce([video]);
    const searchVideos = vi.fn(async () => emptyPage);
    renderPage({ recentVideoIds: [video.id], loadVideosByIds, searchVideos });

    expect(await screen.findByRole("alert")).toHaveTextContent("最近播放读取失败：recent cache busy");
    expect(screen.queryByText("最近播放记录已失效")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

    expect(await screen.findByText(video.filename)).toBeInTheDocument();
    expect(loadVideosByIds).toHaveBeenCalledTimes(2);
    expect(searchVideos).not.toHaveBeenCalled();
  });

  it("uses a div landmark root and limits live announcements to the result summary", () => {
    const { container } = renderPage();
    const root = container.querySelector(".playback-diagnostic-page");
    const results = container.querySelector(".diagnostic-video-results");

    expect(root?.tagName).toBe("DIV");
    expect(container.querySelector("main")).toBeNull();
    expect(results).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(results).toHaveAttribute("aria-busy", "false");
  });

  it("shows cached media fields, source, actual route, and null audio as unrecorded", async () => {
    const loadVideosByIds = vi.fn(async () => [video]);
    const { container } = renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds });

    expect(await screen.findByText("内置播放器")).toBeInTheDocument();
    expect(screen.getByText(/h264/i)).toBeInTheDocument();
    expect(screen.getByText("本地目录 · D:\\Movies")).toBeInTheDocument();
    expect(screen.getByText("未记录")).toBeInTheDocument();
    expect(container.querySelector(".diagnostic-file-heading + .diagnostic-analysis")).toBeInTheDocument();
    expect(container.querySelector(".diagnostic-information-grid > .diagnostic-analysis")).toBeNull();
    expect(container.querySelectorAll(".diagnostic-information-grid > .diagnostic-info-section")).toHaveLength(3);
    expect(container.querySelector(".diagnostic-info-section dd.wrap")).toHaveTextContent(video.path);
    expect(screen.getByRole("button", { name: "检查文件状态" })).toHaveAttribute("title", "本地文件将检查目录与文件；CloudDrive 文件将通过 API 强制刷新远端目录");
    expect(loadVideosByIds).toHaveBeenCalledWith([video.id]);
  });

  it("checks the actual file state and refreshes the selected database record", async () => {
    const loadVideosByIds = vi.fn(async () => [video]);
    const onCheckFileAvailability = vi.fn(async () => availableResult);
    renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds, onCheckFileAvailability });
    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "检查文件状态" }));

    await waitFor(() => expect(onCheckFileAvailability).toHaveBeenCalledWith([video.id]));
    expect(await screen.findByText("已确认文件存在，文件大小与修改时间未变化")).toBeInTheDocument();
    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledTimes(2));
  });

  it("offers a local cache retry when the selected record read fails", async () => {
    const loadVideosByIds = vi.fn()
      .mockRejectedValueOnce(new Error("cache unavailable\n    at hidden-stack"))
      .mockResolvedValueOnce([video]);
    renderPage({ selectedVideoId: video.id, initialVideo: null, loadVideosByIds });

    expect(await screen.findByText("无法读取视频记录")).toBeInTheDocument();
    expect(screen.getByText("cache unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/hidden-stack/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取记录" }));

    expect(await screen.findByText("内置播放器")).toBeInTheDocument();
    expect(loadVideosByIds).toHaveBeenCalledTimes(2);
  });

  it("announces action progress and marks the primary playback action", async () => {
    let finishOpen: (() => void) | undefined;
    const pendingOpen = new Promise<void>((resolve) => { finishOpen = resolve; });
    const onOpen = vi.fn(() => pendingOpen);
    const { container } = renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds: vi.fn(async () => [video]), onOpen });
    const playButton = await screen.findByRole("button", { name: "按当前策略播放" });

    expect(playButton).toHaveClass("primary");
    fireEvent.click(playButton);
    expect(screen.getByRole("button", { name: "正在启动..." })).toBeDisabled();
    expect(container.querySelector(".diagnostic-actions")).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      finishOpen?.();
      await pendingOpen;
    });
    expect(screen.getByRole("button", { name: "按当前策略播放" })).toBeEnabled();
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
      searchVideos: vi.fn(async () => emptyPage),
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

  it("separates database record refresh from actual file checks and metadata submission", async () => {
    const loadVideosByIds = vi.fn().mockResolvedValue([video]);
    const onCheckFileAvailability = vi.fn(); const onRetryMetadata = vi.fn();
    renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds, onCheckFileAvailability, onRetryMetadata });
    const refresh = await screen.findByRole("button", { name: "重新读取记录" });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await waitFor(() => expect(loadVideosByIds).toHaveBeenCalledTimes(2));
    expect(onCheckFileAvailability).not.toHaveBeenCalled();
    expect(onRetryMetadata).not.toHaveBeenCalled();
  });

  it("ignores an availability result from the previously selected video", async () => {
    let resolveCheck!: (result: MissingVideoActionResult) => void;
    const onCheckFileAvailability = vi.fn(() => new Promise<MissingVideoActionResult>((resolve) => { resolveCheck = resolve; }));
    const second = { ...video, id: "v2", filename: "second.mp4" };
    const loadVideosByIds = vi.fn((ids: string[]) => Promise.resolve([ids[0] === video.id ? video : second]));
    const { props, rerender } = renderPage({ selectedVideoId: video.id, initialVideo: video, loadVideosByIds, onCheckFileAvailability });
    await waitFor(() => expect(screen.getByRole("button", { name: "检查文件状态" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "检查文件状态" }));
    rerender(<PlaybackDiagnosticPage {...props} selectedVideoId={second.id} initialVideo={second} />);
    await screen.findByText("second.mp4");
    await act(async () => resolveCheck(availableResult));
    expect(screen.queryByText(availableResult.items[0].message)).not.toBeInTheDocument();
    expect(loadVideosByIds).toHaveBeenCalledTimes(2);
  });
});
