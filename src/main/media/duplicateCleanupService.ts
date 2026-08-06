import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { DuplicateCleanupAccepted, DuplicateCleanupJob, DuplicateCleanupSubmitRequest } from "../../shared/videoTypes.js";
import type { DuplicateCleanupRepository, DuplicateCleanupWorkItem } from "../db/duplicateCleanupRepository.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "../files/pathNormalization.js";
import { permanentlyDeleteFile } from "../files/fileOperations.js";
import type { MediaCacheManager } from "./cacheManager.js";
import type { MetadataQueue } from "./metadataQueue.js";
import type { DomainEventBus } from "../playerWindow.js";

type Inspection =
  | { status: "current"; stats: Stats }
  | { status: "missing"; message: string }
  | { status: "stale"; stats: Stats; message: string }
  | { status: "unreadable"; message: string };

interface DuplicateCleanupServiceOptions {
  deleteFile?: (filePath: string) => Promise<void>;
}

export class DuplicateCleanupService {
  private readonly pendingJobs: string[] = [];
  private pumping = false;
  private stopped = false;
  private currentJobId: string | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deleteFile: (filePath: string) => Promise<void>;

  constructor(
    private readonly jobs: DuplicateCleanupRepository,
    private readonly videos: VideoRepository,
    private readonly metadataQueue: MetadataQueue,
    private readonly cacheManager: MediaCacheManager,
    private readonly domainEvents: DomainEventBus,
    options: DuplicateCleanupServiceOptions = {}
  ) {
    this.deleteFile = options.deleteFile ?? permanentlyDeleteFile;
    this.jobs.interruptActiveJobs();
  }

  preview(request: DuplicateCleanupSubmitRequest) {
    return this.jobs.preview(request);
  }

  submit(request: DuplicateCleanupSubmitRequest): DuplicateCleanupAccepted {
    const accepted = this.jobs.submit(request);
    if (accepted.status === "queued") this.enqueue(accepted.jobId);
    return accepted;
  }

  cancel(jobId: string): DuplicateCleanupJob {
    const job = this.jobs.requestCancel(jobId);
    if (job.status === "cancelling" && this.currentJobId !== jobId) {
      const finished = this.jobs.finish(jobId);
      this.publish(jobId);
      return finished;
    }
    this.publish(jobId);
    return job;
  }

  resume(jobId: string): DuplicateCleanupJob {
    const job = this.jobs.resume(jobId);
    this.enqueue(jobId);
    this.publish(jobId);
    return job;
  }

  retry(jobId: string): DuplicateCleanupJob {
    const job = this.jobs.retry(jobId);
    this.enqueue(jobId);
    this.publish(jobId);
    return job;
  }

  assertVideosAvailable(videoIds: string[]): void {
    this.jobs.assertVideosAvailable(videoIds);
  }

  stop(): void {
    this.stopped = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.jobs.interruptActiveJobs();
  }

