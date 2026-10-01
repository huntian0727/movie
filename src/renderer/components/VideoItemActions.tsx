import { BookmarkX, Film, FolderOpen, FolderSearch, Heart, Pencil, RotateCw, Trash2 } from "lucide-react";
import type { VideoRecord } from "../../shared/videoTypes";

export type VideoItemActionsProps = {
  video: VideoRecord;
  onToggleFavorite(video: VideoRecord): void;
  onTogglePendingDelete?(video: VideoRecord): void;
  onRename(video: VideoRecord): void;
  onDelete(video: VideoRecord): void;
  onRegenerateCover?(video: VideoRecord): void | Promise<void>;
  onRetryMetadata?(video: VideoRecord): void | Promise<void>;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onShowDirectory?(video: VideoRecord): void;
  regenerating?: boolean;
};

/** The grid and list share the same actions, order, icons and accessible labels. */
export function VideoItemActions({ video, onToggleFavorite, onTogglePendingDelete, onRename, onDelete, onRegenerateCover, onRetryMetadata, onRevealInFolder, onShowDirectory, regenerating = false }: VideoItemActionsProps) {
  return <>
    <button type="button" className={video.isFavorite ? "is-favorite" : undefined} aria-label={video.isFavorite ? "取消收藏" : "收藏"} title={video.isFavorite ? "取消收藏" : "收藏"} onClick={() => onToggleFavorite(video)}>
      <Heart size={17} fill={video.isFavorite ? "currentColor" : "none"} />
    </button>
    {onTogglePendingDelete && <button type="button" className={video.isPendingDelete ? "is-pending-delete" : undefined} aria-label={video.isPendingDelete ? "取消待删除标记" : "标记待删除"} title={video.isPendingDelete ? "取消待删除标记" : "标记待删除"} onClick={() => onTogglePendingDelete(video)}>
      <BookmarkX size={17} />
    </button>}
    <button type="button" aria-label="重命名" title="重命名" onClick={() => onRename(video)}><Pencil size={16} /></button>
    <button type="button" className="danger-action" aria-label="删除" title="永久删除" onClick={() => onDelete(video)}><Trash2 size={16} /></button>
    {onRegenerateCover && <button type="button" aria-label={`重新生成 ${video.filename} 的预览`} title="重新生成预览" disabled={regenerating} onClick={() => void onRegenerateCover(video)}><RotateCw size={16} /></button>}
    {onRetryMetadata && video.metadataStatus === "failed" && <button type="button" aria-label={`重新分析 ${video.filename}`} title="重试读取视频时长、分辨率和格式" onClick={() => void onRetryMetadata(video)}><Film size={16} /></button>}
    {onRevealInFolder && <button type="button" aria-label={`打开 ${video.filename} 所在文件夹`} title="打开所在文件夹" onClick={() => void onRevealInFolder(video)}><FolderOpen size={16} /></button>}
    {onShowDirectory && <button type="button" aria-label={`查看 ${video.filename} 同目录视频`} title="只看同目录视频" onClick={() => onShowDirectory(video)}><FolderSearch size={16} /></button>}
  </>;
}
