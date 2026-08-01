// @vitest-environment node

import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  DirectorySnapshot,
  ScanFailure,
  SourceFolder,
  VideoRecord
} from "../../src/shared/videoTypes";
import type {
  RecordScanFailureInput,
  UpsertDirectorySnapshotInput,
  VideoRepository
} from "../../src/main/db/videoRepository";
import { normalizeManagedPath, isManagedPathWithin } from "../../src/main/files/pathNormalization";
import { retryScanFailures, scanSourceFolder, type ScannerDependencies } from "../../src/main/media/libraryScanner";

const ROOT = "Z:\\Cloud";
const FOLDER: SourceFolder = {
  id: "folder-1",
  path: ROOT,
  recursive: true,
  enabled: true,
  lastScannedAt: null,
  createdAt: "",
  updatedAt: "",
  scanError: null
};

describe("directory snapshot incremental scanning", () => {
  it("does not stat unchanged video files on a second scan", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [dir("Series"), file("root.mp4")]);
    fs.addDirectory(`${ROOT}\\Series`, [file("episode.mp4")]);
    const repo = new MemoryScanRepository();

    const first = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(first.counters).toMatchObject({ changedDirectories: 2, addedVideos: 2 });
    expect(fs.fileStatCalls).toBe(2);

    fs.resetCounters();
    const second = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(second.counters).toMatchObject({ skippedDirectories: 2, skippedVideos: 2 });
    expect(fs.fileStatCalls).toBe(0);
    expect(fs.directoryStatCalls).toBe(2);
  });

  it("still descends into children when the parent snapshot is unchanged", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [dir("Series")]);
    fs.addDirectory(`${ROOT}\\Series`, [file("episode-1.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.addDirectory(`${ROOT}\\Series`, [file("episode-1.mp4"), file("episode-2.mp4")]);
    fs.resetCounters();
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.counters).toMatchObject({ skippedDirectories: 1, changedDirectories: 1, addedVideos: 1 });
    expect(repo.videos.has(normalizeManagedPath(`${ROOT}\\Series\\episode-2.mp4`))).toBe(true);
    expect(fs.fileStatCalls).toBe(2);
  });

  it("uses an order-independent direct-entry digest", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("b.mp4"), file("a.mp4"), dir("Child")]);
    fs.addDirectory(`${ROOT}\\Child`, []);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.reverseEntries = true;
    fs.resetCounters();
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(result.counters).toMatchObject({ changedDirectories: 0, skippedDirectories: 2 });
    expect(fs.fileStatCalls).toBe(0);
  });

  it("detects renamed and deleted direct videos without touching unrelated directories", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("keep.mp4"), file("old-name.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.addDirectory(ROOT, [file("keep.mp4"), file("new-name.mp4")]);
    fs.resetCounters();
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.counters).toMatchObject({ changedDirectories: 1, addedVideos: 1, missingVideos: 1 });
    expect(repo.videos.get(normalizeManagedPath(`${ROOT}\\old-name.mp4`))?.isMissing).toBe(true);
    expect(repo.videos.get(normalizeManagedPath(`${ROOT}\\new-name.mp4`))?.isMissing).toBe(false);
    expect(repo.listFailures()).toEqual([]);
  });

  it("resolves every historical failure for a file confirmed deleted by a complete parent scan", async () => {
    const fs = new FakeFileSystem();
    const filePath = `${ROOT}\\A.mp4`;
    fs.addDirectory(ROOT, [file("A.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "old-file",
      objectType: "file",
      objectPath: filePath,
      failureStage: "file-processing",
      errorSummary: "old file error"
    });
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "old-metadata",
      objectType: "file",
      objectPath: filePath,
      failureStage: "metadata",
      errorSummary: "old metadata error"
    });

    fs.addDirectory(ROOT, []);
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result).toMatchObject({ state: "completed", failureCount: 0, message: null });
    expect(repo.videos.get(normalizeManagedPath(filePath))?.isMissing).toBe(true);
    expect(repo.listFailures()).toEqual([]);
    expect(repo.snapshots.get(snapshotKey(FOLDER.id, ROOT))?.hasUnresolvedFailure).toBe(false);
    expect(repo.value.updateSourceFolderScanState).toHaveBeenLastCalledWith(FOLDER.id, expect.any(String), null);
  });

  it("marks a removed child subtree missing only after its parent was read completely", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [dir("Removed")]);
    fs.addDirectory(`${ROOT}\\Removed`, [file("archived.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "removed-subtree",
      objectType: "file",
      objectPath: `${ROOT}\\Removed\\archived.mp4`,
      failureStage: "metadata",
      errorSummary: "old subtree error"
    });

    fs.addDirectory(ROOT, []);
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.counters?.missingVideos).toBe(1);
    expect(repo.videos.get(normalizeManagedPath(`${ROOT}\\Removed\\archived.mp4`))?.isMissing).toBe(true);
    expect(repo.snapshots.has(snapshotKey(FOLDER.id, `${ROOT}\\Removed`))).toBe(false);
    expect(repo.listFailures()).toEqual([]);
  });

  it("treats a child directory that disappears after parent enumeration as a normal deletion", async () => {
    const fs = new FakeFileSystem();
    const childPath = `${ROOT}\\Vanished`;
    fs.addDirectory(ROOT, [dir("Vanished")]);
    fs.addDirectory(childPath, [file("archived.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.removeDirectory(childPath);
    fs.setDirectoryReadSequence(ROOT, [[dir("Vanished")], []]);
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result).toMatchObject({ state: "completed", failureCount: 0, message: null });
    expect(repo.videos.get(normalizeManagedPath(`${childPath}\\archived.mp4`))?.isMissing).toBe(true);
    expect(repo.snapshots.has(snapshotKey(FOLDER.id, childPath))).toBe(false);
    expect(repo.listFailures()).toEqual([]);
  });

  it("resolves deleted directory failures and reuses one readable-parent check for siblings", async () => {
    const fs = new FakeFileSystem();
    const firstPath = `${ROOT}\\First`;
    const secondPath = `${ROOT}\\Second`;
    fs.addDirectory(ROOT, [dir("First"), dir("Second")]);
    fs.addDirectory(firstPath, [file("first.mp4")]);
    fs.addDirectory(secondPath, [file("second.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    fs.removeDirectory(firstPath);
    fs.removeDirectory(secondPath);
    fs.addDirectory(ROOT, []);
    for (const directoryPath of [firstPath, secondPath]) {
      repo.value.recordScanFailure({
        sourceFolderId: FOLDER.id,
        scanTaskId: "old-directory",
        objectType: "directory",
        objectPath: directoryPath,
        failureStage: "directory-enumeration",
        errorCode: "ENOENT",
        errorSummary: "directory not found"
      });
    }
    fs.resetCounters();

    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());

    expect(result).toMatchObject({ state: "completed", failureCount: 0, message: null });
    expect(repo.listFailures()).toEqual([]);
    expect(repo.videos.get(normalizeManagedPath(`${firstPath}\\first.mp4`))?.isMissing).toBe(true);
    expect(repo.videos.get(normalizeManagedPath(`${secondPath}\\second.mp4`))?.isMissing).toBe(true);
    expect(fs.readDirectories.filter((directoryPath) => directoryPath === normalizeManagedPath(ROOT))).toHaveLength(1);
  });

  it("keeps a deleted directory failure when its parent cannot be read", async () => {
    const fs = new FakeFileSystem();
    const childPath = `${ROOT}\\Unconfirmed`;
    fs.addDirectory(ROOT, [dir("Unconfirmed")]);
    fs.addDirectory(childPath, [file("keep.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    fs.removeDirectory(childPath);
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "old-directory",
      objectType: "directory",
      objectPath: childPath,
      failureStage: "directory-enumeration",
      errorCode: "ENOENT",
      errorSummary: "directory not found"
    });
    fs.failDirectories.add(normalizeManagedPath(ROOT));

    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());

    expect(result.state).toBe("completed-with-errors");
    expect(repo.videos.get(normalizeManagedPath(`${childPath}\\keep.mp4`))?.isMissing).toBe(false);
    expect(repo.listFailures()).toEqual([
      expect.objectContaining({ objectPath: childPath, objectType: "directory", retryCount: 1 })
    ]);
  });

  it("treats a renamed child directory as one removed subtree plus one new subtree", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [dir("Old")]);
    fs.addDirectory(`${ROOT}\\Old`, [file("old.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.addDirectory(ROOT, [dir("New")]);
    fs.addDirectory(`${ROOT}\\New`, [file("new.mp4")]);
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.counters).toMatchObject({ addedVideos: 1, missingVideos: 1 });
    expect(repo.videos.get(normalizeManagedPath(`${ROOT}\\Old\\old.mp4`))?.isMissing).toBe(true);
    expect(repo.videos.get(normalizeManagedPath(`${ROOT}\\New\\new.mp4`))?.isMissing).toBe(false);
  });

  it("does not skip a snapshot flagged incomplete or unresolved", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("retry.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    const key = snapshotKey(FOLDER.id, ROOT);
    repo.snapshots.set(key, { ...repo.snapshots.get(key)!, isComplete: false, hasUnresolvedFailure: true });

    fs.resetCounters();
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.counters).toMatchObject({ changedDirectories: 1, skippedDirectories: 0 });
    expect(fs.fileStatCalls).toBe(1);
  });

  it("persists a failed subtree and retries only unresolved objects", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [dir("Healthy"), dir("Unavailable")]);
    fs.addDirectory(`${ROOT}\\Healthy`, [file("ok.mp4")]);
    fs.addDirectory(`${ROOT}\\Unavailable`, [file("retry.mp4")]);
    fs.failDirectories.add(normalizeManagedPath(`${ROOT}\\Unavailable`));
    const repo = new MemoryScanRepository();

    const initial = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(initial.state).toBe("completed-with-errors");
    expect(repo.listFailures()).toEqual([
      expect.objectContaining({ objectType: "directory", status: "unresolved" })
    ]);

    fs.failDirectories.clear();
    fs.resetCounters();
    const retry = await retryScanFailures(repo.value, FOLDER, fs.dependencies());
    expect(retry.state).toBe("completed");
    expect(repo.listFailures()).toEqual([]);
    expect(fs.readDirectories).toEqual([normalizeManagedPath(`${ROOT}\\Unavailable`)]);
    expect(repo.videos.has(normalizeManagedPath(`${ROOT}\\Unavailable\\retry.mp4`))).toBe(true);
  });

  it("returns safely when there are no unresolved failures", async () => {
    const repo = new MemoryScanRepository();
    const fs = new FakeFileSystem();
    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());
    expect(result).toMatchObject({ state: "completed", totalFiles: 0, processedFiles: 0, failureCount: 0 });
    expect(fs.readDirectories).toEqual([]);
  });

  it("retries failed files without enumerating the other 9,999 successful entries", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("ok.mp4"), file("failed.mp4")]);
    fs.failFiles.add(normalizeManagedPath(`${ROOT}\\failed.mp4`));
    const repo = new MemoryScanRepository();
    const initial = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(initial.state).toBe("completed-with-errors");
    expect(repo.listFailures()).toEqual([expect.objectContaining({ objectType: "file", failureStage: "file-processing" })]);

    fs.failFiles.clear();
    fs.resetCounters();
    const retried = await retryScanFailures(repo.value, FOLDER, fs.dependencies());
    expect(retried.state).toBe("completed");
    expect(retried.counters).toMatchObject({ retriedFailures: 1, resolvedFailures: 1 });
    expect(fs.readDirectories).toEqual([]);
    expect(fs.fileStatCalls).toBe(1);
  });

  it("keeps only the failures that still fail during a partial retry", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("first.mp4"), file("second.mp4")]);
    fs.failFiles.add(normalizeManagedPath(`${ROOT}\\first.mp4`));
    fs.failFiles.add(normalizeManagedPath(`${ROOT}\\second.mp4`));
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.failFiles.delete(normalizeManagedPath(`${ROOT}\\first.mp4`));
    const retried = await retryScanFailures(repo.value, FOLDER, fs.dependencies());

    expect(retried.state).toBe("completed-with-errors");
    expect(repo.listFailures()).toEqual([
      expect.objectContaining({ objectPath: `${ROOT}\\second.mp4`, retryCount: 1, status: "unresolved" })
    ]);
  });

  it("resolves a retried file failure when the file is absent from a readable parent", async () => {
    const fs = new FakeFileSystem();
    const filePath = `${ROOT}\\A.mp4`;
    fs.addDirectory(ROOT, [file("A.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "failed-file",
      objectType: "file",
      objectPath: filePath,
      failureStage: "file-processing",
      errorSummary: "file failed"
    });
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "failed-metadata",
      objectType: "file",
      objectPath: filePath,
      failureStage: "metadata",
      errorSummary: "metadata failed"
    });
    fs.addDirectory(ROOT, []);
    fs.missingFiles.add(normalizeManagedPath(filePath));
    fs.resetCounters();

    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());

    expect(result).toMatchObject({ state: "completed", failureCount: 0, message: null });
    expect(result.counters).toMatchObject({ retriedFailures: 1, resolvedFailures: 2, missingVideos: 1 });
    expect(repo.videos.get(normalizeManagedPath(filePath))?.isMissing).toBe(true);
    expect(repo.listFailures()).toEqual([]);
    expect(fs.fileStatCalls).toBe(1);
  });

  it("keeps a file failure when its parent cannot confirm that the file was deleted", async () => {
    const fs = new FakeFileSystem();
    const filePath = `${ROOT}\\A.mp4`;
    fs.addDirectory(ROOT, [file("A.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "failed-file",
      objectType: "file",
      objectPath: filePath,
      failureStage: "file-processing",
      errorSummary: "file failed"
    });
    fs.missingFiles.add(normalizeManagedPath(filePath));
    fs.failDirectories.add(normalizeManagedPath(ROOT));

    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());

    expect(result.state).toBe("completed-with-errors");
    expect(repo.videos.get(normalizeManagedPath(filePath))?.isMissing).toBe(false);
    expect(repo.listFailures()).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: "file", objectPath: filePath, status: "unresolved", retryCount: 1 }),
      expect.objectContaining({ objectType: "directory", objectPath: ROOT, status: "unresolved" })
    ]));
  });

  it("clears a deleted file failure while retaining another file's real access failure", async () => {
    const fs = new FakeFileSystem();
    const deletedPath = `${ROOT}\\A.mp4`;
    const unreadablePath = `${ROOT}\\B.mp4`;
    fs.addDirectory(ROOT, [file("A.mp4"), file("B.mp4")]);
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    repo.value.recordScanFailure({
      sourceFolderId: FOLDER.id,
      scanTaskId: "old-a",
      objectType: "file",
      objectPath: deletedPath,
      failureStage: "metadata",
      errorSummary: "old A error"
    });
    fs.addDirectory(ROOT, [file("B.mp4")]);
    fs.failFiles.add(normalizeManagedPath(unreadablePath));

    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    expect(result.state).toBe("completed-with-errors");
    expect(repo.videos.get(normalizeManagedPath(deletedPath))?.isMissing).toBe(true);
    expect(repo.listFailures()).toEqual([
      expect.objectContaining({ objectPath: unreadablePath, failureStage: "file-processing" })
    ]);
    expect(repo.snapshots.get(snapshotKey(FOLDER.id, ROOT))?.hasUnresolvedFailure).toBe(true);
  });

  it("keeps unprocessed failures after cooperative cancellation", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, [file("first.mp4"), file("second.mp4")]);
    fs.failFiles.add(normalizeManagedPath(`${ROOT}\\first.mp4`));
    fs.failFiles.add(normalizeManagedPath(`${ROOT}\\second.mp4`));
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    fs.failFiles.clear();
    const retryDependencies = fs.dependencies();
    const originalStat = retryDependencies.statImpl!;
    let completedStats = 0;
    retryDependencies.statImpl = vi.fn(async (targetPath: string) => {
      const result = await originalStat(targetPath);
      completedStats += 1;
      return result;
    });
    retryDependencies.isCancelled = () => completedStats >= 1;

    await expect(retryScanFailures(repo.value, FOLDER, retryDependencies)).rejects.toMatchObject({ name: "ScanCancelledError" });
    expect(repo.listFailures()).toEqual([
      expect.objectContaining({ objectPath: `${ROOT}\\second.mp4`, status: "retrying" })
    ]);
  });

  it("avoids per-file stats for a synthetic 10,000-video unchanged tree", async () => {
    const fs = new FakeFileSystem();
    const childEntries = Array.from({ length: 100 }, (_, index) => dir(`D${index}`));
    fs.addDirectory(ROOT, childEntries);
    for (let directoryIndex = 0; directoryIndex < 100; directoryIndex += 1) {
      fs.addDirectory(
        `${ROOT}\\D${directoryIndex}`,
        Array.from({ length: 100 }, (_, fileIndex) => file(`V${fileIndex}.mp4`))
      );
    }
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());

    fs.resetCounters();
    repo.resetOperationCounters();
    const startedAt = performance.now();
    const result = await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    const metrics = {
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      directoryReads: fs.readDirectories.length,
      directoryStatReads: fs.directoryStatCalls,
      videoStatReads: fs.fileStatCalls,
      databaseReads: repo.dbReads,
      databaseWrites: repo.dbWrites,
      skippedDirectories: result.counters?.skippedDirectories,
      skippedVideos: result.counters?.skippedVideos
    };
    console.info("scan-unchanged-performance-metrics", JSON.stringify(metrics));
    expect(result.totalFiles).toBe(10_000);
    expect(result.counters).toMatchObject({ skippedDirectories: 101, skippedVideos: 10_000 });
    expect(fs.fileStatCalls).toBe(0);
    expect(fs.directoryStatCalls).toBe(101);
    expect(metrics.databaseWrites).toBe(0);
  }, 15_000);

  it("retries 100 failures without scanning 9,900 successful videos", async () => {
    const fs = new FakeFileSystem();
    fs.addDirectory(ROOT, Array.from({ length: 100 }, (_, index) => dir(`D${index}`)));
    for (let directoryIndex = 0; directoryIndex < 100; directoryIndex += 1) {
      const directoryPath = `${ROOT}\\D${directoryIndex}`;
      fs.addDirectory(directoryPath, Array.from({ length: 100 }, (_, fileIndex) => file(`V${fileIndex}.mp4`)));
      fs.failFiles.add(normalizeManagedPath(`${directoryPath}\\V0.mp4`));
    }
    const repo = new MemoryScanRepository();
    await scanSourceFolder(repo.value, FOLDER, fs.dependencies());
    expect(repo.videos.size).toBe(9_900);
    expect(repo.listFailures()).toHaveLength(100);

    fs.failFiles.clear();
    fs.resetCounters();
    repo.resetOperationCounters();
    const startedAt = performance.now();
    const result = await retryScanFailures(repo.value, FOLDER, fs.dependencies());
    const metrics = {
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      directoryReads: fs.readDirectories.length,
      videoStatReads: fs.fileStatCalls,
      databaseReads: repo.dbReads,
      databaseWrites: repo.dbWrites,
      skippedDirectories: result.counters?.skippedDirectories,
      skippedVideos: result.counters?.skippedVideos,
      retriedFailures: result.counters?.retriedFailures,
      remainingFailures: repo.listFailures().length
    };
    console.info("scan-performance-metrics", JSON.stringify(metrics));

    expect(metrics).toMatchObject({
      directoryReads: 0,
      videoStatReads: 100,
      retriedFailures: 100,
      remainingFailures: 0
    });
    expect(repo.videos.size).toBe(10_000);
  }, 15_000);
});

