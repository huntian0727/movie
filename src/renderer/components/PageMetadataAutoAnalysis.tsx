import { useEffect, useMemo, useRef, useState } from "react";
import type { VideoRecord } from "../../shared/videoTypes";

const PAGE_ANALYSIS_WORKERS = 2;

type FailedRetryBatch = { pageIdentity: string; ids: string[] };
type PageProgress = { pageIdentity: string; total: number; processed: number };

/**
 * Only owns requests created by this page. Cancelling an old page must never
 * cancel a scan-owned or another consumer's metadata work.
 */
export function PageMetadataAutoAnalysis({
  videos, active, pageLoading, scopeKey
}: {
  videos: VideoRecord[];
  active: boolean;
  pageLoading: boolean;
  scopeKey: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const [queueStates, setQueueStates] = useState<Record<string, "queued" | "active">>({});
  const [retryBatch, setRetryBatch] = useState<FailedRetryBatch | null>(null);
  const [attemptedVersion, setAttemptedVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<PageProgress>({ pageIdentity: "", total: 0, processed: 0 });
  const [retryProgress, setRetryProgress] = useState<PageProgress>({ pageIdentity: "", total: 0, processed: 0 });
  const attemptedRef = useRef<{ pageIdentity: string; ids: Record<string, boolean> }>({ pageIdentity: "", ids: {} });
  const api = window.videoManager;
  const eligibleIds = useMemo(() => videos.filter((video) =>
    !video.isMissing && video.sizeBytes > 0 && video.metadataStatus === "pending"
  ).map((video) => video.id), [videos]);
  const retryableFailedVideos = useMemo(() => videos.filter((video) =>
    !video.isMissing && video.sizeBytes > 0 && video.metadataStatus === "failed"
  ), [videos]);
  const pageIds = videos.map((video) => video.id).join("|");
  const pageIdentity = `${scopeKey}\u0000${pageIds}`;
  const currentAnalysisProgress = analysisProgress.pageIdentity === pageIdentity
    ? analysisProgress
    : { pageIdentity, total: enabled ? eligibleIds.length : 0, processed: 0 };
  const currentRetryProgress = retryProgress.pageIdentity === pageIdentity
    ? retryProgress
    : { pageIdentity, total: 0, processed: 0 };
  // Reset synchronously when the user navigates to a different page/scope.
  if (attemptedRef.current.pageIdentity !== pageIdentity) {
    attemptedRef.current = { pageIdentity, ids: {} };
  }
  const candidates = useMemo(() => eligibleIds.filter((id) => !attemptedRef.current.ids[id]),
    [eligibleIds, attemptedVersion, pageIdentity]);
  const completed = videos.filter((video) => video.metadataStatus === "ready").length;
  const unanalysableCount = videos.filter((video) => video.isMissing || video.sizeBytes <= 0).length;
  const queueQueuedCount = Object.values(queueStates).filter((state) => state === "queued").length;
  const queueActiveCount = Object.values(queueStates).filter((state) => state === "active").length;
  const canRun = enabled && active && !pageLoading && documentVisible && Boolean(api?.loadPreviewMetadata);
  const retryBatchCurrent = retryBatch?.pageIdentity === pageIdentity;
  const retryBusy = retryBatchCurrent && retryingIds.length > 0;
  const autoWorkPending = enabled && candidates.length > 0;
  const retryDisabled = !api?.loadPreviewMetadata || retryableFailedVideos.length === 0 ||
    Boolean(retryBatch) || retryingIds.length > 0 || activeIds.length > 0 || autoWorkPending || pageLoading;

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!canRun || !api || candidates.length === 0) {
      setActiveIds([]);
      setQueueStates({});
      return;
    }

    let disposed = false;
    let nextIndex = 0;
    const requestIds = new Set<string>();
    const pollTimers = new Set<number>();
    const workerCount = Math.min(PAGE_ANALYSIS_WORKERS, candidates.length);

    const worker = async () => {
      while (!disposed) {
        const videoId = candidates[nextIndex++];
        if (!videoId) return;

        const requestId = crypto.randomUUID();
        requestIds.add(requestId);
        let requestFinished = false;
        let pollTimer: number | undefined;
        const pollState = async () => {
          try {
            const next = await api.getPreviewMetadataState(requestId);
            if (!disposed && !requestFinished && next) {
              setQueueStates((current) => current[videoId] === next ? current : { ...current, [videoId]: next });
            }
          } catch {
            // A transient state read must not turn a successful metadata request into a failure.
          }
          if (!disposed && !requestFinished) {
            pollTimer = window.setTimeout(() => {
              if (pollTimer) pollTimers.delete(pollTimer);
              pollTimer = undefined;
              void pollState();
            }, 1000);
            pollTimers.add(pollTimer);
          }
        };
        setQueueStates((current) => ({ ...current, [videoId]: "queued" }));
        void pollState();
        setActiveIds((current) => current.includes(videoId) ? current : [...current, videoId]);
        try {
          const video = await api.loadPreviewMetadata({ requestId, videoId, retry: false });
          if (disposed) return;
          attemptedRef.current.ids[videoId] = true;
          setAttemptedVersion((version) => version + 1);
          setAnalysisProgress((current) => {
            const base = current.pageIdentity === pageIdentity
              ? current
              : { pageIdentity, total: candidates.length, processed: 0 };
            return { ...base, processed: Math.min(base.total, base.processed + 1) };
          });
          if (!video || video.metadataStatus === "pending") {
            setNotice("部分文件未完成分析，可稍后重试");
          }
        } catch (error: unknown) {
          if (disposed) return;
          attemptedRef.current.ids[videoId] = true;
          setAttemptedVersion((version) => version + 1);
          setAnalysisProgress((current) => {
            const base = current.pageIdentity === pageIdentity
              ? current
              : { pageIdentity, total: candidates.length, processed: 0 };
            return { ...base, processed: Math.min(base.total, base.processed + 1) };
          });
          setNotice(error instanceof Error ? error.message : "当前视频分析请求失败");
        } finally {
          requestFinished = true;
          if (pollTimer) {
            window.clearTimeout(pollTimer);
            pollTimers.delete(pollTimer);
          }
          requestIds.delete(requestId);
          if (!disposed) {
            setActiveIds((current) => current.filter((id) => id !== videoId));
            setQueueStates((current) => {
              const next = { ...current };
              delete next[videoId];
              return next;
            });
          }
        }
      }
    };

    const timer = window.setTimeout(() => {
      if (disposed) return;
      setNotice(null);
      // Keep two requests in flight so the bounded main-process queue stays fed.
      // MediaReadBudget still caps total reads and serializes reads from one cloud source.
      void Promise.all(Array.from({ length: workerCount }, () => worker()));
    }, 300);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      for (const pollTimer of pollTimers) window.clearTimeout(pollTimer);
      pollTimers.clear();
      for (const requestId of requestIds) {
        void api.cancelPreviewMetadata(requestId).catch(() => undefined);
      }
    };
  // Deliberately exclude candidates/metadata status: a completion must not cancel its sibling worker.
  // Page identity and run eligibility are the cancellation boundaries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canRun, scopeKey, pageIds]);

  // Failed items are retried only after an explicit click. Zero-byte/missing items
  // are excluded because they need a source/size repair, not another FFprobe run.
  useEffect(() => {
    if (!retryBatch || retryBatch.pageIdentity !== pageIdentity || !api?.loadPreviewMetadata || retryBatch.ids.length === 0) return;

    let disposed = false;
    let nextIndex = 0;
    let attempted = 0;
    let completedCount = 0;
    let unresolvedCount = 0;
    let lastError: string | null = null;
    const ids = [...new Set(retryBatch.ids)];
    const requestIds = new Set<string>();
    const pollTimers = new Set<number>();
    const workerCount = Math.min(PAGE_ANALYSIS_WORKERS, ids.length);

    const worker = async () => {
      while (!disposed) {
        const videoId = ids[nextIndex++];
        if (!videoId) return;
        const requestId = crypto.randomUUID();
        requestIds.add(requestId);
        let requestFinished = false;
        let pollTimer: number | undefined;
        const pollState = async () => {
          try {
            const next = await api.getPreviewMetadataState(requestId);
            if (!disposed && !requestFinished && next) {
              setQueueStates((current) => current[videoId] === next ? current : { ...current, [videoId]: next });
            }
          } catch {
            // Keep the retry request authoritative if a queue-state read temporarily fails.
          }
          if (!disposed && !requestFinished) {
            pollTimer = window.setTimeout(() => {
              if (pollTimer) pollTimers.delete(pollTimer);
              pollTimer = undefined;
              void pollState();
            }, 1000);
            pollTimers.add(pollTimer);
          }
        };
        setQueueStates((current) => ({ ...current, [videoId]: "queued" }));
        void pollState();
        setRetryingIds((current) => current.includes(videoId) ? current : [...current, videoId]);
        try {
          const video = await api.loadPreviewMetadata({ requestId, videoId, retry: true });
          if (disposed) return;
          attemptedRef.current.ids[videoId] = true;
          setAttemptedVersion((version) => version + 1);
          attempted += 1;
          if (video?.metadataStatus === "ready") completedCount += 1;
          else unresolvedCount += 1;
          setRetryProgress((current) => {
            const base = current.pageIdentity === pageIdentity
              ? current
              : { pageIdentity, total: ids.length, processed: 0 };
            return { ...base, processed: Math.min(base.total, base.processed + 1) };
          });
        } catch (error: unknown) {
          if (disposed) return;
          attemptedRef.current.ids[videoId] = true;
          setAttemptedVersion((version) => version + 1);
          attempted += 1;
          unresolvedCount += 1;
          setRetryProgress((current) => {
            const base = current.pageIdentity === pageIdentity
              ? current
              : { pageIdentity, total: ids.length, processed: 0 };
            return { ...base, processed: Math.min(base.total, base.processed + 1) };
          });
          lastError = error instanceof Error ? error.message : "请求失败";
        } finally {
          requestFinished = true;
          if (pollTimer) {
            window.clearTimeout(pollTimer);
            pollTimers.delete(pollTimer);
          }
          requestIds.delete(requestId);
          if (!disposed) {
            setRetryingIds((current) => current.filter((id) => id !== videoId));
            setQueueStates((current) => {
              const next = { ...current };
              delete next[videoId];
              return next;
            });
          }
        }
      }
    };

    const timer = window.setTimeout(() => {
      setNotice(null);
      void Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => {
        if (disposed) return;
        if (unresolvedCount > 0) {
          setNotice(`已重试 ${attempted} 部，成功 ${completedCount} 部，仍有 ${unresolvedCount} 部未恢复。${lastError ? ` 最近错误：${lastError}` : "可查看失败原因后再决定是否重试。"}`);
        } else {
          setNotice(`重试完成：${completedCount} 部视频分析成功。`);
        }
        setRetryBatch(null);
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      for (const pollTimer of pollTimers) window.clearTimeout(pollTimer);
      pollTimers.clear();
      for (const requestId of requestIds) {
        void api.cancelPreviewMetadata(requestId).catch(() => undefined);
      }
    };
  }, [api, pageIdentity, retryBatch]);

  useEffect(() => {
    setNotice(null);
    setActiveIds([]);
    setRetryingIds([]);
    setQueueStates({});
    setRetryBatch(null);
  }, [scopeKey, pageIds]);

  if (!active) return null;
  return <div className="batch-toolbar page-metadata-auto" role="region" aria-label="本页自动分析"
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "8px 12px" }}>
    <button type="button" aria-pressed={enabled} onClick={() => {
      const nextEnabled = !enabled;
      attemptedRef.current.ids = {};
      setAttemptedVersion((version) => version + 1);
      setAnalysisProgress({ pageIdentity, total: nextEnabled ? eligibleIds.length : 0, processed: 0 });
      setEnabled(nextEnabled);
    }}>
      {enabled ? "关闭本页自动分析" : "开启本页自动分析"}
    </button>
    <span role="status">
      本页 {videos.length} 部 · 已就绪 {completed} · 待分析 {eligibleIds.length} · 缺失/0B不可分析 {unanalysableCount} · 失败可重试 {retryableFailedVideos.length}
      {enabled ? pageLoading ? " · 等待页面加载" : !documentVisible ? " · 窗口暂不可见" :
        activeIds.length ? ` · 本页请求中 ${activeIds.length} 部（实际执行 ${queueActiveCount} · 排队 ${queueQueuedCount}）` : candidates.length === 0 ? " · 本页处理完毕" : " · 等待排队" : " · 默认关闭"}
      {enabled && currentAnalysisProgress.total > 0 ? ` · 分析进度 ${currentAnalysisProgress.processed}/${currentAnalysisProgress.total}` : ""}
      {retryBusy ? ` · 重试请求 ${retryingIds.length} 部（实际执行 ${queueActiveCount} · 排队 ${queueQueuedCount}）` : ""}
      {retryBatchCurrent && currentRetryProgress.total > 0 ? ` · 重试进度 ${currentRetryProgress.processed}/${currentRetryProgress.total}` : ""}
    </span>
    {enabled && currentAnalysisProgress.total > 0 && <progress className="page-metadata-progress" max={currentAnalysisProgress.total}
      value={Math.min(currentAnalysisProgress.processed, currentAnalysisProgress.total)} aria-label="本页分析进度" style={{ width: 160, height: 8 }} />}
    {retryBatchCurrent && currentRetryProgress.total > 0 && <progress className="page-metadata-progress" max={currentRetryProgress.total}
      value={Math.min(currentRetryProgress.processed, currentRetryProgress.total)} aria-label="本页重试进度" style={{ width: 160, height: 8 }} />}
    <button type="button" disabled={retryDisabled} title="仅重试当前页中存在且大小有效的分析失败视频"
      onClick={() => {
        setNotice(null);
        const ids = retryableFailedVideos.map((video) => video.id);
        setRetryProgress({ pageIdentity, total: ids.length, processed: 0 });
        setRetryBatch({ pageIdentity, ids });
      }}>
      {retryBatch ? "正在重试失败项…" : `重试本页失败项（${retryableFailedVideos.length}）`}
    </button>
    {unanalysableCount > 0 && <small>缺失文件需先恢复访问；0B 文件需先重新读取大小，不会反复执行无效分析。</small>}
    {notice && <small role="alert">{notice}</small>}
  </div>;
}
