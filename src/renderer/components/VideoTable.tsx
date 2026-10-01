import { Fragment, useState } from "react";
import { Info, Play } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDate, formatDuration } from "./formatters";
import { VideoStoryboard } from "./VideoStoryboard";
import { useProgressiveRenderCount } from "./useProgressiveRenderCount";
import { VideoItemActions, type VideoItemActionsProps } from "./VideoItemActions";

type VideoTableProps = Omit<VideoItemActionsProps, "video" | "regenerating"> & {
  videos: VideoRecord[];
  onOpen(video: VideoRecord): void;
  onOpenAt?(video: VideoRecord, timeMs: number): void;
  onViewDetails(video: VideoRecord): void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?(video: VideoRecord): void;
};

export function VideoTable({ videos, onOpen, onOpenAt, onViewDetails, onToggleFavorite, onTogglePendingDelete, onRename, onDelete, onRegenerateCover, onRetryMetadata, onRevealInFolder, onShowDirectory, selectionMode = false, selectedIds, onToggleSelection }: VideoTableProps) {
  const [previewStates, setPreviewStates] = useState<Record<string, "resetting" | "reset" | "failed">>({});
  const visibleCount = useProgressiveRenderCount(videos.map((video) => video.id).join("|"), videos.length, 12, 12);
  const regeneratePreview = async (video: VideoRecord) => {
    if (!onRegenerateCover || previewStates[video.id] === "resetting") return;
    setPreviewStates((current) => ({ ...current, [video.id]: "resetting" }));
    try {
      await onRegenerateCover(video);
      setPreviewStates((current) => ({ ...current, [video.id]: "reset" }));
    } catch {
      setPreviewStates((current) => ({ ...current, [video.id]: "failed" }));
    }
  };
  return (
    <div className="table-scroll">
      <table className="video-table">
        <thead><tr>{selectionMode && <th aria-label="选择" />}<th>文件名</th><th>大小</th><th>时长</th><th>分辨率</th><th>修改日期</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {videos.slice(0, visibleCount).map((video) => (
            <Fragment key={video.id}><tr className="video-table-info-row" onDoubleClick={() => !selectionMode && onOpen(video)}>
              {selectionMode && <td><input type="checkbox" aria-label={`选择 ${video.filename}`} checked={selectedIds?.has(video.id) ?? false} onChange={() => onToggleSelection?.(video)} /></td>}
              <td><div className="table-title"><span className="table-file-icon"><Play size={14} fill="currentColor" /></span><div><strong>{video.filename}</strong><small>{video.extension.slice(1).toUpperCase()}</small></div></div></td>
              <td>{formatBytes(video.sizeBytes)}</td>
              <td>{video.metadataStatus === "pending" ? "待分析" : video.metadataStatus === "failed" ? "元数据失败" : formatDuration(video.durationMs)}</td>
              <td>{video.width && video.height ? `${video.width}×${video.height}` : "-"}</td>
              <td>{formatDate(video.modifiedAt)}</td>
              <td><div className="row-actions" onDoubleClick={(event) => event.stopPropagation()}>
                <button aria-label={`查看 ${video.filename} 详情`} title="查看详情" onClick={() => onViewDetails(video)}><Info size={15} /></button>
                <VideoItemActions video={video} onToggleFavorite={onToggleFavorite} onTogglePendingDelete={onTogglePendingDelete} onRename={onRename} onDelete={onDelete}
                  onRegenerateCover={onRegenerateCover ? regeneratePreview : undefined} regenerating={previewStates[video.id] === "resetting"}
                  onRetryMetadata={onRetryMetadata} onRevealInFolder={onRevealInFolder} onShowDirectory={onShowDirectory} />
              </div></td>
            </tr><tr className="video-table-storyboard-row"><td colSpan={selectionMode ? 8 : 7}>
              {previewStates[video.id] && <p className="video-preview-action-status" role="status">{previewStates[video.id] === "resetting" ? "正在重置封面预览…" : previewStates[video.id] === "failed" ? "预览重置失败，可点击重新生成重试" : "封面缓存已重置，网格视图将重新加载；下方截图条独立加载。"}</p>}
              <VideoStoryboard video={video} onPlay={(timeMs) => onOpenAt ? onOpenAt(video, timeMs) : onOpen(video)} />
            </td></tr></Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
