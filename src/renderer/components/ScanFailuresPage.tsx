import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileQuestion, FolderOpen, Info, LoaderCircle, Play, RotateCw, Trash2 } from "lucide-react";
import type { ScanFailureCleanupAction, ScanFailureCleanupResult, ScanFailureReviewKind, ScanFailureReviewPage, ScanFailureReviewPageSize, ScanFailureReviewQuery, SourceFolder, VideoRecord } from "../../shared/videoTypes";
import { classifyScanFailureForCleanup } from "../../shared/scanFailureCleanup";
import { formatBytes, formatDuration } from "./formatters";

interface ScanFailuresPageProps {
  folders: SourceFolder[];
  initialSourceFolderId?: string;
  refreshSequence: number;
  loadPage(query: ScanFailureReviewQuery): Promise<ScanFailureReviewPage>;
  onRetry(failureId: string): Promise<unknown>;
  onDeleteFile(failureId: string): Promise<unknown>;
  onCleanup?(failureIds: string[], action: ScanFailureCleanupAction): Promise<ScanFailureCleanupResult>;
  onOpenLocation(failureId: string): Promise<unknown>;
  onOpenVideo?(video: VideoRecord): void;
  onShowDetails?(video: VideoRecord): void;
  onTogglePendingDelete?(video: VideoRecord): void | Promise<void>;
  getCoverUrl?(video: VideoRecord): string | null;
}

const EMPTY_PAGE: ScanFailureReviewPage = {
  items: [], page: 1, pageSize: 30, totalPages: 1, totalCount: 0,
  counts: { all: 0, video: 0, unindexedFile: 0, directory: 0 }
};

