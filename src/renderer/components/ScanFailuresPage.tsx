import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, FileQuestion, FolderOpen, Info, LoaderCircle, Play, RotateCw, Trash2 } from "lucide-react";
import type { ScanFailureBatchJob, ScanFailureBatchOperation, ScanFailureBatchSubmitRequest, ScanFailureCleanupAction, ScanFailureCleanupResult, ScanFailureReviewKind, ScanFailureReviewPage, ScanFailureReviewPageSize, ScanFailureReviewQuery, SourceFolder, VideoRecord } from "../../shared/videoTypes";
import { classifyScanFailureForCleanup } from "../../shared/scanFailureCleanup";
import { formatBytes, formatDuration } from "./formatters";
import { PreviewImage } from "./PreviewImage";
import { OperationFeedback, ReadState, operationErrorMessage } from "./OperationFeedback";

interface ScanFailuresPageProps {
  folders: SourceFolder[];
  initialSourceFolderId?: string;
  refreshSequence: number;
  loadPage(query: ScanFailureReviewQuery): Promise<ScanFailureReviewPage>;
  onRetry(failureId: string): Promise<unknown>;
  onDeleteFile(failureId: string): Promise<unknown>;
  onCleanup?(failureIds: string[], action: ScanFailureCleanupAction): Promise<ScanFailureCleanupResult>;
  onSubmitBatch?(request: ScanFailureBatchSubmitRequest): Promise<ScanFailureBatchJob>;
  onGetBatch?(jobId: string): Promise<ScanFailureBatchJob>;
  onCancelBatch?(jobId: string): Promise<ScanFailureBatchJob>;
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
  folders, initialSourceFolderId, refreshSequence, loadPage, onRetry, onDeleteFile, onCleanup, onSubmitBatch, onGetBatch, onCancelBatch,
  onOpenLocation, onOpenVideo, onShowDetails, onTogglePendingDelete, getCoverUrl
}: ScanFailuresPageProps) {
  const [sourceFolderId, setSourceFolderId] = useState(initialSourceFolderId ?? "");
  const [kind, setKind] = useState<ScanFailureReviewKind>("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<ScanFailureReviewPageSize>(30);
  const [result, setResult] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchRetryVersion, setBatchRetryVersion] = useState(0);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [selectedFailureIds, setSelectedFailureIds] = useState<Set<string>>(() => new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [cleanupFilter, setCleanupFilter] = useState<"all" | "confirmed-corrupt" | "missing">("all");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [batchJob, setBatchJob] = useState<ScanFailureBatchJob | null>(null);
  const loadPageRef = useRef(loadPage);
  const previousQueryKeyRef = useRef<string | null>(null);
  const previousRefreshVersionRef = useRef(refreshVersion);
  const submitGuardRef = useRef(false);

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
    const manualRefresh = previousRefreshVersionRef.current !== refreshVersion;
    previousQueryKeyRef.current = queryKey;
    previousRefreshVersionRef.current = refreshVersion;
    if (queryChanged || manualRefresh) setLoading(true);
    setLoadError(null);
    loadPageRef.current({ sourceFolderId: sourceFolderId || undefined, kind, page: pageNumber, pageSize })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        if (next.page !== pageNumber) setPageNumber(next.page);
      })
      .catch((cause) => { if (!cancelled) setLoadError(toMessage(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, pageNumber, pageSize, refreshSequence, refreshVersion, sourceFolderId]);

  const selectedFolder = useMemo(() => folders.find((folder) => folder.id === sourceFolderId), [folders, sourceFolderId]);
  const sourceAlerts = useMemo(() => folders.filter((folder) => folder.enabled && Boolean(folder.scanError)), [folders]);
  const visibleItems = useMemo(() => result.items.filter((item) => cleanupFilter === "all" || classifyScanFailureForCleanup(item.failure).category === cleanupFilter), [cleanupFilter, result.items]);
  const selectableIds = useMemo(() => visibleItems.filter((item) => item.failure.objectType === "file").map((item) => item.failure.id), [visibleItems]);
  const selectedCorruptCount = result.items.filter((item) => selectedFailureIds.has(item.failure.id) && Boolean(item.video) && classifyScanFailureForCleanup(item.failure).category === "confirmed-corrupt").length;
  const selectedMissingCount = result.items.filter((item) => selectedFailureIds.has(item.failure.id) && classifyScanFailureForCleanup(item.failure).category === "missing").length;
  const batchActive = batchSubmitting || Boolean(batchJob && ["queued", "running", "cancelling"].includes(batchJob.status));
  const rowsUnavailable = loading || Boolean(loadError);

  useEffect(() => {
    const availableIds = new Set(result.items.map((item) => item.failure.id));
    setSelectedFailureIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
  }, [result.items]);

  useEffect(() => {
    setAllFilteredSelected(false);
    setSelectedFailureIds(new Set());
  }, [cleanupFilter, kind, sourceFolderId]);

  useEffect(() => {
    if (!batchJob || !onGetBatch || !["queued", "running", "cancelling"].includes(batchJob.status)) return;
    let cancelled = false;
    let inFlight = false;
    let failed = false;
    setBatchError(null);
    const timer = window.setInterval(() => {
      if (inFlight || failed) return;
      inFlight = true;
      void onGetBatch(batchJob.id).then((next) => {
        if (cancelled) return;
        setBatchJob(next);
        if (!["queued", "running", "cancelling"].includes(next.status)) {
          setNotice(null);
          setRefreshVersion((current) => current + 1);
        }
      }).catch((cause) => { if (!cancelled) { failed = true; setBatchError(toMessage(cause)); } })
        .finally(() => { inFlight = false; });
    }, 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [batchJob?.id, batchJob?.status, onGetBatch, batchRetryVersion]);

  async function runAction(failureId: string, action: () => Promise<unknown>) {
    if (rowsUnavailable || busyIds.has(failureId)) return;
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
    if (!onCleanup || selectedFailureIds.size === 0 || rowsUnavailable || bulkBusy || batchActive) return;
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

  async function startBatch(operation: ScanFailureBatchOperation) {
    if (!onSubmitBatch || submitGuardRef.current || batchActive || rowsUnavailable) return;
    submitGuardRef.current = true;
    setBatchSubmitting(true);
    setBatchError(null);
    setError(null);
    setNotice(null);
    try {
      const scope: ScanFailureBatchSubmitRequest["scope"] = allFilteredSelected
        ? { mode: "filtered", query: { sourceFolderId: sourceFolderId || undefined, kind, cleanupCategory: cleanupFilter } }
        : { mode: "selected", failureIds: [...selectedFailureIds] };
      const job = await onSubmitBatch({ operation, scope });
      setBatchJob(job);
      setNotice(["queued", "running", "cancelling"].includes(job.status) ? `批处理已受理，共 ${job.totalCount} 项。实际结果请看下方任务进度。` : null);
      if (!["queued", "running", "cancelling"].includes(job.status)) setRefreshVersion((current) => current + 1);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      submitGuardRef.current = false;
      setBatchSubmitting(false);
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
            <option value="confirmed-corrupt">仅确认损坏</option>
            <option value="missing">仅网盘已删除</option>
          </select>
        </label>
        <button className="icon-button" title="刷新异常列表" aria-label="刷新异常列表" disabled={loading} onClick={() => setRefreshVersion((current) => current + 1)}><RotateCw className={loading ? "spin" : undefined} size={18} /></button>
      </div>

      {sourceAlerts.length > 0 && <details className="scan-failure-source-alerts">
        <summary><AlertTriangle size={17} />{sourceAlerts.length} 个资料库当前存在来源级异常</summary>
        <p>来源离线或目录不可访问时，优先处理资料库本身；不要把同一来源下的大量文件记录当成独立损坏文件。</p>
        <div>
          {sourceAlerts.map((folder) => <button key={folder.id} type="button" onClick={() => { setSourceFolderId(folder.id); setPageNumber(1); }}>
            <span title={folder.path}>{folder.path}</span><small>{folder.scanError}</small>
          </button>)}
        </div>
      </details>}

      <div className="scan-failure-cleanup-bar">
        <small>刷新列表只读取资料库记录；“复查可访问性”才会检查文件是否仍可访问。</small>
        <strong>{allFilteredSelected ? "已选择全部筛选结果（不限当前页）" : `已选 ${selectedFailureIds.size} 个可处理项`}</strong>
        <button disabled={rowsUnavailable || selectableIds.length === 0 || bulkBusy || batchActive} onClick={() => { setAllFilteredSelected(false); setSelectedFailureIds(new Set(selectableIds)); }}>全选当前页可清理项</button>
        <button disabled={rowsUnavailable || result.totalCount === 0 || !onSubmitBatch || batchActive} onClick={() => { setAllFilteredSelected(true); setSelectedFailureIds(new Set()); }}>全选全部筛选结果</button>
        <button disabled={(!allFilteredSelected && selectedCorruptCount === 0) || bulkBusy || batchActive || (!allFilteredSelected && !onCleanup) || (allFilteredSelected && !onSubmitBatch)} onClick={() => void (allFilteredSelected ? startBatch("permanent-delete") : runBulkCleanup("permanent-delete"))}>{bulkBusy || batchActive ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}永久删除损坏项</button>
        <button disabled={(!allFilteredSelected && selectedMissingCount === 0) || bulkBusy || batchActive || (!allFilteredSelected && !onCleanup) || (allFilteredSelected && !onSubmitBatch)} onClick={() => void (allFilteredSelected ? startBatch("remove-missing-record") : runBulkCleanup("remove-missing-record"))}>清理网盘失效记录</button>
        <button disabled={(!allFilteredSelected && selectedFailureIds.size === 0) || !onSubmitBatch || batchActive} onClick={() => void startBatch("recheck-accessibility")}>复查可访问性</button>
        <button disabled={(!allFilteredSelected && selectedFailureIds.size === 0) || !onSubmitBatch || batchActive} onClick={() => void startBatch("analyze-metadata")}>分析元数据</button>
        {(selectedFailureIds.size > 0 || allFilteredSelected) && <button disabled={bulkBusy || batchActive} onClick={() => { setAllFilteredSelected(false); setSelectedFailureIds(new Set()); }}>取消选择</button>}
        <span>只有独立复核明确确认损坏的项目才允许永久删除；普通 FFprobe 解析失败、格式不匹配、超时、断线和权限异常均不会删除。网盘已删除项只清理本地记录，并在操作时在线强制刷新确认。</span>
      </div>

      {batchSubmitting && <OperationFeedback message="正在提交批处理，请勿重复点击。" tone="info" />}
      {batchJob && <div className="scan-failure-batch-status" role="status">
        <strong>{batchError ? "任务状态暂时未知" : batchJob.status === "queued" ? "等待执行" : batchJob.status === "running" ? "批处理中" : batchJob.status === "cancelling" ? "正在取消" : batchJob.status === "cancelled" ? "已取消" : batchJob.status === "completed-with-errors" ? "批处理完成（有失败）" : "批处理完成"}</strong>
        <span>{batchJob.processedCount} / {batchJob.totalCount} · 成功 {batchJob.successCount} · 跳过 {batchJob.skippedCount} · 失败 {batchJob.failureCount}</span>
        {batchJob.currentPath && <code title={batchJob.currentPath}>{batchJob.currentPath}</code>}
        {batchJob.message && <span>{batchJob.message}</span>}
        {batchActive && <button disabled={!onCancelBatch || batchJob.status === "cancelling"} onClick={() => void onCancelBatch?.(batchJob.id).then(setBatchJob).catch((cause) => setError(toMessage(cause)))}>取消批处理</button>}
        {!batchActive && <button type="button" onClick={() => { setBatchJob(null); setNotice(null); }}>收起结果</button>}
      </div>}

      {selectedFolder && <p className="scan-failure-scope">当前仅查看：{selectedFolder.path}</p>}
      <OperationFeedback message={loadError ? `列表读取失败：${loadError}` : null} tone="error" onRetry={() => setRefreshVersion((current) => current + 1)} />
      <OperationFeedback message={error} tone="error" onDismiss={() => setError(null)} />
      <OperationFeedback message={batchError ? `任务状态读取失败：${batchError}。重新读取不会重复提交任务。` : null} tone="error" onRetry={() => setBatchRetryVersion((current) => current + 1)} />
      <OperationFeedback message={notice} tone={batchActive ? "info" : /失败 [1-9]/.test(notice ?? "") ? "warning" : "success"} autoDismiss={!batchActive} onDismiss={() => setNotice(null)} />
      <ReadState loading={loading} error={loadError} empty={visibleItems.length === 0} loadingText="正在读取异常记录..."
        emptyTitle={result.items.length === 0 ? "当前筛选下没有未解决的扫描异常" : cleanupFilter === "missing" ? "当前页没有网盘已删除记录" : "当前页没有确认损坏的视频"}
        emptyText={result.items.length === 0 ? "已解决记录不会显示在这里。" : "可切换回“全部异常”，或翻页继续查看。"} />

      {!loading && visibleItems.length > 0 && <div className="scan-failure-list">
        {visibleItems.map(({ failure, kind: itemKind, video }) => {
          const busy = busyIds.has(failure.id) || rowsUnavailable;
          const coverUrl = video && getCoverUrl ? getCoverUrl(video) : null;
          const classification = classifyScanFailureForCleanup(failure);
          const selectable = failure.objectType === "file";
          return <article className={`scan-failure-card scan-failure-${classification.category}`} key={failure.id}>
            <label className="scan-failure-select" title={selectable ? "选择此可处理项" : classification.reason}>
              <input type="checkbox" disabled={!selectable || busy || bulkBusy} checked={selectedFailureIds.has(failure.id)} onChange={(event) => setSelectedFailureIds((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(failure.id); else next.delete(failure.id);
                return next;
              })} />
            </label>
            <div className="scan-failure-preview">
              {coverUrl ? <PreviewImage src={coverUrl} cachedOnly /> : itemKind === "directory" ? <FolderOpen size={38} /> : <FileQuestion size={38} />}
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
  return operationErrorMessage(cause);
}
