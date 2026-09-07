import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleGauge, ExternalLink, FileWarning, LoaderCircle, RefreshCw, Search } from "lucide-react";
import type {
  MetadataIssueItem,
  MetadataIssuePage,
  MetadataIssuePageQuery,
  MetadataIssuePageSize,
  MetadataIssueStatusFilter,
  MetadataSizeRefreshResult,
  SourceFolder,
  VideoRecord
} from "../../shared/videoTypes";
import { formatBytes, formatDateTime } from "./formatters";

interface MetadataIssuesPageProps {
  folders: SourceFolder[];
  initialSourceFolderId?: string;
  refreshSequence: number;
  loadPage(query: MetadataIssuePageQuery): Promise<MetadataIssuePage>;
  onRetry(video: VideoRecord): void | Promise<void>;
  onRefreshSizes(videoIds: string[]): Promise<MetadataSizeRefreshResult>;
  onOpenLocation?(video: VideoRecord): void | Promise<void>;
  onTotalCount?(count: number): void;
}

const EMPTY_PAGE: MetadataIssuePage = {
  items: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0,
  automaticCount: 0, deferredCount: 0, failedCount: 0, zeroByteCount: 0,
  queuedCount: 0, activeCount: 0
};

export function MetadataIssuesPage({
  folders, initialSourceFolderId, refreshSequence, loadPage, onRetry, onRefreshSizes, onOpenLocation, onTotalCount
}: MetadataIssuesPageProps) {
  const [sourceFolderId, setSourceFolderId] = useState(initialSourceFolderId ?? "");
  const [status, setStatus] = useState<MetadataIssueStatusFilter>("all");
  const [zeroBytesOnly, setZeroBytesOnly] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<MetadataIssuePageSize>(30);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [actionDetails, setActionDetails] = useState<Array<{ path: string; message: string }>>([]);
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
  }, [pageSize, search, sourceFolderId, status, zeroBytesOnly]);

  useEffect(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    void loadPage({ sourceFolderId: sourceFolderId || undefined, status, zeroBytesOnly, search, page: pageNumber, pageSize })
      .then((next) => {
        if (request !== requestRef.current) return;
        setResult(next);
        onTotalCount?.(next.automaticCount + next.deferredCount + next.failedCount);
        if (next.page !== pageNumber) setPageNumber(next.page);
        const visibleIds = new Set(next.items.map((item) => item.video.id));
        setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
      })
      .catch((cause) => { if (request === requestRef.current) setError(toMessage(cause)); })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
  }, [loadPage, onTotalCount, pageNumber, pageSize, refreshSequence, refreshVersion, search, sourceFolderId, status, zeroBytesOnly]);

  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === sourceFolderId), [folders, sourceFolderId]);
  const allCurrentPageSelected = result.items.length > 0 && result.items.every((item) => selectedIds.has(item.video.id));
  const selectedItems = result.items.filter((item) => selectedIds.has(item.video.id));
  const selectedZeroByteItems = selectedItems.filter((item) => item.video.sizeBytes === 0);
  const selectedAnalyzableItems = selectedItems.filter((item) => item.video.sizeBytes > 0);
  const bulkBusy = busyIds.size > 1;

  async function retryItems(items: MetadataIssueItem[]) {
    const uniqueItems = [...new Map(items.filter((item) => item.video.sizeBytes > 0).map((item) => [item.video.id, item])).values()];
    if (uniqueItems.length === 0) return;
    beginAction(uniqueItems.map((item) => item.video.id));
    const failures: Array<{ path: string; message: string }> = [];
    let successCount = 0;
    try {
      for (let index = 0; index < uniqueItems.length; index += 8) {
        const batch = uniqueItems.slice(index, index + 8);
        const settled = await Promise.allSettled(batch.map((item) => onRetry(item.video)));
        settled.forEach((entry, batchIndex) => {
          if (entry.status === "fulfilled") successCount += 1;
          else failures.push({ path: batch[batchIndex]!.video.path, message: toMessage(entry.reason) });
        });
      }
      setActionDetails(failures);
      setNotice(`已将 ${successCount.toLocaleString("zh-CN")} 条记录优先加入分析队列${failures.length > 0 ? `，失败 ${failures.length.toLocaleString("zh-CN")} 条` : ""}。`);
      finishAction();
    } finally {
      setBusyIds(new Set());
    }
  }

  async function refreshSizes(items: MetadataIssueItem[]) {
    const uniqueItems = [...new Map(items.filter((item) => item.video.sizeBytes === 0).map((item) => [item.video.id, item])).values()];
    if (uniqueItems.length === 0) return;
    beginAction(uniqueItems.map((item) => item.video.id));
    try {
      const outcome = await onRefreshSizes(uniqueItems.map((item) => item.video.id));
      setActionDetails(outcome.items.filter((item) => item.status !== "updated").map((item) => ({ path: item.path || item.videoId, message: item.message })));
      setNotice([
        `已重新读取 ${outcome.requestedCount.toLocaleString("zh-CN")} 条 0B 记录`,
        `恢复并排队 ${outcome.updatedCount.toLocaleString("zh-CN")} 条`,
        `仍为 0B ${outcome.stillZeroCount.toLocaleString("zh-CN")} 条`,
        `转入缺失复查 ${outcome.missingCount.toLocaleString("zh-CN")} 条`,
        outcome.failureCount > 0 ? `失败 ${outcome.failureCount.toLocaleString("zh-CN")} 条` : null
      ].filter(Boolean).join("，") + "。");
      finishAction();
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusyIds(new Set());
    }
  }

  function beginAction(videoIds: string[]) {
    setError(null);
    setNotice(null);
    setActionDetails([]);
    setBusyIds(new Set(videoIds));
  }

  function finishAction() {
    setSelectedIds(new Set());
    setRefreshVersion((current) => current + 1);
  }

  return (
    <section className="missing-video-page metadata-issues-page" aria-label="元数据异常明细">
      <div className="missing-video-intro metadata-issue-intro">
        <div><CircleGauge size={22} /><span><strong>按真实处理状态查看元数据任务</strong><small>自动候选会分批入队；策略暂缓尚未排队；0B 文件必须先重新读取远端大小。</small></span></div>
        <div className="metadata-issue-counts">
          <span>全局正在分析 <b>{result.activeCount.toLocaleString("zh-CN")}</b></span>
          <span>全局已入队 <b>{result.queuedCount.toLocaleString("zh-CN")}</b></span>
          <span>自动候选 <b>{result.automaticCount.toLocaleString("zh-CN")}</b></span>
          <span>策略暂缓 <b>{result.deferredCount.toLocaleString("zh-CN")}</b></span>
          <span>分析失败 <b>{result.failedCount.toLocaleString("zh-CN")}</b></span>
        </div>
      </div>

      <div className="missing-video-filters metadata-issue-filters">
        <label>资料库目录
          <select value={sourceFolderId} onChange={(event) => setSourceFolderId(event.target.value)}>
            <option value="">全部已启用目录</option>
            {folders.filter((folder) => folder.enabled).map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
          </select>
        </label>
        <label>分析状态
          <select value={status} onChange={(event) => setStatus(event.target.value as MetadataIssueStatusFilter)}>
            <option value="all">全部异常</option><option value="automatic">自动分析候选</option><option value="deferred">策略暂缓</option><option value="failed">分析失败</option>
          </select>
        </label>
        <label className="missing-video-search">搜索
          <span><Search size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="文件名或完整路径" /></span>
        </label>
        <label>每页
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as MetadataIssuePageSize)}>
            <option value={30}>30</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        <button className="missing-video-refresh" type="button" disabled={loading || busyIds.size > 0} onClick={() => setRefreshVersion((current) => current + 1)}><RefreshCw className={loading ? "spin" : undefined} size={17} />刷新</button>
      </div>

      <div className="missing-video-actions metadata-issue-actions">
        <strong>已选 {selectedIds.size.toLocaleString("zh-CN")} 条</strong>
        <button type="button" disabled={result.items.length === 0 || busyIds.size > 0} onClick={() => setSelectedIds(allCurrentPageSelected ? new Set() : new Set(result.items.map((item) => item.video.id)))}>{allCurrentPageSelected ? "取消当前页全选" : "全选当前页"}</button>
        <button type="button" className={zeroBytesOnly ? "active" : undefined} disabled={busyIds.size > 0} aria-pressed={zeroBytesOnly} onClick={() => setZeroBytesOnly((current) => !current)}><FileWarning size={15} />仅看 0B（{result.zeroByteCount.toLocaleString("zh-CN")}）</button>
        <button type="button" disabled={selectedZeroByteItems.length === 0 || busyIds.size > 0} onClick={() => void refreshSizes(selectedZeroByteItems)}>{bulkBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}重新读取大小（{selectedZeroByteItems.length.toLocaleString("zh-CN")}）</button>
        <button type="button" disabled={selectedAnalyzableItems.length === 0 || busyIds.size > 0} onClick={() => void retryItems(selectedAnalyzableItems)}>{bulkBusy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}优先重新分析（{selectedAnalyzableItems.length.toLocaleString("zh-CN")}）</button>
        <span>重新读取只更新资料库和分析状态，不会修改或删除视频文件。</span>
      </div>

      {selectedFolder && <p className="missing-video-scope">当前仅查看：{selectedFolder.path}</p>}
      {error && <div className="error-banner missing-video-banner" role="alert"><AlertTriangle size={16} />{error}</div>}
      {notice && <div className="success-banner missing-video-banner" role="status"><CheckCircle2 size={16} />{notice}</div>}
      {actionDetails.length > 0 && <details className="missing-video-result-details"><summary>查看未直接恢复的记录</summary>{actionDetails.map((detail, index) => <p key={`${detail.path}-${index}`}><code>{detail.path}</code><span>{detail.message}</span></p>)}</details>}

      {loading && result.items.length === 0 ? <MetadataTableSkeleton /> : !loading && result.items.length === 0 ? (
        <div className="missing-video-empty"><CheckCircle2 size={38} /><strong>当前筛选下没有元数据异常</strong><span>{emptyMessage(status, zeroBytesOnly)}</span></div>
      ) : (
        <div className="missing-video-table-wrap" aria-busy={loading}>
          <table className="missing-video-table metadata-issue-table">
            <thead><tr><th aria-label="选择" /><th>文件</th><th>处理状态</th><th>状态说明</th><th>最近更新</th><th>操作</th></tr></thead>
            <tbody>{result.items.map((item) => {
              const video = item.video;
              const busy = busyIds.has(video.id);
              const folder = folders.find((candidate) => candidate.id === video.sourceFolderId);
              const displayState = statePresentation(item);
              return <tr key={video.id}>
                <td><input aria-label={`选择 ${video.filename}`} type="checkbox" checked={selectedIds.has(video.id)} disabled={busyIds.size > 0} onChange={(event) => setSelectedIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(video.id); else next.delete(video.id);
                  return next;
                })} /></td>
                <td><div className="missing-video-file"><CircleGauge size={18} /><span><strong title={video.filename}>{video.filename}</strong><code title={video.path}>{video.path}</code><small>{folder?.providerName || folderName(folder?.path ?? video.directory)} · {formatBytes(video.sizeBytes)}</small></span></div></td>
                <td><span className={`metadata-issue-status ${displayState.className}`}>{displayState.label}</span></td>
                <td><div className="metadata-issue-error"><strong title={displayState.message}>{displayState.message}</strong><small>{failureMeta(item)}</small></div></td>
                <td><strong>{formatDateTime(video.updatedAt)}</strong><small>{video.durationMs === null ? "时长未知" : `${Math.round(video.durationMs / 1000).toLocaleString("zh-CN")} 秒`}</small></td>
                <td><div className="missing-video-row-actions">
                  {onOpenLocation && <button type="button" disabled={busyIds.size > 0} onClick={() => void onOpenLocation(video)}><ExternalLink size={14} />打开位置</button>}
                  {video.sizeBytes === 0
                    ? <button type="button" disabled={busyIds.size > 0} onClick={() => void refreshSizes([item])}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}重新读取大小</button>
                    : <button type="button" disabled={busyIds.size > 0} onClick={() => void retryItems([item])}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}重新分析</button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
          {loading && <span className="missing-video-updating">正在更新...</span>}
        </div>
      )}

      <div className="pagination-bar missing-video-pagination">
        <button disabled={result.page <= 1 || loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>上一页</button>
        <span>第 {result.page} / {result.totalPages} 页，共 {result.totalCount.toLocaleString("zh-CN")} 条</span>
        <button disabled={result.page >= result.totalPages || loading} onClick={() => setPageNumber((current) => current + 1)}>下一页</button>
      </div>
    </section>
  );
}