class FakeFileSystem {
  private readonly entries = new Map<string, Dirent[]>();
  private readonly directoryReadSequences = new Map<string, Dirent[][]>();
  readonly failDirectories = new Set<string>();
  readonly failFiles = new Set<string>();
  readonly missingFiles = new Set<string>();
  readDirectories: string[] = [];
  fileStatCalls = 0;
  directoryStatCalls = 0;
  reverseEntries = false;

  addDirectory(directoryPath: string, entries: Dirent[]): void {
    this.entries.set(normalizeManagedPath(directoryPath), entries);
  }

  removeDirectory(directoryPath: string): void {
    this.entries.delete(normalizeManagedPath(directoryPath));
  }

  setDirectoryReadSequence(directoryPath: string, sequence: Dirent[][]): void {
    this.directoryReadSequences.set(normalizeManagedPath(directoryPath), sequence.map((entries) => [...entries]));
  }

  resetCounters(): void {
    this.readDirectories = [];
    this.fileStatCalls = 0;
    this.directoryStatCalls = 0;
  }

  dependencies(): ScannerDependencies {
    return {
      discovery: {
        readdirImpl: vi.fn(async (directoryPath: string) => {
          const key = normalizeManagedPath(directoryPath);
          this.readDirectories.push(key);
          if (this.failDirectories.has(key)) throw Object.assign(new Error("network unavailable"), { code: "ETIMEDOUT" });
          const sequence = this.directoryReadSequences.get(key);
          const entries = sequence && sequence.length > 0
            ? sequence.length > 1 ? sequence.shift()! : sequence[0]
            : this.entries.get(key);
          if (!entries) throw Object.assign(new Error("directory not found"), { code: "ENOENT" });
          return this.reverseEntries ? [...entries].reverse() : [...entries];
        })
      },
      statImpl: vi.fn(async (targetPath: string) => {
        const key = normalizeManagedPath(targetPath);
        const isDirectory = this.entries.has(key);
        if (isDirectory) this.directoryStatCalls += 1;
        else this.fileStatCalls += 1;
        if (!isDirectory && this.missingFiles.has(key)) throw Object.assign(new Error("file not found"), { code: "ENOENT" });
        if (!isDirectory && this.failFiles.has(key)) throw Object.assign(new Error("file unavailable"), { code: "ETIMEDOUT" });
        return {
          size: isDirectory ? 0 : 1_024,
          mtime: new Date("2026-08-01T00:00:00.000Z")
        } as Stats;
      }),
      onMetadataPending: vi.fn()
    };
  }
}

