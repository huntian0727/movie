import { describe, expect, it } from "vitest";
import { buildMpvArgs } from "../../src/main/media/mpvController.js";

describe("buildMpvArgs", () => {
  it("builds mpv args for an external playback window", () => {
    expect(buildMpvArgs("D:\\Movies\\clip.mkv")).toEqual([
      "--force-window=yes",
      "--keep-open=no",
      "D:\\Movies\\clip.mkv"
    ]);
  });
});
