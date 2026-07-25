import { describe, expect, it } from "vitest";
import { choosePlaybackRoute } from "../../src/main/media/playerRouting";

describe("choosePlaybackRoute", () => {
  it("uses native playback for browser-friendly formats in automatic mode", () => {
    expect(choosePlaybackRoute(".mp4", "auto")).toBe("native");
    expect(choosePlaybackRoute(".webm", "auto")).toBe("native");
  });

  it("uses mpv for formats that Chromium cannot reliably play", () => {
    expect(choosePlaybackRoute(".mkv", "auto")).toBe("mpv");
    expect(choosePlaybackRoute(".avi", "auto")).toBe("mpv");
  });

  it("honors explicit mpv preference", () => {
    expect(choosePlaybackRoute(".mp4", "mpv-first")).toBe("mpv");
  });
});
