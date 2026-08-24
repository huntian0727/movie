import crypto from "node:crypto";
import type { FolderScanStatus, ScanCounters, ScanMode, SourceFolder } from "../../shared/videoTypes.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { StructuredLogger } from "../logging/logger.js";
import {
  createEmptyScanCounters,
  retryScanFailure,
  retryScanFailures,
  ScanCancelledError,
  scanSourceFolder,
  type ScannerDependencies,
  type ScanResult
} from "./libraryScanner.js";
import type { MetadataQueue } from "./metadataQueue.js";

type Scan = (repo: VideoRepository, folder: SourceFolder, dependencies: ScannerDependencies) => Promise<ScanResult>;
type SingleFailureScan = (repo: VideoRepository, folder: SourceFolder, failureId: string, dependencies: ScannerDependencies) => Promise<ScanResult>;
type BatchProgress = { totalFolders: number; currentFolderIndex: number; completedFolders: number; failedFolders: number };
interface ActiveFolderTask {
  mode: ScanMode;
  promise: Promise<void>;
}

export class ScanManager {
  private readonly statuses = new Map<string, FolderScanStatus>();
  private readonly tasks = new Map<string, ActiveFolderTask>();
  private readonly singleFailureTasks = new Map<string, Promise<void>>();
  private readonly paused = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly resumeWaiters = new Map<string, Set<() => void>>();
  private queue: Promise<void> = Promise.resolve();
  private allScanTask: Promise<void> | null = null;

  constructor(
    private readonly repo: VideoRepository,
    private readonly scan: Scan = scanSourceFolder,
    private readonly metadataQueue?: MetadataQueue,
    private readonly logger?: StructuredLogger,
    private readonly retryScan: Scan = retryScanFailures,
    private readonly retrySingleScan: SingleFailureScan = retryScanFailure
  ) {}

  listStatuses(): FolderScanStatus[] {
    return [...this.statuses.values()];
  }

  isActive(folderId: string): boolean {
    return this.tasks.has(folderId);
  }

  start(folder: SourceFolder): Promise<void> {
    return this.requestTask(folder, "current-folder", this.scan);
  }

  retryFailures(folder: SourceFolder): Promise<void> {
    return this.requestRetryTask(folder);
  }

  retryFailure(folder: SourceFolder, failureId: string): Promise<void> {
    const existing = this.singleFailureTasks.get(failureId);
    if (existing) return existing;
    const task = this.requestExclusiveRetryTask(
      folder,
      (repo, sourceFolder, dependencies) => this.retrySingleScan(repo, sourceFolder, failureId, dependencies)
    );
    this.singleFailureTasks.set(failureId, task);
    void task.finally(() => { if (this.singleFailureTasks.get(failureId) === task) this.singleFailureTasks.delete(failureId); });
    return task;
  }

  retryFailuresInBackground(
    folder: SourceFolder,
    onCompleted: () => void,
    onFailed: (error: unknown) => void
  ): void {
    void this.retryFailures(folder).then(onCompleted, onFailed);
  }

