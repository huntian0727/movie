// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { deleteScanFailureFile } from "../../src/main/files/scanFailureActions";
import { retryScanFailure } from "../../src/main/media/libraryScanner";

let tempDir: string;
let db: DatabaseConnection | undefined;

beforeEach(() => { tempDir = mkdtempSync(path.join(tmpdir(), "scan-failure-review-")); });
afterEach(() => { db?.close(); db = undefined; rmSync(tempDir, { recursive: true, force: true }); });

function setup() {
  db = createDatabase(path.join(tempDir, "library.sqlite"));
  const repo = new VideoRepository(db);
  const sourcePath = path.join(tempDir, "media");
  mkdirSync(sourcePath);
  const source = repo.addSourceFolder(sourcePath, true);
  return { repo, source, sourcePath };
}

function record(repo: VideoRepository, sourceFolderId: string, objectPath: string, objectType: "file" | "directory" = "file") {
  return repo.recordScanFailure({
    sourceFolderId,
    scanTaskId: "review-test",
    objectType,
    objectPath,
    failureStage: objectType === "directory" ? "directory-enumeration" : "file-processing",
    errorCode: "EIO",
    errorSummary: "network read failed"
  });
}

describe("scan failure review", () => {
  it("classifies, filters and paginates unresolved failures while exposing a global count", () => {
    const { repo, source, sourcePath } = setup();
    const videoPath = path.join(sourcePath, "indexed.mp4");
    repo.upsertVideo({ sourceFolderId: source.id, path: videoPath, directory: sourcePath, filename: "indexed.mp4", basename: "indexed", extension: ".mp4", sizeBytes: 10, durationMs: 1000, width: 10, height: 10, format: "mp4", modifiedAt: new Date().toISOString() });
    record(repo, source.id, videoPath);
    record(repo, source.id, path.join(sourcePath, "folder"), "directory");
    for (let index = 0; index < 31; index += 1) record(repo, source.id, path.join(sourcePath, `unknown-${index}.mp4`));

    const first = repo.listScanFailureReviewPage({ kind: "all", page: 1, pageSize: 30 });
    const second = repo.listScanFailureReviewPage({ sourceFolderId: source.id, kind: "unindexed-file", page: 2, pageSize: 30 });
    const videos = repo.listScanFailureReviewPage({ kind: "video", page: 1, pageSize: 30 });

    expect(first).toMatchObject({ page: 1, totalPages: 2, totalCount: 33, counts: { all: 33, video: 1, unindexedFile: 31, directory: 1 } });
    expect(first.items).toHaveLength(30);
    expect(second).toMatchObject({ page: 2, totalPages: 2, totalCount: 31 });
    expect(second.items).toHaveLength(1);
    expect(videos.items[0]).toMatchObject({ kind: "video", video: { filename: "indexed.mp4" } });
    expect(repo.getLibraryNavigation().scanFailureCount).toBe(33);
    repo.resolveScanFailure(videos.items[0].failure.id);
    expect(repo.listScanFailureReviewPage({ kind: "video", page: 1, pageSize: 30 }).totalCount).toBe(0);
  });

  it("permanently deletes only file failures inside their source and resolves the record", async () => {
    const { repo, source, sourcePath } = setup();
    const filePath = path.join(sourcePath, "broken.mp4");
    const failure = record(repo, source.id, filePath);
    const deleteImpl = vi.fn().mockResolvedValue(undefined);

    await expect(deleteScanFailureFile(repo, failure.id, {
      statImpl: async () => ({ isFile: () => true }) as Stats,
      deleteImpl
    })).resolves.toEqual({ deleted: true, videoId: null });
    expect(deleteImpl).toHaveBeenCalledWith(filePath);
    expect(repo.getScanFailure(failure.id)?.status).toBe("resolved");

    const directoryFailure = record(repo, source.id, path.join(sourcePath, "folder"), "directory");
    await expect(deleteScanFailureFile(repo, directoryFailure.id)).rejects.toThrow("Directories cannot be deleted");
    const outsideFailure = record(repo, source.id, path.join(tempDir, "outside.mp4"));
    await expect(deleteScanFailureFile(repo, outsideFailure.id)).rejects.toThrow("outside its source folder");
  });

  it("treats an already missing file as resolved without invoking deletion", async () => {
    const { repo, source, sourcePath } = setup();
    const failure = record(repo, source.id, path.join(sourcePath, "gone.mp4"));
    const deleteImpl = vi.fn();
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(deleteScanFailureFile(repo, failure.id, { statImpl: async () => { throw missing; }, deleteImpl })).resolves.toEqual({ deleted: false, videoId: null });
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(repo.getScanFailure(failure.id)?.status).toBe("resolved");
  });

  it("retries one file instead of starting a source-wide retry", async () => {
    const { repo, source, sourcePath } = setup();
    const targetPath = path.join(sourcePath, "retry.mp4");
    const untouchedPath = path.join(sourcePath, "untouched.mp4");
    writeFileSync(targetPath, "video");
    const target = record(repo, source.id, targetPath);
    const untouched = record(repo, source.id, untouchedPath);

    await retryScanFailure(repo, source, target.id, {
      readMetadata: async () => ({ durationMs: 2000, width: 1280, height: 720, format: "mp4" })
    });

    expect(repo.getScanFailure(target.id)?.status).toBe("resolved");
    expect(repo.getScanFailure(untouched.id)?.status).toBe("unresolved");
    expect(repo.getVideoByPath(targetPath)?.durationMs).toBe(2000);
  });
});
