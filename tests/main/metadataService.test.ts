import { describe, expect, it } from "vitest";
import { parseFfprobeOutput, readMetadata } from "../../src/main/media/metadataService";

describe("parseFfprobeOutput", () => {
  it("extracts duration, dimensions, and format", () => {
    const result = parseFfprobeOutput({
      format: {
        duration: "12.345",
        format_name: "mov,mp4,m4a,3gp,3g2,mj2"
      },
      streams: [
        { codec_type: "audio", codec_name: "AAC" },
        { codec_type: "video", codec_name: "H264", profile: "High", pix_fmt: "YUV420P", width: 1920, height: 1080 }
      ]
    });

    expect(result).toEqual({
      durationMs: 12345,
      width: 1920,
      height: 1080,
      format: "mov,mp4,m4a,3gp,3g2,mj2",
      videoCodec: "h264",
      videoProfile: "high",
      pixelFormat: "yuv420p",
      audioCodec: "aac"
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
      format: "mp3",
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null
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
      format: "matroska,webm",
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null
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

  it("passes the cloud profile through to runProbe", async () => {
    const profiles: string[] = [];
    const result = await readMetadata("X:\\cloud\\video.mp4", {
      ffprobePath: "ffprobe",
      probeProfile: "cloud",
      runProbe: async (_ffprobePath, _filePath, profile) => {
        profiles.push(profile);
        return {
          stdout: JSON.stringify({
            format: { duration: "10.0", format_name: "mp4" },
            streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }]
          })
        };
      }
    });
    expect(profiles).toEqual(["cloud"]);
    expect(result.format).toBe("mp4");
  });

  it("falls back to default probe args when cloud probe fails", async () => {
    const profiles: string[] = [];
    const result = await readMetadata("X:\\cloud\\weird.mkv", {
      ffprobePath: "ffprobe",
      probeProfile: "cloud",
      runProbe: async (_ffprobePath, _filePath, profile) => {
        profiles.push(profile);
        if (profile === "cloud") throw new Error("Invalid data found when processing");
        return {
          stdout: JSON.stringify({
            format: { duration: "42.0", format_name: "matroska" },
            streams: [{ codec_type: "video", codec_name: "hevc", width: 3840, height: 2160 }]
          })
        };
      }
    });
    expect(profiles).toEqual(["cloud", "local"]);
    expect(result.durationMs).toBe(42_000);
  });

  it("falls back to default probe args when cloud returns malformed json", async () => {
    const profiles: string[] = [];
    const result = await readMetadata("X:\\cloud\\truncated.mp4", {
      ffprobePath: "ffprobe",
      probeProfile: "cloud",
      runProbe: async (_ffprobePath, _filePath, profile) => {
        profiles.push(profile);
        if (profile === "cloud") return { stdout: "{ truncated" };
        return {
          stdout: JSON.stringify({
            format: { duration: "5.0", format_name: "mp4" },
            streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720 }]
          })
        };
      }
    });
    expect(profiles).toEqual(["cloud", "local"]);
    expect(result.width).toBe(1280);
  });

  it("does not retry on local profile", async () => {
    const profiles: string[] = [];
    await expect(
      readMetadata("C:\\local\\fail.mp4", {
        ffprobePath: "ffprobe",
        probeProfile: "local",
        runProbe: async (_ffprobePath, _filePath, profile) => {
          profiles.push(profile);
          throw new Error("spawn failed");
        }
      })
    ).rejects.toThrow("spawn failed");
    expect(profiles).toEqual(["local"]);
  });
});