  private enqueue(jobId: string): void {
    if (this.stopped || this.pendingJobs.includes(jobId) || this.currentJobId === jobId) return;
    this.pendingJobs.push(jobId);
    queueMicrotask(() => void this.pump());
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        const jobId = this.pendingJobs.shift();
        if (!jobId) break;
        if (!this.jobs.start(jobId)) continue;
        this.currentJobId = jobId;
        this.publish(jobId);
        await this.runJob(jobId);
        this.currentJobId = null;
      }
    } finally {
      this.currentJobId = null;
      this.pumping = false;
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const items = this.jobs.listWorkItems(jobId);
    const byGroup = new Map<string, DuplicateCleanupWorkItem[]>();
    for (const item of items) byGroup.set(item.group_key, [...(byGroup.get(item.group_key) ?? []), item]);

    for (const groupItems of byGroup.values()) {
      if (this.stopped || this.jobs.isCancelling(jobId)) break;
      const keep = groupItems[0];
      const keepInspection = await this.inspect(keep.keep_path, keep.expected_keep_size_bytes, keep.expected_keep_modified_at);
      if (this.stopped) return;
      if (this.jobs.isCancelling(jobId)) break;
      if (keepInspection.status !== "current") {
        await this.refreshChangedVideo(keep.keep_video_id, keep.keep_path, keep.expected_keep_size_bytes, keep.expected_keep_modified_at, keepInspection);
        for (const item of groupItems) this.jobs.updateItem(item.id, "skipped", `keep-${keepInspection.status}`, `保留文件状态异常：${keepInspection.message}`);
        this.jobs.progress(jobId);
        this.publish(jobId);
        continue;
      }

      for (const item of groupItems) {
        if (this.stopped || this.jobs.isCancelling(jobId)) break;
        await this.processDeleteItem(item);
        this.jobs.progress(jobId);
        this.publish(jobId);
      }
    }

    if (!this.stopped) {
      const finished = this.jobs.finish(jobId);
      if (finished.successItems > 0) this.cacheManager.scheduleMaintenance(true);
      this.publish(jobId, true);
    }
  }

  private async processDeleteItem(item: DuplicateCleanupWorkItem): Promise<void> {
    this.jobs.updateItem(item.id, "verifying");
    const inspection = await this.inspect(item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at);
    if (this.stopped) return;
    if (inspection.status !== "current") {
      await this.refreshChangedVideo(item.delete_video_id, item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at, inspection);
      const status = inspection.status === "unreadable" ? "failed" : "skipped";
      this.jobs.updateItem(item.id, status, inspection.status, inspection.message);
      return;
    }

    // Final safety check immediately before the irreversible delete.
    const finalInspection = await this.inspect(item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at);
    if (this.stopped) return;
    if (finalInspection.status !== "current") {
      await this.refreshChangedVideo(item.delete_video_id, item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at, finalInspection);
      this.jobs.updateItem(item.id, finalInspection.status === "unreadable" ? "failed" : "skipped", `final-${finalInspection.status}`, finalInspection.message);
      return;
    }

    this.jobs.updateItem(item.id, "deleting");
    try {
      await this.deleteFile(item.delete_path);
      if (this.stopped) return;
      this.videos.removeVideo(item.delete_video_id);
      this.jobs.updateItem(item.id, "deleted", "deleted", null);
      this.domainEvents.publish({ type: "video:removed", videoIds: [item.delete_video_id] });
    } catch (error: unknown) {
      this.jobs.updateItem(item.id, "failed", getErrorCode(error), toMessage(error));
    }
  }

  private async inspect(filePath: string, expectedSize: number, expectedModifiedAt: string): Promise<Inspection> {
    if (!this.isManaged(filePath)) return { status: "unreadable", message: "文件已不在受管理目录内" };
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return { status: "unreadable", message: "路径不是普通文件" };
      const currentModifiedAt = stats.mtime.toISOString();
      if (stats.size !== expectedSize || currentModifiedAt !== expectedModifiedAt) {
        return { status: "stale", stats, message: "文件大小或修改时间已变化" };
      }
      return { status: "current", stats };
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") return { status: "unreadable", message: toMessage(error) };
      try {
        await readdir(path.dirname(filePath));
        return { status: "missing", message: "文件已不存在" };
      } catch (parentError: unknown) {
        return { status: "unreadable", message: `父目录无法读取：${toMessage(parentError)}` };
      }
    }
  }

  private async refreshChangedVideo(videoId: string, filePath: string, size: number, modifiedAt: string, inspection: Exclude<Inspection, { status: "current" }>): Promise<void> {
    if (inspection.status === "missing") {
      this.videos.markMissingIfVersion(videoId, filePath, size, modifiedAt);
    } else if (inspection.status === "stale") {
      const changed = this.videos.refreshVideoFileVersion(videoId, filePath, size, modifiedAt, inspection.stats.size, inspection.stats.mtime.toISOString());
      if (changed) this.metadataQueue.enqueue(videoId);
    }
    if (inspection.status !== "unreadable") this.domainEvents.publish({ type: "video:updated", videoIds: [videoId] });
  }

  private isManaged(filePath: string): boolean {
    return this.videos.listSourceFolders().some((folder) => folder.enabled && isManagedPathWithin(filePath, folder.path));
  }

  private publish(jobId: string, immediate = false): void {
    if (immediate) {
      if (this.changeTimer) clearTimeout(this.changeTimer);
      this.changeTimer = null;
      this.domainEvents.publish({ type: "duplicate-cleanup:changed", videoIds: [], jobId });
      return;
    }
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.domainEvents.publish({ type: "duplicate-cleanup:changed", videoIds: [], jobId });
    }, 300);
  }
}

function getErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