class MemoryScanRepository {
  readonly snapshots = new Map<string, DirectorySnapshot>();
  readonly videos = new Map<string, VideoRecord>();
  private failures: ScanFailure[] = [];
  private nextId = 1;
  dbReads = 0;
  dbWrites = 0;

  readonly value = {
    getDirectorySnapshot: (sourceFolderId: string, directoryPath: string) => {
      this.dbReads += 1;
      return this.snapshots.get(snapshotKey(sourceFolderId, directoryPath)) ?? null;
    },
    upsertDirectorySnapshot: (input: UpsertDirectorySnapshotInput) => this.upsertSnapshot(input),
    markDirectorySnapshotIncomplete: (sourceFolderId: string, directoryPath: string) => {
      const current = this.snapshots.get(snapshotKey(sourceFolderId, directoryPath));
      this.dbWrites += 1;
      if (current) this.snapshots.set(snapshotKey(sourceFolderId, directoryPath), {
        ...current,
        isComplete: false,
        hasUnresolvedFailure: true
      });
    },
    listDirectChildSnapshots: (sourceFolderId: string, parentPath: string) => {
      this.dbReads += 1;
      return [...this.snapshots.values()].filter(
        (snapshot) => snapshot.sourceFolderId === sourceFolderId && snapshot.normalizedParentPath === normalizeManagedPath(parentPath)
      );
    },
    deleteDirectorySnapshotSubtree: (sourceFolderId: string, directoryPath: string) => {
      for (const [key, snapshot] of this.snapshots) {
        if (snapshot.sourceFolderId === sourceFolderId && isManagedPathWithin(snapshot.directoryPath, directoryPath)) this.snapshots.delete(key);
      }
    },
    getVideoByPath: (filePath: string) => {
      this.dbReads += 1;
      return this.videos.get(normalizeManagedPath(filePath)) ?? null;
    },
    upsertVideo: (input: Record<string, unknown>) => this.upsertVideo(input),
    markMissing: (videoId: string, missing = true) => {
      for (const [key, video] of this.videos) if (video.id === videoId) this.videos.set(key, { ...video, isMissing: missing });
    },
    markMetadataPending: vi.fn(() => true),
    reconcileDirectoryMissing: (sourceFolderId: string, directoryPath: string, currentPaths: string[]) => {
      const current = new Set(currentPaths.map(normalizeManagedPath));
      let changed = 0;
      for (const [key, video] of this.videos) {
        if (video.sourceFolderId !== sourceFolderId || normalizeManagedPath(video.directory) !== normalizeManagedPath(directoryPath)) continue;
        const isMissing = !current.has(key);
        if (video.isMissing !== isMissing) {
          this.videos.set(key, { ...video, isMissing });
          changed += 1;
        }
        if (isMissing) {
          this.resolveMatching((failure) =>
            failure.sourceFolderId === sourceFolderId && failure.normalizedPath === normalizeManagedPath(video.path)
          );
        }
      }
      return changed;
    },
    markDirectorySubtreeMissing: (sourceFolderId: string, directoryPath: string) => {
      let changed = 0;
      for (const [key, video] of this.videos) {
        if (video.sourceFolderId === sourceFolderId && !video.isMissing && isManagedPathWithin(video.directory, directoryPath)) {
          this.videos.set(key, { ...video, isMissing: true });
          changed += 1;
        }
      }
      return changed;
    },
    recordScanFailure: (input: RecordScanFailureInput) => this.recordFailure(input),
    listScanFailures: (sourceFolderId: string) => {
      this.dbReads += 1;
      return this.failures.filter(
        (failure) => failure.sourceFolderId === sourceFolderId && failure.status !== "resolved"
      );
    },
    markScanFailureRetrying: (id: string) => this.updateFailure(id, { status: "retrying" }),
    resolveScanFailure: (id: string) => {
      const failure = this.failures.find((candidate) => candidate.id === id && candidate.status !== "resolved");
      if (!failure) return 0;
      this.updateFailure(id, { status: "resolved", resolvedAt: new Date().toISOString() });
      return 1;
    },
    resolveScanFailuresForObject: (sourceFolderId: string, objectPath: string, objectType?: string) =>
      this.resolveMatching((failure) => failure.sourceFolderId === sourceFolderId && failure.normalizedPath === normalizeManagedPath(objectPath) && (!objectType || failure.objectType === objectType)),
    resolveScanFailuresForObjectStage: (sourceFolderId: string, objectPath: string, objectType: string, stage: string) =>
      this.resolveMatching((failure) => failure.sourceFolderId === sourceFolderId && failure.normalizedPath === normalizeManagedPath(objectPath) && failure.objectType === objectType && failure.failureStage === stage),
    resolveScanFailuresInSubtree: (sourceFolderId: string, directoryPath: string) =>
      this.resolveMatching((failure) => failure.sourceFolderId === sourceFolderId && isManagedPathWithin(failure.objectPath, directoryPath)),
    updateSourceFolderScanState: vi.fn()
  } as unknown as VideoRepository;

