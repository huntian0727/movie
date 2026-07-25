import type { FolderScanStatus, SourceFolder } from "../../shared/videoTypes.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import { scanSourceFolder, type ScannerDependencies, type ScanResult } from "./libraryScanner.js";
import type { MetadataQueue } from "./metadataQueue.js";

type Scan = (repo: VideoRepository, folder: SourceFolder, dependencies: ScannerDependencies) => Promise<ScanResult>;

export class ScanManager {
  private readonly statuses = new Map<string, FolderScanStatus>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly paused = new Set<string>();
  private readonly resumeWaiters = new Map<string, Set<() => void>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: VideoRepository,
    private readonly scan: Scan = scanSourceFolder,
    private readonly metadataQueue?: MetadataQueue,
    private readonly logger?: StructuredLogger
  ) {}

  listStatuses(): FolderScanStatus[] {
    return [...this.statuses.values()];
  }

  start(folder: SourceFolder): Promise<void> {
    const existing = this.tasks.get(folder.id);
    if (existing) return existing;

    this.setStatus(folder.id, { state: "queued", phase: null, totalFiles: 0, processedFiles: 0, currentPath: null, message: null });
    const task = this.queue.then(() => this.run(folder), () => this.run(folder));
    this.queue = task.catch(() => undefined);
    this.tasks.set(folder.id, task);
    void task.finally(() => this.tasks.delete(folder.id));
    return task;
  }

  pause(folderId: string): boolean {
    const status = this.statuses.get(folderId);
    if (!status || (status.state !== "queued" && status.state !== "scanning")) return false;
    this.paused.add(folderId);
    this.setStatus(folderId, { ...status, state: "paused" });
    return true;
  }

  resume(folderId: string): boolean {
    if (!this.paused.delete(folderId)) return false;
    const status = this.statuses.get(folderId);
    if (status) this.setStatus(folderId, { ...status, state: status.phase ? "scanning" : "queued" });
    for (const resolve of this.resumeWaiters.get(folderId) ?? []) resolve();
    this.resumeWaiters.delete(folderId);
    return true;
  }

  forget(folderId: string): void {
    if (this.tasks.has(folderId)) {
      throw new Error("Cannot remove a source folder while its scan is active");
    }
    this.statuses.delete(folderId);
  }

  private async run(folder: SourceFolder): Promise<void> {
    const operationId = this.logger?.createOperationId();
    const startedAt = Date.now();
    this.logger?.info({
      module: "library.scan",
      operationId,
      event: "scan_started",
      context: { folderId: folder.id, path: folder.path, recursive: folder.recursive }
    });
    await this.waitIfPaused(folder.id);
    this.setStatus(folder.id, { state: "scanning", phase: "discovering", totalFiles: 0, processedFiles: 0, currentPath: folder.path, message: null });
    const pendingMetadataIds: string[] = [];
    try {
      const result = await this.scan(this.repo, folder, {
        waitIfPaused: () => this.waitIfPaused(folder.id),
        onMetadataPending: this.metadataQueue ? (videoId) => pendingMetadataIds.push(videoId) : undefined,
        onProgress: (progress) => {
          const current = this.statuses.get(folder.id);
          this.setStatus(folder.id, {
            state: current?.state === "paused" ? "paused" : "scanning",
            ...progress,
            message: null
          });
        }
      });
      this.setStatus(folder.id, {
        state: result.state,
        phase: null,
        totalFiles: result.totalFiles,
        processedFiles: result.processedFiles,
        currentPath: null,
        message: result.message
      });
      this.logger?.info({
        module: "library.scan",
        operationId,
        event: "scan_completed",
        durationMs: Date.now() - startedAt,
        context: {
          folderId: folder.id,
          state: result.state,
          totalFiles: result.totalFiles,
          processedFiles: result.processedFiles,
          pendingMetadataCount: pendingMetadataIds.length
        }
      });
    } catch (error) {
      this.setStatus(folder.id, {
        state: "error",
        phase: null,
        totalFiles: this.statuses.get(folder.id)?.totalFiles ?? 0,
        processedFiles: this.statuses.get(folder.id)?.processedFiles ?? 0,
        currentPath: null,
        message: error instanceof Error ? error.message : String(error)
      });
      this.logger?.error({
        module: "library.scan",
        operationId,
        event: "scan_failed",
        durationMs: Date.now() - startedAt,
        message: "Source folder scan failed",
        context: { folderId: folder.id, path: folder.path },
        error
      });
    } finally {
      for (const videoId of pendingMetadataIds) this.metadataQueue?.enqueue(videoId);
    }
  }

  private async waitIfPaused(folderId: string): Promise<void> {
    while (this.paused.has(folderId)) {
      await new Promise<void>((resolve) => {
        const waiters = this.resumeWaiters.get(folderId) ?? new Set<() => void>();
        waiters.add(resolve);
        this.resumeWaiters.set(folderId, waiters);
      });
    }
  }

  private setStatus(folderId: string, value: Omit<FolderScanStatus, "folderId" | "updatedAt">): void {
    this.statuses.set(folderId, { folderId, updatedAt: new Date().toISOString(), ...value });
  }
}