export function ScanFailuresPage({
  folders, initialSourceFolderId, refreshSequence, loadPage, onRetry, onDeleteFile, onCleanup,
  onOpenLocation, onOpenVideo, onShowDetails, onTogglePendingDelete, getCoverUrl
}: ScanFailuresPageProps) {
  const [sourceFolderId, setSourceFolderId] = useState(initialSourceFolderId ?? "");
  const [kind, setKind] = useState<ScanFailureReviewKind>("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<ScanFailureReviewPageSize>(30);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [selectedFailureIds, setSelectedFailureIds] = useState<Set<string>>(() => new Set());
  const [cleanupFilter, setCleanupFilter] = useState<"all" | "confirmed-corrupt" | "missing">("all");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadPageRef = useRef(loadPage);
  const previousQueryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);

  useEffect(() => {
    setSourceFolderId(initialSourceFolderId ?? "");
    setPageNumber(1);
  }, [initialSourceFolderId]);

  useEffect(() => {
    let cancelled = false;
    const queryKey = `${sourceFolderId}\u0000${kind}\u0000${pageNumber}\u0000${pageSize}`;
    const queryChanged = previousQueryKeyRef.current !== queryKey;
    previousQueryKeyRef.current = queryKey;
    if (queryChanged) setLoading(true);
    setError(null);
    loadPageRef.current({ sourceFolderId: sourceFolderId || undefined, kind, page: pageNumber, pageSize })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        if (next.page !== pageNumber) setPageNumber(next.page);
      })
      .catch((cause) => { if (!cancelled) setError(toMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, pageNumber, pageSize, refreshSequence, refreshVersion, sourceFolderId]);

  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === sourceFolderId), [folders, sourceFolderId]);
  const visibleItems = useMemo(() => result.items.filter((item) => cleanupFilter === "all" || classifyScanFailureForCleanup(item.failure).category === cleanupFilter), [cleanupFilter, result.items]);
  const selectableIds = useMemo(() => visibleItems.filter((item) => {
    const category = classifyScanFailureForCleanup(item.failure).category;
    return (category === "confirmed-corrupt" && Boolean(item.video)) || category === "missing";
  }).map((item) => item.failure.id), [visibleItems]);
  const selectedCorruptCount = result.items.filter((item) => selectedFailureIds.has(item.failure.id) && Boolean(item.video) && classifyScanFailureForCleanup(item.failure).category === "confirmed-corrupt").length;
  const selectedMissingCount = result.items.filter((item) => selectedFailureIds.has(item.failure.id) && classifyScanFailureForCleanup(item.failure).category === "missing").length;

  useEffect(() => {
    const availableIds = new Set(result.items.map((item) => item.failure.id));
    setSelectedFailureIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [result.items]);

  async function runAction(failureId: string, action: () => Promise<unknown>) {
    setBusyIds((current) => new Set(current).add(failureId));
    setError(null);
    try {
      await action();
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(failureId); return next; });
    }
  }

  async function runBulkCleanup(action: ScanFailureCleanupAction) {
    if (!onCleanup || selectedFailureIds.size === 0) return;
    const eligibleFailureIds = result.items.filter((item) => {
      if (!selectedFailureIds.has(item.failure.id)) return false;
      const category = classifyScanFailureForCleanup(item.failure).category;
      return action === "remove-missing-record" ? category === "missing" : category === "confirmed-corrupt" && Boolean(item.video);
    }).map((item) => item.failure.id);
    if (eligibleFailureIds.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const cleanupResult = await onCleanup(eligibleFailureIds, action);
      setNotice(action === "remove-missing-record"
        ? `网盘失效记录清理完成：成功 ${cleanupResult.successCount} 个，跳过 ${cleanupResult.skippedCount} 个，失败 ${cleanupResult.failureCount} 个。`
        : action === "mark-pending-delete"
          ? `已将 ${cleanupResult.successCount} 个确认损坏视频加入“待删除”。`
          : `永久删除完成：成功 ${cleanupResult.successCount} 个，跳过 ${cleanupResult.skippedCount} 个，失败 ${cleanupResult.failureCount} 个。`);
      setSelectedFailureIds(new Set());
      setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <section className="scan-failure-page" aria-label="扫描异常">
      <div className="scan-failure-filters">
        <label>资料库目录
          <select value={sourceFolderId} onChange={(event) => { setSourceFolderId(event.target.value); setPageNumber(1); }}>
            <option value="">全部已启用目录</option>
            {folders.filter((folder) => folder.enabled).map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
          </select>
        </label>
        <label>异常类型
          <select value={kind} onChange={(event) => { setKind(event.target.value as ScanFailureReviewKind); setPageNumber(1); }}>
            <option value="all">全部（{result.counts.all}）</option>
            <option value="video">已入库视频（{result.counts.video}）</option>
            <option value="unindexed-file">未入库文件（{result.counts.unindexedFile}）</option>
            <option value="directory">目录（{result.counts.directory}）</option>
          </select>
        </label>
        <label>每页
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as ScanFailureReviewPageSize); setPageNumber(1); }}>
            <option value={30}>30</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </label>
        <label>清理筛选
          <select value={cleanupFilter} onChange={(event) => setCleanupFilter(event.target.value as "all" | "confirmed-corrupt" | "missing")}>
            <option value="all">全部异常</option>
            <option value="confirmed-corrupt">仅确认损坏（当前页）</option>
            <option value="missing">仅网盘已删除（当前页）</option>
          </select>
        </label>
        <button className="icon-button" title="刷新异常列表" onClick={() => setRefreshVersion((current) => current + 1)}><RotateCw size={18} /></button>
      </div>

      <div className="scan-failure-cleanup-bar">
        <strong>已选 {selectedFailureIds.size} 个可处理项</strong>
        <button disabled={selectableIds.length === 0 || bulkBusy} onClick={() => setSelectedFailureIds(new Set(selectableIds))}>全选当前页可清理项</button>
        <button disabled={selectedCorruptCount === 0 || bulkBusy || !onCleanup} onClick={() => void runBulkCleanup("mark-pending-delete")}>损坏项标记待删除</button>
        <button className="danger-button" disabled={selectedCorruptCount === 0 || bulkBusy || !onCleanup} onClick={() => void runBulkCleanup("permanent-delete")}>{bulkBusy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}永久删除损坏项</button>
        <button disabled={selectedMissingCount === 0 || bulkBusy || !onCleanup} onClick={() => void runBulkCleanup("remove-missing-record")}>清理网盘失效记录</button>
        {selectedFailureIds.size > 0 && <button disabled={bulkBusy} onClick={() => setSelectedFailureIds(new Set())}>取消选择</button>}
        <span>损坏项会永久删除原文件；网盘已删除项只清理本地记录，并在操作时在线强制刷新确认。超时、断线、权限异常不会清理。</span>
      </div>

      {selectedFolder && <p className="scan-failure-scope">当前仅查看：{selectedFolder.path}</p>}
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}
      {loading && <div className="empty-state"><LoaderCircle className="spin" />正在读取异常记录…</div>}
      {!loading && result.items.length === 0 && (
        <div className="empty-state"><AlertTriangle size={42} /><strong>当前筛选下没有未解决的扫描异常</strong><span>已解决记录不会显示在这里。</span></div>
      )}
      {!loading && result.items.length > 0 && visibleItems.length === 0 && (
        <div className="empty-state"><AlertTriangle size={42} /><strong>当前页没有确认损坏的视频</strong><span>可切换回“全部异常”，或翻页继续查看。</span></div>
      )}

      {!loading && visibleItems.length > 0 && <div className="scan-failure-list">
        {visibleItems.map(({ failure, kind: itemKind, video }) => {
          const busy = busyIds.has(failure.id);
          const coverUrl = video && getCoverUrl ? getCoverUrl(video) : null;
          const classification = classifyScanFailureForCleanup(failure);
          const selectable = (Boolean(video) && classification.category === "confirmed-corrupt") || classification.category === "missing";
          return <article className={`scan-failure-card scan-failure-${classification.category}`} key={failure.id}>
            <label className="scan-failure-select" title={selectable ? "选择此可处理项" : classification.reason}>
              <input type="checkbox" disabled={!selectable || busy || bulkBusy} checked={selectedFailureIds.has(failure.id)} onChange={(event) => setSelectedFailureIds((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(failure.id); else next.delete(failure.id);
                return next;
              })} />
            </label>
            <div className="scan-failure-preview">
              {coverUrl ? <img src={coverUrl} alt="" /> : itemKind === "directory" ? <FolderOpen size={38} /> : <FileQuestion size={38} />}
              <span>{itemKind === "video" ? "已入库视频" : itemKind === "directory" ? "目录" : "未入库文件"}</span>
            </div>
            <div className="scan-failure-body">
              <strong title={failure.objectPath}>{video?.filename ?? fileName(failure.objectPath)}</strong>
              <code>{failure.objectPath}</code>
              {video && <span>{formatBytes(video.sizeBytes)} · {formatDuration(video.durationMs)}</span>}
              <div className="scan-failure-error"><AlertTriangle size={16} /><span>{failure.errorSummary}</span></div>
              <span className={`scan-failure-classification ${classification.category}`} title={classification.reason}>{classification.label}</span>
              <small>阶段：{failure.failureStage} · 错误码：{failure.errorCode ?? "未知"} · 最近失败：{formatDate(failure.lastFailedAt)} · 重试 {failure.retryCount} 次</small>
            </div>
            <div className="scan-failure-actions">
              {video && <button title="播放" disabled={busy} onClick={() => onOpenVideo?.(video)}><Play size={17} />播放</button>}
              {video && <button title="视频详情" disabled={busy} onClick={() => onShowDetails?.(video)}><Info size={17} />详情</button>}
              <button title="打开所在位置" disabled={busy} onClick={() => void runAction(failure.id, () => onOpenLocation(failure.id))}><ExternalLink size={17} />打开位置</button>
              <button title="仅重试此项" disabled={busy} onClick={() => void runAction(failure.id, () => onRetry(failure.id))}>{busy ? <LoaderCircle className="spin" size={17} /> : <RotateCw size={17} />}重试</button>
              {video && <button title={video.isPendingDelete ? "取消待删除" : "标记待删除"} disabled={busy} onClick={() => void runAction(failure.id, async () => onTogglePendingDelete?.(video))}><Trash2 size={17} />{video.isPendingDelete ? "取消标记" : "待删除"}</button>}
              {classification.category === "confirmed-corrupt" && video && <button className="danger-button" title="永久删除文件" disabled={busy} onClick={() => void runAction(failure.id, () => onDeleteFile(failure.id))}><Trash2 size={17} />永久删除</button>}
              {classification.category === "missing" && <button title="在线确认远端已删除后，仅清理本地记录" disabled={busy || !onCleanup} onClick={() => void runAction(failure.id, async () => {
                const cleanupResult = await onCleanup!([failure.id], "remove-missing-record");
                const failedItem = cleanupResult.items.find((item) => item.status === "failed");
                if (failedItem) throw new Error(failedItem.message);
                setNotice("远端已确认不存在，本地记录已清理。");
              })}><Trash2 size={17} />清理失效记录</button>}
            </div>
          </article>;
        })}
      </div>}

      <div className="pagination-bar">
        <button disabled={result.page <= 1 || loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>上一页</button>
        <span>第 {result.page} / {result.totalPages} 页，共 {result.totalCount} 项</span>
        <button disabled={result.page >= result.totalPages || loading} onClick={() => setPageNumber((current) => current + 1)}>下一页</button>
      </div>

    </section>
  );
}

function fileName(targetPath: string): string {
  return targetPath.split(/[\\/]/).filter(Boolean).at(-1) ?? targetPath;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