  listFailures(): ScanFailure[] {
    this.dbReads += 1;
    return this.failures.filter((failure) => failure.status !== "resolved");
  }

  resetOperationCounters(): void {
    this.dbReads = 0;
    this.dbWrites = 0;
  }

  private upsertSnapshot(input: UpsertDirectorySnapshotInput): void {
    this.dbWrites += 1;
    const now = new Date().toISOString();
    const previous = this.snapshots.get(snapshotKey(input.sourceFolderId, input.directoryPath));
    this.snapshots.set(snapshotKey(input.sourceFolderId, input.directoryPath), {
      sourceFolderId: input.sourceFolderId,
      directoryPath: input.directoryPath,
      normalizedPath: normalizeManagedPath(input.directoryPath),
      parentDirectoryPath: input.parentDirectoryPath,
      normalizedParentPath: input.parentDirectoryPath ? normalizeManagedPath(input.parentDirectoryPath) : null,
      directoryMtime: input.directoryMtime,
      directVideoCount: input.directVideoCount,
      directChildCount: input.directChildCount,
      directEntryDigest: input.directEntryDigest,
      lastSuccessfulScanAt: input.successful ? now : previous?.lastSuccessfulScanAt ?? null,
      isComplete: input.isComplete,
      hasUnresolvedFailure: input.hasUnresolvedFailure,
      updatedAt: now
    });
  }

