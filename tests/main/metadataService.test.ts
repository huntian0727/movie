import { describe, expect, it } from "vitest";
import { parseFfprobeOutput, readMetadata } from "../../src/main/media/metadataService";

describe("parseFfprobeOutput", () => {
  it("extracts duration, dimensions, and format", () => {
    const result = parseFfprobeOutput({
      format: {
        duration: "12.345",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2"
      },
      streams: [{ codec_type: "audio" }, { codec_type: "video", width: 1920, height: 1080 }]
    });

    expect(result).toEqual({
      durationMs: 12345,
      width: 1920,
      height: 1080,
      format: "mov,mp4,m4a,3gp,3g2,mj2"
    });
  });

  it("returns null dimensions when no video stream is present", () => {
    const result = parseFfprobeOutput({
      format: {
        duration: "12.345",
        format_name: "mp3"
      },
      streams: [{ codec_type: "audio" }]
    });

    expect(result).toEqual({
      durationMs: 12345,
      width: null,
      height: null,
      format: "mp3"
    });
  });

  it("returns null duration when ffprobe duration is invalid", () => {
    const result = parseFfprobeOutput({
      format: {
        duration: "not-a-number",
        format_name: "matroska,webm"
      },
      streams: [{ codec_type: "video", width: 1280, height: 720 }]
    });

    expect(result).toEqual({
      durationMs: null,
      width: 1280,
      height: 720,
      format: "matroska,webm"
    });
  });
});

describe("readMetadata", () => {
  it("throws a clear error when ffprobe path is unavailable", async () => {
    await expect(
      readMetadata("C:\\videos\\missing-path.mp4", {
        ffprobePath: "   "
      })
    ).rejects.toThrow("Unable to read metadata for C:\\videos\\missing-path.mp4: ffprobe path is not configured");
  });

  it("wraps probe execution failures with the target path", async () => {
    await expect(
      readMetadata("C:\\videos\\probe-failure.mp4", {
        ffprobePath: "ffprobe",
        runProbe: async () => {
          throw new Error("spawn failed");
        }
      })
    ).rejects.toThrow("Unable to read metadata for C:\\videos\\probe-failure.mp4: spawn failed");
  });

  it("wraps malformed json failures with the target path", async () => {
    await expect(
      readMetadata("C:\\videos\\bad-json.mp4", {
        ffprobePath: "ffprobe",
        runProbe: async () => ({
          stdout: "{invalid json"
        })
      })
    ).rejects.toThrow("Unable to parse metadata for C:\\videos\\bad-json.mp4");
  });
});
