import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, MediaCacheStatus, VideoManagerApi } from "../../src/shared/videoTypes";
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
