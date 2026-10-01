import { describe, expect, it } from "vitest";
import { buildMpvArgs } from "../../src/main/media/mpvController.js";

describe("buildMpvArgs", () => {
  it("passes the screenshot timestamp as mpv's starting position", () => {
    expect(buildMpvArgs("D:\\Movies\\clip.mkv", 150_500)).toContain("--start=150.5");
    expect(buildMpvArgs("D:\\Movies\\clip.mkv", -1)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--start=/)]));
  });
  it("builds mpv args for an external playback window", () => {
    expect(buildMpvArgs("D:\\Movies\\clip.mkv")).toEqual([
      "--force-window=yes",
      "--keep-open=no",
      "D:\\Movies\\clip.mkv"
    ]);
  });
});
