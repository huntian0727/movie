// @vitest-environment node

import type { Stats } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { MissingVideoService } from "../../src/main/files/missingVideoService";
import type { SourceFolder, VideoRecord } from "../../src/shared/videoTypes";
import type { VideoRepository } from "../../src/main/db/videoRepository";

describe("MissingVideoService", () => {
  it("restores present local files and keeps confirmed absent files missing", async () => {
    const folder = sourceFolder("folder-1", "D:\\Movies");
    const present = video("present", folder.id, "D:\\Movies\\present.mp4");
    const absent = video("absent", folder.id, "D:\\Movies\\absent.mp4");
    const denied = video("denied", folder.id, "D:\\Movies\\denied.mp4");
    const { repo } = fakeRepo([present, absent, denied], [folder]);
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch: vi.fn(),
      assertVideosAvailable: vi.fn(),
      enqueueMetadata: vi.fn(),
      statPath: vi.fn(async (targetPath) => {
        if (targetPath === folder.path) return stats({ directory: true });
        if (targetPath === present.path) return stats({ size: present.sizeBytes, mtime: new Date(present.modifiedAt) });
        if (targetPath === absent.path) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      })
    });

    const result = await service.recheck([present.id, absent.id, denied.id]);

    expect(result).toMatchObject({ requestedCount: 3, restoredCount: 1, stillMissingCount: 1, failureCount: 1, removedCount: 0 });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ videoId: present.id, status: "restored" }),
      expect.objectContaining({ videoId: absent.id, status: "still-missing" }),
      expect.objectContaining({ videoId: denied.id, status: "failed" })
    ]));
  });

  it("does not remove records when the source folder is unavailable", async () => {
    const folder = sourceFolder("folder-1", "D:\\Movies");
    const missing = video("missing", folder.id, "D:\\Movies\\missing.mp4");
    const { repo, removeMissingVideosIfVersions } = fakeRepo([missing], [folder]);
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch: vi.fn(),
      assertVideosAvailable: vi.fn(),
      enqueueMetadata: vi.fn(),
      statPath: vi.fn(async () => { throw Object.assign(new Error("offline"), { code: "ENOENT" }); })
    });

    const result = await service.forget([missing.id]);

    expect(result).toMatchObject({ removedCount: 0, failureCount: 1 });
    expect(removeMissingVideosIfVersions).not.toHaveBeenCalled();
  });

  it("uses CloudDrive confirmation before restoring or removing records", async () => {
    const folder = { ...sourceFolder("cloud", "F:\\Cloud"), providerType: "clouddrive" as const };
    const present = video("present", folder.id, "F:\\Cloud\\present.mp4");
    const absent = video("absent", folder.id, "F:\\Cloud\\absent.mp4");
    const { repo, removeMissingVideosIfVersions } = fakeRepo([present, absent], [folder]);
    const assertVideosAvailable = vi.fn();
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch: vi.fn(async () => new Map<string, "present" | "missing">([[present.path, "present"], [absent.path, "missing"]])),
      assertVideosAvailable,
      enqueueMetadata: vi.fn()
    });

    const result = await service.forget([present.id, absent.id]);

    expect(result).toMatchObject({ restoredCount: 1, removedCount: 1, failureCount: 0 });
    expect(assertVideosAvailable).toHaveBeenCalledWith([absent.id]);
    expect(removeMissingVideosIfVersions).toHaveBeenCalledWith([absent]);
  });

  it("checks available records and marks a deleted local file missing", async () => {
    const folder = sourceFolder("folder-1", "D:\\Movies");
    const available = { ...video("available", folder.id, "D:\\Movies\\available.mp4"), isMissing: false };
    const deleted = { ...video("deleted", folder.id, "D:\\Movies\\deleted.mp4"), isMissing: false };
    const { repo, markMissingIfVersion } = fakeRepo([available, deleted], [folder]);
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch: vi.fn(),
      assertVideosAvailable: vi.fn(),
      enqueueMetadata: vi.fn(),
      statPath: vi.fn(async (targetPath) => {
        if (targetPath === folder.path) return stats({ directory: true });
        if (targetPath === available.path) return stats({ size: available.sizeBytes, mtime: new Date(available.modifiedAt) });
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      })
    });

    const result = await service.recheck([available.id, deleted.id]);

    expect(result).toMatchObject({ requestedCount: 2, stillMissingCount: 1, skippedCount: 1, failureCount: 0 });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ videoId: available.id, status: "skipped", message: expect.stringContaining("文件存在") }),
      expect.objectContaining({ videoId: deleted.id, status: "still-missing", message: expect.stringContaining("已标记为缺失") })
    ]));
    expect(markMissingIfVersion).toHaveBeenCalledWith(deleted.id, deleted.path, deleted.sizeBytes, deleted.modifiedAt);
  });

  it("checks available CloudDrive records through a forced remote listing", async () => {
    const folder = { ...sourceFolder("cloud", "F:\\Cloud"), providerType: "clouddrive" as const };
    const available = { ...video("available", folder.id, "F:\\Cloud\\available.mp4"), isMissing: false };
    const deleted = { ...video("deleted", folder.id, "F:\\Cloud\\deleted.mp4"), isMissing: false };
    const { repo, markMissingIfVersion } = fakeRepo([available, deleted], [folder]);
    const confirmRemoteMissingBatch = vi.fn(async () => new Map<string, "present" | "missing">([
      [available.path, "present"], [deleted.path, "missing"]
    ]));
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch,
      assertVideosAvailable: vi.fn(),
      enqueueMetadata: vi.fn()
    });

    const result = await service.recheck([available.id, deleted.id]);

    expect(confirmRemoteMissingBatch).toHaveBeenCalledWith([available.path, deleted.path]);
    expect(result).toMatchObject({ stillMissingCount: 1, skippedCount: 1, failureCount: 0 });
    expect(markMissingIfVersion).toHaveBeenCalledWith(deleted.id, deleted.path, deleted.sizeBytes, deleted.modifiedAt);
  });

  it("does not mark an available record missing when its source directory is offline", async () => {
    const folder = sourceFolder("offline", "Z:\\Offline");
    const available = { ...video("available", folder.id, "Z:\\Offline\\available.mp4"), isMissing: false };
    const { repo, markMissingIfVersion } = fakeRepo([available], [folder]);
    const service = new MissingVideoService(repo, {
      confirmRemoteMissingBatch: vi.fn(),
      assertVideosAvailable: vi.fn(),
      enqueueMetadata: vi.fn(),
      statPath: vi.fn(async () => { throw Object.assign(new Error("network unavailable"), { code: "ENOENT" }); })
    });

    const result = await service.recheck([available.id]);

    expect(result).toMatchObject({ requestedCount: 1, stillMissingCount: 0, failureCount: 1 });
    expect(result.items[0]).toMatchObject({ videoId: available.id, status: "failed", message: expect.stringContaining("本次未更改记录") });
    expect(markMissingIfVersion).not.toHaveBeenCalled();
  });
});

