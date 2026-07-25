import type { PlaybackPreference, PlaybackRoute } from "./videoTypes.js";

const NATIVE_EXTENSIONS = new Set([".mp4", ".m4v", ".webm", ".mov"]);

export function choosePlaybackRoute(extension: string, preference: PlaybackPreference): PlaybackRoute {
  if (preference === "mpv-first") return "mpv";
  return NATIVE_EXTENSIONS.has(extension.toLowerCase()) ? "native" : "mpv";
}
