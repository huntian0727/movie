import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/main/db/database.js";
import type { DatabaseConnection } from "../../src/main/db/database.js";
import { VideoRepository } from "../../src/main/db/videoRepository.js";
import { scanSourceFolder } from "../../src/main/media/libraryScanner.js";

let tempDir: string;
let db: DatabaseConnection | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-scan-"));
});

afterEach(() => {
  db?.close();
  db = undefined;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("scanSourceFolder", () => {
  it("continues past metadata failures, imports good files, and records scan errors", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    const badFilePath = path.join(mediaDir, "bad.mp4");
    const goodFilePath = path.join(mediaDir, "good.mp4");
    writeFileSync(badFilePath, "bad");
    writeFileSync(goodFilePath, "good");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async (filePath) => {
        if (filePath === badFilePath) {
          throw new Error("ffprobe failed");
        }

        return { durationMs: 9000, width: 1920, height: 1080, format: "mp4" };
      }
    });

    const [video] = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: false
    });
    const updatedSource = repo.getSourceFolderByPath(mediaDir);

    expect(video.filename).toBe("good.mp4");
    expect(video.sizeBytes).toBe(statSync(goodFilePath).size);
    expect(video.durationMs).toBe(9000);
    expect(updatedSource.lastScannedAt).not.toBeNull();
    expect(updatedSource.scanError).toContain("1 file");
    expect(updatedSource.scanError).toContain("bad.mp4");
    expect(updatedSource.scanError).toContain("ffprobe failed");
  });

  it("clears a previous scan error and updates lastScannedAt after a successful scan", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    writeFileSync(path.join(mediaDir, "clip.mp4"), "fake");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    repo.updateSourceFolderScanState(source.id, "2026-07-09T00:00:00.000Z", "1 file failed: stale.mp4: old error");

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const updatedSource = repo.getSourceFolderByPath(mediaDir);

    expect(updatedSource.scanError).toBeNull();
    expect(updatedSource.lastScannedAt).not.toBeNull();
    expect(updatedSource.lastScannedAt).not.toBe("2026-07-09T00:00:00.000Z");
  });

  it("normalizes uppercase extensions and stores parsed directory and basename", async () => {
    const mediaDir = path.join(tempDir, "media");
    const nestedDir = path.join(mediaDir, "nested");
    mkdirSync(nestedDir, { recursive: true });
    const filePath = path.join(nestedDir, "My.Clip.MP4");
    writeFileSync(filePath, "fake");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const [video] = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: false
    });

    expect(video.extension).toBe(".mp4");
    expect(video.directory).toBe(nestedDir);
    expect(video.basename).toBe("My.Clip");
  });

  it("persists scan state when the source root is missing", async () => {
    const missingDir = path.join(tempDir, "missing-root");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(missingDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const updatedSource = repo.getSourceFolderByPath(missingDir);

    expect(updatedSource.lastScannedAt).not.toBeNull();
    expect(updatedSource.scanError).toContain("missing-root");
    expect(updatedSource.scanError).toMatch(/ENOENT|no such file/i);
  });

  it("marks previously imported videos missing when they disappear from a later scan", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    const keepFilePath = path.join(mediaDir, "keep.mp4");
    const removedFilePath = path.join(mediaDir, "removed.mp4");
    writeFileSync(keepFilePath, "keep");
    writeFileSync(removedFilePath, "removed");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    rmSync(removedFilePath);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const visibleVideos = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: false
    });
    const allVideos = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: true
    });

    expect(visibleVideos.map((video) => video.filename)).toEqual(["keep.mp4"]);
    expect(allVideos.find((video) => video.filename === "removed.mp4")?.isMissing).toBe(true);
  });

  it("preserves existing videos when a source root is temporarily unavailable", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    const filePath = path.join(mediaDir, "clip.mp4");
    writeFileSync(filePath, "fake");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    rmSync(mediaDir, { recursive: true, force: true });

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const [video] = repo.listVideos({
      view: "all",
      search: "",
      sortField: "filename",
      sortDirection: "asc",
      includeMissing: true
    });

    expect(video.isMissing).toBe(false);
    expect(repo.getSourceFolderByPath(mediaDir).scanError).not.toBeNull();
  });

  it("skips metadata reads for unchanged videos on later scans", async () => {
    const mediaDir = path.join(tempDir, "media");
    mkdirSync(mediaDir);
    writeFileSync(path.join(mediaDir, "clip.mp4"), "fake");

    db = createDatabase(path.join(tempDir, "library.sqlite"));
    const repo = new VideoRepository(db);
    const source = repo.addSourceFolder(mediaDir, true);

    await scanSourceFolder(repo, source, {
      readMetadata: async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" })
    });

    const readMetadata = vi.fn(async () => ({ durationMs: 9000, width: 1920, height: 1080, format: "mp4" }));

    await scanSourceFolder(repo, source, { readMetadata });

    expect(readMetadata).not.toHaveBeenCalled();
  });
});
