// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoRepository } from "../../src/main/db/videoRepository";
import { scanSourceFolder } from "../../src/main/media/libraryScanner";
import type { SourceFolder } from "../../src/shared/videoTypes";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "video-manager-network-scan-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("scanSourceFolder network-drive safeguards", () => {
  it("indexes a new file as pending and defers FFprobe when a metadata queue is connected", async () => {
    writeFileSync(path.join(tempDir, "new.mp4"), "video");
    const repo = createRepositoryStub();
    repo.upsertVideo.mockReturnValue({ id: "video-1" });
    const readMetadata = vi.fn();
    const onMetadataPending = vi.fn();

    const result = await scanSourceFolder(repo.value, createSourceFolder(tempDir), {
      readMetadata,
      onMetadataPending
    });

    expect(result).toMatchObject({ state: "completed", totalFiles: 1, processedFiles: 1, failureCount: 0 });
    expect(readMetadata).not.toHaveBeenCalled();
    expect(repo.upsertVideo).toHaveBeenCalledWith(expect.objectContaining({
      filename: "new.mp4",
      durationMs: null,
      width: null,
      height: null,
      format: null,
      metadataStatus: "pending"
    }));
    expect(onMetadataPending).toHaveBeenCalledWith("video-1");
  });

  it("imports discovered files but does not reconcile missing records after a child directory failure", async () => {
    const blockedDir = path.join(tempDir, "blocked");
    mkdirSync(blockedDir);
    writeFileSync(path.join(tempDir, "visible.mp4"), "video");
    const repo = createRepositoryStub();
    const source = createSourceFolder(tempDir);

    const result = await scanSourceFolder(repo.value, source, {
      readMetadata: async () => ({ durationMs: 1000, width: 1920, height: 1080, format: "mp4" }),
      discovery: {
        readdirImpl: async (directory) => {
          if (directory === blockedDir) throw new Error("network branch unavailable");
          return readdir(directory, { withFileTypes: true });
        }
      }
    });

    expect(result).toMatchObject({ state: "completed-with-errors", totalFiles: 1, processedFiles: 1, failureCount: 1 });
    expect(repo.upsertVideo).toHaveBeenCalledOnce();
    expect(repo.reconcileSourceFolderMissing).not.toHaveBeenCalled();
    expect(repo.updateSourceFolderScanState).toHaveBeenLastCalledWith(
      source.id,
      expect.any(String),
      expect.stringContaining("network branch unavailable")
    );
  });

  it("treats an unresponsive source root as offline without reconciling existing records", async () => {
    const repo = createRepositoryStub();
    const source = createSourceFolder(tempDir);

    const result = await scanSourceFolder(repo.value, source, {
      discovery: {
        directoryEntryTimeoutMs: 10,
        directoryEntriesImpl: async () => new Promise<never>(() => undefined)
      }
    });

    expect(result).toMatchObject({ state: "offline", totalFiles: 0, processedFiles: 0, failureCount: 1 });
    expect(result.message).toContain("stopped responding");
    expect(repo.reconcileSourceFolderMissing).not.toHaveBeenCalled();
  });

  it("accepts a mapped-drive empty child when its iterator fails but the OS probe confirms it is empty", async () => {
    const emptyDir = path.join(tempDir, "empty-cloud-folder");
    mkdirSync(emptyDir);
    const repo = createRepositoryStub();
    const source = createSourceFolder(tempDir);
    const emptyDirectoryProbeImpl = vi.fn(async (directory: string) => directory === emptyDir);

    const result = await scanSourceFolder(repo.value, source, {
      discovery: {
        directoryEntriesImpl: async (directory) => {
          if (directory !== emptyDir) return readdir(directory, { withFileTypes: true });
          return {
            async *[Symbol.asyncIterator]() {
              const error = new Error("mapped provider cannot enumerate empty directory") as NodeJS.ErrnoException;
              error.code = "EINVAL";
              throw error;
            }
          };
        },
        emptyDirectoryProbeImpl
      }
    });

    expect(result).toMatchObject({ state: "completed", totalFiles: 0, processedFiles: 0, failureCount: 0 });
    expect(repo.updateSourceFolderScanState).toHaveBeenLastCalledWith(source.id, expect.any(String), null);
    expect(emptyDirectoryProbeImpl).toHaveBeenCalledWith(emptyDir);
  });

  it("keeps the failure when the mapped-drive fallback cannot confirm an empty directory", async () => {
    const blockedDir = path.join(tempDir, "blocked-cloud-folder");
    mkdirSync(blockedDir);
    const repo = createRepositoryStub();

    const result = await scanSourceFolder(repo.value, createSourceFolder(tempDir), {
      discovery: {
        directoryEntriesImpl: async (directory) => {
          if (directory !== blockedDir) return readdir(directory, { withFileTypes: true });
          const error = new Error("mapped provider failure") as NodeJS.ErrnoException;
          error.code = "EINVAL";
          throw error;
        },
        emptyDirectoryProbeImpl: async () => false
      }
    });

    expect(result).toMatchObject({ state: "completed-with-errors", failureCount: 1 });
    expect(repo.updateSourceFolderScanState).toHaveBeenLastCalledWith(
      "folder-1",
      expect.any(String),
      expect.stringContaining("mapped provider failure")
    );
  });
  it("measures synthetic CloudDrive lookup windows, bounded write transactions, and path-free phase counters", async () => {
    const repo = createRepositoryStub();
    const getVideosByPaths = vi.fn((_paths: string[]) => new Map());
    const runInTransaction = vi.fn(<T,>(work: () => T): T => work());
    const upsertDirectorySnapshot = vi.fn();
    Object.assign(repo.value, {
      getVideosByPaths,
      runInTransaction,
      getDirectorySnapshot: vi.fn(() => null),
      listDirectChildSnapshots: vi.fn(() => []),
      upsertDirectorySnapshot,
      reconcileDirectoryMissingByFilenames: vi.fn(() => 0),
      setSourceFolderProvider: vi.fn()
    });
    const entries = Array.from({ length: 300 }, (_, index) => ({
      name: `video-${index}.mp4`,
      kind: "file" as const,
      scanIdentity: `video-${index}`,
      fileInfo: {
        sizeBytes: 1024 + index,
        modifiedAt: "2026-10-24T00:00:00.000Z",
        providerFileId: `remote-${index}`,
        providerPath: `/videos/video-${index}.mp4`
      }
    }));
    const source: SourceFolder = { ...createSourceFolder(tempDir), providerType: "clouddrive", providerName: "synthetic" };
    const result = await scanSourceFolder(repo.value, source, {
      onMetadataPending: vi.fn(),
      cloudDirectorySource: async () => ({
        provider: { type: "clouddrive", rootPath: "/synthetic", name: "synthetic", readOnly: true },
        readDirectory: async () => ({ entries, directoryMtime: "2026-10-24T00:00:00.000Z", readDurationMs: 2, cacheHit: false })
      })
    });

    expect(result).toMatchObject({ state: "completed", totalFiles: 300, processedFiles: 300 });
    expect(getVideosByPaths.mock.calls.map(([paths]) => paths.length)).toEqual([128, 128, 44]);
    expect(runInTransaction.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(result.performance).toMatchObject({
      cloudDirectoryReadCount: 1,
      directoryEntryCount: 300,
      directoryReadMaxEntries: 300,
      existingVideoLookupCount: 3,
      snapshotWriteCount: 1
    });
    expect(result.performance?.writeBatchCount).toBe(runInTransaction.mock.calls.length);
    expect(JSON.stringify(result.performance)).not.toContain(tempDir);
    expect(upsertDirectorySnapshot).toHaveBeenCalledOnce();
  });
  it("respects the configured concurrency limit while prefetching synthetic cloud directories", async () => {
    const repo = createRepositoryStub();
    Object.assign(repo.value, {
      setSourceFolderProvider: vi.fn(),
      getDirectorySnapshot: vi.fn(() => null),
      listDirectChildSnapshots: vi.fn(() => []),
      upsertDirectorySnapshot: vi.fn(),
      reconcileDirectoryMissingByFilenames: vi.fn(() => 0)
    });
    const children = Array.from({ length: 10 }, (_, index) => ({
      name: `directory-${index}`,
      kind: "directory" as const,
      scanIdentity: `directory-${index}`
    }));
    let activeReads = 0;
    let maxActiveReads = 0;
    const result = await scanSourceFolder(repo.value, {
      ...createSourceFolder(tempDir), providerType: "clouddrive", providerName: "synthetic"
    }, {
      cloudDirectoryConcurrency: 3,
      cloudDirectorySource: async () => ({
        provider: { type: "clouddrive", rootPath: "/synthetic", name: "synthetic", readOnly: true },
        readDirectory: async (directory) => {
          if (directory === tempDir) return { entries: children, directoryMtime: "2026-10-24T00:00:00.000Z", readDurationMs: 1 };
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 2));
          activeReads -= 1;
          return { entries: [], directoryMtime: "2026-10-24T00:00:00.000Z", readDurationMs: 1 };
        }
      })
    });

    expect(result.state).toBe("completed");
    expect(result.performance?.cloudDirectoryReadCount).toBe(11);
    expect(maxActiveReads).toBe(3);
  });
  it("honors cancellation during a synthetic CloudDrive write batch before committing the final snapshot", async () => {
    const repo = createRepositoryStub();
    const runInTransaction = vi.fn(<T,>(work: () => T): T => work());
    const upsertDirectorySnapshot = vi.fn();
    Object.assign(repo.value, {
      getVideosByPaths: vi.fn(() => new Map()),
      runInTransaction,
      getDirectorySnapshot: vi.fn(() => null),
      listDirectChildSnapshots: vi.fn(() => []),
      upsertDirectorySnapshot,
      reconcileDirectoryMissingByFilenames: vi.fn(() => 0),
      setSourceFolderProvider: vi.fn()
    });
    const entries = Array.from({ length: 300 }, (_, index) => ({
      name: `cancel-${index}.mp4`,
      kind: "file" as const,
      scanIdentity: `cancel-${index}`,
      fileInfo: {
        sizeBytes: 2048,
        modifiedAt: "2026-10-24T00:00:00.000Z",
        providerFileId: `cancel-remote-${index}`,
        providerPath: `/videos/cancel-${index}.mp4`
      }
    }));
    let cancelled = false;
    await expect(scanSourceFolder(repo.value, {
      ...createSourceFolder(tempDir), providerType: "clouddrive", providerName: "synthetic"
    }, {
      onMetadataPending: vi.fn(),
      isCancelled: () => cancelled,
      onProgress: (progress) => { if (progress.processedFiles >= 1) cancelled = true; },
      cloudDirectorySource: async () => ({
        provider: { type: "clouddrive", rootPath: "/synthetic", name: "synthetic", readOnly: true },
        readDirectory: async () => ({ entries, directoryMtime: "2026-10-24T00:00:00.000Z", readDurationMs: 2 })
      })
    })).rejects.toMatchObject({ name: "ScanCancelledError" });

    expect(upsertDirectorySnapshot).not.toHaveBeenCalled();
    expect(runInTransaction).toHaveBeenCalled();
    expect(repo.updateSourceFolderScanState).not.toHaveBeenCalled();
  });
});

function createSourceFolder(folderPath: string): SourceFolder {
  return {
    id: "folder-1",
    path: folderPath,
    recursive: true,
    enabled: true,
    lastScannedAt: null,
    createdAt: "",
    updatedAt: "",
    scanError: null
  };
}

function createRepositoryStub() {
  const updateSourceFolderScanState = vi.fn();
  const upsertVideo = vi.fn();
  const reconcileSourceFolderMissing = vi.fn();
  const value = {
    updateSourceFolderScanState,
    getVideoByPath: vi.fn(() => null),
    markMissing: vi.fn(),
    upsertVideo,
    reconcileSourceFolderMissing
  } as unknown as VideoRepository;

  return { value, updateSourceFolderScanState, upsertVideo, reconcileSourceFolderMissing };
}
