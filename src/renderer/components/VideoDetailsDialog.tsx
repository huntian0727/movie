import { CircleGauge, Copy, Info, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { VideoRecord } from "../../shared/videoTypes";
import { formatBytes, formatDateTime, formatDuration } from "./formatters";

interface VideoDetailsDialogProps {
  video: VideoRecord;
  onClose(): void;
  onOpenDiagnostic?(video: VideoRecord): void;
}

export function VideoDetailsDialog({ video, onClose, onOpenDiagnostic }: VideoDetailsDialogProps) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyPath = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(video.path);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div
      className="details-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-details-title"
      >
        <header className="details-dialog-header">
          <div>
            <div className="details-dialog-kicker">
              <Info size={15} />
              <span>视频详情</span>
            </div>
            <h2 id="video-details-title">{video.filename}</h2>
          </div>
          <button
            type="button"
            className="details-dialog-close"
            aria-label="关闭详情"
            title="关闭详情"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="details-dialog-content">
          <DetailSection title="基础信息">
            <DetailItem label="格式" value={formatVideoFormat(video)} />
            <DetailItem label="时长" value={formatMaybeValue(formatDuration(video.durationMs), video.durationMs !== null)} />
            <DetailItem label="分辨率" value={formatResolution(video.width, video.height)} />
            <DetailItem label="文件大小" value={formatBytes(video.sizeBytes)} />
          </DetailSection>

          <DetailSection title="文件信息">
            <DetailItem label="完整路径" value={video.path} wide />
            <DetailItem label="所在目录" value={video.directory} wide />
            <DetailItem label="修改日期" value={formatDateTime(video.modifiedAt)} />
            <DetailItem label="导入日期" value={formatDateTime(video.importedAt)} />
          </DetailSection>

          <DetailSection title="系统状态">
            <DetailItem label="收藏状态" value={video.isFavorite ? "已收藏" : "未收藏"} />
            <DetailItem label="待删除状态" value={video.isPendingDelete ? "已标记待删除" : "未标记"} />
            <DetailItem label="文件状态" value={video.isMissing ? "文件缺失" : "文件正常"} />
            <DetailItem label="元数据状态" value={formatStatus(video.metadataStatus)} />
            <DetailItem label="封面状态" value={formatStatus(video.thumbnailStatus)} />
            <DetailItem label="时间轴预览" value={formatStatus(video.timelinePreviewStatus)} />
          </DetailSection>
        </div>

        <footer className="details-dialog-footer">
          <div className={`details-copy-status ${copyState !== "idle" ? "visible" : ""}`} aria-live="polite">
            {copyState === "success" ? "路径已复制" : copyState === "error" ? "复制失败，请稍后重试" : ""}
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => void copyPath()}>
              <Copy size={15} />
              <span>{copyState === "success" ? "已复制路径" : "复制路径"}</span>
            </button>
            {onOpenDiagnostic && <button type="button" onClick={() => onOpenDiagnostic(video)}>
              <CircleGauge size={15} />
              <span>播放诊断</span>
            </button>}
            <button type="button" className="primary" onClick={onClose}>关闭</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

interface DetailSectionProps {
  title: string;
  children: ReactNode;
}

function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className="details-section">
      <h3>{title}</h3>
      <div className="details-grid">{children}</div>
    </section>
  );
}

interface DetailItemProps {
  label: string;
  value: string;
  wide?: boolean;
}

function DetailItem({ label, value, wide = false }: DetailItemProps) {
  return (
    <article className={`details-item${wide ? " wide" : ""}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </article>
  );
}

function formatVideoFormat(video: VideoRecord): string {
  if (video.format?.trim()) {
    return video.format;
  }
  return video.extension ? video.extension.slice(1).toUpperCase() : "未识别";
}

function formatResolution(width: number | null, height: number | null): string {
  return width && height ? `${width} x ${height}` : "未识别";
}

function formatMaybeValue(value: string, hasValue: boolean): string {
  return hasValue ? value : "未识别";
}

function formatStatus(status: "pending" | "ready" | "failed"): string {
  if (status === "ready") return "已完成";
  if (status === "failed") return "失败";
  return "待生成";
}
