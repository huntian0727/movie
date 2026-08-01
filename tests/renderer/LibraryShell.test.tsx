import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryShell } from "../../src/renderer/components/LibraryShell";
import type { DuplicateGroup, SourceFolder, VideoRecord } from "../../src/shared/videoTypes";
import { DEFAULT_SHORTCUTS } from "../../src/shared/shortcuts";

const folder: SourceFolder = {
  id: "f1",
  path: "D:\\Movies",
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  scanError: null
};

const nestedFolder: SourceFolder = {
  ...folder,
  id: "f2",
  path: "D:\\Movies\\Drama"
};

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
  modifiedAt: "2026-07-09T00:00:00.000Z",
  importedAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
  isFavorite: true,
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

const nestedVideo: VideoRecord = {
  ...video,
  id: "v-nested",
  path: "D:\\Movies\\Drama\\episode-01.mp4",
  directory: "D:\\Movies\\Drama",
  filename: "episode-01.mp4",
  basename: "episode-01"
};

const deepNestedVideo: VideoRecord = {
  ...video,
  id: "v-deep",
  path: "D:\\Movies\\Drama\\Season 1\\episode-02.mp4",
  directory: "D:\\Movies\\Drama\\Season 1",
  filename: "episode-02.mp4",
  basename: "episode-02"
};

const scanCounters = {
  totalFolders: 0, currentFolderIndex: 0, completedFolders: 0, failedFolders: 0,
  checkedDirectories: 1, changedDirectories: 1, skippedDirectories: 0, processedVideos: 7,
  skippedVideos: 0, addedVideos: 0, updatedVideos: 0, missingVideos: 0,
  fileFailures: 0, directoryFailures: 0, pendingFailures: 0, retriedFailures: 0, resolvedFailures: 0
};

const duplicateGroups: DuplicateGroup[] = [
  {
    groupKey: "fingerprint-1",
    identityStatus: "size_duration_match",
    recommendedKeepVideoId: video.id,
    reclaimableBytes: nestedVideo.sizeBytes,
    items: [
      { video, isRecommendedToKeep: true, keepReason: "已收藏" },
      { video: nestedVideo, isRecommendedToKeep: false, keepReason: null }
    ]
  }
];

