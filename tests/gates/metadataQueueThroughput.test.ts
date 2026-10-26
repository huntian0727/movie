// @vitest-environment node

import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import type { VideoRepository } from "../../src/main/db/videoRepository";
import { MetadataQueue } from "../../src/main/media/metadataQueue";
import type { MediaMetadata } from "../../src/main/media/metadataService";
import type { VideoRecord } from "../../src/shared/videoTypes";

const VIDEO_COUNT = 100_000;
const FAILURE_EVERY = 50;
const SUCCESS_METADATA: MediaMetadata = { durationMs: 90_000, width: 1920, height: 1080, format: "mp4", videoCodec: "h264", audioCodec: "aac" };

it("drains 100k synthetic pending metadata tasks and records throughput, failures, and progress notifications", async () => {
  const videos = new Map<string, VideoRecord>();
  for (let index = 1; index <= VIDEO_COUNT; index += 1) {
    const video = createVideo(index);
    videos.set(video.id, video);
  }
  const repo = createRepo(videos);
  let videoUpdatedCount = 0;
  let sourceFolderUpdatedCount = 0;
  let loaderCalls = 0;
  let readerCalls = 0;
  let maxLoaderCallMs = 0;
  let totalLoaderCallMs = 0;
  const pendingIds = [...videos.keys()];
  let pendingCursor = 0;
  const pendingLoader = async (limit: number) => {
    loaderCalls += 1;
    const loaderStarted = performance.now();
    const result: VideoRecord[] = [];
    while (pendingCursor < pendingIds.length && result.length < limit) {
      const video = videos.get(pendingIds[pendingCursor++]!);
      if (video?.metadataStatus === "pending") result.push(video);
    }
    const loaderDurationMs = performance.now() - loaderStarted;
    maxLoaderCallMs = Math.max(maxLoaderCallMs, loaderDurationMs);
    totalLoaderCallMs += loaderDurationMs;
    return result;
  };
  const reader = async (filePath: string): Promise<MediaMetadata> => {
    readerCalls += 1;
    const match = /video-(\d+)\.mp4$/i.exec(filePath);
    const index = Number(match?.[1] ?? 0);
    if (process.env.METADATA_QUEUE_BENCHMARK_TIMER_READS !== "0" && index > 0 && index % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (index > 0 && index % FAILURE_EVERY === 0) throw new Error("synthetic metadata probe failure");
    return SUCCESS_METADATA;
  };
  const queue = new MetadataQueue(repo.value, reader, 3, undefined, () => { videoUpdatedCount += 1; }, () => { sourceFolderUpdatedCount += 1; }, undefined, async () => null, pendingLoader);
  let lastTick = performance.now();
  let lastUpdatedAtTick = 0;
  let maxEventLoopGapMs = 0;
  let timerTicks = 0;
  const longEventLoopGaps: Array<{ gapMs: number; updatedDuringGap: number; totalUpdated: number }> = [];
  const timer = setInterval(() => {
    const now = performance.now();
    const gapMs = now - lastTick;
    maxEventLoopGapMs = Math.max(maxEventLoopGapMs, gapMs);
    if (gapMs > 100) longEventLoopGaps.push({ gapMs, updatedDuringGap: videoUpdatedCount - lastUpdatedAtTick, totalUpdated: videoUpdatedCount });
    lastTick = now;
    lastUpdatedAtTick = videoUpdatedCount;
    timerTicks += 1;
  }, 5);
  const started = performance.now();
  try {
    await queue.enqueuePending(1000);
    await queue.whenIdle();
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    clearInterval(timer);
  }
  const elapsedMs = performance.now() - started;
  const failed = [...videos.values()].filter((video) => video.metadataStatus === "failed");
  const ready = [...videos.values()].filter((video) => video.metadataStatus === "ready");
  const failureRate = failed.length / VIDEO_COUNT;
  console.info("MetadataQueue 100k drain: " + elapsedMs.toFixed(2) + " ms; throughput=" + Math.round(VIDEO_COUNT * 1000 / elapsedMs) + "/s; ready=" + ready.length + "; failed=" + failed.length + "; failureRate=" + (failureRate * 100).toFixed(2) + "%; readerCalls=" + readerCalls + "; loaderCalls=" + loaderCalls + "; maxLoaderCall=" + maxLoaderCallMs.toFixed(2) + " ms; totalLoaderCalls=" + totalLoaderCallMs.toFixed(2) + " ms; videoUpdated=" + videoUpdatedCount + "; sourceFolderUpdated=" + sourceFolderUpdatedCount + "; timerTicks=" + timerTicks + "; maxEventLoopGap=" + maxEventLoopGapMs.toFixed(2) + " ms; longGaps=" + JSON.stringify(longEventLoopGaps.sort((a, b) => b.gapMs - a.gapMs).slice(0, 5)));
  expect(ready.length).toBe(VIDEO_COUNT - VIDEO_COUNT / FAILURE_EVERY);
  expect(failed.length).toBe(VIDEO_COUNT / FAILURE_EVERY);
  expect(failureRate).toBe(1 / FAILURE_EVERY);
  expect(readerCalls).toBe(VIDEO_COUNT);
  expect(videoUpdatedCount).toBe(VIDEO_COUNT);
  expect(sourceFolderUpdatedCount).toBe(5921);
  expect(timerTicks).toBeGreaterThan(0);
  expect(repo.recordScanFailureCount).toBe(failed.length);
  expect(queue.getStatus()).toEqual({ queued: 0, active: 0 });
  expect(loaderCalls).toBeGreaterThan(100);
  expect(elapsedMs).toBeLessThan(120_000);

  const retryIds = failed.map((video) => video.id);
  for (const video of failed) videos.set(video.id, { ...video, metadataStatus: "pending" });
  let retryUpdatedCount = 0;
  let retrySourceUpdatedCount = 0;
  const retryQueue = new MetadataQueue(repo.value, async () => SUCCESS_METADATA, 3, undefined, () => { retryUpdatedCount += 1; }, () => { retrySourceUpdatedCount += 1; }, undefined, async () => null);
  const retryStarted = performance.now();
  for (const id of retryIds) expect(retryQueue.enqueue(id, true)).toBe(true);
  await retryQueue.whenIdle();
  const retryElapsedMs = performance.now() - retryStarted;
  const recovered = retryIds.filter((id) => videos.get(id)?.metadataStatus === "ready").length;
  console.info("MetadataQueue explicit retry: " + retryElapsedMs.toFixed(2) + " ms; retried=" + retryIds.length + "; recovered=" + recovered + "; retryVideoUpdated=" + retryUpdatedCount + "; retrySourceFolderUpdated=" + retrySourceUpdatedCount);
  expect(recovered).toBe(retryIds.length);
  expect(retryUpdatedCount).toBe(retryIds.length);
  expect(retryQueue.getStatus()).toEqual({ queued: 0, active: 0 });
  expect(maxEventLoopGapMs).toBeLessThan(250);
}, 120_000);

it("measures pause and resume response without starting new metadata reads while paused", async () => {
  const videos = new Map<string, VideoRecord>([["pause-a", createVideo(100_001)], ["pause-b", createVideo(100_002)]]);
  const repo = createRepo(videos);
  let finishFirst!: (metadata: MediaMetadata) => void;
  const reader = vi.fn((filePath: string) => filePath.endsWith("video-100001.mp4")
    ? new Promise<MediaMetadata>((resolve) => { finishFirst = resolve; })
    : Promise.resolve(SUCCESS_METADATA));
  const queue = new MetadataQueue(repo.value, reader, 1);
  queue.enqueue("pause-a");
  await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
  queue.enqueue("pause-b");
  queue.pause();
  finishFirst(SUCCESS_METADATA);
  await queue.waitForVideos(["pause-a"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(reader).toHaveBeenCalledOnce();
  const resumedAt = performance.now();
  queue.resume();
  await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
  const resumeLatencyMs = performance.now() - resumedAt;
  await queue.whenIdle();
  console.info("MetadataQueue pause/resume: queued read remained stopped while paused; resume-to-next-reader=" + resumeLatencyMs.toFixed(2) + " ms");
  expect(resumeLatencyMs).toBeLessThan(1000);
  expect(queue.getStatus()).toEqual({ queued: 0, active: 0 });
}, 15_000);

function createRepo(videos: Map<string, VideoRecord>) {
  let recordScanFailureCount = 0;
  const markMetadataReady = (videoId: string) => {
    const video = videos.get(videoId);
    if (video) videos.set(videoId, { ...video, metadataStatus: "ready", durationMs: SUCCESS_METADATA.durationMs, width: SUCCESS_METADATA.width, height: SUCCESS_METADATA.height, format: SUCCESS_METADATA.format });
    return Boolean(video);
  };
  const markMetadataFailed = (videoId: string) => {
    const video = videos.get(videoId);
    if (video) videos.set(videoId, { ...video, metadataStatus: "failed" });
    return Boolean(video);
  };
  const recordScanFailure = () => { recordScanFailureCount += 1; };
  const resolveScanFailuresForObjectStage = () => {};
  const value = {
    getVideo: (videoId: string) => {
      const video = videos.get(videoId);
      if (!video) throw new Error("Synthetic video not found");
      return video;
    },
    markMetadataReady,
    markMetadataFailed,
    recordScanFailure,
    resolveScanFailuresForObjectStage
  } as unknown as VideoRepository;
  return { value, get recordScanFailureCount() { return recordScanFailureCount; } };
}
function createVideo(index: number): VideoRecord {
  const filename = `video-${index}.mp4`;
  return {
    id: index > 100_000 ? (index === 100_001 ? "pause-a" : "pause-b") : `metadata-${index}`,
    sourceFolderId: "synthetic-metadata-folder",
    path: `D:\\synthetic-metadata\\${filename}`,
    directory: "D:\\synthetic-metadata",
    filename,
    basename: filename.slice(0, -4),
    extension: ".mp4",
    sizeBytes: 1024,
    durationMs: null,
    width: null,
    height: null,
    format: null,
    videoCodec: null,
    videoProfile: null,
    pixelFormat: null,
    audioCodec: null,
    codecProbeStatus: "unprobed",
    modifiedAt: "2026-10-25T00:00:00.000Z",
    importedAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
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
