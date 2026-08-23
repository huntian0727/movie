import { stat } from "node:fs/promises";
import crypto from "node:crypto";
import type {
  ScanFailure,
  ScanFailureBatchJob,
  ScanFailureBatchOperation,
  ScanFailureBatchSubmitRequest,
  ScanFailureReviewKind
} from "../../shared/videoTypes.js";
import { classifyScanFailureForCleanup } from "../../shared/scanFailureCleanup.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { CloudDriveMissingConfirmation } from "../clouddrive/mountedScanner.js";
import { cleanupScanFailures } from "./scanFailureActions.js";
import { isManagedPathWithin } from "./pathNormalization.js";

interface ScanFailureBatchDependencies {
  analyzeFailure(failureId: string): Promise<void>;
  confirmRemoteMissing(targetPath: string, isCancelled: () => boolean): Promise<CloudDriveMissingConfirmation>;
  confirmRemoteMissingBatch(targetPaths: readonly string[], isCancelled: () => boolean): Promise<Map<string, CloudDriveMissingConfirmation>>;
  assertPermanentDeleteAllowed(videoIds: string[]): void;
  onLibraryChanged(removedVideoIds: string[]): void;
}

interface MutableJob extends ScanFailureBatchJob {
  cancelRequested: boolean;
}

export class ScanFailureBatchService {
  private readonly jobs = new Map<string, MutableJob>();

  constructor(private readonly repo: VideoRepository, private readonly dependencies: ScanFailureBatchDependencies) {}

  submit(request: ScanFailureBatchSubmitRequest): ScanFailureBatchJob {
    const failureIds = this.resolveFailureIds(request);
    const now = new Date().toISOString();
    const job: MutableJob = {
      id: crypto.randomUUID(), operation: request.operation, status: "queued", totalCount: failureIds.length,
      processedCount: 0, successCount: 0, skippedCount: 0, failureCount: 0,
      currentPath: null, message: failureIds.length === 0 ? "当前筛选没有可处理项" : null,
      createdAt: now, completedAt: failureIds.length === 0 ? now : null, cancelRequested: false
    };
    if (failureIds.length === 0) job.status = "completed";
    this.jobs.set(job.id, job);
    if (failureIds.length > 0) void this.run(job, failureIds);
    return snapshot(job);
  }

