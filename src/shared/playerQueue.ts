import { MAX_PLAYER_QUEUE_ITEMS, type VideoRecord } from "./videoTypes.js";

/** The browsable directory is unbounded; only its active playback window is bounded. */
export function playerQueueWindow(videos: VideoRecord[], selectedId: string): VideoRecord[] {
  const unique = [...new Map(videos.map(video => [video.id, video])).values()];
  const selected = unique.findIndex(video => video.id === selectedId);
  if (selected < 0) throw new Error("Selected video is not available in this playlist");
  const start = Math.max(0, Math.min(selected - Math.floor(MAX_PLAYER_QUEUE_ITEMS / 2), unique.length - MAX_PLAYER_QUEUE_ITEMS));
  return unique.slice(start, start + MAX_PLAYER_QUEUE_ITEMS);
}
