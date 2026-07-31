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
