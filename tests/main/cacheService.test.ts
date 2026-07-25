import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCacheKey,
  generateCover,
  generateTimelineFrame,
  getCoverPath,
  getCoverTimeSeconds,
  getMediaCacheRoot,
  migrateLegacyMediaCache,
  getTimelineFramePath
} from "../../src/main/media/cacheService";

describe("cacheService", () => {
  it("uses path, size, and modified time to build stable cache keys", () => {
    const a = buildCacheKey("D:\\Movies\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const b = buildCacheKey("D:\\Movies\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const c = buildCacheKey("D:\\Movies\\clip.mp4", 101, "2026-07-09T00:00:00.000Z");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("normalizes Windows path identity before hashing", () => {
    const a = buildCacheKey("C:\\Videos\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const b = buildCacheKey("c:\\videos\\clip.mp4", 100, "2026-07-09T00:00:00.000Z");
    const c = buildCacheKey("C:/Videos/clip.mp4", 100, "2026-07-09T00:00:00.000Z");

    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("returns deterministic cover and timeline paths", () => {
    const key = "abc123";
    expect(getCoverPath("C:\\Cache", key)).toBe("C:\\Cache\\covers\\abc123-5s.jpg");
    expect(getCoverPath("C:\\Cache", key, 10)).toBe("C:\\Cache\\covers\\abc123-10s.jpg");
    expect(getTimelineFramePath("C:\\Cache", key, 12000)).toBe("C:\\Cache\\timeline\\abc123\\12000.jpg");
    expect(getTimelineFramePath("C:\\Cache", key, -1250)).toBe("C:\\Cache\\timeline\\abc123\\0.jpg");
  });

  it("uses the middle frame when a clip is shorter than the requested cover offset", () => {
    expect(getCoverTimeSeconds(5, 2_000)).toBe(1);
    expect(getCoverTimeSeconds(5, 5_000)).toBe(2.5);
    expect(getCoverTimeSeconds(5, 8_000)).toBe(5);
    expect(getCoverTimeSeconds(0, 2_000)).toBe(0);
  });

  it("uses a dedicated persistent media cache directory", () => {
    expect(getMediaCacheRoot("C:\\Users\\test\\AppData\\Roaming\\local-video-manager"))
      .toBe("C:\\Users\\test\\AppData\\Roaming\\local-video-manager\\media-cache");
  });

  it("migrates legacy previews without touching Electron cache data", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "video-manager-cache-"));
    const legacyRoot = path.join(userDataPath, "cache");
    const cacheRoot = getMediaCacheRoot(userDataPath);

    try {
      await mkdir(path.join(legacyRoot, "covers"), { recursive: true });
      await mkdir(path.join(legacyRoot, "timeline", "video-key"), { recursive: true });
      await mkdir(path.join(legacyRoot, "Cache_Data"), { recursive: true });
      await writeFile(path.join(legacyRoot, "covers", "cover.jpg"), "cover");
      await writeFile(path.join(legacyRoot, "timeline", "video-key", "1000.jpg"), "timeline");
      await writeFile(path.join(legacyRoot, "Cache_Data", "index"), "electron");

      await migrateLegacyMediaCache(userDataPath);

      await expect(readFile(path.join(cacheRoot, "covers", "cover.jpg"), "utf8")).resolves.toBe("cover");
      await expect(readFile(path.join(cacheRoot, "timeline", "video-key", "1000.jpg"), "utf8")).resolves.toBe("timeline");
      await expect(readFile(path.join(legacyRoot, "Cache_Data", "index"), "utf8")).resolves.toBe("electron");
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("uses the default ffmpeg-static path when no ffmpeg path is injected", async () => {
    const ensureDir = vi.fn(async () => undefined);
    const runFfmpeg = vi.fn(async (_ffmpegPath: string, _args: string[]) => undefined);

    await generateCover("C:\\videos\\clip.mp4", "C:\\cache\\covers\\clip.jpg", 1, {
      ensureDir,
      runFfmpeg
    });

    expect(ensureDir).toHaveBeenCalledWith("C:\\cache\\covers");
    expect(runFfmpeg).toHaveBeenCalledTimes(1);
    const [resolvedFfmpegPath] = runFfmpeg.mock.calls[0] ?? [];
    expect(resolvedFfmpegPath).toEqual(expect.any(String));
    expect(resolvedFfmpegPath).not.toBe("");
  });

  it("throws a clear error when the ffmpeg path is unavailable", async () => {
    let thrown: unknown;

    try {
      await generateCover("C:\\videos\\clip.mp4", "C:\\cache\\covers\\clip.jpg", 1, {
        ffmpegPath: "   "
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      message: "Unable to generate cover for C:\\videos\\clip.mp4: ffmpeg path is not configured"
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
    expect(((thrown as Error & { cause?: Error }).cause as Error).message).toBe("ffmpeg path is not configured");
  });

  it("clamps negative timeline times to zero before invoking ffmpeg", async () => {
    const ensureDir = vi.fn(async () => undefined);
    const runFfmpeg = vi.fn(async (_ffmpegPath: string, _args: string[]) => undefined);

    await generateTimelineFrame("C:\\videos\\clip.mp4", "C:\\cache\\timeline\\clip\\0.jpg", -1250, {
      ffmpegPath: "ffmpeg",
      ensureDir,
      runFfmpeg
    });

    expect(ensureDir).toHaveBeenCalledWith("C:\\cache\\timeline\\clip");
    expect(runFfmpeg).toHaveBeenCalledWith("ffmpeg", [
      "-y",
      "-ss",
      "0.000",
      "-i",
      "C:\\videos\\clip.mp4",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-vf",
      "scale=320:-1",
      "C:\\cache\\timeline\\clip\\0.jpg"
    ]);
  });

  it("preserves the underlying runner error as the cause", async () => {
    const cause = new Error("spawn failed");

    let thrown: unknown;

    try {
      await generateTimelineFrame("C:\\videos\\clip.mp4", "C:\\cache\\timeline\\clip\\500.jpg", 500, {
        ffmpegPath: "ffmpeg",
        ensureDir: async () => undefined,
        runFfmpeg: async () => {
          throw cause;
        }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      message: "Unable to generate timeline frame for C:\\videos\\clip.mp4: spawn failed"
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBe(cause);
  });
});
