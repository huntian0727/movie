// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseConnection } from "../../src/main/db/database";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { DuplicateCleanupRepository } from "../../src/main/db/duplicateCleanupRepository";
import { cleanupScanFailures, deleteScanFailureFile } from "../../src/main/files/scanFailureActions";
import { classifyScanFailureForCleanup } from "../../src/shared/scanFailureCleanup";
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

function record(repo: VideoRepository, sourceFolderId: string, objectPath: string, objectType: "file" | "directory" = "file", errorSummary = "network read failed", errorCode = "EIO") {
  return repo.recordScanFailure({
    sourceFolderId,
    scanTaskId: "review-test",
    objectType,
    objectPath,
    failureStage: objectType === "directory" ? "directory-enumeration" : "file-processing",
    errorCode,
    errorSummary
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
    const failure = record(repo, source.id, filePath, "file", "moov atom not found; Invalid data found when processing input");
    const deleteImpl = vi.fn().mockResolvedValue(undefined);

    await expect(deleteScanFailureFile(repo, failure.id, {
      statImpl: async () => ({ isFile: () => true }) as Stats,
      deleteImpl
    })).resolves.toEqual({ deleted: true, videoId: null });
    expect(deleteImpl).toHaveBeenCalledWith(filePath);
    expect(repo.getScanFailure(failure.id)?.status).toBe("resolved");

    const directoryFailure = record(repo, source.id, path.join(sourcePath, "folder"), "directory");
    await expect(deleteScanFailureFile(repo, directoryFailure.id)).rejects.toThrow("Directories cannot be deleted");
    const outsideFailure = record(repo, source.id, path.join(tempDir, "outside.mp4"), "file", "moov atom not found");
    await expect(deleteScanFailureFile(repo, outsideFailure.id)).rejects.toThrow("outside its source folder");
  });

  it("batch retries unresolved failures and reports per-item status", async () => {
    const { repo, source, sourcePath } = setup();
    const targetPath = path.join(sourcePath, "retry.mp4");
    writeFileSync(targetPath, "video");
    const target = record(repo, source.id, targetPath);
    const resolved = record(repo, source.id, path.join(sourcePath, "resolved.mp4"));
    repo.resolveScanFailure(resolved.id);

    const retryFailure = vi.fn().mockResolvedValue(undefined);
    const listSourceFolders = () => [{ id: source.id, path: source.path }];
    const result = await cleanupScanFailures(repo, [target.id, resolved.id], "retry", { retryFailure, listSourceFolders });
    expect(result.successCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.items.find((item) => item.failureId === target.id)?.status).toBe("retried");
    expect(result.items.find((item) => item.failureId === resolved.id)?.status).toBe("skipped");
  });

  it("treats an already missing file as resolved without invoking deletion", async () => {
    const { repo, source, sourcePath } = setup();
    const failure = record(repo, source.id, path.join(sourcePath, "gone.mp4"), "file", "moov atom not found");
    const deleteImpl = vi.fn();
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    await expect(deleteScanFailureFile(repo, failure.id, { statImpl: async () => { throw missing; }, deleteImpl })).resolves.toEqual({ deleted: false, videoId: null });
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(repo.getScanFailure(failure.id)?.status).toBe("resolved");
  });

  it("classifies failures into extended error types", () => {
    const { repo, source, sourcePath } = setup();
    const corrupt = record(repo, source.id, path.join(sourcePath, "corrupt.mp4"), "file", "moov atom not found");
    const offline = record(repo, source.id, path.join(sourcePath, "offline.mp4"), "file", "network read failed: ETIMEDOUT");
    const unknown = record(repo, source.id, path.join(sourcePath, "unknown.mp4"), "file", "Command failed with exit code 1", "EXIT_1");
    const missing = record(repo, source.id, path.join(sourcePath, "gone.mp4"), "file", "ENOENT: no such file or directory");
    const permission = record(repo, source.id, path.join(sourcePath, "denied.mp4"), "file", "EACCES: permission denied");
    const busy = record(repo, source.id, path.join(sourcePath, "locked.mp4"), "file", "EBUSY: resource busy or locked");
    const ioError = record(repo, source.id, path.join(sourcePath, "ioerr.mp4"), "file", "EIO: i/o error");
    expect(classifyScanFailureForCleanup(corrupt).category).toBe("corrupt");
    expect(classifyScanFailureForCleanup(offline).category).toBe("network");
    expect(classifyScanFailureForCleanup(unknown).category).toBe("unknown");
    expect(classifyScanFailureForCleanup(missing).category).toBe("missing");
    expect(classifyScanFailureForCleanup(permission).category).toBe("permission");
    expect(classifyScanFailureForCleanup(busy).category).toBe("busy");
    expect(classifyScanFailureForCleanup(ioError).category).toBe("io-error");
  });

  it("batch marks all file failures regardless of error type", async () => {
    const { repo, source, sourcePath } = setup();
    const corruptPath = path.join(sourcePath, "corrupt.mp4");
    const offlinePath = path.join(sourcePath, "offline.mp4");
    repo.upsertVideo({ sourceFolderId: source.id, path: corruptPath, directory: sourcePath, filename: "corrupt.mp4", basename: "corrupt", extension: ".mp4", sizeBytes: 10, durationMs: null, width: null, height: null, format: null, modifiedAt: new Date(0).toISOString() });
    repo.upsertVideo({ sourceFolderId: source.id, path: offlinePath, directory: sourcePath, filename: "offline.mp4", basename: "offline", extension: ".mp4", sizeBytes: 10, durationMs: null, width: null, height: null, format: null, modifiedAt: new Date(0).toISOString() });
    const corrupt = record(repo, source.id, corruptPath, "file", "Invalid data found when processing input");
    const offline = record(repo, source.id, offlinePath, "file", "network read failed: ETIMEDOUT");

    const result = await cleanupScanFailures(repo, [corrupt.id, offline.id], "mark-pending-delete");
    expect(result).toMatchObject({ successCount: 2, skippedCount: 0, failureCount: 0 });
    expect(repo.getVideoByPath(corruptPath)?.isPendingDelete).toBe(true);
    expect(repo.getVideoByPath(offlinePath)?.isPendingDelete).toBe(true);
  });

  it("refuses permanent deletion when the indexed file version changed", async () => {
    const { repo, source, sourcePath } = setup();
    const filePath = path.join(sourcePath, "changed.mp4");
    const video = repo.upsertVideo({ sourceFolderId: source.id, path: filePath, directory: sourcePath, filename: "changed.mp4", basename: "changed", extension: ".mp4", sizeBytes: 10, durationMs: null, width: null, height: null, format: null, modifiedAt: new Date(0).toISOString() });
    const failure = record(repo, source.id, filePath, "file", "moov atom not found");
    const deleteImpl = vi.fn();

    await expect(deleteScanFailureFile(repo, failure.id, {
      statImpl: async () => ({ isFile: () => true, size: 11, mtime: new Date(1) }) as Stats,
      deleteImpl
    })).rejects.toThrow("文件状态已变化");
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(repo.getVideo(video.id)).toBeTruthy();
    expect(repo.getScanFailure(failure.id)?.status).toBe("unresolved");
  });

  it("does not let scan-failure permanent deletion bypass duplicate SHA-256 authorization", async () => {
    const { repo, source, sourcePath } = setup();
    const candidatePath = path.join(sourcePath, "candidate.mp4");
    const peerPath = path.join(sourcePath, "peer.mp4");
    writeFileSync(candidatePath, Buffer.alloc(64, 1));
    writeFileSync(peerPath, Buffer.alloc(64, 1));
    const candidateStat = statSync(candidatePath);
    const peerStat = statSync(peerPath);
    const candidate = repo.upsertVideo({
      sourceFolderId: source.id, path: candidatePath, directory: sourcePath, filename: "candidate.mp4",
      basename: "candidate", extension: ".mp4", sizeBytes: candidateStat.size, durationMs: 5000,
      width: 1920, height: 1080, format: "mp4", modifiedAt: candidateStat.mtime.toISOString()
    });
    repo.upsertVideo({
      sourceFolderId: source.id, path: peerPath, directory: sourcePath, filename: "peer.mp4",
      basename: "peer", extension: ".mp4", sizeBytes: peerStat.size, durationMs: 5000,
      width: 1920, height: 1080, format: "mp4", modifiedAt: peerStat.mtime.toISOString()
    });
    const failure = record(repo, source.id, candidatePath, "file", "moov atom not found");
    const deleteImpl = vi.fn().mockResolvedValue(undefined);

    await expect(deleteScanFailureFile(repo, failure.id, { deleteImpl })).rejects.toThrow(/full SHA-256 verification/i);
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(repo.getVideo(candidate.id)).toBeTruthy();
  });

  it("applies the duplicate-candidate guard to batch permanent scan-failure cleanup", async () => {
    const { repo, source, sourcePath } = setup();
    const candidatePath = path.join(sourcePath, "batch-candidate.mp4");
    const peerPath = path.join(sourcePath, "batch-peer.mp4");
    writeFileSync(candidatePath, Buffer.alloc(64, 1));
    writeFileSync(peerPath, Buffer.alloc(64, 1));
    for (const [filePath, filename] of [[candidatePath, "batch-candidate.mp4"], [peerPath, "batch-peer.mp4"]]) {
      const fileStat = statSync(filePath);
      repo.upsertVideo({ sourceFolderId: source.id, path: filePath, directory: sourcePath, filename,
        basename: path.parse(filename).name, extension: ".mp4", sizeBytes: fileStat.size, durationMs: 5000,
        width: 1920, height: 1080, format: "mp4", modifiedAt: fileStat.mtime.toISOString() });
    }
    const failure = record(repo, source.id, candidatePath, "file", "moov atom not found");
    const deleteImpl = vi.fn();
    const jobs = new DuplicateCleanupRepository(db!, repo);

    const result = await cleanupScanFailures(repo, [failure.id], "permanent-delete", {
      deleteImpl,
      assertPermanentDeleteAllowed: (videoIds) => jobs.assertGenericPermanentDeleteAllowed(videoIds)
    });

    expect(result).toMatchObject({ successCount: 0, failureCount: 1, skippedCount: 0 });
    expect(result.items[0].message).toMatch(/full SHA-256 verification/i);
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(repo.getVideoByPath(candidatePath)).toBeTruthy();
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
