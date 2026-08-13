// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../../src/main/db/database";
import { VideoRepository } from "../../src/main/db/videoRepository";
import { MetadataQueue } from "../../src/main/media/metadataQueue";
import type { VideoRecord } from "../../src/shared/videoTypes";

describe("MetadataQueue", () => {
  it("runs FFprobe with bounded concurrency and writes ready metadata", async () => {
    const videos = new Map([
      ["v1", createVideo("v1", "Z:\\Cloud\\one.mp4")],
      ["v2", createVideo("v2", "Z:\\Cloud\\two.mp4")]
    ]);
    const repo = createRepo(videos);
    let active = 0;
    let maxActive = 0;
    const reader = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { durationMs: 5000, width: 1920, height: 1080, format: "mp4" };
    });
    const queue = new MetadataQueue(repo.value, reader, 1);

    expect(queue.enqueue("v1")).toBe(true);
    expect(queue.enqueue("v1")).toBe(false);
    expect(queue.enqueue("v2")).toBe(true);
    await queue.whenIdle();

    expect(maxActive).toBe(1);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(repo.markMetadataReady).toHaveBeenCalledTimes(2);
    expect(repo.markMetadataFailed).not.toHaveBeenCalled();
    expect(queue.getStatus()).toEqual({ queued: 0, active: 0 });
  });

  it("marks a matching pending record failed when FFprobe rejects", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\broken.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    const onSourceFolderUpdated = vi.fn();
    const queue = new MetadataQueue(
      repo.value,
      async () => { throw new Error("ffprobe failed"); },
      1,
      undefined,
      undefined,
      onSourceFolderUpdated
    );

    queue.enqueue(video.id);
    await queue.whenIdle();

    expect(repo.markMetadataFailed).toHaveBeenCalledWith(video.id, video.path, video.sizeBytes, video.modifiedAt);
    expect(repo.recordScanFailure).toHaveBeenCalledWith(expect.objectContaining({
      sourceFolderId: video.sourceFolderId,
      objectType: "file",
      objectPath: video.path,
      failureStage: "metadata",
      errorSummary: "ffprobe failed"
    }));
    expect(onSourceFolderUpdated).toHaveBeenCalledWith(video.sourceFolderId);
  });

  it("increments the failure retry count only for an explicit metadata retry", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\retry-failed.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    const queue = new MetadataQueue(repo.value, async () => { throw new Error("ffprobe failed again"); });

    queue.enqueue(video.id, true);
    await queue.whenIdle();

    expect(repo.recordScanFailure).toHaveBeenCalledWith(expect.objectContaining({
      objectPath: video.path,
      failureStage: "metadata",
      incrementRetry: true
    }));
  });

  it("prioritizes an explicit retry ahead of ordinary queued metadata", async () => {
    const first = createVideo("v1", "Z:\\Cloud\\first.mp4");
    const ordinary = createVideo("v2", "Z:\\Cloud\\ordinary.mp4");
    const retry = createVideo("v3", "Z:\\Cloud\\retry.mp4");
    const repo = createRepo(new Map([[first.id, first], [ordinary.id, ordinary], [retry.id, retry]]));
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const order: string[] = [];
    const queue = new MetadataQueue(repo.value, async (filePath) => {
      order.push(filePath);
      if (filePath === first.path) await firstGate;
      return { durationMs: 1000, width: 1280, height: 720, format: "mp4" };
    });

    queue.enqueue(first.id);
    queue.enqueue(ordinary.id);
    queue.enqueue(retry.id);
    queue.enqueue(retry.id, true);
    releaseFirst();
    await queue.whenIdle();

    expect(order).toEqual([first.path, retry.path, ordinary.path]);
  });

  it("notifies the renderer after metadata retry settles", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\retry.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    const onVideoUpdated = vi.fn();
    const onSourceFolderUpdated = vi.fn();
    repo.resolveScanFailuresForObjectStage.mockReturnValue(1);
    const queue = new MetadataQueue(
      repo.value,
      async () => ({ durationMs: 5000, width: 1280, height: 720, format: "mp4" }),
      1,
      undefined,
      onVideoUpdated,
      onSourceFolderUpdated
    );

    queue.enqueue(video.id);
    await queue.whenIdle();

    expect(onVideoUpdated).toHaveBeenCalledWith(video.id);
    expect(onSourceFolderUpdated).toHaveBeenCalledWith(video.sourceFolderId);
  });

  it("restores pending database records on startup", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\resume.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    repo.listVideosPendingMetadata.mockReturnValueOnce([video]).mockReturnValue([]);
    const queue = new MetadataQueue(repo.value, async () => ({ durationMs: null, width: null, height: null, format: null }));

    expect(queue.enqueuePending()).toBe(1);
    await queue.whenIdle();

    expect(repo.markMetadataReady).toHaveBeenCalledOnce();
  });

  it("can hold queued work until a startup folder scan finishes", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\delayed.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    const reader = vi.fn(async () => ({ durationMs: 1000, width: 1280, height: 720, format: "mp4" }));
    const queue = new MetadataQueue(repo.value, reader);

    queue.pause();
    queue.enqueue(video.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reader).not.toHaveBeenCalled();

    queue.resume();
    await queue.whenIdle();
    expect(reader).toHaveBeenCalledOnce();
  });

  it("persists metadata failures, publishes folder refreshes, and clears the warning after a successful retry", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "video-manager-metadata-queue-"));
    const db = createDatabase(path.join(tempDirectory, "library.sqlite"));
    try {
      const repo = new VideoRepository(db);
      const source = repo.addSourceFolder("Z:\\Cloud", true);
      const persistedVideo = repo.upsertVideo({
        sourceFolderId: source.id,
        path: "Z:\\Cloud\\broken.mp4",
        directory: "Z:\\Cloud",
        filename: "broken.mp4",
        basename: "broken",
        extension: ".mp4",
        sizeBytes: 1024,
        durationMs: null,
        width: null,
        height: null,
        format: null,
        modifiedAt: "2026-07-16T00:00:00.000Z",
        metadataStatus: "pending"
      });
      const folderUpdates = vi.fn();
      const failedQueue = new MetadataQueue(
        repo,
        async () => { throw new Error("ffprobe timed out"); },
        1,
        undefined,
        undefined,
        folderUpdates
      );

      failedQueue.enqueue(persistedVideo.id);
      await failedQueue.whenIdle();

      expect(repo.getScanFailureSummary(source.id)).toMatchObject({ totalUnresolved: 1, latestError: "ffprobe timed out" });
      expect(repo.listSourceFolders().find((item) => item.id === source.id)?.scanError).toBe("ffprobe timed out");
      expect(folderUpdates).toHaveBeenLastCalledWith(source.id);

      expect(repo.markMetadataPending(
        persistedVideo.id,
        persistedVideo.path,
        persistedVideo.sizeBytes,
        persistedVideo.modifiedAt
      )).toBe(true);
      const successfulQueue = new MetadataQueue(
        repo,
        async () => ({ durationMs: 5000, width: 1280, height: 720, format: "mp4" }),
        1,
        undefined,
        undefined,
        folderUpdates
      );
      successfulQueue.enqueue(persistedVideo.id);
      await successfulQueue.whenIdle();

      expect(repo.getScanFailureSummary(source.id).totalUnresolved).toBe(0);
      expect(repo.listSourceFolders().find((item) => item.id === source.id)?.scanError).toBeNull();
      expect(folderUpdates).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("treats an ENOENT metadata race as a confirmed deletion when the parent is readable", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "video-manager-metadata-deleted-"));
    try {
      const video = createVideo("v1", path.join(tempDirectory, "removed.mp4"));
      const videos = new Map([[video.id, video]]);
      const repo = createRepo(videos);
      const onVideoUpdated = vi.fn();
      const onSourceFolderUpdated = vi.fn();
      const queue = new MetadataQueue(
        repo.value,
        async () => { throw Object.assign(new Error("ffprobe ENOENT"), { code: "ENOENT" }); },
        1,
        undefined,
        onVideoUpdated,
        onSourceFolderUpdated
      );

      queue.enqueue(video.id);
      await queue.whenIdle();

      expect(repo.markMissing).toHaveBeenCalledWith(video.id, true);
      expect(videos.get(video.id)?.isMissing).toBe(true);
      expect(repo.resolveScanFailuresForObject).toHaveBeenCalledWith(video.sourceFolderId, video.path);
      expect(repo.markMetadataFailed).not.toHaveBeenCalled();
      expect(repo.recordScanFailure).not.toHaveBeenCalled();
      expect(onVideoUpdated).toHaveBeenCalledWith(video.id);
      expect(onSourceFolderUpdated).toHaveBeenCalledWith(video.sourceFolderId);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("does not recreate a metadata warning when the video became missing while FFprobe was running", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\removed-during-probe.mp4");
    const videos = new Map([[video.id, video]]);
    const repo = createRepo(videos);
    let rejectProbe!: (error: unknown) => void;
    const probe = new Promise<never>((_resolve, reject) => { rejectProbe = reject; });
    const reader = vi.fn(() => probe);
    const queue = new MetadataQueue(repo.value, reader);

    queue.enqueue(video.id);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
    videos.set(video.id, { ...video, isMissing: true });
    rejectProbe(Object.assign(new Error("ffprobe ENOENT"), { code: "ENOENT" }));
    await queue.whenIdle();

    expect(repo.resolveScanFailuresForObject).toHaveBeenCalledWith(video.sourceFolderId, video.path);
    expect(repo.markMissing).not.toHaveBeenCalled();
    expect(repo.markMetadataFailed).not.toHaveBeenCalled();
    expect(repo.recordScanFailure).not.toHaveBeenCalled();
  });
});

