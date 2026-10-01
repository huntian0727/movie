import { useState } from "react";
import { Film, Info, Play } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";
import { PreviewImage } from "./PreviewImage";
import { useProgressiveRenderCount } from "./useProgressiveRenderCount";
import { VideoItemActions } from "./VideoItemActions";

interface VideoGridProps {
  videos: VideoRecord[];
  getCoverUrl?(video: VideoRecord): string | null;
  onOpen(video: VideoRecord): void;
  onViewDetails(video: VideoRecord): void;
  onToggleFavorite(video: VideoRecord): void;
  onTogglePendingDelete?(video: VideoRecord): void;
  onRename(video: VideoRecord): void;
  onDelete(video: VideoRecord): void;
  onRegenerateCover?(video: VideoRecord): void | Promise<void>;
  onRetryMetadata?(video: VideoRecord): void | Promise<void>;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onShowDirectory?(video: VideoRecord): void;
  cardWidth?: number;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?(video: VideoRecord): void;
}

export function VideoGrid({ videos, getCoverUrl, onOpen, onViewDetails, onToggleFavorite, onTogglePendingDelete, onRename, onDelete, onRegenerateCover, onRetryMetadata, onRevealInFolder, onShowDirectory, cardWidth, selectionMode = false, selectedIds, onToggleSelection }: VideoGridProps) {
  const [failedCoverUrls, setFailedCoverUrls] = useState<Set<string>>(() => new Set());
  const [explicitPreviewIds, setExplicitPreviewIds] = useState<Set<string>>(() => new Set());
  const [previewAttempts, setPreviewAttempts] = useState<Record<string, number>>({});
  const [resettingIds, setResettingIds] = useState<Set<string>>(() => new Set());
  const [resetFailedIds, setResetFailedIds] = useState<Set<string>>(() => new Set());
  const pageKey = videos.map((video) => video.id).join("|");
  const visibleCount = useProgressiveRenderCount(pageKey, videos.length, 48, 40);

  const retryPreview = async (video: VideoRecord, url: string | null) => {
    if (!onRegenerateCover || resettingIds.has(video.id)) return;
    setResettingIds((current) => new Set(current).add(video.id));
    try {
      await onRegenerateCover(video);
      setExplicitPreviewIds((current) => new Set(current).add(video.id));
      setFailedCoverUrls((current) => { const next = new Set(current); if (url) next.delete(url); return next; });
      setResetFailedIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
      // Explicit retry must work even if the database timestamp / URL is unchanged.
      setPreviewAttempts((current) => ({ ...current, [video.id]: (current[video.id] ?? 0) + 1 }));
    } catch {
      if (url) setFailedCoverUrls((current) => new Set(current).add(url));
      setResetFailedIds((current) => new Set(current).add(video.id));
    } finally {
      setResettingIds((current) => { const next = new Set(current); next.delete(video.id); return next; });
    }
  };

  return (
    <div
      className="video-grid video-grid--masonry"
      style={cardWidth ? ({ "--video-card-width": `${cardWidth}px` } as React.CSSProperties) : undefined}
    >
      {videos.slice(0, visibleCount).map((video, index) => {
        const requestedCoverUrl = getCoverUrl?.(video) ?? video.coverCachePath;
        const coverUrl = requestedCoverUrl && !failedCoverUrls.has(requestedCoverUrl) ? requestedCoverUrl : null;
        const coverAspectRatio = getAspectRatioValue(video.width, video.height);

        return (
          <article className={`video-card${selectedIds?.has(video.id) ? " is-selected" : ""}`} key={video.id} onDoubleClick={() => !selectionMode && onOpen(video)}>
            {selectionMode && <label className="video-select"><input type="checkbox" aria-label={`选择 ${video.filename}`} checked={selectedIds?.has(video.id) ?? false} onChange={() => onToggleSelection?.(video)} /></label>}
            <div
              className={`video-cover tone-${index % 6}`}
              style={{ "--cover-aspect-ratio": coverAspectRatio } as React.CSSProperties}
              role="button"
              tabIndex={0}
              aria-label={`播放 ${video.filename}`}
              title={`播放 ${video.filename}`}
              onClick={() => selectionMode ? onToggleSelection?.(video) : onOpen(video)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectionMode ? onToggleSelection?.(video) : onOpen(video);
                }
              }}
            >
              {coverUrl ? (
                <PreviewImage
                  key={`${video.id}:${previewAttempts[video.id] ?? 0}`}
                  src={coverUrl}
                  priority={explicitPreviewIds.has(video.id) ? 2 : 1}
                  onError={() => {
                    setFailedCoverUrls((current) => new Set(current).add(coverUrl));
                  }}
                />
              ) : (
                <Film size={42} strokeWidth={1.4} aria-hidden="true" />
              )}
              <span className="format-badge">{video.extension.slice(1).toUpperCase()}</span>
              <span className="duration-badge">
                {video.metadataStatus === "pending"
                  ? "待分析"
                  : video.metadataStatus === "failed"
                    ? "元数据失败"
                    : video.thumbnailStatus === "failed"
                      ? "预览失败"
                      : formatDuration(video.durationMs)}
              </span>
              <span className="cover-play" aria-hidden="true">
                <Play size={22} fill="currentColor" />
              </span>
            </div>
            <div className="video-card-body">
              <div className="video-card-title-row">
                <h3 title={video.filename}>{video.filename}</h3>
                <button className="more-button" aria-label={`查看 ${video.filename} 详情`} title="查看详情" onClick={() => onViewDetails(video)}>
                  <Info size={17} />
                </button>
              </div>
              <p>
                {video.width && video.height ? `${video.width}x${video.height}` : "分辨率未知"}
                <i />
                <span>{formatBytes(video.sizeBytes)}</span>
              </p>
              <div className="card-actions" onDoubleClick={(event) => event.stopPropagation()}>
                <VideoItemActions video={video} onToggleFavorite={onToggleFavorite} onTogglePendingDelete={onTogglePendingDelete} onRename={onRename} onDelete={onDelete}
                  onRegenerateCover={onRegenerateCover ? () => retryPreview(video, requestedCoverUrl) : undefined} regenerating={resettingIds.has(video.id)}
                  onRetryMetadata={onRetryMetadata} onRevealInFolder={onRevealInFolder} onShowDirectory={onShowDirectory} />
              </div>
              {resettingIds.has(video.id) && <p role="status">预览排队或生成中…</p>}
              {((requestedCoverUrl && failedCoverUrls.has(requestedCoverUrl)) || resetFailedIds.has(video.id)) && <p role="status">预览加载失败，可点击重新生成重试</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function getAspectRatioValue(width: number | null, height: number | null): string {
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }

  return "16 / 9";
}
