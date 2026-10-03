import { useEffect, useState } from "react";
import type { PlayerTimelinePreviewContent } from "../../shared/playerTimelinePreview";
import { PreviewImage } from "./PreviewImage";

export function PlayerTimelinePreviewWindow() {
  const [content, setContent] = useState<PlayerTimelinePreviewContent | null>(null);
  useEffect(() => window.videoManager?.subscribePlayerTimelinePreview?.(setContent), []);
  if (!content) return null;
  const seconds = Math.floor(content.timeMs / 1000);
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return <div className="timeline-preview-window">
    <PreviewImage src={content.url} eager priority={2} delayMs={0} style={{ height: content.imageHeight }} />
    <span>{clock}</span>
  </div>;
}
