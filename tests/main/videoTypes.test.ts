import { describe, expect, it } from "vitest";
import { SORT_FIELDS, VIDEO_EXTENSIONS, isVideoExtension } from "../../src/shared/videoTypes";

describe("video type helpers", () => {
  it("recognizes supported video extensions case-insensitively", () => {
    expect(isVideoExtension("movie.MKV")).toBe(true);
    expect(isVideoExtension("clip.mp4")).toBe(true);
    expect(isVideoExtension("notes.txt")).toBe(false);
  });

  it("includes the required first-version sort fields", () => {
    expect(SORT_FIELDS).toEqual(["filename", "sizeBytes", "durationMs", "modifiedAt"]);
  });

  it("includes common local video formats", () => {
    expect(VIDEO_EXTENSIONS).toEqual(expect.arrayContaining([".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".wmv", ".m4v", ".ts"]));
  });
});
