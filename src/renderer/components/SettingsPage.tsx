import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, Cloud, Database, FileDown, FolderSearch, Keyboard, RotateCcw } from "lucide-react";
import type {
  AppSettings,
  CloudDriveConnectionTestResult,
  DiagnosticsExportResult,
  DiagnosticsPreview,
  MediaCacheCleanupResult,
  MediaCacheStatus,
  PlaybackPreference,
  ShortcutActionId
} from "../../shared/videoTypes";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFINITIONS,
  formatShortcutBinding,
  shortcutFromKeyboardEvent
} from "../../shared/shortcuts";

interface SettingsPageProps {
  settings: AppSettings;
  cacheLocation: string;
  cacheStatus: MediaCacheStatus;
  onBack?(): void;
  onChange?(settings: AppSettings): void | Promise<void>;
  onTestCloudDrive?(): Promise<CloudDriveConnectionTestResult>;
  onClearCache?(): MediaCacheCleanupResult | null | Promise<MediaCacheCleanupResult | null>;
  onPreviewDiagnostics?(includeFullPaths: boolean): Promise<DiagnosticsPreview>;
  onExportDiagnostics?(includeFullPaths: boolean): Promise<DiagnosticsExportResult>;
}

export function SettingsPage({
  settings,
  cacheLocation,
  cacheStatus,
  onBack,
  onChange,
  onTestCloudDrive,
  onClearCache,
  onPreviewDiagnostics,
  onExportDiagnostics
}: SettingsPageProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [includeFullPaths, setIncludeFullPaths] = useState(false);
  const [diagnosticsPreview, setDiagnosticsPreview] = useState<DiagnosticsPreview | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [capturingShortcut, setCapturingShortcut] = useState<ShortcutActionId | null>(null);
  const [shortcutMessage, setShortcutMessage] = useState<string | null>(null);
  const [cloudDriveDraft, setCloudDriveDraft] = useState({ ...settings.cloudDrive });
  const [cloudDriveBusy, setCloudDriveBusy] = useState(false);
  const [cloudDriveMessage, setCloudDriveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  useEffect(() => setCloudDriveDraft({ ...settings.cloudDrive }), [settings.cloudDrive]);
  const update = (patch: Partial<AppSettings>) => void onChange?.({ ...settings, ...patch });
  const validateCloudDriveDraft = () => {
    const endpoint = new URL(cloudDriveDraft.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("API 地址必须使用 http:// 或 https://");
    if (!cloudDriveDraft.apiToken.trim()) throw new Error("请填写 CloudDrive API Token");
    if (cloudDriveDraft.mountMapJson.trim()) {
      const mountMap = JSON.parse(cloudDriveDraft.mountMapJson) as unknown;
      if (!Array.isArray(mountMap)) throw new Error("挂载映射必须是 JSON 数组");
    }
  };
  const saveCloudDrive = async (showSuccess = true) => {
    validateCloudDriveDraft();
    await onChange?.({ ...settings, cloudDrive: { ...cloudDriveDraft } });
    if (showSuccess) setCloudDriveMessage({ kind: "success", text: "CloudDrive API 配置已保存。" });
  };
  const testCloudDrive = async () => {
    if (!onTestCloudDrive) return;
    setCloudDriveBusy(true);
    setCloudDriveMessage(null);
    try {
      await saveCloudDrive(false);
      const result = await onTestCloudDrive();
      const writableCount = result.mountPoints.filter((mountPoint) => mountPoint.isMounted && !mountPoint.readOnly).length;
      setCloudDriveMessage({
        kind: "success",
        text: `连接成功：API 返回 ${result.apiMountPointCount} 个挂载点，当前使用 ${result.effectiveMountPointCount} 个，其中 ${result.mountedMountPointCount} 个已挂载、${writableCount} 个可写。`
      });
    } catch (cause) {
      setCloudDriveMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setCloudDriveBusy(false);
    }
  };
  const saveShortcut = (actionId: ShortcutActionId, binding: string): boolean => {
    const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === actionId);
    const conflict = SHORTCUT_DEFINITIONS.find((item) =>
      item.id !== actionId
      && item.scope === definition?.scope
      && settings.shortcuts[item.id] === binding
    );
    if (conflict) {
      setShortcutMessage(`不能保存：与“${conflict.label}”使用了相同快捷键。`);
      return false;
    }
    update({ shortcuts: { ...settings.shortcuts, [actionId]: binding } });
    setShortcutMessage(null);
    return true;
  };
  const captureShortcut = (actionId: ShortcutActionId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      setCapturingShortcut(null);
      setShortcutMessage(null);
      return;
    }
    const binding = shortcutFromKeyboardEvent(event);
    if (!binding) {
      setShortcutMessage("请在修饰键之后继续按一个主键；Esc 可取消。");
      return;
    }
    if (saveShortcut(actionId, binding)) setCapturingShortcut(null);
  };
  const clearCache = async () => {
    const result = await onClearCache?.();
    setConfirmClear(false);
    if (!result) return;
    setCacheMessage(
      result.failures.length > 0
        ? `已清理 ${result.removedCount} 项，释放 ${formatBytes(result.reclaimedBytes)}；${result.failures.length} 项失败`
        : `已清理 ${result.removedCount} 项，释放 ${formatBytes(result.reclaimedBytes)}`
    );
  };
  const previewDiagnostics = async () => {
    if (!onPreviewDiagnostics) return;
    setDiagnosticsBusy(true);
    setDiagnosticsMessage(null);
    try {
      setDiagnosticsPreview(await onPreviewDiagnostics(includeFullPaths));
    } catch (cause) {
      setDiagnosticsMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiagnosticsBusy(false);
    }
  };
  const exportDiagnostics = async () => {
    if (!onExportDiagnostics) return;
    setDiagnosticsBusy(true);
    setDiagnosticsMessage(null);
    try {
      const result = await onExportDiagnostics(includeFullPaths);
      setDiagnosticsMessage(result.exported ? "诊断包已导出。" : "已取消导出。");
    } catch (cause) {
      setDiagnosticsMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  return (
    <section className="settings-page">
      <header className="settings-topbar"><button aria-label="返回视频库" onClick={onBack}><ArrowLeft size={20} /></button><div><h1>设置</h1><p>资料库、播放、快捷键和本地缓存</p></div></header>
      <div className="settings-content">
        <section className="settings-section"><div className="section-title"><FolderSearch size={20} /><div><h2>资料库</h2><p>控制新文件夹和启动扫描行为</p></div></div>
          <label className="setting-row"><div><strong>默认递归扫描</strong><span>添加文件夹时扫描所有子文件夹</span></div><input aria-label="默认递归扫描" type="checkbox" checked={settings.defaultRecursiveScan} onChange={(event) => update({ defaultRecursiveScan: event.target.checked })} /></label>
          <label className="setting-row"><div><strong>启动时自动同步</strong><span>打开应用后检查已添加的文件夹</span></div><input aria-label="启动时自动同步" type="checkbox" checked={settings.startupSync} onChange={(event) => update({ startupSync: event.target.checked })} /></label>
        </section>

        <section className="settings-section">
          <div className="section-title"><Cloud size={20} /><div><h2>CloudDrive API</h2><p>用于低带宽扫描、旧资料库绑定和批量远端删除</p></div></div>
          <div className="clouddrive-settings-grid">
            <label>
              <span>API 地址</span>
              <input aria-label="CloudDrive API 地址" value={cloudDriveDraft.endpoint} placeholder="http://127.0.0.1:19798" onChange={(event) => setCloudDriveDraft((current) => ({ ...current, endpoint: event.target.value }))} />
            </label>
            <label>
              <span>API Token</span>
              <input aria-label="CloudDrive API Token" type="password" autoComplete="off" value={cloudDriveDraft.apiToken} placeholder="填写 CloudDrive API Token" onChange={(event) => setCloudDriveDraft((current) => ({ ...current, apiToken: event.target.value }))} />
            </label>
            <label>
              <span>请求超时（毫秒）</span>
              <input aria-label="CloudDrive API 请求超时" type="number" min="1000" max="120000" step="1000" value={cloudDriveDraft.timeoutMs} onChange={(event) => setCloudDriveDraft((current) => ({ ...current, timeoutMs: Number(event.target.value) }))} />
            </label>
            <label className="clouddrive-mount-map">
              <span>手动挂载映射（可选）</span>
              <textarea aria-label="CloudDrive 手动挂载映射" rows={3} value={cloudDriveDraft.mountMapJson} placeholder={'留空则自动读取 CloudDrive 挂载点；示例：[{"mountPoint":"F:\\\\","sourceDir":"/115"}]'} onChange={(event) => setCloudDriveDraft((current) => ({ ...current, mountMapJson: event.target.value }))} />
              <small>只有 API 自动返回的本地挂载路径不正确时才需要填写。支持多个映射。</small>
            </label>
          </div>
          <div className="clouddrive-settings-actions">
            <button className="secondary-button" disabled={cloudDriveBusy} onClick={() => void saveCloudDrive().catch((cause) => setCloudDriveMessage({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) }))}>保存配置</button>
            <button className="secondary-button" disabled={cloudDriveBusy || !onTestCloudDrive} onClick={() => void testCloudDrive()}>{cloudDriveBusy ? "正在连接..." : "保存并测试连接"}</button>
          </div>
          {cloudDriveMessage && <p className={cloudDriveMessage.kind === "success" ? "settings-success" : "settings-warning"} role="status">{cloudDriveMessage.text}</p>}
        </section>

        <section className="settings-section"><div className="section-title"><RotateCcw size={20} /><div><h2>播放</h2><p>调整播放器控制和格式选择</p></div></div>
          <label className="setting-row"><div><strong>打开视频后自动播放</strong><span>进入播放器时自动开始播放当前视频</span></div><input aria-label="打开视频后自动播放" type="checkbox" checked={settings.autoPlayOnOpen} onChange={(event) => update({ autoPlayOnOpen: event.target.checked })} /></label>
          <label className="setting-row"><div><strong>快进与快退秒数</strong><span>播放器按钮和方向键每次跳转的时间</span></div><input className="number-input" aria-label="快进与快退秒数" type="number" min="1" max="120" value={settings.seekStepSeconds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 120) update({ seekStepSeconds: value }); }} /></label>
          <label className="setting-row"><div><strong>播放策略</strong><span>不兼容格式会自动交给外部播放器</span></div><select aria-label="播放策略" value={settings.playbackPreference} onChange={(event) => update({ playbackPreference: event.target.value as PlaybackPreference })}><option value="auto">自动选择</option><option value="native-first">内置播放器优先</option><option value="mpv-first">mpv 优先</option></select></label>
        </section>

        <section className="settings-section">
          <div className="section-title settings-section-title-actions">
            <Keyboard size={20} />
            <div><h2>快捷键</h2><p>点击快捷键后直接按下新的组合；同一页面内不能重复</p></div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                update({ shortcuts: { ...DEFAULT_SHORTCUTS } });
                setCapturingShortcut(null);
                setShortcutMessage(null);
              }}
            >
              恢复默认
            </button>
          </div>
          <div className="shortcut-list">
            {SHORTCUT_DEFINITIONS.map((definition) => (
              <div className="setting-row shortcut-row" key={definition.id}>
                <div>
                  <strong>{definition.label}</strong>
                  <span>{definition.description} · {definition.scope === "library" ? "视频库" : "播放器"}</span>
                </div>
                <div className="shortcut-controls">
                  <button
                    type="button"
                    className={`shortcut-capture${capturingShortcut === definition.id ? " is-capturing" : ""}`}
                    aria-label={`${definition.label}快捷键`}
                    onClick={() => {
                      setCapturingShortcut(definition.id);
                      setShortcutMessage("请按下新的快捷键；Esc 取消。");
                    }}
                    onKeyDown={(event) => {
                      if (capturingShortcut === definition.id) captureShortcut(definition.id, event);
                    }}
                  >
                    {capturingShortcut === definition.id ? "请按键…" : formatShortcutBinding(settings.shortcuts[definition.id])}
                  </button>
                  <button
                    type="button"
                    className="shortcut-reset"
                    aria-label={`恢复${definition.label}默认快捷键`}
                    title="恢复此项默认值"
                    disabled={settings.shortcuts[definition.id] === DEFAULT_SHORTCUTS[definition.id]}
                    onClick={() => saveShortcut(definition.id, DEFAULT_SHORTCUTS[definition.id])}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {shortcutMessage && <p className={shortcutMessage.startsWith("不能保存") ? "settings-warning" : "settings-hint"}>{shortcutMessage}</p>}
        </section>

        <section className="settings-section"><div className="section-title"><Database size={20} /><div><h2>缓存</h2><p>封面和进度预览图片</p></div></div>
          <label className="setting-row"><div><strong>封面截帧位置</strong><span>从视频开始后的指定秒数取一帧；短视频自动取中间位置</span></div><select aria-label="封面截帧位置" value={settings.coverFrameTimeSeconds} onChange={(event) => update({ coverFrameTimeSeconds: Number(event.target.value) as AppSettings["coverFrameTimeSeconds"] })}><option value={0}>开头（0 秒）</option><option value={3}>3 秒</option><option value={5}>5 秒（推荐）</option><option value={10}>10 秒</option><option value={15}>15 秒</option></select></label>
          <div className="setting-row"><div className="cache-path"><strong>缓存位置</strong><span title={cacheLocation}>{cacheLocation}</span></div><button className="secondary-button" onClick={() => setConfirmClear(true)}>清理缓存</button></div>
          <div className="cache-usage" aria-label="缓存使用情况">
            <strong>{formatBytes(cacheStatus.totalBytes)} / {formatBytes(cacheStatus.maxBytes)}</strong>
            <span>{cacheStatus.itemCount} 项 · 封面 {formatBytes(cacheStatus.coverBytes)} · 进度预览 {formatBytes(cacheStatus.timelineBytes)}</span>
            <span>自动清理已开启{cacheStatus.lastMaintenanceAt ? ` · 最近检查 ${formatDateTime(cacheStatus.lastMaintenanceAt)}` : " · 尚未完成首次检查"}</span>
            {cacheStatus.lastCleanup && cacheStatus.lastCleanup.failureCount > 0 && <span className="settings-warning">最近清理有 {cacheStatus.lastCleanup.failureCount} 项失败，请稍后重试。</span>}
          </div>
          {cacheMessage && <p className="settings-success">{cacheMessage}</p>}
        </section>

        <section className="settings-section"><div className="section-title"><FileDown size={20} /><div><h2>诊断与日志</h2><p>预览并导出脱敏运行信息，便于定位扫描、数据库和媒体问题</p></div></div>
          <label className="setting-row"><div><strong>导出应用数据目录完整路径</strong><span>默认关闭；即使开启，也不会包含视频路径、文件名、数据库正文、令牌或环境变量值。</span></div><input aria-label="导出应用数据目录完整路径" type="checkbox" checked={includeFullPaths} onChange={(event) => { setIncludeFullPaths(event.target.checked); setDiagnosticsPreview(null); }} /></label>
          <div className="diagnostics-actions">
            <button className="secondary-button" disabled={diagnosticsBusy} onClick={() => void previewDiagnostics()}>{diagnosticsBusy ? "处理中…" : "预览诊断内容"}</button>
            <button className="secondary-button" disabled={diagnosticsBusy || !diagnosticsPreview} onClick={() => void exportDiagnostics()}>导出诊断包</button>
          </div>
          {diagnosticsPreview && <pre className="diagnostics-preview" aria-label="诊断内容预览">{JSON.stringify(diagnosticsPreview, null, 2)}</pre>}
          {diagnosticsMessage && <p className={diagnosticsMessage.includes("已导出") || diagnosticsMessage.includes("取消") ? "settings-success" : "settings-warning"}>{diagnosticsMessage}</p>}
        </section>
      </div>

      {confirmClear && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-cache-title"><h3 id="clear-cache-title">清理全部缓存？</h3><p>封面和进度预览会在需要时重新生成，原始视频不会被删除。</p><div className="dialog-actions"><button onClick={() => setConfirmClear(false)}>取消</button><button className="danger" onClick={() => void clearCache()}>清理缓存</button></div></section></div>}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
