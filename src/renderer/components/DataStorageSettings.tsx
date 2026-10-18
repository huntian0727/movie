import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { DataStorageApi, DataStoragePreview, DataStorageStatus } from "../../shared/dataStorage";

export function DataStorageSettings({ api }: { api: DataStorageApi }) {
  const [status, setStatus] = useState<DataStorageStatus | null>(null);
  const [preview, setPreview] = useState<DataStoragePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void api.getDataStorage().then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setMessage("数据目录信息暂不可用，请重新打开设置。"); });
    return () => { active = false; };
  }, [api]);
  async function choose() {
    setBusy(true); setMessage(""); setPreview(null);
    try { setPreview(await api.chooseDataDirectory()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "无法选择目录，请检查磁盘权限。"); }
    finally { setBusy(false); }
  }
  async function migrate() {
    if (!preview) return;
    setBusy(true); setMessage("正在安排迁移并重启，请稍候…");
    try {
      const result = await api.migrateDataDirectory(preview.token);
      if (!result.restarting) { setBusy(false); setMessage("迁移已取消，继续使用原目录。"); }
    } catch (error) {
      setBusy(false); setPreview(null);
      setMessage(error instanceof Error ? error.message : "迁移未开始，原数据保持不变。");
    }
  }
  return <section id="settings-storage" className="settings-section" aria-labelledby="data-storage-title">
    <div className="section-title"><FolderOpen size={20} /><div><h2 id="data-storage-title">数据存储位置</h2><p>集中保存资料库、设置、应用字幕和媒体缓存</p></div></div>
    <div className="setting-row"><div className="cache-path"><strong>当前数据目录</strong><span title={status?.currentDirectory}>{status?.currentDirectory ?? "正在读取…"}</span></div></div>
    <p className="settings-hint">更换位置后自动迁移并重启。原视频、视频旁的字幕和已导出的文件保留在原位置。升级或移动程序文件夹后会继续使用此数据目录。</p>
    <div className="diagnostics-actions">
      <button className="secondary-button" disabled={busy || !status} onClick={() => void api.openDataDirectory().catch(() => setMessage("无法打开数据目录，请检查磁盘连接。"))}>打开数据目录</button>
      <button className="secondary-button" disabled={busy || !status} onClick={() => void choose()}>{busy ? "处理中…" : "更改位置"}</button>
    </div>
    {status?.message && <p className="settings-hint" role="status">{status.message}</p>}
    {message && <p className="settings-warning" role="status">{message}</p>}
    {preview && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="storage-migration-title">
      <h3 id="storage-migration-title">迁移应用数据？</h3>
      <p className="storage-path">当前位置：{preview.sourceDirectory}</p>
      <p className="storage-path">新位置：{preview.targetDirectory}</p>
      <p>将迁移 {preview.fileCount.toLocaleString()} 个文件，约 {(preview.totalBytes / 1024 / 1024).toFixed(1)} MB；目标可用 {(preview.availableBytes / 1024 / 1024 / 1024).toFixed(1)} GB。</p>
      <p>程序将在重启后复制并校验数据，成功启用新目录后清理原应用数据。失败时继续使用原目录。请先保存当前操作并结束播放。</p>
      {busy && <p role="status">{message}</p>}
      <div className="dialog-actions"><button autoFocus disabled={busy} onClick={() => setPreview(null)}>取消</button><button disabled={busy} onClick={() => void migrate()}>迁移并重启</button></div>
    </section></div>}
  </section>;
}
