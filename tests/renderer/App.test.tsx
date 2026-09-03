import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, DomainEvent, MediaCacheStatus, VideoManagerApi, VideoRecord } from "../../src/shared/videoTypes";
import { DEFAULT_SHORTCUTS } from "../../src/shared/shortcuts";
import { App, DesktopApp } from "../../src/renderer/App";
import type { DesktopVideoManagerApi } from "../../src/renderer/api/client";

const settings: AppSettings = {
  defaultRecursiveScan: true,
  startupSync: true,
  autoPlayOnOpen: true,
  seekStepSeconds: 10,
  coverFrameTimeSeconds: 5,
  playbackPreference: "auto",
  cloudDrive: { endpoint: "http://127.0.0.1:19798", apiToken: "", timeoutMs: 20_000, mountMapJson: "" },
  shortcuts: { ...DEFAULT_SHORTCUTS }
};

const cacheStatus: MediaCacheStatus = {
  totalBytes: 0,
  coverBytes: 0,
  timelineBytes: 0,
  itemCount: 0,
  maxBytes: 10 * 1024 * 1024 * 1024,
  automaticCleanup: true,
  lastMaintenanceAt: null,
  lastCleanup: null
};

afterEach(() => {
  delete window.videoManager;
});

describe("desktop-only renderer runtime", () => {
  it("shows an unsupported-runtime page instead of a demo library without preload", () => {
    delete window.videoManager;

    render(<App />);

    expect(screen.getByRole("heading", { name: "映匣仅支持 Windows 桌面应用运行" })).toBeInTheDocument();
    expect(screen.getByText("请从映匣桌面客户端启动。")).toBeInTheDocument();
    expect(screen.queryByText("City Walk - Shanghai.mp4")).not.toBeInTheDocument();
    expect(screen.queryByText("D:\\Movies\\Personal Library")).not.toBeInTheDocument();
  });

  it("initializes the real desktop application through a mocked preload API", async () => {
    const api = createDesktopApi();

    render(<DesktopApp api={api} />);

    await waitFor(() => expect(api.getWindowSyncSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(api.listVideoPage).toHaveBeenCalled());
    expect(screen.queryByText("映匣仅支持 Windows 桌面应用运行")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "所有视频" })).toBeInTheDocument();
  });

  it("requests a cover for an API video whose metadata is still pending", async () => {
    const api = createDesktopApi();
    const video = {
      id: "pending-api-video", filename: "sample.mp4", basename: "sample", path: "F:\\sample.mp4", directory: "F:\\",
      extension: ".mp4", sizeBytes: 1024, durationMs: null, width: null, height: null,
      metadataStatus: "pending", thumbnailStatus: "pending", updatedAt: "2026-09-01", isMissing: false
    } as VideoRecord;
    vi.mocked(api.listVideoPage).mockResolvedValue({ videos: [video], page: 1, pageSize: 100, totalPages: 1, totalCount: 1 });
    const { container } = render(<DesktopApp api={api} />);
    await waitFor(() => expect(container.querySelector(".video-cover img")).toHaveAttribute("src", expect.stringContaining("local-video://cover/pending-api-video")));
  });

  it("keeps cleanup progress lightweight and coalesces removal refreshes", async () => {
    let listener: ((event: DomainEvent) => void) | undefined;
    const api = createDesktopApi();
    vi.mocked(api.subscribeDomainEvents).mockImplementation((nextListener) => {
      listener = nextListener;
      return () => undefined;
    });
    render(<DesktopApp api={api} />);
    await waitFor(() => expect(api.getWindowSyncSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(api.getLibraryNavigation).toHaveBeenCalled());
    const initialNavigationCalls = vi.mocked(api.getLibraryNavigation).mock.calls.length;

    await act(async () => listener?.({ sequence: 1, type: "duplicate-cleanup:changed", videoIds: [], jobId: "job-1" }));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(api.getLibraryNavigation).toHaveBeenCalledTimes(initialNavigationCalls);

    await act(async () => {
      listener?.({ sequence: 2, type: "video:removed", videoIds: ["v1"] });
      listener?.({ sequence: 3, type: "video:removed", videoIds: ["v2"] });
      listener?.({ sequence: 4, type: "video:removed", videoIds: ["v3"] });
    });
    await waitFor(() => expect(api.getLibraryNavigation).toHaveBeenCalledTimes(initialNavigationCalls + 1), { timeout: 1_000 });
  });
});

function createDesktopApi(): DesktopVideoManagerApi {
  const implemented = {
    windowMode: "main" as const,
    subscribeDomainEvents: vi.fn(() => () => undefined),
    getWindowSyncSnapshot: vi.fn(async () => ({ sequence: 0, playerSession: null })),
    listFolders: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ settings, cacheLocation: "C:\\Cache", cacheStatus })),
    listPlayHistory: vi.fn(async () => []),
    getLibraryNavigation: vi.fn(async () => ({
      totalVideos: 0,
      favoriteVideos: 0,
      pendingDeleteVideos: 0,
      pendingDeleteBytes: 0,
      pendingMetadataVideos: 0,
      scanFailureCount: 0,
      directoryPaths: []
    })),
    listFolderScanStatuses: vi.fn(async () => []),
    listVideoPage: vi.fn(async (query: { page: number; pageSize: 30 | 50 | 100 | 200 | 300 }) => ({
      videos: [],
      page: query.page,
      pageSize: query.pageSize,
      totalPages: 1,
      totalCount: 0
    }))
  };

  return implemented as unknown as DesktopVideoManagerApi & VideoManagerApi;
}
