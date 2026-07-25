import { describe, expect, it } from "vitest";
import { getMediaContentType, parseRangeHeader } from "../../src/main/media/mediaProtocol";
import { getTimelinePreviewFromUrl, getVideoIdFromCoverUrl, getVideoIdFromMediaUrl } from "../../src/main/media/mediaUrl";

describe("getVideoIdFromMediaUrl", () => {
  it("extracts and decodes a video id", () => {
    expect(getVideoIdFromMediaUrl("local-video://media/video%201")).toBe("video 1");
  });

  it("rejects other hosts and missing ids", () => {
    expect(() => getVideoIdFromMediaUrl("local-video://other/video-1")).toThrow("Invalid media URL");
    expect(() => getVideoIdFromMediaUrl("local-video://media/")).toThrow("Invalid media URL");
  });
});

describe("getTimelinePreviewFromUrl", () => {
  it("extracts a video id and timeline position", () => {
    expect(getTimelinePreviewFromUrl("local-video://preview/video%201/12000")).toEqual({
      videoId: "video 1",
      timeMs: 12000
    });
  });

  it("rejects invalid preview URLs", () => {
    expect(() => getTimelinePreviewFromUrl("local-video://media/video-1/12000")).toThrow("Invalid timeline preview URL");
    expect(() => getTimelinePreviewFromUrl("local-video://preview/video-1/nope")).toThrow("Invalid timeline preview URL");
    expect(() => getTimelinePreviewFromUrl("local-video://preview/video-1/-1")).toThrow("Invalid timeline preview URL");
  });
});

describe("getVideoIdFromCoverUrl", () => {
  it("extracts and decodes a cover video id", () => {
    expect(getVideoIdFromCoverUrl("local-video://cover/video%201")).toBe("video 1");
  });

  it("rejects invalid cover URLs", () => {
    expect(() => getVideoIdFromCoverUrl("local-video://media/video-1")).toThrow("Invalid cover URL");
    expect(() => getVideoIdFromCoverUrl("local-video://cover/")).toThrow("Invalid cover URL");
  });
});

describe("parseRangeHeader", () => {
  it("parses bounded and open-ended byte ranges", () => {
    expect(parseRangeHeader("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRangeHeader("bytes=10-", 100)).toEqual({ start: 10, end: 99 });
  });

  it("supports suffix ranges and clamps oversized requests", () => {
    expect(parseRangeHeader("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
    expect(parseRangeHeader("bytes=90-120", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects malformed or impossible ranges", () => {
    expect(parseRangeHeader(null, 100)).toBeNull();
    expect(parseRangeHeader("items=1-2", 100)).toBe("invalid");
    expect(parseRangeHeader("bytes=120-130", 100)).toBe("invalid");
    expect(parseRangeHeader("bytes=20-10", 100)).toBe("invalid");
  });
});

describe("getMediaContentType", () => {
  it("returns stable content types for known video formats", () => {
    expect(getMediaContentType("D:\\Movies\\clip.mp4")).toBe("video/mp4");
    expect(getMediaContentType("D:\\Movies\\clip.mkv")).toBe("video/x-matroska");
    expect(getMediaContentType("D:\\Movies\\clip.webm")).toBe("video/webm");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(getMediaContentType("D:\\Movies\\clip.bin")).toBe("application/octet-stream");
  });
});