  scanAll(folders: SourceFolder[]): Promise<void> {
    if (this.allScanTask) return this.allScanTask;
    const enabled = folders.filter((folder) => folder.enabled);
    const task = (async () => {
      const batch: BatchProgress = { totalFolders: enabled.length, currentFolderIndex: 0, completedFolders: 0, failedFolders: 0 };
      for (let index = 0; index < enabled.length; index += 1) {
        const folder = enabled[index];
        batch.currentFolderIndex = index + 1;
        await this.requestTask(folder, "scan-all", this.scan, batch);
        batch.completedFolders += 1;
        const status = this.statuses.get(folder.id);
        if (status && status.state !== "completed") batch.failedFolders += 1;
        if (status) this.setStatus(folder.id, { ...status, counters: mergeBatchCounters(status.counters, batch) });
      }
    })();
    this.allScanTask = task;
    void task.finally(() => { if (this.allScanTask === task) this.allScanTask = null; });
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

  cancel(folderId: string): boolean {
    const status = this.statuses.get(folderId);
    if (!status || !this.tasks.has(folderId)) return false;
    this.cancelled.add(folderId);
    this.paused.delete(folderId);
    for (const resolve of this.resumeWaiters.get(folderId) ?? []) resolve();
    this.resumeWaiters.delete(folderId);
    return true;
  }

  forget(folderId: string): void {
    if (this.tasks.has(folderId)) throw new Error("Cannot remove a source folder while its scan is active");
    this.statuses.delete(folderId);
  }

  private requestRetryTask(folder: SourceFolder): Promise<void> {
    const existing = this.tasks.get(folder.id);
    if (existing?.mode === "retry-failures") return existing.promise;
    if (existing) {
      return existing.promise.then(() => {
        this.clearActiveTask(folder.id, existing.promise);
        return this.hasUnresolvedFailures(folder.id)
          ? this.requestTask(folder, "retry-failures", this.retryScan)
          : undefined;
      });
    }
    return this.hasUnresolvedFailures(folder.id)
      ? this.requestTask(folder, "retry-failures", this.retryScan)
      : Promise.resolve();
  }

  private requestExclusiveRetryTask(folder: SourceFolder, scan: Scan): Promise<void> {
    const existing = this.tasks.get(folder.id);
    if (existing) {
      return existing.promise.then(() => {
        this.clearActiveTask(folder.id, existing.promise);
        return this.requestExclusiveRetryTask(folder, scan);
      });
    }
    return this.enqueueTask(folder, "retry-failures", scan);
  }

  private requestTask(folder: SourceFolder, mode: ScanMode, scan: Scan, batch?: BatchProgress): Promise<void> {
    const existing = this.tasks.get(folder.id);
    if (existing) {
      if (canExistingTaskSatisfy(existing.mode, mode)) return existing.promise;
      return existing.promise.then(() => {
        this.clearActiveTask(folder.id, existing.promise);
        return this.requestTask(folder, mode, scan, batch);
      });
    }
    return this.enqueueTask(folder, mode, scan, batch);
  }

  private enqueueTask(folder: SourceFolder, mode: ScanMode, scan: Scan, batch?: BatchProgress): Promise<void> {
    this.setStatus(folder.id, {
      mode,
      state: "queued",
      phase: null,
      totalFiles: 0,
      processedFiles: 0,
      currentPath: null,
      message: null,
      counters: mergeBatchCounters(createEmptyScanCounters(), batch)
    });
    const task = this.queue.then(() => this.run(folder, mode, scan, batch), () => this.run(folder, mode, scan, batch));
    this.queue = task.catch(() => undefined);
    this.tasks.set(folder.id, { mode, promise: task });
    void task.finally(() => this.clearActiveTask(folder.id, task));
    return task;
  }

  private clearActiveTask(folderId: string, task: Promise<void>): void {
    if (this.tasks.get(folderId)?.promise === task) this.tasks.delete(folderId);
  }

  private hasUnresolvedFailures(folderId: string): boolean {
    return this.repo.getScanFailureSummary?.(folderId).totalUnresolved > 0;
  }

  private async run(folder: SourceFolder, mode: ScanMode, scan: Scan, batch?: BatchProgress): Promise<void> {
    const operationId = this.logger?.createOperationId();
    const taskId = crypto.randomUUID();
    const startedAt = Date.now();
    this.repo.createScanTask?.(taskId, folder.id, mode);
    this.logger?.info({
      module: "library.scan",
      operationId,
      event: "scan_started",
      context: { folderId: folder.id, mode, recursive: folder.recursive }
    });
    await this.waitIfPaused(folder.id);
    this.setStatus(folder.id, {
      mode,
      state: "scanning",
      phase: mode === "retry-failures" ? "retrying-failures" : "discovering",
      totalFiles: 0,
      processedFiles: 0,
      currentPath: folder.path,
      message: null,
      counters: mergeBatchCounters(createEmptyScanCounters(), batch)
    });
    const pendingMetadataIds = new Set<string>();
    try {
      const result = await scan(this.repo, folder, {
        taskId,
        mode,
        isCancelled: () => this.cancelled.has(folder.id),
        waitIfPaused: () => this.waitIfPaused(folder.id),
        onMetadataPending: this.metadataQueue ? (videoId) => pendingMetadataIds.add(videoId) : undefined,
        onProgress: (progress) => {
          const current = this.statuses.get(folder.id);
          this.setStatus(folder.id, {
            mode,
            state: current?.state === "paused" ? "paused" : "scanning",
            phase: progress.phase,
            totalFiles: progress.totalFiles,
            processedFiles: progress.processedFiles,
            currentPath: progress.currentPath,
            message: null,
            counters: mergeBatchCounters(progress.counters ?? current?.counters ?? createEmptyScanCounters(), batch)
          });
        }
      });
      for (const videoId of pendingMetadataIds) this.metadataQueue?.enqueue(videoId, mode === "retry-failures");
      // CloudDrive scans stay metadata-only until an exact-size collision makes duration useful.
      // The repository query includes local files plus only those cloud collision candidates.
      this.metadataQueue?.enqueuePending?.();
      if (mode === "retry-failures" && this.metadataQueue && pendingMetadataIds.size > 0) {
        this.setStatus(folder.id, {
          mode,
          state: "scanning",
          phase: "retrying-failures",
          totalFiles: result.totalFiles,
          processedFiles: result.processedFiles,
          currentPath: null,
          message: `正在重新读取 ${pendingMetadataIds.size} 个视频的元数据`,
          counters: mergeBatchCounters(result.counters ?? createEmptyScanCounters(), batch)
        });
        await this.metadataQueue.waitForVideos(pendingMetadataIds);
      }
      const counters = result.counters ?? createEmptyScanCounters();
      const retryStillHasFailures = mode === "retry-failures" && this.hasUnresolvedFailures(folder.id);
      const finalState = retryStillHasFailures ? "completed-with-errors" : result.state;
      const finalMessage = retryStillHasFailures ? "部分异常项重试后仍然失败，请查看最新错误" : result.message;
      this.setStatus(folder.id, {
        mode,
        state: finalState,
        phase: null,
        totalFiles: result.totalFiles,
        processedFiles: result.processedFiles,
        currentPath: null,
        message: finalMessage,
        counters: mergeBatchCounters(counters, batch)
      });
      this.repo.completeScanTask?.(taskId, finalState, counters, finalMessage);
      this.logger?.info({
        module: "library.scan",
        operationId,
        event: "scan_completed",
        durationMs: Date.now() - startedAt,
        context: {
          folderId: folder.id,
          mode,
          state: finalState,
          totalFiles: result.totalFiles,
          processedFiles: result.processedFiles,
          pendingMetadataCount: pendingMetadataIds.size
        }
      });
    } catch (error) {
      const counters = this.statuses.get(folder.id)?.counters ?? createEmptyScanCounters();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = error instanceof ScanCancelledError;
      this.setStatus(folder.id, {
        mode,
        state: cancelled ? "cancelled" : "error",
        phase: null,
        totalFiles: this.statuses.get(folder.id)?.totalFiles ?? 0,
        processedFiles: this.statuses.get(folder.id)?.processedFiles ?? 0,
        currentPath: null,
        message: cancelled ? null : message,
        counters: mergeBatchCounters(counters, batch)
      });
      this.repo.completeScanTask?.(taskId, cancelled ? "cancelled" : "error", counters, cancelled ? null : message);
      if (!cancelled) {
        this.logger?.error({
          module: "library.scan",
          operationId,
          event: "scan_failed",
          durationMs: Date.now() - startedAt,
          message: "Source folder scan failed",
          context: { folderId: folder.id, mode },
          error
        });
      }
    } finally {
      this.cancelled.delete(folder.id);
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

function mergeBatchCounters(counters: ScanCounters, batch?: BatchProgress): ScanCounters {
  return batch ? { ...counters, ...batch } : counters;
}

function isNormalScanMode(mode: ScanMode): boolean {
  return mode === "current-folder" || mode === "scan-all";
}

function canExistingTaskSatisfy(existingMode: ScanMode, requestedMode: ScanMode): boolean {
  return existingMode === requestedMode || (isNormalScanMode(existingMode) && isNormalScanMode(requestedMode));
}
