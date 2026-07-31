import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import { readMetadata, type MediaMetadata } from "./metadataService.js";

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
      if (this.repo.markMetadataFailed(video.id, video.path, video.sizeBytes, video.modifiedAt)) {
        this.repo.recordScanFailure?.({
          sourceFolderId: video.sourceFolderId,
          scanTaskId: `metadata:${video.id}`,
          objectType: "file",
          objectPath: video.path,
          failureStage: "metadata",
          errorCode: getErrorCode(error),
          errorSummary: getErrorSummary(error),
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
        error
      });
    }
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
