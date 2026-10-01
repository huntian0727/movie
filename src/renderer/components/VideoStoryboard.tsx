import { memo, useEffect, useState } from "react";
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
  if (times.length === 0) return <p className="video-storyboard-unavailable">{video.metadataStatus === "pending" ? "时长分析完成后显示截图预览" : "暂无可用时长，无法生成截图预览"}</p>;
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
