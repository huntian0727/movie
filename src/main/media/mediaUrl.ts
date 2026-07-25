export const MEDIA_SCHEME = "local-video";

export function getVideoIdFromMediaUrl(url: string): string {
  const parsed = new URL(url);
  const videoId = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== "media" || !videoId || videoId.includes("/")) {
    throw new Error("Invalid media URL");
  }
  return videoId;
}

export function getVideoIdFromCoverUrl(url: string): string {
  const parsed = new URL(url);
  const videoId = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== "cover" || !videoId || videoId.includes("/")) {
    throw new Error("Invalid cover URL");
  }
  return videoId;
}

export interface TimelinePreviewUrlParts {
  videoId: string;
  timeMs: number;
}

export function getTimelinePreviewFromUrl(url: string): TimelinePreviewUrlParts {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [videoId, timeMsText] = parts;
  const timeMs = Number(timeMsText);

  if (
    parsed.protocol !== `${MEDIA_SCHEME}:` ||
    parsed.hostname !== "preview" ||
    parts.length !== 2 ||
    !videoId ||
    !Number.isInteger(timeMs) ||
    timeMs < 0
  ) {
    throw new Error("Invalid timeline preview URL");
  }

  return { videoId, timeMs };
}
