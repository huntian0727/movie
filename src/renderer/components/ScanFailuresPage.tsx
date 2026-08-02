import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileQuestion, FolderOpen, Info, LoaderCircle, Play, RotateCw, Trash2 } from "lucide-react";
import type { ScanFailureReviewKind, ScanFailureReviewPage, ScanFailureReviewPageSize, ScanFailureReviewQuery, SourceFolder, VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

interface ScanFailuresPageProps {
  folders: SourceFolder[];
  initialSourceFolderId?: string;
  refreshSequence: number;
  loadPage(query: ScanFailureReviewQuery): Promise<ScanFailureReviewPage>;
  onRetry(failureId: string): Promise<unknown>;
  onDeleteFile(failureId: string): Promise<unknown>;
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
  folders, initialSourceFolderId, refreshSequence, loadPage, onRetry, onDeleteFile,
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
  const [deleteFailureId, setDeleteFailureId] = useState<string | null>(null);
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
        <button className="icon-button" title="刷新异常列表" onClick={() => setRefreshVersion((current) => current + 1)}><RotateCw size={18} /></button>
      </div>

      {selectedFolder && <p className="scan-failure-scope">当前仅查看：{selectedFolder.path}</p>}
      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="empty-state"><LoaderCircle className="spin" />正在读取异常记录…</div>}
      {!loading && result.items.length === 0 && (
        <div className="empty-state"><AlertTriangle size={42} /><strong>当前筛选下没有未解决的扫描异常</strong><span>已解决记录不会显示在这里。</span></div>
      )}

      {!loading && result.items.length > 0 && <div className="scan-failure-list">
        {result.items.map(({ failure, kind: itemKind, video }) => {
          const busy = busyIds.has(failure.id);
          const coverUrl = video && getCoverUrl ? getCoverUrl(video) : null;
          return <article className="scan-failure-card" key={failure.id}>
            <div className="scan-failure-preview">
              {coverUrl ? <img src={coverUrl} alt="" /> : itemKind === "directory" ? <FolderOpen size={38} /> : <FileQuestion size={38} />}
              <span>{itemKind === "video" ? "已入库视频" : itemKind === "directory" ? "目录" : "未入库文件"}</span>
            </div>
            <div className="scan-failure-body">
              <strong title={failure.objectPath}>{video?.filename ?? fileName(failure.objectPath)}</strong>
              <code>{failure.objectPath}</code>
              {video && <span>{formatBytes(video.sizeBytes)} · {formatDuration(video.durationMs)}</span>}
              <div className="scan-failure-error"><AlertTriangle size={16} /><span>{failure.errorSummary}</span></div>
              <small>阶段：{failure.failureStage} · 错误码：{failure.errorCode ?? "未知"} · 最近失败：{formatDate(failure.lastFailedAt)} · 重试 {failure.retryCount} 次</small>
            </div>
            <div className="scan-failure-actions">
              {video && <button title="播放" disabled={busy} onClick={() => onOpenVideo?.(video)}><Play size={17} />播放</button>}
              {video && <button title="视频详情" disabled={busy} onClick={() => onShowDetails?.(video)}><Info size={17} />详情</button>}
              <button title="打开所在位置" disabled={busy} onClick={() => void runAction(failure.id, () => onOpenLocation(failure.id))}><ExternalLink size={17} />打开位置</button>
              <button title="仅重试此项" disabled={busy} onClick={() => void runAction(failure.id, () => onRetry(failure.id))}>{busy ? <LoaderCircle className="spin" size={17} /> : <RotateCw size={17} />}重试</button>
              {video && <button title={video.isPendingDelete ? "取消待删除" : "标记待删除"} disabled={busy} onClick={() => void runAction(failure.id, async () => onTogglePendingDelete?.(video))}><Trash2 size={17} />{video.isPendingDelete ? "取消标记" : "待删除"}</button>}
              {itemKind !== "directory" && <button className="danger-button" title="永久删除文件" disabled={busy} onClick={() => setDeleteFailureId(failure.id)}><Trash2 size={17} />永久删除</button>}
            </div>
          </article>;
        })}
      </div>}

      <div className="pagination-bar">
        <button disabled={result.page <= 1 || loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>上一页</button>
        <span>第 {result.page} / {result.totalPages} 页，共 {result.totalCount} 项</span>
        <button disabled={result.page >= result.totalPages || loading} onClick={() => setPageNumber((current) => current + 1)}>下一页</button>
      </div>

      {deleteFailureId && <div className="dialog-backdrop" role="presentation">
        <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="scan-failure-delete-title">
          <h2 id="scan-failure-delete-title">确认永久删除</h2>
          <p>将永久删除磁盘上的文件，不进入回收站。此操作无法撤销。</p>
          <div className="dialog-actions">
            <button onClick={() => setDeleteFailureId(null)}>取消</button>
            <button className="danger-button" onClick={() => {
              const failureId = deleteFailureId;
              setDeleteFailureId(null);
              void runAction(failureId, () => onDeleteFile(failureId));
            }}>确认永久删除</button>
          </div>
        </div>
      </div>}
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
