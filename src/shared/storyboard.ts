import type { VideoRecord } from "./videoTypes.js";

export const LIST_STORYBOARD_FRAME_COUNT = 6;

export function getStoryboardFrameCount(durationMs: number): number {
  if (durationMs <= 60_000) return 6;
  if (durationMs <= 300_000) return 8;
  if (durationMs <= 1_200_000) return 12;
  if (durationMs <= 3_600_000) return 16;
  if (durationMs <= 9_000_000) return 20;
  return 24;
}

/** Sample the middle of each equal segment, keeping seeks away from either end. */
export function getStoryboardTimes(durationMs: number | null, count = LIST_STORYBOARD_FRAME_COUNT): number[] {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isInteger(count) || count <= 0) return [];
  return [...new Set(Array.from({ length: count }, (_, index) => Math.min(Math.max(0, Math.ceil(durationMs) - 1), Math.floor((index + 0.5) * durationMs / count))))];
}

/** Cache writes and unrelated database updates must not flash an already loaded image. */
export function getStoryboardFrameUrl(video: VideoRecord, timeMs: number): string {
  const version = JSON.stringify([video.path, video.sizeBytes, video.modifiedAt]);
  return `local-video://preview/${encodeURIComponent(video.id)}/${timeMs}?v=${encodeURIComponent(version)}`;
}
