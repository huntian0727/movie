import { describe, expect, it } from "vitest";
import { choosePlaybackRoute } from "../../src/main/media/playerRouting";

describe("choosePlaybackRoute", () => {
  const identity = (overrides: Partial<Parameters<typeof choosePlaybackRoute>[0]> = {}) => ({
    extension: ".mp4",
    videoCodec: "h264",
    videoProfile: "high",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    ...overrides
  });

  it("routes conservative native combinations in automatic mode", () => {
    expect(choosePlaybackRoute(identity(), "auto")).toBe("native");
    expect(choosePlaybackRoute(identity({ extension: ".M4V", audioCodec: null }), "auto")).toBe("native");
    expect(choosePlaybackRoute(identity({ extension: ".webm", videoCodec: "VP9", videoProfile: null, pixelFormat: null, audioCodec: "OPUS" }), "auto")).toBe("native");
  });

  it.each([
    ["hevc mp4", identity({ videoCodec: "hevc" })],
    ["unknown codec", identity({ videoCodec: null })],
    ["unknown profile", identity({ videoProfile: null })],
    ["complex pixel format", identity({ pixelFormat: "yuv420p10le" })],
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
});
