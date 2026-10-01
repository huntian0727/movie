import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, RotateCw } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { getStoryboardFrameCount, getStoryboardFrameUrl, getStoryboardTimes } from "../../shared/storyboard";
import { PreviewImage, type PreviewImageState } from "./PreviewImage";
import { formatDuration } from "./formatters";

export const VideoStoryboard = memo(function VideoStoryboard({ video, onPlay }: {
  video: VideoRecord; onPlay(timeMs: number): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [frameStates, setFrameStates] = useState<Record<string, PreviewImageState>>({});
  const updateFrameState = useCallback((key: string, state: PreviewImageState) => {
    setFrameStates((current) => current[key] === state ? current : { ...current, [key]: state });
  }, []);
  const times = getStoryboardTimes(video.durationMs, expanded ? getStoryboardFrameCount(video.durationMs ?? 0) : 6);
  const states = times.map((timeMs) => frameStates[getStoryboardFrameUrl(video, timeMs)] ?? "idle");
  const count = (state: PreviewImageState) => states.filter((value) => value === state).length;
  const progress = [count("queued") && `排队 ${count("queued")}`, count("loading") && `生成中 ${count("loading")}`,
    count("failed") && `失败 ${count("failed")}`, count("paused") && `暂停 ${count("paused")}`].filter(Boolean).join(" · ");
  const remote = Boolean(video.providerFileId || video.providerPath);
  if (times.length === 0) return <StoryboardMetadataGate key={JSON.stringify([video.id, video.path, video.sizeBytes, video.modifiedAt])} video={video} onPlay={onPlay} />;
  return <div className={`video-storyboard${expanded ? " is-expanded" : ""}`} aria-label={`${video.filename} 截图预览`}>
    <div className="video-storyboard-frames">
      {times.map((timeMs, index) => <StoryboardFrame key={getStoryboardFrameUrl(video, timeMs)} video={video} timeMs={timeMs}
        priority={index === 0 ? remote ? 1 : 2 : remote ? 0 : 1}
        retryVersion={retryVersion} onPlay={onPlay} onStateChange={updateFrameState} />)}
    </div>
    <div className="video-storyboard-footer">
      <span role="status">已加载 {count("ready")}/{times.length} 张{progress ? ` · ${progress}` : ""} · 点击从对应位置播放</span>
      {getStoryboardFrameCount(video.durationMs!) > 6 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{expanded ? "收起截图" : `查看全部 ${getStoryboardFrameCount(video.durationMs!)} 张`}
      </button>}
      <button type="button" title="只重新尝试未能加载的截图" onClick={() => setRetryVersion((value) => value + 1)}><RotateCw size={12} />重试失败截图</button>
    </div>
    {remote && <div className="video-storyboard-note">云盘使用快速关键帧截图，画面可能略有偏移；点击仍从标注的采样时间播放。</div>}
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

function StoryboardFrame({ video, timeMs, priority, retryVersion, onPlay, onStateChange }: {
  video: VideoRecord; timeMs: number; priority: 0 | 1 | 2; retryVersion: number; onPlay(timeMs: number): void;
  onStateChange(key: string, state: PreviewImageState): void;
}) {
  const [state, setState] = useState<PreviewImageState>("idle");
  const failed = state === "failed";
  const [requestVersion, setRequestVersion] = useState(retryVersion);
  useEffect(() => {
    if (failed && retryVersion > requestVersion) {
      setRequestVersion(retryVersion);
      setState("idle");
    }
  }, [failed, requestVersion, retryVersion]);
  return <button type="button" className={`video-storyboard-frame${failed ? " is-failed" : ""}`}
    aria-label={`从 ${formatDuration(timeMs)} 播放 ${video.filename}`} title={`从 ${formatDuration(timeMs)} 播放`}
    onClick={() => onPlay(timeMs)}>
    <PreviewImage key={requestVersion} src={getStoryboardFrameUrl(video, timeMs)} priority={priority}
      delayMs={180} onStateChange={(next) => { setState(next); onStateChange(getStoryboardFrameUrl(video, timeMs), next); }} />
    {state !== "ready" && <span className={`video-storyboard-frame-state${failed ? " is-failed" : ""}`}>
      {state === "loading" ? "正在生成…" : state === "queued" ? "等待生成" : failed ? "生成失败 · 可重试" : state === "paused" ? "离屏暂停" : "等待可见"}
    </span>}
    <span className="video-storyboard-time">{formatDuration(timeMs)}</span>
  </button>;
}