function createRepo(videos: Map<string, VideoRecord>) {
  const markMetadataReady = vi.fn(() => true);
  const markMetadataFailed = vi.fn(() => true);
  const listVideosPendingMetadata = vi.fn(() => [] as VideoRecord[]);
  const recordScanFailure = vi.fn();
  const resolveScanFailuresForObjectStage = vi.fn();
  const resolveScanFailuresForObject = vi.fn();
  const markMissing = vi.fn((videoId: string, missing: boolean) => {
    const video = videos.get(videoId);
    if (video) videos.set(videoId, { ...video, isMissing: missing });
  });
  const value = {
    getVideo: (videoId: string) => {
      const video = videos.get(videoId);
      if (!video) throw new Error("Video not found");
      return video;
    },
    markMetadataReady,
    markMetadataFailed,
    recordScanFailure,
    resolveScanFailuresForObject,
    resolveScanFailuresForObjectStage,
    markMissing,
    listVideosPendingMetadata
  } as unknown as VideoRepository;
  return { value, markMetadataReady, markMetadataFailed, recordScanFailure, resolveScanFailuresForObject, resolveScanFailuresForObjectStage, markMissing, listVideosPendingMetadata };
}

function createVideo(id: string, filePath: string): VideoRecord {
  return {
    id,
    sourceFolderId: "folder-1",
    path: filePath,
    directory: path.dirname(filePath),
    filename: filePath.split("\\").at(-1)!,
    basename: id,
    extension: ".mp4",
    sizeBytes: 1024,
    durationMs: null,
    width: null,
    height: null,
    format: null,
    modifiedAt: "2026-07-16T00:00:00.000Z",
    importedAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    isFavorite: false,
    isPendingDelete: false,
    isMissing: false,
    metadataStatus: "pending",
    thumbnailStatus: "pending",
    timelinePreviewStatus: "pending",
    coverCachePath: null,
    contentFingerprint: null,
    fingerprintStatus: "pending",
    fingerprintUpdatedAt: null,
    fingerprintError: null
  };
}
