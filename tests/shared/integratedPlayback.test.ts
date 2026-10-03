import { describe, it, expect } from "vitest";
import { integratedPlaybackRoute } from "../../src/shared/integratedPlayback";
describe("unified playback route", () => {
  it("uses embedded decoding for compatibility without an external launch", () => {
    expect(integratedPlaybackRoute("mpv", "auto", true)).toBe("embedded");
    expect(integratedPlaybackRoute("mpv", "native-first", true)).toBe("embedded");
    expect(integratedPlaybackRoute("native", "auto", true)).toBe("native");
  });
  it("respects explicit external preference and the trusted window boundary", () => {
    expect(integratedPlaybackRoute("mpv", "mpv-first", true)).toBe("mpv");
    expect(integratedPlaybackRoute("mpv", "auto", false)).toBe("mpv");
  });
});
