import { useState } from "react";
import { ArrowLeft, Database, FileDown, FolderSearch, RotateCcw, Trash2 } from "lucide-react";
import type {
  AppSettings,
  DiagnosticsExportResult,
  DiagnosticsPreview,
  MediaCacheCleanupResult,
  MediaCacheStatus,
  PlaybackPreference,
  VideoRecord
} from "../../shared/videoTypes";

interface SettingsPageProps {
  settings: AppSettings;
  cacheLocation: string;
  cacheStatus: MediaCacheStatus;
  missingVideos: VideoRecord[];
  onBack?(): void;
  onChange?(settings: AppSettings): void | Promise<void>;
  onClearCache?(): MediaCacheCleanupResult | null | Promise<MediaCacheCleanupResult | null>;
  onForgetMissing?(video: VideoRecord): void | Promise<void>;
  onPreviewDiagnostics?(includeFullPaths: boolean): Promise<DiagnosticsPreview>;
  onExportDiagnostics?(includeFullPaths: boolean): Promise<DiagnosticsExportResult>;
}

export function SettingsPage({
  settings,
  cacheLocation,
  cacheStatus,
  missingVideos,
  onBack,
  onChange,
  onClearCache,
  onForgetMissing,
  onPreviewDiagnostics,
  onExportDiagnostics
}: SettingsPageProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [includeFullPaths, setIncludeFullPaths] = useState(false);
  const [diagnosticsPreview, setDiagnosticsPreview] = useState<DiagnosticsPreview | null>(null);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const update = (patch: Partial<AppSettings>) => void onChange?.({ ...settings, ...patch });
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
      <header className="settings-topbar"><button aria-label="返回视频库" onClick={onBack}><ArrowLeft size={20} /></button><div><h1>设置</h1><p>资料库、播放和本地缓存</p></div></header>
      <div className="settings-content">
        <section className="settings-section"><div className="section-title"><FolderSearch size={20} /><div><h2>资料库</h2><p>控制新文件夹和启动扫描行为</p></div></div>
          <label className="setting-row"><div><strong>默认递归扫描</strong><span>添加文件夹时扫描所有子文件夹</span></div><input aria-label="默认递归扫描" type="checkbox" checked={settings.defaultRecursiveScan} onChange={(event) => update({ defaultRecursiveScan: event.target.checked })} /></label>
          <label className="setting-row"><div><strong>启动时自动同步</strong><span>打开应用后检查已添加的文件夹</span></div><input aria-label="启动时自动同步" type="checkbox" checked={settings.startupSync} onChange={(event) => update({ startupSync: event.target.checked })} /></label>
        </section>

        <section className="settings-section"><div className="section-title"><RotateCcw size={20} /><div><h2>播放</h2><p>调整播放器控制和格式选择</p></div></div>
          <label className="setting-row"><div><strong>打开视频后自动播放</strong><span>进入播放器时自动开始播放当前视频</span></div><input aria-label="打开视频后自动播放" type="checkbox" checked={settings.autoPlayOnOpen} onChange={(event) => update({ autoPlayOnOpen: event.target.checked })} /></label>
          <label className="setting-row"><div><strong>快进与快退秒数</strong><span>播放器按钮和方向键每次跳转的时间</span></div><input className="number-input" aria-label="快进与快退秒数" type="number" min="1" max="120" value={settings.seekStepSeconds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 120) update({ seekStepSeconds: value }); }} /></label>
          <label className="setting-row"><div><strong>播放策略</strong><span>不兼容格式会自动交给外部播放器</span></div><select aria-label="播放策略" value={settings.playbackPreference} onChange={(event) => update({ playbackPreference: event.target.value as PlaybackPreference })}><option value="auto">自动选择</option><option value="native-first">内置播放器优先</option><option value="mpv-first">mpv 优先</option></select></label>
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

        <section className="settings-section"><div className="section-title"><Trash2 size={20} /><div><h2>缺失文件</h2><p>{missingVideos.length ? `${missingVideos.length} 条记录找不到原始文件` : "所有文件均可访问"}</p></div></div>
          {missingVideos.length > 0 && <div className="missing-list">{missingVideos.map((video) => <div className="missing-row" key={video.id}><div><strong>{video.filename}</strong><span title={video.path}>{video.path}</span></div><button aria-label={`移除 ${video.filename}`} title="仅从资料库移除" onClick={() => void onForgetMissing?.(video)}><Trash2 size={16} /></button></div>)}</div>}
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
