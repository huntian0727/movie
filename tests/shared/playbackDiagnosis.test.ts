import { describe, expect, it } from "vitest";
import { explainPlaybackRoute } from "../../src/shared/playbackDiagnosis";
import { choosePlaybackRoute } from "../../src/shared/playbackRouting";
import type { PlaybackPreference, VideoRecord } from "../../src/shared/videoTypes";

const baseVideo: VideoRecord = {
  id: "video-1",
  sourceFolderId: "folder-1",
  path: "D:\\Movies\\clip.mp4",
  directory: "D:\\Movies",
  filename: "clip.mp4",
  basename: "clip",
  extension: ".mp4",
  sizeBytes: 1024,
  durationMs: 90_000,
  width: 1920,
  height: 1080,
  format: "mp4",
  videoCodec: "h264",
  videoProfile: "high",
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  codecProbeStatus: "ready",
  modifiedAt: "2026-09-04T00:00:00.000Z",
  importedAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  isFavorite: false,
  isPendingDelete: false,
  isMissing: false,
  metadataStatus: "ready",
  thumbnailStatus: "pending",
  timelinePreviewStatus: "pending",
  coverCachePath: null,
  contentFingerprint: null,
  fingerprintStatus: "pending",
  fingerprintUpdatedAt: null,
  fingerprintError: null
};

function diagnose(overrides: Partial<VideoRecord>, preference: PlaybackPreference = "auto") {
  const video = { ...baseVideo, ...overrides };
  const route = choosePlaybackRoute(video, preference);
  return explainPlaybackRoute(video, preference, route);
}

describe("explainPlaybackRoute", () => {
  it("explains automatic native routing for MP4 H264 AAC", () => {
    const result = diagnose({});
    expect(result.route).toBe("native");
    expect(result.confidence).toBe("high");
    expect(result.reason).toContain("符合内置播放器规则");
  });

  it("explains automatic MPV routing for HEVC DTS", () => {
    const result = diagnose({ videoCodec: "hevc", audioCodec: "dts" });
    expect(result.route).toBe("mpv");
    expect(result.risk).toBe("high");
    expect(result.reason).toContain("编码组合");
  });

  it("keeps native-first HEVC DTS on the route selected by the real router", () => {
    const result = diagnose({ videoCodec: "hevc", audioCodec: "dts" }, "native-first");
    expect(result.route).toBe("native");
    expect(result.routeLabel).toBe("内置播放器");
    expect(result.reason).not.toContain("选择 MPV");
  });

  it("uses user preference as the primary MPV-first explanation", () => {
    const result = diagnose({ metadataStatus: "pending", codecProbeStatus: "unprobed" }, "mpv-first");
    expect(result.route).toBe("mpv");
    expect(result.risk).toBe("unknown");
    expect(result.reason).toMatch(/^播放偏好设置为 MPV 优先/);
  });

  it("does not claim a known native-first risk before codec probing completes", () => {
    const result = diagnose({ metadataStatus: "pending", codecProbeStatus: "unprobed" }, "native-first");
    expect(result.route).toBe("native");
    expect(result.risk).toBe("unknown");
  });

  it("marks pending container routing as low confidence", () => {
    const result = diagnose({
      metadataStatus: "pending",
      codecProbeStatus: "unprobed",
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null
    });
    expect(result.route).toBe("native");
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("依据文件容器");
  });

  it.each([
    ["failed", { metadataStatus: "failed" as const, codecProbeStatus: "failed" as const }],
    ["unprobed", { metadataStatus: "ready" as const, codecProbeStatus: "unprobed" as const }]
  ])("marks %s metadata as low confidence", (_label, overrides) => {
    const result = diagnose(overrides);
    expect(result.confidence).toBe("low");
    expect(result.risk).toBe("unknown");
  });

  it("explains a compatible WebM route", () => {
    const result = diagnose({ extension: ".webm", format: "webm", videoCodec: "vp9", videoProfile: null, pixelFormat: "yuv420p", audioCodec: "opus" });
    expect(result.route).toBe("native");
    expect(result.risk).toBe("low");
  });

  it("does not interpret a null audio field as proof of no audio", () => {
    const result = diagnose({ audioCodec: null });
    expect(result.reason).not.toContain("无音频");
    expect(result.disclaimer).toContain("不代表实际播放结果");
  });
});
