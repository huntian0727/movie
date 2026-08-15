import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerPage } from "../../src/renderer/components/PlayerPage";
import type { VideoRecord } from "../../src/shared/videoTypes";
import { DEFAULT_SHORTCUTS } from "../../src/shared/shortcuts";

const video: VideoRecord = {
  id: "v1",
  sourceFolderId: "f1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90000,
  width: 1920,
  height: 1080,
  format: "mp4",
  videoCodec: null,
  videoProfile: null,
  pixelFormat: null,
  audioCodec: null,
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: false,
  isPendingDelete: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "ready",
  timelinePreviewStatus: "pending",
  coverCachePath: null,
  contentFingerprint: null,
  fingerprintStatus: "pending",
  fingerprintUpdatedAt: null,
  fingerprintError: null
};

let fullscreenElementMock: Element | null = null;

beforeEach(() => {
  fullscreenElementMock = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElementMock
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => {
      fullscreenElementMock = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    })
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    writable: true,
    value: vi.fn(async function requestFullscreenMock(this: HTMLElement) {
      fullscreenElementMock = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    })
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlayerPage", () => {
  it("renders standard player controls", () => {
    render(<PlayerPage video={video} />);
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快退 10 秒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快进 10 秒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "播放进度" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "音量" })).toBeInTheDocument();
  });

  it("calls navigation and favorite actions", () => {
    const onBack = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onToggleFavorite = vi.fn();
    render(
      <PlayerPage
        video={video}
        onBack={onBack}
        onPrevious={onPrevious}
        onNext={onNext}
        onToggleFavorite={onToggleFavorite}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "返回视频库" }));
    fireEvent.click(screen.getByRole("button", { name: "上一部" }));
    fireEvent.click(screen.getByRole("button", { name: "下一部" }));
    fireEvent.click(screen.getByRole("button", { name: "收藏" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith(video);
  });

  it("uses the external playback action for mpv-routed videos", async () => {
    const onPlayExternal = vi.fn().mockResolvedValue(undefined);
    render(<PlayerPage video={{ ...video, extension: ".mkv", filename: "clip.mkv" }} playbackRoute="mpv" onPlayExternal={onPlayExternal} />);
    fireEvent.click(screen.getAllByRole("button", { name: "用 mpv 播放" })[0]);
    await waitFor(() => expect(onPlayExternal).toHaveBeenCalledOnce());
  });

  it("renders a timeline preview image while hovering the progress bar", () => {
    render(
      <PlayerPage
        video={{ ...video, width: 720, height: 1280 }}
        getTimelinePreviewUrl={(timeMs) => `local-video://preview/v1/${timeMs}`}
      />
    );
    const slider = screen.getByRole("slider", { name: "播放进度" });
    const progressWrap = slider.parentElement!;
    vi.spyOn(progressWrap, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
      top: 0,
      right: 100,
      bottom: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    fireEvent.mouseMove(progressWrap, { clientX: 50 });

    expect(document.querySelector(".progress-preview img")).toHaveAttribute("src", "local-video://preview/v1/45000");
    expect(document.querySelector(".progress-preview img")).toHaveAttribute(
      "style",
      expect.stringContaining("--preview-aspect-ratio: 720 / 1280")
    );
  });

  it("tries external playback when native playback errors", async () => {
    const onPlayExternal = vi.fn().mockResolvedValue(undefined);
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" onPlayExternal={onPlayExternal} />);

    fireEvent.error(document.querySelector("video")!);

    await waitFor(() => expect(onPlayExternal).toHaveBeenCalledOnce());
  });

  it("marks the native player to autoplay when the setting is enabled", () => {
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" autoPlayOnOpen />);
    expect(document.querySelector("video")).toHaveProperty("autoplay", true);
  });

  it("adjusts native playback volume with up and down arrows", () => {
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);
    const media = document.querySelector("video")!;

    fireEvent.keyDown(window, { code: "ArrowDown" });
    expect(media.volume).toBeCloseTo(0.95);
    fireEvent.keyDown(window, { code: "ArrowUp" });
    expect(media.volume).toBeCloseTo(1);
  });

  it("marks the current video for later deletion", async () => {
    const onTogglePendingDelete = vi.fn();
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" onTogglePendingDelete={onTogglePendingDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "标记待删除" }));

    await waitFor(() => expect(onTogglePendingDelete).toHaveBeenCalledWith(video));
  });

  it("permanently deletes from the page button after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "永久删除视频" }));
    expect(screen.getByRole("alertdialog", { name: "永久删除这个视频？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(onDelete).toHaveBeenCalledWith(video);
  });

  it("opens deletion with Ctrl+D and confirms it with Enter", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" onDelete={onDelete} />);

    fireEvent.keyDown(window, { code: "KeyD", ctrlKey: true });
    expect(screen.getByRole("alertdialog", { name: "永久删除这个视频？" })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "Enter" });

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
  });

  it("uses a customized deletion shortcut and stops using the old binding", () => {
    const onDelete = vi.fn();
    render(
      <PlayerPage
        video={video}
        mediaUrl="local-video://media/v1"
        onDelete={onDelete}
        shortcuts={{ ...DEFAULT_SHORTCUTS, playerDelete: "Ctrl+KeyX" }}
      />
    );

    fireEvent.keyDown(window, { code: "KeyD", ctrlKey: true });
    expect(screen.queryByRole("alertdialog", { name: "永久删除这个视频？" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyX", ctrlKey: true });
    expect(screen.getByRole("alertdialog", { name: "永久删除这个视频？" })).toBeInTheDocument();
  });

  it("rotates native playback 90 degrees with Ctrl and left or right arrows", () => {
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);
    const media = document.querySelector("video")!;

    fireEvent.keyDown(window, { code: "ArrowRight", ctrlKey: true });
    expect(media).toHaveStyle({ transform: "translate(-50%, -50%) rotate(90deg)" });
    fireEvent.keyDown(window, { code: "ArrowLeft", ctrlKey: true });
    expect(media).toHaveStyle({ transform: "translate(-50%, -50%) rotate(0deg)" });
  });

  it("uses decoded dimensions to fit a rotated video when stored metadata is missing", () => {
    const { container } = render(
      <PlayerPage video={{ ...video, width: null, height: null }} mediaUrl="local-video://media/v1" />
    );
    const stage = container.querySelector(".player-stage")!;
    const media = document.querySelector("video")!;
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 800 }
    });
    fireEvent(window, new Event("resize"));
    Object.defineProperties(media, {
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 }
    });
    fireEvent.loadedMetadata(media);

    fireEvent.keyDown(window, { code: "ArrowRight", ctrlKey: true });

    expect(media).toHaveStyle({
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%) rotate(90deg)",
      width: "675px",
      height: "1200px"
    });
  });

  it("opens the current directory playlist and switches to a selected video", async () => {
    const nextVideo: VideoRecord = { ...video, id: "v2", path: "D:\\Movies\\next.mp4", filename: "next.mp4", basename: "next" };
    const loadDirectoryPlaylist = vi.fn().mockResolvedValue({
      videos: [video, nextVideo],
      page: 1,
      pageSize: 100,
      totalPages: 1,
      totalCount: 2
    });
    const onSelectPlaylistVideo = vi.fn();
    render(
      <PlayerPage
        video={video}
        mediaUrl="local-video://media/v1"
        loadDirectoryPlaylist={loadDirectoryPlaylist}
        onSelectPlaylistVideo={onSelectPlaylistVideo}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "播放列表" }));

    await waitFor(() => expect(loadDirectoryPlaylist).toHaveBeenCalledWith(1));
    expect(screen.getByText("2 个视频 · 当前文件夹")).toBeInTheDocument();
    expect(screen.getByText("正在播放")).toBeInTheDocument();
    expect(screen.getAllByText("01:30")).toHaveLength(2);
    fireEvent.click(screen.getByText("next.mp4").closest("button")!);
    expect(onSelectPlaylistVideo).toHaveBeenCalledWith(nextVideo, [video, nextVideo]);
  });

  it("shows pending playlist durations as analysis instead of zero", async () => {
    const pendingVideo = { ...video, durationMs: null, metadataStatus: "pending" as const };
    const loadDirectoryPlaylist = vi.fn().mockResolvedValue({
      videos: [pendingVideo],
      page: 1,
      pageSize: 100,
      totalPages: 1,
      totalCount: 1
    });
    render(<PlayerPage video={pendingVideo} mediaUrl="local-video://media/v1" loadDirectoryPlaylist={loadDirectoryPlaylist} />);

    fireEvent.click(screen.getByRole("button", { name: "播放列表" }));

    await waitFor(() => expect(screen.getByText("分析中")).toBeInTheDocument());
    expect(screen.queryByText("00:00")).not.toBeInTheDocument();
  });

  it("launches external playback automatically when autoplay is enabled for mpv", async () => {
    const onPlayExternal = vi.fn().mockResolvedValue(undefined);
    render(<PlayerPage video={video} playbackRoute="mpv" autoPlayOnOpen onPlayExternal={onPlayExternal} />);
    await waitFor(() => expect(onPlayExternal).toHaveBeenCalledOnce());
  });

  it("enters fullscreen from the control button and syncs the fullscreen state", async () => {
    const { container } = render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));

    await waitFor(() => expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledOnce());
    expect(container.querySelector(".player-page.is-fullscreen")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2);
  });

  it("exits fullscreen from the explicit exit button", async () => {
    const { container } = render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "退出全屏" })).toHaveLength(2));

    fireEvent.click(screen.getAllByRole("button", { name: "退出全屏" })[0]);

    await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledOnce());
    expect(container.querySelector(".player-page.is-fullscreen")).not.toBeInTheDocument();
  });

  it("toggles fullscreen when double-clicking the player stage", async () => {
    const { container } = render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);
    const stage = container.querySelector(".player-stage");

    expect(stage).toBeTruthy();

    fireEvent.doubleClick(stage!);
    await waitFor(() => expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledOnce());

    fireEvent.doubleClick(stage!);
    await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledOnce());
  });

  it("opens the details dialog and closes it with the close button and escape", () => {
    render(<PlayerPage video={video} mediaUrl="local-video://media/v1" />);

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByRole("dialog", { name: "clip.mp4" })).toBeInTheDocument();
    expect(document.querySelector("video")).toBeInTheDocument();
    expect(screen.getByText("完整路径")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("dialog", { name: "clip.mp4" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByRole("dialog", { name: "clip.mp4" })).not.toBeInTheDocument();
  });

  it("copies the video path from the details dialog", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText }
    });

    render(<PlayerPage video={video} />);
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    fireEvent.click(screen.getByRole("button", { name: "复制路径" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("D:\\Movies\\clip.mp4"));
    expect(screen.getByText("路径已复制")).toBeInTheDocument();
  });

  it("renders fallback labels for missing metadata in the details dialog", () => {
    render(
      <PlayerPage
        video={{
          ...video,
          durationMs: null,
          width: null,
          height: null,
          format: null,
          metadataStatus: "failed",
          thumbnailStatus: "failed",
          timelinePreviewStatus: "pending"
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));

    expect(screen.getAllByText("未识别")).toHaveLength(2);
    expect(screen.getAllByText("失败")).toHaveLength(2);
    expect(screen.getByText("待生成")).toBeInTheDocument();
  });
});
