// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { VideoRepository } from "../../src/main/db/videoRepository";
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
    const queue = new MetadataQueue(repo.value, async () => { throw new Error("ffprobe failed"); });

    queue.enqueue(video.id);
    await queue.whenIdle();

    expect(repo.markMetadataFailed).toHaveBeenCalledWith(video.id, video.path, video.sizeBytes, video.modifiedAt);
  });

  it("notifies the renderer after metadata retry settles", async () => {
    const video = createVideo("v1", "Z:\\Cloud\\retry.mp4");
    const repo = createRepo(new Map([[video.id, video]]));
    const onVideoUpdated = vi.fn();
    const queue = new MetadataQueue(
      repo.value,
      async () => ({ durationMs: 5000, width: 1280, height: 720, format: "mp4" }),
      1,
      undefined,
      onVideoUpdated
    );

    queue.enqueue(video.id);
    await queue.whenIdle();

    expect(onVideoUpdated).toHaveBeenCalledWith(video.id);
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
});

function createRepo(videos: Map<string, VideoRecord>) {
  const markMetadataReady = vi.fn(() => true);
  const markMetadataFailed = vi.fn(() => true);
  const listVideosPendingMetadata = vi.fn(() => [] as VideoRecord[]);
  const value = {
    getVideo: (videoId: string) => {
      const video = videos.get(videoId);
      if (!video) throw new Error("Video not found");
      return video;
    },
    markMetadataReady,
    markMetadataFailed,
    listVideosPendingMetadata
  } as unknown as VideoRepository;
  return { value, markMetadataReady, markMetadataFailed, listVideosPendingMetadata };
}

function createVideo(id: string, filePath: string): VideoRecord {
  return {
    id,
    sourceFolderId: "folder-1",
    path: filePath,
    directory: "Z:\\Cloud",
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
