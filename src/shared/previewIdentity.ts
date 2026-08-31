import type { VideoRecord } from "./videoTypes.js";

/** Only media changes invalidate covers; UI/database activity is not a file version. */
export function getCoverUrl(video: VideoRecord, frameTimeSeconds: number): string {
  const timeSeconds = getCoverTimeSeconds(frameTimeSeconds, video.durationMs);
  const version = JSON.stringify([video.sizeBytes, video.modifiedAt, timeSeconds]);
  return `local-video://cover/${encodeURIComponent(video.id)}?v=${encodeURIComponent(version)}`;
}

/** Use the midpoint when the preferred frame lies past the end of a short clip. */
export function getCoverTimeSeconds(preferredTimeSeconds: number, durationMs: number | null): number {
  const preferred = Math.max(0, Math.trunc(preferredTimeSeconds));
  if (preferred === 0 || !durationMs || durationMs <= 0 || durationMs > preferred * 1000) return preferred;
  return Number((durationMs / 2000).toFixed(3));
}
