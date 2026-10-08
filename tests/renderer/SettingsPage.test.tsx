import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../src/renderer/components/SettingsPage";
import type { AppSettings, AppSettingsUpdate, MediaCacheStatus } from "../../src/shared/videoTypes";
import { DEFAULT_SHORTCUTS } from "../../src/shared/shortcuts";

const settings: AppSettings = { defaultRecursiveScan: true, startupSync: true, autoPlayOnOpen: true, seekStepSeconds: 10, coverFrameTimeSeconds: 5, playbackPreference: "auto", cloudDrive: { endpoint: "http://127.0.0.1:19798", configured: true, timeoutMs: 20_000, mountMapJson: "" }, shortcuts: { ...DEFAULT_SHORTCUTS } };
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
  it("shows credential recovery status and keeps the replacement field empty", () => {
    const recovery = { ...settings, cloudDrive: { ...settings.cloudDrive, configured: false,
      credentialError: "CloudDrive 安全凭据暂不可用，连接已停用；请重新输入 Token 并保存以恢复。原凭据已保留。" } };
    render(<SettingsPage settings={recovery} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} />);
    expect(screen.getByRole("alert")).toHaveTextContent("请重新输入 Token");
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveValue("");
  });
  it("shows required settings and configurable shortcuts without the missing-file section", () => {
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} />);
    expect(screen.getByText("默认递归扫描")).toBeInTheDocument();
    expect(screen.getByText("启动时自动同步")).toBeInTheDocument();
    expect(screen.getByText("打开视频后自动播放")).toBeInTheDocument();
    expect(screen.getByText("快进与快退秒数")).toBeInTheDocument();
    expect(screen.getByText("播放策略")).toBeInTheDocument();
    expect(screen.getByText("封面截帧位置")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeInTheDocument();
    expect(screen.getByLabelText("播放或暂停快捷键")).toHaveTextContent("空格");
    expect(screen.queryByText("缺失文件")).not.toBeInTheDocument();
    expect(screen.getByLabelText("缓存使用情况")).toHaveTextContent("3 项");
  });

  it("captures and saves a new shortcut", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    const shortcut = screen.getByLabelText("播放或暂停快捷键");
    fireEvent.click(shortcut);
    fireEvent.keyDown(shortcut, { code: "KeyP", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      shortcuts: { ...settings.shortcuts, playerTogglePlayback: "Ctrl+KeyP" }
    });
  });

  it("rejects duplicate shortcuts within the same window", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    const shortcut = screen.getByLabelText("快进快捷键");
    fireEvent.click(shortcut);
    fireEvent.keyDown(shortcut, { code: "ArrowLeft" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/与“快退”使用了相同快捷键/)).toBeInTheDocument();
  });

  it("emits the selected cover frame offset", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("封面截帧位置"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith({ ...settings, coverFrameTimeSeconds: 10 });
  });

  it("emits changed settings", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("快进与快退秒数"), { target: { value: "15" } });
    expect(onChange).toHaveBeenCalledWith({ ...settings, seekStepSeconds: 15 });
  });

  it("emits autoplay toggle changes", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("打开视频后自动播放"));
    expect(onChange).toHaveBeenCalledWith({ ...settings, autoPlayOnOpen: false });
  });

  it("persists CloudDrive configuration before testing the connection", async () => {
    const onChange = vi.fn(async () => undefined);
    const onTestCloudDrive = vi.fn(async () => ({
      endpoint: "http://127.0.0.1:19798",
      apiMountPointCount: 1,
      effectiveMountPointCount: 1,
      mountedMountPointCount: 1,
      mountPoints: [{ mountPoint: "F:\\", sourceDir: "/115", name: "CloudDrive2", readOnly: false, isMounted: true }]
    }));
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} onTestCloudDrive={onTestCloudDrive} />);

    fireEvent.change(screen.getByLabelText("CloudDrive API Token"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试连接" }));

    await waitFor(() => expect(onTestCloudDrive).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      cloudDrive: { ...settings.cloudDrive, apiToken: "new-token" }
    });
    expect(screen.getByText(/连接成功：API 返回 1 个挂载点/)).toBeInTheDocument();
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveValue("");
  });

  it("keeps a configured credential write-only and omits blank replacements", async () => {
    const onChange = vi.fn(async (_settings: AppSettingsUpdate) => undefined);
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveValue("");
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveAttribute("placeholder", expect.stringContaining("已配置"));
    fireEvent.change(screen.getByLabelText("CloudDrive API 请求超时"), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange.mock.calls[0][0]).toEqual({ ...settings, cloudDrive: { ...settings.cloudDrive, timeoutMs: 30000 } });
    expect(JSON.stringify(onChange.mock.calls)).not.toContain("apiToken");
  });

  it("rejects remote HTTP before saving or testing and allows HTTPS", async () => {
    const onChange = vi.fn(async () => undefined);
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("CloudDrive API 地址"), { target: { value: "http://192.168.1.10:19798" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("HTTPS"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("CloudDrive API 地址"), { target: { value: "https://192.168.1.10:19798" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  });

  it("retains an unsaved replacement across errors but never prefills from settings sync", async () => {
    const onChange = vi.fn(async () => { throw new Error("设置保存失败"); });
    const { rerender } = render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("CloudDrive API Token"), { target: { value: "new-token" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("设置保存失败"));
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveValue("new-token");
    rerender(<SettingsPage settings={{ ...settings, cloudDrive: { ...settings.cloudDrive, timeoutMs: 40000 } }} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onChange={onChange} />);
    expect(screen.getByLabelText("CloudDrive API Token")).toHaveValue("new-token");
  });

  it("shows reclaimed space and cleanup failures returned by the main process", async () => {
    const onClearCache = vi.fn(async () => ({
      removedCount: 2,
      reclaimedBytes: 2048,
      failures: [{ cachePath: "C:\\Cache\\locked.jpg", message: "permission denied" }],
      status: { ...cacheStatus, totalBytes: 4, itemCount: 1 }
    }));
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onClearCache={onClearCache} />);

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
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onPreviewDiagnostics={onPreviewDiagnostics} />);

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
    render(<SettingsPage settings={settings} cacheLocation="C:\\Cache" cacheStatus={cacheStatus} onPreviewDiagnostics={onPreviewDiagnostics} />);

    fireEvent.click(screen.getByRole("button", { name: "预览诊断内容" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出诊断包" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("导出应用数据目录完整路径"));
    expect(screen.getByRole("button", { name: "导出诊断包" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预览诊断内容" }));
    await waitFor(() => expect(onPreviewDiagnostics).toHaveBeenLastCalledWith(true));
  });
});
