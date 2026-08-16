import type { PlaybackPreference, PlaybackRoute, VideoRecord } from "./videoTypes.js";

type PlaybackIdentity = Pick<VideoRecord,
  "extension" | "videoCodec" | "videoProfile" | "pixelFormat" | "audioCodec" | "metadataStatus" | "codecProbeStatus"
>;

const CONTAINER_NATIVE_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm"]);
const H264_NATIVE_PROFILES = new Set(["baseline", "constrained baseline", "main", "high"]);
const MP4_NATIVE_AUDIO = new Set(["aac", "mp3"]);
const WEBM_NATIVE_VIDEO = new Set(["vp8", "vp9"]);
const WEBM_NATIVE_AUDIO = new Set(["opus", "vorbis"]);

export function choosePlaybackRoute(video: PlaybackIdentity, preference: PlaybackPreference): PlaybackRoute {
  if (preference === "mpv-first") return "mpv";

  const extension = normalize(video.extension);
  if (preference === "native-first") {
    return CONTAINER_NATIVE_EXTENSIONS.has(extension) ? "native" : "mpv";
  }

  if (video.metadataStatus === "pending") {
    return CONTAINER_NATIVE_EXTENSIONS.has(extension) ? "native" : "mpv";
  }
  if (video.metadataStatus !== "ready" || video.codecProbeStatus !== "ready") return "mpv";

  const videoCodec = normalizeNullable(video.videoCodec);
  const audioCodec = normalizeNullable(video.audioCodec);
  if (extension === ".webm") {
    const pixelFormat = normalizeNullable(video.pixelFormat);
    return videoCodec && WEBM_NATIVE_VIDEO.has(videoCodec) && pixelFormat === "yuv420p" && isNullOrAllowed(audioCodec, WEBM_NATIVE_AUDIO)
      ? "native"
      : "mpv";
  }
  if (extension === ".mp4" || extension === ".m4v" || extension === ".mov") {
    const profile = normalizeNullable(video.videoProfile);
    const pixelFormat = normalizeNullable(video.pixelFormat);
    return videoCodec === "h264"
      && profile !== null
      && H264_NATIVE_PROFILES.has(profile)
      && pixelFormat === "yuv420p"
      && isNullOrAllowed(audioCodec, MP4_NATIVE_AUDIO)
      ? "native"
      : "mpv";
  }
  return "mpv";
}

function normalize(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function normalizeNullable(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function isNullOrAllowed(value: string | null, allowed: Set<string>): boolean {
  return value === null || allowed.has(value);
}