  get(jobId: string): ScanFailureBatchJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Scan failure batch job not found");
    return snapshot(job);
  }

  cancel(jobId: string): ScanFailureBatchJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Scan failure batch job not found");
    if (job.status === "queued" || job.status === "running") {
      job.cancelRequested = true;
      job.status = "cancelling";
      job.message = "正在取消；当前文件处理结束后停止";
    }
    return snapshot(job);
  }

  private resolveFailureIds(request: ScanFailureBatchSubmitRequest): string[] {
    if (request.scope.mode === "selected") return [...new Set(request.scope.failureIds)].filter((id) => Boolean(this.repo.getScanFailure(id)));
    const { query } = request.scope;
    const folders = this.repo.listSourceFolders().filter((folder) => folder.enabled && (!query.sourceFolderId || folder.id === query.sourceFolderId));
    const failures = folders.flatMap((folder) => this.repo.listScanFailures(folder.id));
    return failures.filter((failure) => {
      if (query.kind !== "all" && reviewKind(this.repo, failure) !== query.kind) return false;
      if (query.cleanupCategory !== "all" && classifyScanFailureForCleanup(failure).category !== query.cleanupCategory) return false;
      const hasVideo = request.operation === "permanent-delete" && Boolean(this.repo.getVideoByPath(failure.objectPath));
      return isEligible(request.operation, failure, hasVideo);
    }).map((failure) => failure.id);
  }

  private async run(job: MutableJob, failureIds: string[]): Promise<void> {
    job.status = "running";
    if (job.operation === "remove-missing-record") {
      await this.removeMissingRecords(job, failureIds);
      return;
    }
    const removedVideoIds: string[] = [];
    for (const failureId of failureIds) {
      if (job.cancelRequested) break;
      const failure = this.repo.getScanFailure(failureId);
      job.currentPath = failure?.objectPath ?? null;
      try {
        if (!failure || failure.status === "resolved" || !isEligible(job.operation, failure, Boolean(this.repo.getVideoByPath(failure.objectPath)))) {
          job.skippedCount += 1;
        } else if (job.operation === "analyze-metadata") {
          await this.dependencies.analyzeFailure(failureId);
          const remaining = this.repo.getScanFailure(failureId);
          if (!remaining || remaining.status === "resolved") job.successCount += 1;
          else job.failureCount += 1;
        } else if (job.operation === "recheck-accessibility") {
          await this.recheckAccessibility(failure, () => job.cancelRequested);
          job.successCount += 1;
        } else {
          const action = job.operation;
          const videoId = this.repo.getVideoByPath(failure.objectPath)?.id ?? null;
          const result = await cleanupScanFailures(this.repo, [failureId], action, {
            confirmRemoteMissing: (targetPath) => this.dependencies.confirmRemoteMissing(targetPath, () => job.cancelRequested),
            assertPermanentDeleteAllowed: this.dependencies.assertPermanentDeleteAllowed
          });
          job.successCount += result.successCount;
          job.skippedCount += result.skippedCount;
          job.failureCount += result.failureCount;
          if (result.successCount > 0 && videoId) removedVideoIds.push(videoId);
        }
      } catch (error) {
        if (job.cancelRequested && getErrorCode(error) === "ABORT_ERR") break;
        job.failureCount += 1;
        job.message = error instanceof Error ? error.message : String(error);
      } finally {
        job.processedCount += 1;
      }
    }
    this.finish(job, removedVideoIds);
  }

  private async removeMissingRecords(job: MutableJob, failureIds: string[]): Promise<void> {
    const candidates: ScanFailure[] = [];
    const sourceFolders = new Map(this.repo.listSourceFolders().map((folder) => [folder.id, folder]));
    const failuresById = new Map(this.repo.getScanFailures(failureIds).map((failure) => [failure.id, failure]));
    for (const failureId of failureIds) {
      const failure = failuresById.get(failureId);
      const sourceFolder = failure ? sourceFolders.get(failure.sourceFolderId) : null;
      if (!failure || failure.status === "resolved" || !isEligible("remove-missing-record", failure, false)) {
        job.skippedCount += 1;
        job.processedCount += 1;
      } else if (!sourceFolder || !isManagedPathWithin(failure.objectPath, sourceFolder.path)) {
        job.failureCount += 1;
        job.processedCount += 1;
      } else {
        candidates.push(failure);
      }
    }

    if (job.cancelRequested || candidates.length === 0) {
      this.finish(job, []);
      return;
    }

    job.currentPath = candidates[0]?.objectPath ?? null;
    job.message = `正在按远端目录合并验证 ${candidates.length} 项；验证完成前不会清理记录`;
    let confirmations: Map<string, CloudDriveMissingConfirmation>;
    try {
      confirmations = await this.dependencies.confirmRemoteMissingBatch(
        candidates.map((failure) => failure.objectPath),
        () => job.cancelRequested
      );
    } catch (error) {
      if (!job.cancelRequested) {
        job.failureCount += candidates.length;
        job.processedCount += candidates.length;
        job.message = error instanceof Error ? error.message : String(error);
      }
      this.finish(job, []);
      return;
    }

    if (job.cancelRequested) {
      this.finish(job, []);
      return;
    }

    const confirmedMissingIds: string[] = [];
    for (const failure of candidates) {
      const confirmation = confirmations.get(failure.objectPath);
      if (confirmation === "missing") confirmedMissingIds.push(failure.id);
      else job.failureCount += 1;
    }

    const cleaned = this.repo.resolveConfirmedMissingScanFailures(confirmedMissingIds);
    job.successCount += cleaned.cleanedFailureIds.length;
    job.skippedCount += confirmedMissingIds.length - cleaned.cleanedFailureIds.length;
    job.processedCount += candidates.length;
    this.finish(job, cleaned.removedVideoIds);
  }

  private finish(job: MutableJob, removedVideoIds: string[]): void {
    job.currentPath = null;
    job.completedAt = new Date().toISOString();
    if (job.cancelRequested) {
      job.status = "cancelled";
      job.message = `已取消，已处理 ${job.processedCount} / ${job.totalCount} 项；未完成验证的记录没有清理`;
    } else {
      job.status = job.failureCount > 0 ? "completed-with-errors" : "completed";
      job.message = `已处理 ${job.processedCount} 项：成功 ${job.successCount}，跳过 ${job.skippedCount}，失败 ${job.failureCount}`;
    }
    this.dependencies.onLibraryChanged(removedVideoIds);
  }

  private async recheckAccessibility(failure: ScanFailure, isCancelled: () => boolean): Promise<void> {
    if (failure.objectType !== "file") throw new Error("可访问性复查目前仅支持文件");
    const cloudState = await this.dependencies.confirmRemoteMissing(failure.objectPath, isCancelled);
    let accessible = cloudState === "present";
    if (cloudState === "not-cloud-drive") {
      const fileStat = await stat(failure.objectPath);
      accessible = fileStat.isFile();
    }
    this.repo.recordScanFailure({
      sourceFolderId: failure.sourceFolderId,
      scanTaskId: failure.scanTaskId,
      objectType: "file",
      objectPath: failure.objectPath,
      failureStage: failure.failureStage,
      errorCode: accessible ? "ACCESSIBLE" : "ENOENT",
      errorSummary: accessible ? "文件可访问；尚未执行元数据分析" : "ENOENT: forced CloudDrive refresh confirmed the remote file is absent",
      incrementRetry: true
    });
  }
}

function reviewKind(repo: VideoRepository, failure: ScanFailure): ScanFailureReviewKind {
  if (failure.objectType === "directory") return "directory";
  return repo.getVideoByPath(failure.objectPath) ? "video" : "unindexed-file";
}

function isEligible(operation: ScanFailureBatchOperation, failure: ScanFailure, hasVideo: boolean): boolean {
  if (failure.objectType !== "file") return false;
  const category = classifyScanFailureForCleanup(failure).category;
  if (operation === "permanent-delete") return hasVideo && category === "confirmed-corrupt";
  if (operation === "remove-missing-record") return category === "missing";
  return true;
}

function snapshot(job: MutableJob): ScanFailureBatchJob {
  const { cancelRequested: _cancelRequested, ...value } = job;
  return { ...value };
}

function getErrorCode(error: unknown): string | null {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : null;
}