  private upsertVideo(input: Record<string, unknown>): VideoRecord {
    this.dbWrites += 1;
    const filePath = String(input.path);
    const key = normalizeManagedPath(filePath);
    const old = this.videos.get(key);
    const now = new Date().toISOString();
    const video: VideoRecord = {
      id: old?.id ?? `video-${this.nextId++}`,
      sourceFolderId: String(input.sourceFolderId),
      path: filePath,
      directory: String(input.directory),
      filename: String(input.filename),
      basename: String(input.basename),
      extension: String(input.extension),
      sizeBytes: Number(input.sizeBytes),
      durationMs: input.durationMs as number | null,
      width: input.width as number | null,
      height: input.height as number | null,
      format: input.format as string | null,
      modifiedAt: String(input.modifiedAt),
      importedAt: old?.importedAt ?? now,
      updatedAt: now,
      isFavorite: old?.isFavorite ?? false,
      isPendingDelete: false,
      isMissing: false,
      metadataStatus: (input.metadataStatus as VideoRecord["metadataStatus"]) ?? "ready",
      thumbnailStatus: "pending",
      timelinePreviewStatus: "pending",
      coverCachePath: null,
      contentFingerprint: null,
      fingerprintStatus: "pending",
      fingerprintUpdatedAt: null,
      fingerprintError: null
    };
    this.videos.set(key, video);
    return video;
  }