function makeVideo(index: number): VideoRecord {
  return {
    ...video,
    id: `v${index}`,
    filename: `clip-${String(index).padStart(3, "0")}.mp4`,
    basename: `clip-${String(index).padStart(3, "0")}`
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("LibraryShell", () => {
  it("renders navigation, toolbar, and video metadata", () => {
    render(<LibraryShell videos={[video]} folders={[folder]} />);
    expect(screen.getByRole("button", { name: "查看所有视频" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看收藏视频" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索文件名")).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("01:30")).toBeInTheDocument();
  });

  it("shows a clear placeholder while background metadata analysis is pending", () => {
    render(<LibraryShell videos={[{ ...video, durationMs: null, width: null, height: null, metadataStatus: "pending" }]} />);

    expect(screen.getByText("分析中")).toBeInTheDocument();
    expect(screen.getByText("分辨率未知")).toBeInTheDocument();
  });

  it("distinguishes metadata failure and lets the user retry analysis", async () => {
    const onRetryMetadata = vi.fn();
    const failedVideo = {
      ...video,
      durationMs: null,
      width: null,
      height: null,
      metadataStatus: "failed" as const
    };

    render(<LibraryShell videos={[failedVideo]} onRetryMetadata={onRetryMetadata} />);

    expect(screen.getByText("元数据失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新分析 clip.mp4" }));
    await waitFor(() => expect(onRetryMetadata).toHaveBeenCalledWith(failedVideo));
  });

  it("filters by favorite and can switch to table view", () => {
    render(<LibraryShell videos={[video, { ...video, id: "v2", filename: "other.mkv", isFavorite: false }]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看收藏视频" }));
    expect(screen.queryByText("other.mkv")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("calls the favorite action", async () => {
    const onToggleFavorite = vi.fn();
    render(<LibraryShell videos={[video]} onToggleFavorite={onToggleFavorite} />);
    fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
    await waitFor(() => expect(onToggleFavorite).toHaveBeenCalledWith(video));
  });

  it("marks videos for deletion and filters them in the pending-delete view", async () => {
    const onTogglePendingDelete = vi.fn();
    const marked = { ...video, id: "marked", filename: "marked.mp4", isPendingDelete: true };
    render(<LibraryShell videos={[video, marked]} onTogglePendingDelete={onTogglePendingDelete} />);

    fireEvent.click(screen.getAllByRole("button", { name: "标记待删除" })[0]);
    await waitFor(() => expect(onTogglePendingDelete).toHaveBeenCalledWith(video));
    fireEvent.click(screen.getByRole("button", { name: "查看待删除视频" }));

    expect(screen.getByText("marked.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip.mp4")).not.toBeInTheDocument();
  });

  it("clears every pending-delete video after one confirmation", async () => {
    const onDeleteAllPending = vi.fn().mockResolvedValue({ successCount: 2, failureCount: 0, reclaimedBytes: 3072, failures: [] });
    render(
      <LibraryShell
        videos={[]}
        navigation={{ totalVideos: 10, favoriteVideos: 0, pendingDeleteVideos: 2, pendingDeleteBytes: 3072, pendingMetadataVideos: 0, directoryPaths: [] }}
        onDeleteAllPending={onDeleteAllPending}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看待删除视频" }));
    fireEvent.click(screen.getByRole("button", { name: "全部永久删除" }));
    expect(screen.getByText(/全部 2 个待删除视频/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));

    await waitFor(() => expect(onDeleteAllPending).toHaveBeenCalledOnce());
  });

  it("opens a video's containing folder from the card action next to delete", async () => {
    const onRevealInFolder = vi.fn().mockResolvedValue(undefined);
    render(<LibraryShell videos={[video]} onRevealInFolder={onRevealInFolder} />);

    fireEvent.click(screen.getByRole("button", { name: "打开 clip.mp4 所在文件夹" }));

    await waitFor(() => expect(onRevealInFolder).toHaveBeenCalledWith(video));
  });

  it("filters the grid to videos in the selected video's exact directory", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder]} />);

    fireEvent.click(screen.getByRole("button", { name: "查看 clip.mp4 同目录视频" }));

    expect(screen.getByRole("heading", { name: "同目录 · Movies" })).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.queryByText("episode-01.mp4")).not.toBeInTheDocument();
    expect(screen.queryByText("episode-02.mp4")).not.toBeInTheDocument();
  });

  it("renames through an in-app dialog", async () => {
    const onRename = vi.fn();
    render(<LibraryShell videos={[video]} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    fireEvent.change(screen.getByLabelText("文件名"), { target: { value: "new-name" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(video, "new-name"));
  });

  it("opens videos with the currently sorted playback queue", () => {
    const onOpen = vi.fn();
    const zeta = { ...video, id: "z", filename: "zeta.mp4" };
    const alpha = { ...video, id: "a", filename: "alpha.mp4" };
    render(<LibraryShell videos={[zeta, alpha]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "播放 alpha.mp4" }));
    expect(onOpen).toHaveBeenCalledWith(alpha, [alpha, zeta]);
  });

  it("opens a video when any part of its preview is clicked", () => {
    const onOpen = vi.fn();
    const { container } = render(<LibraryShell videos={[video]} onOpen={onOpen} />);

    fireEvent.click(container.querySelector(".video-cover")!);
    expect(onOpen).toHaveBeenCalledWith(video, [video]);
  });

  it("paginates videos with configurable page sizes", () => {
    const videos = Array.from({ length: 121 }, (_, index) => makeVideo(index + 1));
    render(<LibraryShell videos={videos} />);

    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip-101.mp4")).not.toBeInTheDocument();
    expect(screen.getByLabelText("跳转页码")).toHaveValue("1");
    expect(screen.getByText("/ 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("clip-101.mp4")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("combobox").at(-1)!, { target: { value: "200" } });
    expect(screen.getByText("clip-121.mp4")).toBeInTheDocument();
    expect(screen.getByLabelText("跳转页码")).toHaveValue("1");
    expect(screen.getByText("/ 1")).toBeInTheDocument();
  });

  it("offers 30 and 50 item page sizes and jumps directly to a validated page", () => {
    const videos = Array.from({ length: 121 }, (_, index) => makeVideo(index + 1));
    render(<LibraryShell videos={videos} />);
    const pageSize = screen.getByLabelText("每页视频数量");

    expect([...pageSize.querySelectorAll("option")].map((option) => option.value)).toEqual(["30", "50", "100", "200", "300"]);
    fireEvent.change(pageSize, { target: { value: "30" } });
    expect(screen.getByLabelText("跳转页码")).toHaveValue("1");
    expect(screen.getByText("/ 5")).toBeInTheDocument();

    const pageInput = screen.getByLabelText("跳转页码");
    fireEvent.change(pageInput, { target: { value: "4" } });
    fireEvent.keyDown(pageInput, { key: "Enter" });

    expect(screen.getByText("clip-091.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip-001.mp4")).not.toBeInTheDocument();

    fireEvent.change(pageInput, { target: { value: "99" } });
    fireEvent.blur(pageInput);
    expect(screen.getByLabelText("跳转页码")).toHaveValue("5");
  });

  it("restores the selected library page size after remounting", () => {
    const first = render(<LibraryShell videos={[video]} />);
    fireEvent.change(screen.getByLabelText("每页视频数量"), { target: { value: "50" } });
    expect(window.localStorage.getItem("video-manager:library-page-size")).toBe("50");
    first.unmount();

    render(<LibraryShell videos={[video]} />);
    expect(screen.getByLabelText("每页视频数量")).toHaveValue("50");
  });

  it("changes pages with left and right arrows unless an input is active", () => {
    const videos = Array.from({ length: 61 }, (_, index) => makeVideo(index + 1));
    render(<LibraryShell videos={videos} />);
    fireEvent.change(screen.getByLabelText("每页视频数量"), { target: { value: "30" } });

    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(screen.getByText("clip-031.mp4")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("搜索文件名");
    fireEvent.keyDown(search, { code: "ArrowRight" });
    expect(screen.getByText("clip-031.mp4")).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "ArrowLeft" });
    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument();
  });

  it("changes pages with customized library shortcuts", () => {
    const videos = Array.from({ length: 61 }, (_, index) => makeVideo(index + 1));
    render(
      <LibraryShell
        videos={videos}
        shortcuts={{
          ...DEFAULT_SHORTCUTS,
          libraryPreviousPage: "KeyA",
          libraryNextPage: "KeyD"
        }}
      />
    );
    fireEvent.change(screen.getByLabelText("每页视频数量"), { target: { value: "30" } });

    fireEvent.keyDown(window, { code: "ArrowRight" });
    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyD" });
    expect(screen.getByText("clip-031.mp4")).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyA" });
    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument();
  });

  it("resizes masonry cards in five steps and remembers the selected width", () => {
    const view = render(<LibraryShell videos={[video]} />);
    const { container } = view;
    const slider = screen.getByRole("slider", { name: "预览卡片大小" });
    const grid = container.querySelector(".video-grid--masonry");

    expect(slider).toHaveValue("2");
    expect(grid).toHaveAttribute("style", expect.stringContaining("--video-card-width: 260px"));

    fireEvent.change(slider, { target: { value: "4" } });
    expect(grid).toHaveAttribute("style", expect.stringContaining("--video-card-width: 400px"));
    expect(window.localStorage.getItem("video-manager:grid-card-width")).toBe("400");

    fireEvent.click(screen.getByRole("button", { name: "缩小预览卡片" }));
    expect(grid).toHaveAttribute("style", expect.stringContaining("--video-card-width: 320px"));
    view.unmount();

    const restored = render(<LibraryShell videos={[video]} />);
    expect(screen.getByRole("slider", { name: "预览卡片大小" })).toHaveValue("3");
    expect(restored.container.querySelector(".video-grid--masonry")).toHaveAttribute("style", expect.stringContaining("--video-card-width: 320px"));
  });

  it("shows recently played videos in history order", () => {
    const first = { ...video, id: "first", filename: "first.mp4" };
    const second = { ...video, id: "second", filename: "second.mp4" };
    render(<LibraryShell videos={[first, second]} recentVideoIds={["second", "first"]} />);

    fireEvent.click(screen.getByRole("button", { name: "查看最近播放" }));

    const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(titles).toEqual(["second.mp4", "first.mp4"]);
  });

  it("shows child directories collapsed by default and lets folders expand recursively", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder]} />);

    expect(screen.getByRole("button", { name: "Movies" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Drama" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Season 1" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Movies" }));
    expect(screen.getByRole("button", { name: "Drama" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Season 1" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Drama" }));
    expect(screen.getByRole("button", { name: "Season 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Drama" }));

    expect(screen.queryByText("clip.mp4")).not.toBeInTheDocument();
    expect(screen.getByText("episode-01.mp4")).toBeInTheDocument();
    expect(screen.getByText("episode-02.mp4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Movies" }));

    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByText("episode-01.mp4")).toBeInTheDocument();
    expect(screen.getByText("episode-02.mp4")).toBeInTheDocument();
  });

  it("does not duplicate nested source folders in the sidebar tree", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder, nestedFolder]} />);

    expect(screen.getAllByRole("button", { name: "Movies" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "展开 Movies" }));
    expect(screen.getAllByRole("button", { name: "Drama" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "展开 Drama" }));
    expect(screen.getAllByRole("button", { name: "Season 1" })).toHaveLength(1);
  });

  it("supports collapsing expanded folders individually", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder]} />);

    fireEvent.click(screen.getByRole("button", { name: "展开 Movies" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 Drama" }));
    expect(screen.getByRole("button", { name: "Season 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠 Drama" }));
    expect(screen.queryByRole("button", { name: "Season 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drama" })).toBeInTheDocument();
  });

  it("searches known folder names and paths without requiring their parents to be expanded", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "搜索文件夹名称或路径" }), {
      target: { value: "Season 1" }
    });

    expect(screen.queryByRole("button", { name: "Movies" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Season 1" })).toBeInTheDocument();
    expect(screen.getByText("D:\\Movies\\Drama\\Season 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除文件夹搜索" }));
    expect(screen.getByRole("button", { name: "Movies" })).toBeInTheDocument();
  });

  it("supports keyboard navigation and expansion in the folder tree", () => {
    render(<LibraryShell videos={[video, nestedVideo, deepNestedVideo]} folders={[folder]} />);

    const movies = screen.getByRole("button", { name: "Movies" });
    movies.focus();
    fireEvent.keyDown(movies, { key: "ArrowRight" });

    const drama = screen.getByRole("button", { name: "Drama" });
    fireEvent.keyDown(movies, { key: "ArrowDown" });
    expect(drama).toHaveFocus();

    fireEvent.keyDown(drama, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Season 1" })).toBeInTheDocument();
    fireEvent.keyDown(drama, { key: "ArrowLeft" });
    expect(screen.queryByRole("button", { name: "Season 1" })).not.toBeInTheDocument();
  });

  it("remembers the resized sidebar width and supports keyboard resizing", () => {
    const { container, unmount } = render(<LibraryShell videos={[video]} folders={[folder]} />);
    const resizer = screen.getByRole("separator", { name: "调整侧栏宽度" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(container.querySelector(".app-shell")).toHaveStyle({ "--sidebar-width": "310px" });
    expect(window.localStorage.getItem("video-manager:sidebar-width")).toBe("310");

    unmount();
    const restored = render(<LibraryShell videos={[video]} folders={[folder]} />);
    expect(restored.container.querySelector(".app-shell")).toHaveStyle({ "--sidebar-width": "310px" });
  });

  it("only retries a failed cover when its URL changes", () => {
    const getCoverUrl = vi.fn((item: VideoRecord) => `local-video://cover/${item.id}?v=${item.updatedAt}`);
    const { rerender, container } = render(<LibraryShell videos={[video]} getCoverUrl={getCoverUrl} />);

    fireEvent.error(container.querySelector(".video-cover img")!);
    expect(container.querySelector(".video-cover img")).toBeNull();

    rerender(<LibraryShell videos={[{ ...video }]} getCoverUrl={getCoverUrl} />);
    expect(container.querySelector(".video-cover img")).toBeNull();

    rerender(<LibraryShell videos={[{ ...video, updatedAt: "2026-07-19T00:00:00.000Z" }]} getCoverUrl={getCoverUrl} />);
    expect(container.querySelector(".video-cover img")).not.toBeNull();
  });

  it("uses each video's aspect ratio for the cover container", () => {
    const portraitVideo = {
      ...video,
      id: "portrait",
      filename: "portrait.mp4",
      basename: "portrait",
      width: 720,
      height: 1280
    };

    const { container } = render(<LibraryShell videos={[portraitVideo]} />);

    expect(container.querySelector(".video-cover")).toHaveAttribute("style", expect.stringContaining("--cover-aspect-ratio: 720 / 1280"));
  });

  it("uses the masonry container across all grid-based library views", () => {
    render(<LibraryShell videos={[video, nestedVideo]} folders={[folder]} recentVideoIds={[nestedVideo.id, video.id]} />);

    const expectMasonryGrid = () => {
      expect(document.querySelector(".video-grid.video-grid--masonry")).toBeInTheDocument();
    };

    expectMasonryGrid();

    fireEvent.click(screen.getByRole("button", { name: "查看收藏视频" }));
    expectMasonryGrid();

    fireEvent.click(screen.getByRole("button", { name: "查看最近播放" }));
    expectMasonryGrid();

    fireEvent.click(screen.getByRole("button", { name: "展开 Movies" }));
    fireEvent.click(screen.getByRole("button", { name: "Drama" }));
    expectMasonryGrid();
  });

  it("opens the details dialog from the all videos grid", () => {
    render(<LibraryShell videos={[video]} />);

    fireEvent.click(screen.getByRole("button", { name: "查看 clip.mp4 详情" }));

    expect(screen.getByRole("dialog", { name: "clip.mp4" })).toBeInTheDocument();
    expect(screen.getByText("完整路径")).toBeInTheDocument();
    expect(screen.getByText("D:\\Movies\\clip.mp4")).toBeInTheDocument();
  });

  it("opens the details dialog from the table view", () => {
    render(<LibraryShell videos={[video]} />);

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    fireEvent.click(screen.getByRole("button", { name: "查看 clip.mp4 详情" }));

    expect(screen.getByRole("dialog", { name: "clip.mp4" })).toBeInTheDocument();
  });

  it("switches to the duplicates view and renders duplicate groups", () => {
    render(
      <LibraryShell
        videos={[video, nestedVideo]}
        duplicateGroups={duplicateGroups}
        onPreviewDuplicateResolve={vi.fn().mockResolvedValue({
          groupCount: 1,
          keepCount: 1,
          deleteCount: 1,
          reclaimableBytes: nestedVideo.sizeBytes
        })}
        onResolveDuplicateGroups={vi.fn().mockResolvedValue({
          groupCount: 1,
          keepCount: 1,
          successCount: 1,
          failureCount: 0,
          reclaimedBytes: nestedVideo.sizeBytes,
          failures: []
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看重复项" }));

    expect(screen.getByText("重复组 01")).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.getByText("episode-01.mp4")).toBeInTheDocument();
  });

  it("loads duplicate groups only after opening the paginated duplicates view", async () => {
    const onLoadDuplicateGroups = vi.fn().mockResolvedValue({
      groups: duplicateGroups,
      page: 1,
      pageSize: 20,
      totalPages: 3,
      totalGroups: 41,
      totalCandidateGroups: 45,
      totalCandidateFiles: 90,
      totalReclaimableBytes: 4096,
      directoryOptions: [{ path: "D:\\Movies", groupCount: 41, estimatedReclaimableBytes: 4096 }]
    });
    render(
      <LibraryShell
        videos={[video, nestedVideo]}
        folders={[folder]}
        onLoadDuplicateGroups={onLoadDuplicateGroups}
        onPreviewDuplicateResolve={vi.fn()}
        onResolveDuplicateGroups={vi.fn()}
      />
    );

    expect(onLoadDuplicateGroups).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看重复项" }));

    await waitFor(() => expect(onLoadDuplicateGroups).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortDirection: "desc" }));
    expect(screen.getAllByText("41")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("重复项大小排序"), { target: { value: "asc" } });
    await waitFor(() => expect(onLoadDuplicateGroups).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, sortDirection: "asc" }));

    fireEvent.click(screen.getByLabelText("选择重复项优先保留目录"));
    fireEvent.click(screen.getByRole("option", { name: /^Movies D:/ }));
    await waitFor(() => expect(onLoadDuplicateGroups).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      sortDirection: "asc",
      preferredDirectoryPath: "D:\\Movies",
      preferredDirectoryScope: "recursive"
    }));
  });

  it("confirms removing an explicit source folder and explains overlapping records", async () => {
    const onRemoveFolder = vi.fn().mockResolvedValue(undefined);
    render(
      <LibraryShell
        videos={[video, nestedVideo, deepNestedVideo]}
        folders={[folder, nestedFolder]}
        onRemoveFolder={onRemoveFolder}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "移除源目录 Movies" }));

    expect(screen.getByRole("alertdialog", { name: "从资料库移除此文件夹？" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/预计移除 1 条视频记录/)).toBeInTheDocument());
    expect(screen.getByText(/另有 2 条记录/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "从资料库移除" }));
    await waitFor(() => expect(onRemoveFolder).toHaveBeenCalledWith(folder));
  });

  it("shows folder scan progress and supports pause and resume", async () => {
    const onPauseFolderScan = vi.fn();
    const onResumeFolderScan = vi.fn();
    const { rerender } = render(
      <LibraryShell
        videos={[video]}
        folders={[folder]}
        scanStatuses={[{ folderId: folder.id, mode: "current-folder", state: "scanning", phase: "processing", totalFiles: 20, processedFiles: 7, currentPath: "D:\\Movies\\clip.mp4", message: null, counters: scanCounters, updatedAt: "" }]}
        onPauseFolderScan={onPauseFolderScan}
        onResumeFolderScan={onResumeFolderScan}
      />
    );

    expect(screen.getByText("已发现 20 · 已处理 7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂停扫描 Movies" }));
    expect(onPauseFolderScan).toHaveBeenCalledWith(folder);

    rerender(
      <LibraryShell
        videos={[video]}
        folders={[folder]}
        scanStatuses={[{ folderId: folder.id, mode: "current-folder", state: "paused", phase: "processing", totalFiles: 20, processedFiles: 7, currentPath: "D:\\Movies\\clip.mp4", message: null, counters: scanCounters, updatedAt: "" }]}
        onPauseFolderScan={onPauseFolderScan}
        onResumeFolderScan={onResumeFolderScan}
      />
    );
    expect(screen.getByText("已暂停 7/20")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续扫描 Movies" }));
    expect(onResumeFolderScan).toHaveBeenCalledWith(folder);
  });

  it("shows active scan progress instead of a stale warning from an older scan", () => {
    const folderWithOldError = { ...folder, scanError: "上次读取网盘超时" };
    render(
      <LibraryShell
        videos={[video]}
        folders={[folderWithOldError]}
        scanStatuses={[{ folderId: folder.id, mode: "current-folder", state: "scanning", phase: "processing", totalFiles: 20, processedFiles: 7, currentPath: "D:\\Movies\\clip.mp4", message: null, counters: scanCounters, updatedAt: "" }]}
      />
    );

    expect(screen.getByLabelText("正在扫描 Movies")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 Movies 扫描异常" })).not.toBeInTheDocument();
  });

  it.each(["queued", "paused"] as const)("hides a stale persisted warning while a scan is %s", (state) => {
    render(
      <LibraryShell
        videos={[video]}
        folders={[{ ...folder, scanError: "上次读取网盘超时" }]}
        scanStatuses={[{
          folderId: folder.id,
          mode: "current-folder",
          state,
          phase: state === "paused" ? "processing" : null,
          totalFiles: 20,
          processedFiles: 7,
          currentPath: null,
          message: null,
          counters: scanCounters,
          updatedAt: ""
        }]}
      />
    );

    expect(screen.queryByRole("button", { name: "查看 Movies 扫描异常" })).not.toBeInTheDocument();
  });

  it("does not show a warning after a completed scan when no persisted error remains", () => {
    render(
      <LibraryShell
        videos={[video]}
        folders={[folder]}
        scanStatuses={[{ folderId: folder.id, mode: "current-folder", state: "completed", phase: null, totalFiles: 20, processedFiles: 20, currentPath: null, message: null, counters: scanCounters, updatedAt: "" }]}
      />
    );

    expect(screen.queryByRole("button", { name: "查看 Movies 扫描异常" })).not.toBeInTheDocument();
  });

  it("keeps showing a later persisted metadata warning after the folder scan status is completed", () => {
    render(
      <LibraryShell
        videos={[video]}
        folders={[{ ...folder, scanError: "FFprobe 读取失败" }]}
        scanStatuses={[{ folderId: folder.id, mode: "current-folder", state: "completed", phase: null, totalFiles: 20, processedFiles: 20, currentPath: null, message: null, counters: scanCounters, updatedAt: "" }]}
      />
    );

    expect(screen.getByRole("button", { name: "查看 Movies 扫描异常" })).toHaveAttribute("title", "FFprobe 读取失败");
  });

  it("reacts to refreshed folder data by showing and then clearing a metadata warning", () => {
    const completedStatus = { folderId: folder.id, mode: "current-folder" as const, state: "completed" as const, phase: null, totalFiles: 20, processedFiles: 20, currentPath: null, message: null, counters: scanCounters, updatedAt: "" };
    const view = render(<LibraryShell videos={[video]} folders={[folder]} scanStatuses={[completedStatus]} />);

    expect(screen.queryByRole("button", { name: "查看 Movies 扫描异常" })).not.toBeInTheDocument();
    view.rerender(<LibraryShell videos={[video]} folders={[{ ...folder, scanError: "FFprobe 读取失败" }]} scanStatuses={[completedStatus]} />);
    expect(screen.getByRole("button", { name: "查看 Movies 扫描异常" })).toBeInTheDocument();
    view.rerender(<LibraryShell videos={[video]} folders={[folder]} scanStatuses={[completedStatus]} />);
    expect(screen.queryByRole("button", { name: "查看 Movies 扫描异常" })).not.toBeInTheDocument();
  });

  it("opens actionable folder scan details and retries from the warning", async () => {
    let finishRetry!: () => void;
    const retryPending = new Promise<void>((resolve) => { finishRetry = resolve; });
    const onRetryFolderFailures = vi.fn(() => retryPending);
    render(
      <LibraryShell
        videos={[video]}
        folders={[{ ...folder, scanError: "读取子目录 D:\\Movies\\Cloud 超时" }]}
        onRetryFolderFailures={onRetryFolderFailures}
        onLoadScanFailureSummary={async () => ({
          sourceFolderId: folder.id,
          failedFileCount: 0,
          failedDirectoryCount: 1,
          totalUnresolved: 1,
          latestError: "读取子目录 D:\\Movies\\Cloud 超时",
          latestFailedAt: "2026-08-01T00:00:00.000Z",
          totalRetryCount: 0
        })}
        onLoadScanFailures={async () => []}
      />
    );

    const warning = screen.getByRole("button", { name: "查看 Movies 扫描异常" });
    expect(warning).toHaveAttribute("title", "读取子目录 D:\\Movies\\Cloud 超时");
    fireEvent.click(warning);

    expect(screen.getByRole("dialog", { name: "上次扫描存在异常" })).toBeInTheDocument();
    expect(screen.getByText("读取子目录 D:\\Movies\\Cloud 超时")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "重试异常项" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "重试异常项" }));
    await waitFor(() => expect(onRetryFolderFailures).toHaveBeenCalledWith(expect.objectContaining({ id: folder.id })));
    expect(screen.getByRole("button", { name: "正在重试异常项" })).toBeDisabled();
    expect(screen.getByText("正在重试…")).toBeInTheDocument();
    finishRetry();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上次扫描存在异常" })).not.toBeInTheDocument());
  });

  it("offers a normal folder scan when a legacy warning has no failure details", async () => {
    const onScanFolder = vi.fn().mockResolvedValue(undefined);
    render(
      <LibraryShell
        videos={[video]}
        folders={[{ ...folder, scanError: "旧版本扫描异常" }]}
        onScanFolder={onScanFolder}
        onRetryFolderFailures={vi.fn()}
        onLoadScanFailureSummary={async () => ({
          sourceFolderId: folder.id,
          failedFileCount: 0,
          failedDirectoryCount: 0,
          totalUnresolved: 0,
          latestError: null,
          latestFailedAt: null,
          totalRetryCount: 0
        })}
        onLoadScanFailures={async () => []}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 Movies 扫描异常" }));
    expect(await screen.findByText("这是旧版本遗留的扫描异常，缺少具体异常明细，请扫描当前文件夹以重新建立状态。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试异常项" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "扫描当前文件夹" }));
    await waitFor(() => expect(onScanFolder).toHaveBeenCalledWith(expect.objectContaining({ id: folder.id })));
  });

  it("loads only the requested ordinary library page from the backend", async () => {
    const onLoadVideoPage = vi.fn(async (query: { page: number; pageSize: number }) => ({
      videos: query.page === 1 ? [video] : [nestedVideo],
      page: query.page,
      pageSize: query.pageSize as 30 | 50 | 100 | 200 | 300,
      totalPages: 2,
      totalCount: 101
    }));

    render(
      <LibraryShell
        videos={[]}
        folders={[folder]}
        navigation={{ totalVideos: 101, favoriteVideos: 1, pendingDeleteVideos: 0, pendingDeleteBytes: 0, pendingMetadataVideos: 0, directoryPaths: ["D:\\Movies", "D:\\Movies\\Drama"] }}
        onLoadVideoPage={onLoadVideoPage}
      />
    );

    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(onLoadVideoPage).toHaveBeenLastCalledWith(expect.objectContaining({ view: "all", page: 1, pageSize: 100 }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("episode-01.mp4")).toBeInTheDocument();
    expect(onLoadVideoPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 100 }));
  });

  it("reloads the active backend page when a domain event sequence changes", async () => {
    const onLoadVideoPage = vi.fn(async () => ({
      videos: [video],
      page: 1,
      pageSize: 100 as const,
      totalPages: 1,
      totalCount: 1
    }));
    const { rerender } = render(
      <LibraryShell videos={[]} folders={[folder]} refreshSequence={0} onLoadVideoPage={onLoadVideoPage} />
    );
    await waitFor(() => expect(onLoadVideoPage).toHaveBeenCalledTimes(1));

    rerender(<LibraryShell videos={[]} folders={[folder]} refreshSequence={8} onLoadVideoPage={onLoadVideoPage} />);

    await waitFor(() => expect(onLoadVideoPage).toHaveBeenCalledTimes(2));
  });
});