function MetadataTableSkeleton() {
  return <div className="missing-video-skeleton" role="status" aria-label="正在读取元数据异常记录">{Array.from({ length: 7 }, (_, index) => <span key={index} />)}</div>;
}

function statePresentation(item: MetadataIssueItem): { label: string; className: string; message: string } {
  if (item.queueState === "active") return { label: "正在分析", className: "active", message: "媒体探测正在运行" };
  if (item.queueState === "queued") return { label: "已入队", className: "queued", message: "已进入本次运行队列，等待可用并发" };
  if (item.video.sizeBytes === 0) return { label: "0B 待确认", className: "zero", message: "0B 文件不会进入媒体分析，请先重新读取 CloudDrive 大小" };
  if (item.analysisState === "automatic") return { label: "自动候选", className: "automatic", message: "符合自动分析策略，将按批次加入队列" };
  if (item.analysisState === "deferred") return { label: "策略暂缓", className: "deferred", message: "尚未入队。CloudDrive 唯一大小文件默认暂缓，以避免大规模远端读取" };
  return { label: "分析失败", className: "failed", message: item.errorSummary ?? "未记录错误摘要" };
}

function failureMeta(item: MetadataIssueItem): string {
  if (item.analysisState !== "failed") return item.queueState ? "运行队列状态" : "可手动优先分析";
  const category = failureCategory(item.errorCode);
  return `${category}，重试 ${item.retryCount.toLocaleString("zh-CN")} 次${item.lastFailedAt ? `，${formatDateTime(item.lastFailedAt)}` : ""}`;
}

function failureCategory(code: string | null): string {
  if (code === "EMPTY_FILE") return "空文件或占位文件";
  if (code === "INVALID_MEDIA") return "媒体结构无效或未完整下载";
  if (code === "TIMEOUT" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "读取超时";
  if (code === "ENOENT") return "文件不存在";
  if (code === "CLOUD_UNAVAILABLE") return "CloudDrive 暂时不可用";
  return code ? `错误码 ${code}` : "未分类错误";
}

function emptyMessage(status: MetadataIssueStatusFilter, zeroBytesOnly: boolean): string {
  if (zeroBytesOnly) return "没有大小为 0B 的异常记录。";
  if (status === "failed") return "没有分析失败的视频。";
  if (status === "automatic") return "没有符合自动分析策略且尚未处理的视频。";
  if (status === "deferred") return "没有被策略暂缓的视频。";
  return "所有可访问视频的元数据均已就绪。";
}

function folderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath;
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
