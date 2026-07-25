import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../src/renderer/components/SettingsPage";
import type { AppSettings, MediaCacheStatus, VideoRecord } from "../../src/shared/videoTypes";

const settings: AppSettings = { defaultRecursiveScan: true, startupSync: true, autoPlayOnOpen: true, seekStepSeconds: 10, coverFrameTimeSeconds: 5, playbackPreference: "auto" };
const missingVideo = { id: "missing", filename: "lost.mp4", path: "D:\\Movies\\lost.mp4", isMissing: true } as VideoRecord;
const cacheStatus: MediaCacheStatus = {
  totalBytes: 1536,
  coverBytes: 512,
  timelineBytes: 1024,
  itemCount: 3,
  maxBytes: 10 * 1024 * 1024 * 1024,
  automaticCleanup: true,
  lastMaintenanceAt: "2026-07-24T00:00:00.000Z",
  lastCleanup: null
};

describe("SettingsPage", () => {
  it("shows required settings and missing files", () => {
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[missingVideo]} />);
    expect(screen.getByText("默认递归扫描")).toBeInTheDocument();
    expect(screen.getByText("启动时自动同步")).toBeInTheDocument();
    expect(screen.getByText("打开视频后自动播放")).toBeInTheDocument();
    expect(screen.getByText("快进与快退秒数")).toBeInTheDocument();
    expect(screen.getByText("播放策略")).toBeInTheDocument();
    expect(screen.getByText("封面截帧位置")).toBeInTheDocument();
    expect(screen.getByText("lost.mp4")).toBeInTheDocument();
    expect(screen.getByLabelText("缓存使用情况")).toHaveTextContent("3 项");
  });

  it("emits the selected cover frame offset", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("封面截帧位置"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith({ ...settings, coverFrameTimeSeconds: 10 });
  });

  it("emits changed settings", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("快进与快退秒数"), { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith({ ...settings, seekStepSeconds: 15 });
  });

  it("emits autoplay toggle changes", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("打开视频后自动播放"));
    expect(onChange).toHaveBeenCalledWith({ ...settings, autoPlayOnOpen: false });
  });

  it("shows reclaimed space and cleanup failures returned by the main process", async () => {
    const onClearCache = vi.fn(async () => ({
      removedCount: 2,
      reclaimedBytes: 2048,
      failures: [{ cachePath: "C:\\Cache\\locked.jpg", message: "permission denied" }],
      status: { ...cacheStatus, totalBytes: 4, itemCount: 1 }
    }));
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onClearCache={onClearCache} />);

    fireEvent.click(screen.getByText("清理缓存"));
    fireEvent.click(screen.getAllByRole("button", { name: "清理缓存" }).at(-1)!);

    await waitFor(() => expect(screen.getByText(/已清理 2 项，释放 2.00 KB；1 项失败/)).toBeInTheDocument());
  });

  it("previews the diagnostics whitelist before enabling export", async () => {
    const onPreviewDiagnostics = vi.fn(async () => ({
      generatedAt: "2026-07-25T00:00:00.000Z",
      includeFullPaths: false,
      contents: ["OS and native ABI", "redacted structured logs"],
      environment: {
        appVersion: "0.1.0",
        platform: "win32",
        arch: "x64",
        osRelease: "test",
        nodeVersion: "22.23.1",
        electronVersion: "33.4.11",
        nodeModuleVersion: "130",
        schemaVersion: 4,
        packaged: true
      },
      checks: [{ id: "database.quick_check", status: "ok" as const, detail: "SQLite quick_check: ok" }],
      logEntryCount: 3,
      exclusions: ["video files"]
    }));
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onPreviewDiagnostics={onPreviewDiagnostics} />);

    expect(screen.getByRole("button", { name: "导出诊断包" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预览诊断内容" }));

    await waitFor(() => expect(screen.getByLabelText("诊断内容预览")).toHaveTextContent("database.quick_check"));
    expect(onPreviewDiagnostics).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "导出诊断包" })).toBeEnabled();
  });

  it("requires a fresh preview when full application paths are explicitly selected", async () => {
    const onPreviewDiagnostics = vi.fn(async (includeFullPaths: boolean) => ({
      generatedAt: "2026-07-25T00:00:00.000Z",
      includeFullPaths,
      contents: [],
      environment: {
        appVersion: "0.1.0",
        platform: "win32",
        arch: "x64",
        osRelease: "test",
        nodeVersion: "22.23.1",
        electronVersion: "33.4.11",
        nodeModuleVersion: "130",
        schemaVersion: 4,
        packaged: true
      },
      checks: [],
      logEntryCount: 0,
      paths: includeFullPaths ? { userData: "C:\\App", database: "C:\\App\\library.sqlite", cache: "C:\\App\\cache", logs: "C:\\App\\logs" } : undefined,
      exclusions: []
    }));
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} missingVideos={[]} onPreviewDiagnostics={onPreviewDiagnostics} />);

    fireEvent.click(screen.getByRole("button", { name: "预览诊断内容" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出诊断包" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("导出应用数据目录完整路径"));
    expect(screen.getByRole("button", { name: "导出诊断包" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预览诊断内容" }));
    await waitFor(() => expect(onPreviewDiagnostics).toHaveBeenLastCalledWith(true));
  });
});
