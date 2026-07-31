import { BookmarkX, Heart, Info, Pencil, Play, Trash2 } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDate, formatDuration } from "./formatters";

type VideoTableProps = {
  videos: VideoRecord[];
  onOpen(video: VideoRecord): void;
  onViewDetails(video: VideoRecord): void;
  onToggleFavorite(video: VideoRecord): void;
  onTogglePendingDelete?(video: VideoRecord): void;
  onRename(video: VideoRecord): void;
  onDelete(video: VideoRecord): void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?(video: VideoRecord): void;
};

export function VideoTable({ videos, onOpen, onViewDetails, onToggleFavorite, onTogglePendingDelete, onRename, onDelete, selectionMode = false, selectedIds, onToggleSelection }: VideoTableProps) {
  return (
    <div className="table-scroll">
      <table className="video-table">
        <thead><tr>{selectionMode && <th aria-label="选择" />}<th>文件名</th><th>大小</th><th>时长</th><th>分辨率</th><th>修改日期</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.id} onDoubleClick={() => !selectionMode && onOpen(video)}>
              {selectionMode && <td><input type="checkbox" aria-label={`选择 ${video.filename}`} checked={selectedIds?.has(video.id) ?? false} onChange={() => onToggleSelection?.(video)} /></td>}
              <td><div className="table-title"><span className="table-file-icon"><Play size={14} fill="currentColor" /></span><div><strong>{video.filename}</strong><small>{video.extension.slice(1).toUpperCase()}</small></div></div></td>
              <td>{formatBytes(video.sizeBytes)}</td>
              <td>{video.metadataStatus === "pending" ? "分析中" : video.metadataStatus === "failed" ? "元数据失败" : formatDuration(video.durationMs)}</td>
              <td>{video.width && video.height ? `${video.width}×${video.height}` : "-"}</td>
              <td>{formatDate(video.modifiedAt)}</td>
              <td><div className="row-actions">
                <button aria-label={`查看 ${video.filename} 详情`} title="查看详情" onClick={() => onViewDetails(video)}><Info size={15} /></button>
                <button className={video.isFavorite ? "is-favorite" : undefined} aria-label={video.isFavorite ? "取消收藏" : "收藏"} onClick={() => onToggleFavorite(video)}><Heart size={16} fill={video.isFavorite ? "currentColor" : "none"} /></button>
                {onTogglePendingDelete && <button className={video.isPendingDelete ? "is-pending-delete" : undefined} aria-label={video.isPendingDelete ? "取消待删除标记" : "标记待删除"} onClick={() => onTogglePendingDelete(video)}><BookmarkX size={16} /></button>}
                <button aria-label="重命名" onClick={() => onRename(video)}><Pencil size={15} /></button>
                <button className="danger-action" aria-label="删除" onClick={() => onDelete(video)}><Trash2 size={15} /></button>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