  private recordFailure(input: RecordScanFailureInput): ScanFailure {
    this.dbWrites += 1;
    const normalizedPath = normalizeManagedPath(input.objectPath);
    const existing = this.failures.find((failure) =>
      failure.sourceFolderId === input.sourceFolderId && failure.normalizedPath === normalizedPath &&
      failure.failureStage === input.failureStage && failure.status !== "resolved"
    );
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, {
        status: "unresolved",
        lastFailedAt: now,
        retryCount: existing.retryCount + (input.incrementRetry ? 1 : 0),
        errorSummary: input.errorSummary
      });
      return existing;
    }
    const failure: ScanFailure = {
      id: `failure-${this.nextId++}`,
      sourceFolderId: input.sourceFolderId,
      scanTaskId: input.scanTaskId,
      objectType: input.objectType,
      objectPath: input.objectPath,
      normalizedPath,
      failureStage: input.failureStage,
      errorCode: input.errorCode ?? null,
      errorSummary: input.errorSummary,
      firstFailedAt: now,
      lastFailedAt: now,
      retryCount: input.incrementRetry ? 1 : 0,
      status: "unresolved",
      resolvedAt: null
    };
    this.failures.push(failure);
    return failure;
  }

  private updateFailure(id: string, update: Partial<ScanFailure>): void {
    this.dbWrites += 1;
    const failure = this.failures.find((candidate) => candidate.id === id);
    if (failure) Object.assign(failure, update);
  }

  private resolveMatching(predicate: (failure: ScanFailure) => boolean): number {
    let count = 0;
    for (const failure of this.failures) {
      if (failure.status !== "resolved" && predicate(failure)) {
        failure.status = "resolved";
        failure.resolvedAt = new Date().toISOString();
        this.dbWrites += 1;
        count += 1;
      }
    }
    return count;
  }
}

function snapshotKey(sourceFolderId: string, directoryPath: string): string {
  return `${sourceFolderId}:${normalizeManagedPath(directoryPath)}`;
}

function file(name: string): Dirent {
  return { name, isFile: () => true, isDirectory: () => false } as Dirent;
}

function dir(name: string): Dirent {
  return { name, isFile: () => false, isDirectory: () => true } as Dirent;
}
