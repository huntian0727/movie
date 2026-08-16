import { describe, expect, it } from "vitest";
import { choosePlaybackRoute } from "../../src/main/media/playerRouting";

describe("choosePlaybackRoute", () => {
  const identity = (overrides: Partial<Parameters<typeof choosePlaybackRoute>[0]> = {}) => ({
    extension: ".mp4",
    videoCodec: "h264",
    videoProfile: "high",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    metadataStatus: "ready" as const,
    codecProbeStatus: "ready" as const,
    ...overrides
  });

  it("routes conservative native combinations in automatic mode", () => {
    expect(choosePlaybackRoute(identity(), "auto")).toBe("native");
    expect(choosePlaybackRoute(identity({ extension: ".M4V", audioCodec: null }), "auto")).toBe("native");
    expect(choosePlaybackRoute(identity({ extension: ".webm", videoCodec: "VP9", videoProfile: null, pixelFormat: "yuv420p", audioCodec: "OPUS" }), "auto")).toBe("native");
  });

  it.each([
    ["hevc mp4", identity({ videoCodec: "hevc" })],
    ["unknown codec", identity({ videoCodec: null })],
    ["unknown profile", identity({ videoProfile: null })],
    ["complex pixel format", identity({ pixelFormat: "yuv420p10le" })],
    ["10-bit VP9 WebM", identity({ extension: ".webm", videoCodec: "vp9", videoProfile: null, pixelFormat: "yuv420p10le", audioCodec: "opus" })],
    ["unsupported audio", identity({ audioCodec: "ac3" })],
    ["mkv", identity({ extension: ".mkv" })],
    ["avi", identity({ extension: ".avi" })]
  ])("uses mpv for %s in automatic mode", (_label, video) => {
    expect(choosePlaybackRoute(video, "auto")).toBe("mpv");
  });

  it("keeps explicit preferences distinct from automatic mode", () => {
    expect(choosePlaybackRoute(identity({ videoCodec: "hevc" }), "native-first")).toBe("native");
    expect(choosePlaybackRoute(identity({ extension: ".mkv" }), "native-first")).toBe("mpv");
    expect(choosePlaybackRoute(identity(), "mpv-first")).toBe("mpv");
  });

  it("uses native-first temporarily for pending native containers but stays conservative after probe failure", () => {
    expect(choosePlaybackRoute(identity({
      metadataStatus: "pending",
      codecProbeStatus: "unprobed",
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null
    }), "auto")).toBe("native");
    expect(choosePlaybackRoute(identity({
      metadataStatus: "ready",
      codecProbeStatus: "failed",
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null
    }), "auto")).toBe("mpv");
  });
});
