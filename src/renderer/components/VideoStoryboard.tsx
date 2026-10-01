import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, RotateCw } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { getStoryboardFrameCount, getStoryboardFrameUrl, getStoryboardTimes } from "../../shared/storyboard";
import { PreviewImage } from "./PreviewImage";
import { formatDuration } from "./formatters";

export const VideoStoryboard = memo(function VideoStoryboard({ video, onPlay }: {
  video: VideoRecord; onPlay(timeMs: number): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const times = getStoryboardTimes(video.durationMs, expanded ? getStoryboardFrameCount(video.durationMs ?? 0) : 6);
  if (times.length === 0) return <StoryboardMetadataGate key={JSON.stringify([video.id, video.path, video.sizeBytes, video.modifiedAt])} video={video} onPlay={onPlay} />;
  return <div className={`video-storyboard${expanded ? " is-expanded" : ""}`} aria-label={`${video.filename} 截图预览`}>
    <div className="video-storyboard-frames">
      {times.map((timeMs) => <StoryboardFrame key={getStoryboardFrameUrl(video, timeMs)} video={video} timeMs={timeMs} retryVersion={retryVersion} onPlay={onPlay} />)}
    </div>
    <div className="video-storyboard-footer">
      <span>{times.length} 张均匀截图 · 点击从对应位置播放</span>
      {getStoryboardFrameCount(video.durationMs!) > 6 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{expanded ? "收起截图" : `查看全部 ${getStoryboardFrameCount(video.durationMs!)} 张`}
      </button>}
      <button type="button" title="只重新尝试未能加载的截图" onClick={() => setRetryVersion((value) => value + 1)}><RotateCw size={12} />重试失败截图</button>
    </div>
  </div>;
});

/** Duration is a prerequisite; merely waiting for the duplicate-only cloud queue would never start it. */
function StoryboardMetadataGate({ video, onPlay }: { video: VideoRecord; onPlay(timeMs: number): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [resolved, setResolved] = useState<VideoRecord | null>(null);
  const [state, setState] = useState<"idle" | "queued" | "active" | "failed" | "unavailable">("idle");
  const [retryVersion, setRetryVersion] = useState(0);
  const attempted = useRef(false);
  const consumedRetry = useRef(0);
  const api = window.videoManager;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "0px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!visible || !pageVisible || !api?.loadPreviewMetadata || resolved || attempted.current) return;
    if (video.isMissing || video.sizeBytes <= 0 || video.metadataStatus === "ready") { setState("unavailable"); return; }
    const retry = retryVersion > consumedRetry.current;
    if (video.metadataStatus === "failed" && !retry) { setState("failed"); return; }
    let disposed = false;
    let requested = false;
    let finished = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const requestId = crypto.randomUUID();
    const pollState = async () => {
      try {
        const next = await api.getPreviewMetadataState(requestId);
        if (!disposed && !finished && next) setState(next);
      } catch { /* Completion remains authoritative; a transient state read is not a failed probe. */ }
      if (!disposed && !finished) poll = setTimeout(() => void pollState(), 1000);
    };
    const timer = setTimeout(() => {
      requested = true;
      attempted.current = true;
      consumedRetry.current = retryVersion;
      setState("queued");
      void api.loadPreviewMetadata({ requestId, videoId: video.id, retry }).then((next) => {
        finished = true;
        if (disposed) return;
        if (next && next.path === video.path && next.sizeBytes === video.sizeBytes && next.modifiedAt === video.modifiedAt && !next.isMissing && getStoryboardTimes(next.durationMs).length > 0) setResolved(next);
        else setState(next?.metadataStatus === "failed" || next?.metadataStatus === "pending" || !next ? "failed" : "unavailable");
      }).catch(() => { finished = true; if (!disposed) setState("failed"); });
      void pollState();
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (poll) clearTimeout(poll);
      if (requested) void api.cancelPreviewMetadata(requestId).catch(() => undefined);
      if (!finished) { attempted.current = false; setState("idle"); }
    };
  }, [api, pageVisible, resolved, retryVersion, video.id, video.isMissing, video.metadataStatus, video.modifiedAt, video.path, video.sizeBytes, visible]);

  if (resolved) return <VideoStoryboard video={resolved} onPlay={onPlay} />;
  const blocked = video.isMissing || video.sizeBytes <= 0 || video.metadataStatus === "ready";
  const failed = state === "failed" || video.metadataStatus === "failed" && state !== "queued" && state !== "active";
  const message = video.isMissing ? "文件当前不可访问，无法生成截图预览"
    : video.sizeBytes <= 0 ? "文件大小为 0B，请先重新读取大小"
      : state === "active" ? "正在分析时长，完成后自动加载截图…"
        : state === "queued" ? "已排队，等待时长分析…"
          : failed ? "时长分析失败，截图暂不可用"
            : blocked || state === "unavailable" ? "暂无可用时长，无法生成截图预览"
              : "进入可见区域后自动分析时长并加载截图";
  return <div ref={root} className="video-storyboard-unavailable" role="status">
    <span>{message}</span>
    {failed && !blocked && <button type="button" onClick={() => { attempted.current = false; setState("idle"); setRetryVersion((value) => value + 1); }}><RotateCw size={12} />重试时长分析</button>}
  </div>;
}

function StoryboardFrame({ video, timeMs, retryVersion, onPlay }: {
  video: VideoRecord; timeMs: number; retryVersion: number; onPlay(timeMs: number): void;
}) {
  const [failed, setFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(retryVersion);
  useEffect(() => {
    if (failed && retryVersion > requestVersion) {
      setRequestVersion(retryVersion);
      setFailed(false);
    }
  }, [failed, requestVersion, retryVersion]);
  return <button type="button" className={`video-storyboard-frame${failed ? " is-failed" : ""}`}
    aria-label={`从 ${formatDuration(timeMs)} 播放 ${video.filename}`} title={`从 ${formatDuration(timeMs)} 播放`}
    onClick={() => onPlay(timeMs)}>
    <PreviewImage key={requestVersion} src={getStoryboardFrameUrl(video, timeMs)} priority={video.providerFileId || video.providerPath ? 0 : 1}
      delayMs={180} onStateChange={(state) => { if (state === "failed") setFailed(true); }} />
    {failed && <span className="video-storyboard-frame-error">截图暂不可用</span>}
    <span className="video-storyboard-time">{formatDuration(timeMs)}</span>
  </button>;
}
