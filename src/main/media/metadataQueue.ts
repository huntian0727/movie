import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import { readMetadata, type MediaMetadata } from "./metadataService.js";
import { readdir } from "node:fs/promises";
import path from "node:path";

type MetadataReader = (filePath: string) => Promise<MediaMetadata>;

export interface MetadataQueueStatus {
  queued: number;
  active: number;
}

export class MetadataQueue {
  private readonly waiting: string[] = [];
  private readonly scheduled = new Set<string>();
  private active = 0;
  private stopped = false;
  private paused = false;
  private resumePendingBatches = false;
  private pendingBatchSize = 1000;
  private readonly idleWaiters = new Set<() => void>();

  constructor(
    private readonly repo: VideoRepository,
    private readonly metadataReader: MetadataReader = readMetadata,
    private readonly concurrency = 1,
    private readonly logger?: StructuredLogger,
    private readonly onVideoUpdated?: (videoId: string) => void,
    private readonly onSourceFolderUpdated?: (sourceFolderId: string) => void
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Metadata queue concurrency must be at least 1");
  }

  enqueue(videoId: string): boolean {
    if (this.stopped || this.scheduled.has(videoId)) return false;
    this.scheduled.add(videoId);
    this.waiting.push(videoId);
    this.pump();
    return true;
  }

  enqueuePending(limit = 1000): number {
    this.resumePendingBatches = true;
    this.pendingBatchSize = limit;
    return this.loadPendingBatch();
  }

  private loadPendingBatch(): number {
    let count = 0;
    for (const video of this.repo.listVideosPendingMetadata(this.pendingBatchSize)) {
      if (this.enqueue(video.id)) count += 1;
    }
    return count;
  }

  getStatus(): MetadataQueueStatus {
    return { queued: this.waiting.length, active: this.active };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.pump();
  }

  whenIdle(): Promise<void> {
    if (this.active === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  stop(): void {
    this.stopped = true;
    this.waiting.length = 0;
    if (this.active === 0) this.resolveIdleWaiters();
  }

  private pump(): void {
    while (!this.stopped && !this.paused && this.active < this.concurrency && this.waiting.length > 0) {
      const videoId = this.waiting.shift()!;
      this.active += 1;
      void this.process(videoId).finally(() => {
        this.active -= 1;
        this.scheduled.delete(videoId);
        this.pump();
        if (this.active === 0 && this.waiting.length === 0) {
          const restored = this.resumePendingBatches && !this.stopped ? this.loadPendingBatch() : 0;
          if (restored === 0) this.resolveIdleWaiters();
        }
      });
    }
  }

  private async process(videoId: string): Promise<void> {
    let video;
    try {
      video = this.repo.getVideo(videoId);
    } catch {
      return;
    }
    if (video.isMissing || video.metadataStatus !== "pending") return;

    try {
      const metadata = await this.metadataReader(video.path);
      if (this.stopped) return;
      if (this.repo.markMetadataReady(video.id, video.path, video.sizeBytes, video.modifiedAt, metadata)) {
        const resolved = this.repo.resolveScanFailuresForObjectStage?.(video.sourceFolderId, video.path, "file", "metadata") ?? 0;
        if (resolved > 0) this.onSourceFolderUpdated?.(video.sourceFolderId);
        this.onVideoUpdated?.(video.id);
      }
    } catch (error) {
      if (this.stopped) return;
      let failureError = error;
      if (isMissingFileError(error)) {
        const missingResult = await this.resolveMissingMetadataTarget(video);
        if (missingResult.confirmed) return;
        if (missingResult.error) failureError = missingResult.error;
      }
      if (this.repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt)) {
        this.repo.recordScanFailure?.({
          sourceFolderId: video.sourceFolderId,
          scanTaskId: `metadata:${video.id}`,
          objectType: "file",
          objectPath: video.path,
          failureStage: "metadata",
          errorCode: getErrorCode(failureError),
          errorSummary: getErrorSummary(failureError),
          incrementRetry: false
        });
        this.onSourceFolderUpdated?.(video.sourceFolderId);
        this.onVideoUpdated?.(video.id);
      }
      this.logger?.error({
        module: "media.metadata",
        event: "ffprobe_failed",
        message: "Video metadata extraction failed",
        context: { videoId: video.id, extension: video.extension },
        error: failureError
      });
    }
  }

  private async resolveMissingMetadataTarget(video: Awaited<ReturnType<VideoRepository["getVideo"]>>): Promise<{ confirmed: boolean; error?: unknown }> {
    let latest;
    try {
      latest = this.repo.getVideo(video.id);
    } catch {
      return { confirmed: true };
    }
    if (!isSameVideoVersion(latest, video)) return { confirmed: true };
    if (latest.isMissing) {
      this.repo.resolveScanFailuresForObject?.(video.sourceFolderId, video.path);
      this.onSourceFolderUpdated?.(video.sourceFolderId);
      return { confirmed: true };
    }

    const parentPath = path.dirname(video.path);
    try {
      const entries = await withTimeout(
        readdir(parentPath, { withFileTypes: true }),
        30_000,
        `Directory stopped responding for 30s`
      );
      const normalizedTarget = path.normalize(video.path).toLocaleLowerCase();
      const stillListed = entries.some((entry) =>
        path.normalize(path.join(parentPath, entry.name)).toLocaleLowerCase() === normalizedTarget
      );
      if (stillListed) return { confirmed: false };
    } catch (parentError) {
      return { confirmed: false, error: parentError };
    }

    let current;
    try {
      current = this.repo.getVideo(video.id);
    } catch {
      return { confirmed: true };
    }
    if (!isSameVideoVersion(current, video)) return { confirmed: true };
    if (!current.isMissing) this.repo.markMissing(video.id, true);
    this.repo.resolveScanFailuresForObject?.(video.sourceFolderId, video.path);
    this.onSourceFolderUpdated?.(video.sourceFolderId);
    this.onVideoUpdated?.(video.id);
    return { confirmed: true };
  }

  private resolveIdleWaiters(): void {
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

function getErrorSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "Video metadata extraction failed";
}

function getErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return null;
}

function isMissingFileError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (getErrorCode(current) === "ENOENT") return true;
    if (current instanceof Error && /\bENOENT\b|no such file/i.test(current.message)) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

function isSameVideoVersion(current: Awaited<ReturnType<VideoRepository["getVideo"]>>, expected: Awaited<ReturnType<VideoRepository["getVideo"]>>): boolean {
  return current.path === expected.path
    && current.sizeBytes === expected.sizeBytes
    && current.modifiedAt === expected.modifiedAt;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
