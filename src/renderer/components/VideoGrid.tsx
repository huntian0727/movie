import { useState } from "react";
import { BookmarkX, Film, FolderOpen, FolderSearch, Heart, Info, Pencil, Play, RotateCw, Trash2 } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDuration } from "./formatters";

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

  return (
    <div
      className="video-grid video-grid--masonry"
      style={cardWidth ? ({ "--video-card-width": `${cardWidth}px` } as React.CSSProperties) : undefined}
    >
      {videos.map((video, index) => {
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
                  onOpen(video);
                }
              }}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  loading="lazy"
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
                  ? "分析中"
                  : video.metadataStatus === "deferred"
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
              <div className="card-actions">
                <button className={video.isFavorite ? "is-favorite" : undefined} aria-label={video.isFavorite ? "取消收藏" : "收藏"} title={video.isFavorite ? "取消收藏" : "收藏"} onClick={() => onToggleFavorite(video)}>
                  <Heart size={17} fill={video.isFavorite ? "currentColor" : "none"} />
                </button>
                {onTogglePendingDelete && (
                  <button className={video.isPendingDelete ? "is-pending-delete" : undefined} aria-label={video.isPendingDelete ? "取消待删除标记" : "标记待删除"} title={video.isPendingDelete ? "取消待删除标记" : "标记待删除"} onClick={() => onTogglePendingDelete(video)}>
                    <BookmarkX size={17} />
                  </button>
                )}
                <button aria-label="重命名" title="重命名" onClick={() => onRename(video)}>
                  <Pencil size={16} />
                </button>
                <button className="danger-action" aria-label="删除" title="永久删除" onClick={() => onDelete(video)}>
                  <Trash2 size={16} />
                </button>
                {onRegenerateCover && (
                  <button aria-label={`重新生成 ${video.filename} 的预览`} title="重新生成预览" onClick={() => void onRegenerateCover(video)}>
                    <RotateCw size={16} />
                  </button>
                )}
                {onRetryMetadata && (video.metadataStatus === "failed" || video.metadataStatus === "deferred") && (
                  <button
                    aria-label={`${video.metadataStatus === "deferred" ? "分析" : "重新分析"} ${video.filename}`}
                    title={video.metadataStatus === "deferred" ? "立即读取视频时长、分辨率和格式" : "重试读取视频时长、分辨率和格式"}
                    onClick={() => void onRetryMetadata(video)}
                  >
                    <Film size={16} />
                  </button>
                )}
                {onRevealInFolder && (
                  <button aria-label={`打开 ${video.filename} 所在文件夹`} title="打开所在文件夹" onClick={() => void onRevealInFolder(video)}>
                    <FolderOpen size={16} />
                  </button>
                )}
                {onShowDirectory && (
                  <button aria-label={`查看 ${video.filename} 同目录视频`} title="只看同目录视频" onClick={() => onShowDirectory(video)}>
                    <FolderSearch size={16} />
                  </button>
                )}
              </div>
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
