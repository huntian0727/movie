import { useEffect, useMemo, useState } from "react";
import type { VideoRecord } from "../../shared/videoTypes";

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
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const api = window.videoManager;
  const eligibleIds = useMemo(() => videos.filter((video) =>
    !video.isMissing && video.sizeBytes > 0 && video.metadataStatus === "pending"
  ).map((video) => video.id), [videos]);
  const eligibleKey = eligibleIds.join("|");
  const pageIds = videos.map((video) => video.id).join("|");
  const completed = videos.filter((video) => video.metadataStatus === "ready").length;
  const unavailable = videos.filter((video) => video.isMissing || video.sizeBytes <= 0 || video.metadataStatus === "failed").length;
  const candidates = eligibleIds.filter((id) => !attempted[id]);
  const canRun = enabled && active && !pageLoading && documentVisible && Boolean(api?.loadPreviewMetadata);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  // Identity tracks navigation and video IDs rather than video objects / refresh events.
  // Completed tasks stay cached in SQLite; only requests owned by this page are cancelled.
  useEffect(() => {
    if (!canRun || !api || candidates.length === 0) {
      setCurrentId(null);
      return;
    }
    let disposed = false;
    let requestId: string | null = null;
    const timer = window.setTimeout(() => {
      if (disposed) return;
      const videoId = candidates[0]!;
      requestId = crypto.randomUUID();
      setCurrentId(videoId);
      setNotice(null);
      void api.loadPreviewMetadata({ requestId, videoId, retry: false })
        .then((video) => {
          if (disposed) return;
          setAttempted((current) => ({ ...current, [videoId]: true }));
          if (!video || video.metadataStatus === "pending") setNotice("部分文件未完成分析，可稍后重新开启重试");
        })
        .catch((error: unknown) => {
          if (disposed) return;
          setAttempted((current) => ({ ...current, [videoId]: true }));
          setNotice(error instanceof Error ? error.message : "当前视频分析请求失败");
        })
        .finally(() => { if (!disposed) setCurrentId(null); });
    }, 300);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (requestId) void api.cancelPreviewMetadata(requestId).catch(() => undefined);
    };
  // A refreshed page can remove completed IDs. Never depend on entire video objects.
  }, [api, canRun, scopeKey, pageIds, eligibleKey, candidates.join("|")]);

  useEffect(() => { setAttempted({}); setNotice(null); }, [scopeKey, pageIds]);

  if (!active) return null;
  return <div className="batch-toolbar page-metadata-auto" role="region" aria-label="本页自动分析"
    style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "8px 12px" }}>
    <button type="button" aria-pressed={enabled} onClick={() => { setEnabled((value) => !value); setAttempted({}); }}>
      {enabled ? "关闭本页自动分析" : "开启本页自动分析"}
    </button>
    <span role="status">
      本页 {videos.length} 部 · 已就绪 {completed} · 待分析 {eligibleIds.length} · 不可分析/失败 {unavailable}
      {enabled ? pageLoading ? " · 等待页面加载" : !documentVisible ? " · 窗口暂不可见" :
        currentId ? " · 正在处理 1 部" : candidates.length === 0 ? " · 本页处理完毕" : " · 等待排队" : " · 默认关闭"}
    </span>
    {notice && <small role="alert">{notice}</small>}
  </div>;
}