function fakeRepo(initialVideos: VideoRecord[], folders: SourceFolder[]) {
  const videos = new Map(initialVideos.map((item) => [item.id, { ...item }]));
  const removeMissingVideosIfVersions = vi.fn((candidates: readonly VideoRecord[]) => candidates.filter((candidate) => {
    const item = videos.get(candidate.id);
    if (!item?.isMissing) return false;
    videos.delete(candidate.id);
    return true;
  }).map((candidate) => candidate.id));
  const markMissingIfVersion = vi.fn((id: string) => {
    const item = videos.get(id);
    if (!item) return false;
    videos.set(id, { ...item, isMissing: true });
    return true;
  });
  const repo = {
    listVideosByIds: (ids: string[]) => ids.map((id) => videos.get(id)).filter(Boolean),
    listSourceFolders: () => folders,
    restoreMissingIfVersion: (id: string) => {
      const item = videos.get(id);
      if (!item?.isMissing) return false;
      videos.set(id, { ...item, isMissing: false });
      return true;
    },
    refreshVideoFileVersion: () => true,
    markMissingIfVersion,
    removeMissingVideosIfVersions
  } as unknown as VideoRepository;
  return { repo, markMissingIfVersion, removeMissingVideosIfVersions };
}

function sourceFolder(id: string, folderPath: string): SourceFolder {
  return { id, path: folderPath, recursive: true, enabled: true, lastScannedAt: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", scanError: null, providerType: "local" };
}

function video(id: string, sourceFolderId: string, filePath: string): VideoRecord {
  return {
    id, sourceFolderId, path: filePath, directory: filePath.slice(0, filePath.lastIndexOf("\\")), filename: filePath.slice(filePath.lastIndexOf("\\") + 1), basename: id,
    extension: ".mp4", sizeBytes: 1200, durationMs: 5000, width: 1920, height: 1080, format: "mp4", videoCodec: "h264", videoProfile: null,
    pixelFormat: null, audioCodec: "aac", codecProbeStatus: "ready", modifiedAt: "2026-09-01T00:00:00.000Z", importedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z", metadataStatus: "ready", thumbnailStatus: "ready", timelinePreviewStatus: "ready", fingerprintStatus: "pending",
    contentFingerprint: null, fingerprintUpdatedAt: null, fingerprintError: null, coverCachePath: null, isFavorite: false, isPendingDelete: false, isMissing: true,
    providerFileId: null, providerPath: null, durationSource: "local-probe"
  };
}

function stats(options: { directory?: boolean; size?: number; mtime?: Date }): Stats {
  return { isDirectory: () => Boolean(options.directory), isFile: () => !options.directory, size: options.size ?? 0, mtime: options.mtime ?? new Date(0) } as Stats;
}
