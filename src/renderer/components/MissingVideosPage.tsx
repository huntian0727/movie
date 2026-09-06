import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileQuestion, LoaderCircle, RotateCw, Search, Trash2 } from "lucide-react";
import type { MissingVideoActionResult, MissingVideoPage, MissingVideoPageQuery, MissingVideoPageSize, SourceFolder, VideoRecord } from "../../shared/videoTypes";
import { formatBytes } from "./formatters";

interface MissingVideosPageProps {
  folders: SourceFolder[];
  initialSourceFolderId?: string;
  refreshSequence: number;
  loadPage(query: MissingVideoPageQuery): Promise<MissingVideoPage>;
  onRecheck(videoIds: string[]): Promise<MissingVideoActionResult>;
  onForget(videoIds: string[]): Promise<MissingVideoActionResult>;
  onOpenLocation?(video: VideoRecord): void | Promise<void>;
  onTotalCount?(count: number): void;
}

const EMPTY_PAGE: MissingVideoPage = { items: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0 };

export function MissingVideosPage({ folders, initialSourceFolderId, refreshSequence, loadPage, onRecheck, onForget, onOpenLocation, onTotalCount }: MissingVideosPageProps) {
  const [sourceFolderId, setSourceFolderId] = useState(initialSourceFolderId ?? "");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<MissingVideoPageSize>(30);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [forgetTargetIds, setForgetTargetIds] = useState<string[] | null>(null);
  const [lastResult, setLastResult] = useState<MissingVideoActionResult | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    setSourceFolderId(initialSourceFolderId ?? "");
    setPageNumber(1);
  }, [initialSourceFolderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    setPageNumber(1);
    setSelectedIds(new Set());
  }, [pageSize, search, sourceFolderId]);

  useEffect(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    void loadPage({ sourceFolderId: sourceFolderId || undefined, search, page: pageNumber, pageSize })
      .then((next) => {
        if (request !== requestRef.current) return;
        setResult(next);
        onTotalCount?.(next.totalCount);
        if (next.page !== pageNumber) setPageNumber(next.page);
        const visibleIds = new Set(next.items.map((video) => video.id));
        setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
      })
      .catch((cause) => { if (request === requestRef.current) setError(toMessage(cause)); })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
  }, [loadPage, onTotalCount, pageNumber, pageSize, refreshSequence, refreshVersion, search, sourceFolderId]);

  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === sourceFolderId), [folders, sourceFolderId]);
  const allCurrentPageSelected = result.items.length > 0 && result.items.every((video) => selectedIds.has(video.id));

  async function runAction(videoIds: string[], action: "recheck" | "forget") {
    const uniqueIds = [...new Set(videoIds)];
    if (uniqueIds.length === 0) return;
    setError(null);
    setNotice(null);
    setLastResult(null);
    setBusyIds((current) => new Set([...current, ...uniqueIds]));
    if (uniqueIds.length > 1) setBulkBusy(true);
    try {
      const next = action === "recheck" ? await onRecheck(uniqueIds) : await onForget(uniqueIds);
      setLastResult(next);
      setNotice(action === "recheck"
        ? `复查完成：恢复 ${next.restoredCount} 条，仍缺失 ${next.stillMissingCount} 条，失败 ${next.failureCount} 条。`
        : `清理完成：仅移除 ${next.removedCount} 条资料库记录，恢复 ${next.restoredCount} 条，失败 ${next.failureCount} 条。`);
      setSelectedIds(new Set());
      setForgetTargetIds(null);
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        for (const id of uniqueIds) next.delete(id);
        return next;
      });
      setBulkBusy(false);
    }
  }

  return (
    <section className="missing-video-page" aria-label="文件缺失明细">
      <div className="missing-video-intro">
        <div><FileQuestion size={22} /><span><strong>这些是资料库中保留的缺失记录</strong><small>它们不会出现在正常视频列表中。复查会重新确认文件是否可访问。</small></span></div>
        <span>{result.totalCount.toLocaleString("zh-CN")} 条</span>
      </div>

      <div className="missing-video-filters">
        <label>资料库目录
          <select value={sourceFolderId} onChange={(event) => setSourceFolderId(event.target.value)}>
            <option value="">全部已启用目录</option>
            {folders.filter((folder) => folder.enabled).map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
          </select>
        </label>
        <label className="missing-video-search">搜索
          <span><Search size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="文件名或完整路径" /></span>
        </label>
        <label>每页
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as MissingVideoPageSize)}>
            <option value={30}>30</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        <button className="missing-video-refresh" type="button" title="刷新缺失记录" disabled={loading || bulkBusy} onClick={() => setRefreshVersion((current) => current + 1)}><RotateCw className={loading ? "spin" : undefined} size={17} />刷新</button>
      </div>

      <div className="missing-video-actions">
        <strong>已选 {selectedIds.size.toLocaleString("zh-CN")} 条</strong>
        <button type="button" disabled={result.items.length === 0 || bulkBusy} onClick={() => setSelectedIds(allCurrentPageSelected ? new Set() : new Set(result.items.map((video) => video.id)))}>{allCurrentPageSelected ? "取消当前页全选" : "全选当前页"}</button>
        <button type="button" disabled={selectedIds.size === 0 || bulkBusy} onClick={() => void runAction([...selectedIds], "recheck")}>{bulkBusy ? <LoaderCircle className="spin" size={15} /> : <RotateCw size={15} />}复查可访问性</button>
        <button className="record-remove" type="button" disabled={selectedIds.size === 0 || bulkBusy} onClick={() => setForgetTargetIds([...selectedIds])}><Trash2 size={15} />仅移除资料库记录</button>
        <span>移除前会再次复查。来源离线、权限异常或网盘验证失败时不会清理。</span>
      </div>

      {selectedFolder && <p className="missing-video-scope">当前仅查看：{selectedFolder.path}</p>}
      {error && <div className="error-banner missing-video-banner" role="alert"><AlertTriangle size={16} />{error}</div>}
      {notice && <div className="success-banner missing-video-banner" role="status"><CheckCircle2 size={16} />{notice}</div>}
      {lastResult && lastResult.items.some((item) => item.status === "failed" || item.status === "skipped") && (
        <details className="missing-video-result-details">
          <summary>查看未处理明细</summary>
          {lastResult.items.filter((item) => item.status === "failed" || item.status === "skipped").map((item) => <p key={item.videoId}><code>{item.path || item.videoId}</code><span>{item.message}</span></p>)}
        </details>
      )}

      {loading && result.items.length === 0 ? <MissingTableSkeleton /> : !loading && result.items.length === 0 ? (
        <div className="missing-video-empty"><CheckCircle2 size={38} /><strong>当前筛选下没有缺失记录</strong><span>如果刚刚恢复了文件，可以重新扫描来源目录后再查看。</span></div>
      ) : (
        <div className="missing-video-table-wrap" aria-busy={loading}>
          <table className="missing-video-table">
            <thead><tr><th aria-label="选择" /><th>文件</th><th>所属资料库</th><th>最后记录</th><th>操作</th></tr></thead>
            <tbody>{result.items.map((video) => {
              const busy = busyIds.has(video.id);
              const folder = folders.find((candidate) => candidate.id === video.sourceFolderId);
              return <tr key={video.id}>
                <td><input aria-label={`选择 ${video.filename}`} type="checkbox" checked={selectedIds.has(video.id)} disabled={busy || bulkBusy} onChange={(event) => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(video.id); else next.delete(video.id);
                  return next;
                })} /></td>
                <td><div className="missing-video-file"><FileQuestion size={18} /><span><strong title={video.filename}>{video.filename}</strong><code title={video.path}>{video.path}</code></span></div></td>
                <td><strong>{folder?.providerName || folderName(folder?.path ?? video.directory)}</strong><small title={folder?.path}>{folder?.path ?? "来源目录已移除"}</small></td>
                <td><strong>{formatBytes(video.sizeBytes)}</strong><small>{formatDate(video.modifiedAt)}</small></td>
                <td><div className="missing-video-row-actions">
                  {onOpenLocation && <button type="button" disabled={busy || bulkBusy} onClick={() => void onOpenLocation(video)}><ExternalLink size={14} />打开位置</button>}
                  <button type="button" disabled={busy || bulkBusy} onClick={() => void runAction([video.id], "recheck")}>{busy ? <LoaderCircle className="spin" size={14} /> : <RotateCw size={14} />}复查</button>
                  <button className="record-remove" type="button" disabled={busy || bulkBusy} onClick={() => setForgetTargetIds([video.id])}><Trash2 size={14} />移除记录</button>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          {loading && <span className="missing-video-updating">正在更新…</span>}
        </div>
      )}

      <div className="pagination-bar missing-video-pagination">
        <button disabled={result.page <= 1 || loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>上一页</button>
        <span>第 {result.page} / {result.totalPages} 页，共 {result.totalCount.toLocaleString("zh-CN")} 条</span>
        <button disabled={result.page >= result.totalPages || loading} onClick={() => setPageNumber((current) => current + 1)}>下一页</button>
      </div>

      {forgetTargetIds && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkBusy) setForgetTargetIds(null); }}>
        <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="missing-forget-title">
          <h3 id="missing-forget-title">仅移除资料库记录？</h3>
          <p>将处理 {forgetTargetIds.length.toLocaleString("zh-CN")} 条缺失记录。系统会先复查，确认仍缺失后只删除本地资料库记录，不会删除或修改任何磁盘文件。</p>
          <p>以后文件重新出现时，需要重新扫描来源目录才能再次加入资料库。</p>
          <div className="dialog-actions"><button type="button" disabled={bulkBusy} onClick={() => setForgetTargetIds(null)}>取消</button><button className="danger" type="button" disabled={bulkBusy} onClick={() => void runAction(forgetTargetIds, "forget")}>{bulkBusy ? "正在复查…" : "确认仅移除记录"}</button></div>
        </section>
      </div>}
    </section>
  );
}

function MissingTableSkeleton() {
  return <div className="missing-video-skeleton" role="status" aria-label="正在读取缺失记录">{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>;
}

function folderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
