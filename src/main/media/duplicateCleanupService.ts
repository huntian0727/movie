import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import { link, lstat, mkdtemp, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import type {
  DuplicateCleanupAccepted, DuplicateCleanupConfirmRequest, DuplicateCleanupJob,
  DuplicateCleanupFilteredSubmitRequest, DuplicateCleanupSubmitRequest, DuplicateVerificationStatus
} from "../../shared/videoTypes.js";
import type { DuplicateCleanupRepository, DuplicateCleanupWorkItem } from "../db/duplicateCleanupRepository.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "../files/pathNormalization.js";
import { permanentlyDeleteFile } from "../files/fileOperations.js";
import { assertManagedOrdinaryFile } from "../files/safePermanentDelete.js";
import type { MediaCacheManager } from "./cacheManager.js";
import type { MetadataQueue } from "./metadataQueue.js";
import type { DomainEventBus } from "../playerWindow.js";
import { deleteCloudDriveFiles, getCloudDriveConnectionBinding } from "../clouddrive/mountedScanner.js";
import type { CloudDriveFileOperationResult } from "../clouddrive/grpcClient.js";

type Inspection =
  | { status: "current"; stats: Stats }
  | { status: "missing"; message: string }
  | { status: "stale"; stats: Stats; message: string }
  | { status: "unreadable"; message: string };

interface DuplicateCleanupServiceOptions {
  getCloudConnectionBinding?: () => string | null;
  databasePath?: string;
  deleteFile?: (filePath: string) => Promise<void>;
  /** Legacy test seam only. Duplicate identification intentionally never reads or hashes video content. */
  hashFile?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  deleteCloudFiles?: (
    remotePaths: readonly string[],
    permanently?: boolean,
    isCancelled?: () => boolean
  ) => Promise<CloudDriveFileOperationResult>;
}

interface FileIdentityEvidence { stable: string; version: string }
interface MetadataAttempt { status: "matched" | "different" | "unverifiable"; identity: string | null; error: string | null }

export class DuplicateCleanupService {
  private readonly pendingJobs: string[] = [];
  private pumping = false;
  private stopped = false;
  private currentJobId: string | null = null;
  private currentVerificationAbort: AbortController | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deleteFile: (filePath: string) => Promise<void>;
  private readonly renameFile: (source: string, destination: string) => Promise<void>;
  private readonly deleteCloudFiles: NonNullable<DuplicateCleanupServiceOptions["deleteCloudFiles"]>;
  private readonly getCloudConnectionBinding: () => string | null;
  private readonly recoveryPromise: Promise<void>;
  private preparationTail: Promise<unknown> = Promise.resolve();
  private readonly preparationWorkers = new Set<Worker>();
  private readonly preparationDatabasePath?: string;

  constructor(
    private readonly jobs: DuplicateCleanupRepository,
    private readonly videos: VideoRepository,
    private readonly metadataQueue: MetadataQueue,
    private readonly cacheManager: MediaCacheManager,
    private readonly domainEvents: DomainEventBus,
    options: DuplicateCleanupServiceOptions = {}
  ) {
    this.preparationDatabasePath = options.databasePath;
    this.deleteFile = options.deleteFile ?? permanentlyDeleteFile;
    this.renameFile = options.renameFile ?? rename;
    this.deleteCloudFiles = options.deleteCloudFiles ?? ((remotePaths, permanently, isCancelled) =>
      deleteCloudDriveFiles(remotePaths, permanently, process.env, isCancelled));
    this.getCloudConnectionBinding = options.getCloudConnectionBinding ?? (options.deleteCloudFiles
      ? () => crypto.createHash("sha256").update("injected-cloud-provider").digest("hex")
      : getCloudDriveConnectionBinding);
    this.jobs.interruptActiveJobs();
    this.recoveryPromise = this.recoverStagedFiles();
    for (const jobId of this.jobs.recoverFastJobs()) this.enqueue(jobId);
  }

  preview(request: DuplicateCleanupSubmitRequest) { return this.jobs.preview(request); }

  submit(request: DuplicateCleanupSubmitRequest): DuplicateCleanupAccepted {
    // Public-release default: old autoDeleteAfterVerification=true was overloaded
    // to mean unverified CloudDrive API deletion. Reject even on replay/idempotency.
    if (request.autoDeleteAfterVerification === true) {
      throw new Error("旧自动清理参数已禁用。请重新创建大小/时长核对任务，核对完成后人工确认。");
    }
    const existing = this.jobs.findAcceptedRequest(request.requestId);
    if (existing) {
      if (this.jobs.getJob(existing.jobId).workflowVersion === 3) {
        throw new Error("未经大小/时长核对的旧快速永久删除任务已暂停，请取消并清除后重新核对。");
      }
      return existing;
    }
    const accepted = this.jobs.submit(request);
    if (accepted.status === "queued") this.enqueue(accepted.jobId);
    return accepted;
  }

  async submitFiltered(_request: DuplicateCleanupFilteredSubmitRequest): Promise<DuplicateCleanupAccepted> {
    // A metadata-only filtered plan cannot prove that any two files have equal content.
    // Explicit opt-in is intentionally unavailable until a separately reviewed protocol
    // has a strong per-task confirmation and audited deletion authorization.
    throw new Error("全部筛选结果的快速永久删除已默认关闭；请在当前页按大小与时长核对候选，并在后台任务中二次确认。");
  }

  private async disabledLegacyFilteredPreparation(request: DuplicateCleanupFilteredSubmitRequest): Promise<DuplicateCleanupAccepted> {
    if (this.stopped) throw new Error("Duplicate cleanup service has stopped");
    if (this.preparationDatabasePath) {
      const snapshot = structuredClone(request);
      const pending = this.preparationTail.catch(() => undefined).then(async () => {
        if (this.stopped) throw new Error("Duplicate cleanup service has stopped");
        const existing = this.jobs.findAcceptedRequest(snapshot.requestId);
        if (existing) return existing;
        const temporary = await mkdtemp(path.join(os.tmpdir(), "lamian-cleanup-plan-"));
        try {
          const stagePath = path.join(temporary, "plan.sqlite");
          await this.prepareFilteredInWorker(snapshot, stagePath);
          if (this.stopped) throw new Error("Duplicate cleanup service has stopped");
          const accepted = this.jobs.submitFastStaged({
            requestId: snapshot.requestId,
            sourceView: snapshot.sourceView ?? "duplicates-filtered"
          }, stagePath);
          this.bindNewFastJob(accepted);
          if (accepted.status === "queued") this.enqueue(accepted.jobId);
          return accepted;
        } finally { await rm(temporary, { recursive: true, force: true }); }
      });
      this.preparationTail = pending;
      return pending;
    }
    // Isolated in-memory test repositories have no path usable by a worker.
    const existing = this.jobs.findAcceptedRequest(request.requestId);
    if (existing) return existing;
    const entries = this.videos.buildDuplicateResolveEntriesForQuery(request.query);
    if (entries.length === 0) {
      throw new Error("当前筛选结果中没有可通过 CloudDrive API 删除的候选项");
    }
    const accepted = this.jobs.submitFastPrepared({
      requestId: request.requestId,
      sourceView: request.sourceView ?? "duplicates-filtered"
    }, entries);
    this.bindNewFastJob(accepted);
    if (accepted.status === "queued") this.enqueue(accepted.jobId);
    return accepted;
  }

  confirm(request: DuplicateCleanupConfirmRequest): DuplicateCleanupJob {
    const job = this.jobs.authorizeDeletion(request);
    this.enqueue(job.id);
    this.publish(job.id);
    return job;
  }

  cancel(jobId: string): DuplicateCleanupJob {
    const before = this.jobs.getJob(jobId);
    const job = this.jobs.requestCancel(jobId);
    if (job.status === "cancelling" && this.currentJobId === jobId && before.phase === "verification") {
      this.currentVerificationAbort?.abort();
    } else if (job.status === "cancelling" && this.currentJobId !== jobId) {
      const finished = this.jobs.finishCancelled(jobId);
      this.publish(jobId, true);
      return finished;
    }
    this.publish(jobId);
    return job;
  }

  resume(jobId: string): DuplicateCleanupJob {
    if (this.jobs.getJob(jobId).workflowVersion === 3) {
      throw new Error("旧快速清理任务不能继续；请取消并清除后重新核对大小与时长。");
    }
    this.assertFastConnection(jobId);
    const job = this.jobs.resume(jobId);
    this.enqueue(jobId);
    this.publish(jobId);
    return job;
  }

  retry(jobId: string): DuplicateCleanupJob {
    if (this.jobs.getJob(jobId).workflowVersion === 3) {
      throw new Error("旧快速清理任务不能重试；请清除后重新核对大小与时长。");
    }
    this.assertFastConnection(jobId);
    const job = this.jobs.retry(jobId);
    this.enqueue(jobId);
    this.publish(jobId);
    return job;
  }

  assertVideosAvailable(videoIds: string[]): void { this.jobs.assertVideosAvailable(videoIds); }

  private bindNewFastJob(accepted: DuplicateCleanupAccepted): void {
    if (this.jobs.getJob(accepted.jobId).workflowVersion !== 3 || this.jobs.getCloudDriveConnectionBinding(accepted.jobId)) return;
    const binding = this.getCloudConnectionBinding();
    if (!binding) {
      this.jobs.requestCancel(accepted.jobId);
      this.jobs.finishCancelled(accepted.jobId);
      throw new Error("CloudDrive 连接不可用，未执行删除；请清除任务并重新创建。");
    }
    this.jobs.bindCloudDriveConnection(accepted.jobId, binding);
  }

  private assertFastConnection(jobId: string): void {
    if (this.jobs.getJob(jobId).workflowVersion !== 3) return;
    const current = this.getCloudConnectionBinding();
    if (!current || current !== this.jobs.getCloudDriveConnectionBinding(jobId)) {
      throw new Error("CloudDrive 连接或账号与删除计划不一致；请清除旧任务并重新审核候选。未执行删除。");
    }
  }

  assertSourceFolderVideosAvailable(sourceFolderId: string): void {
    this.jobs.assertSourceFolderVideosAvailable(sourceFolderId);
  }

  stop(): void {
    this.stopped = true;
    for (const worker of this.preparationWorkers) void worker.terminate();
    this.currentVerificationAbort?.abort();
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.jobs.interruptActiveJobs();
  }

  private prepareFilteredInWorker(request: DuplicateCleanupFilteredSubmitRequest, stagePath: string): Promise<void> {
    if (this.stopped || !this.preparationDatabasePath) {
      return Promise.reject(new Error("Duplicate cleanup service has stopped"));
    }
    const worker = new Worker(new URL("./duplicateCleanupPreparationWorker.js", import.meta.url), {
      workerData: { databasePath: this.preparationDatabasePath, request, stagePath }
    });
    this.preparationWorkers.add(worker);
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (result: { ok: true } | { ok: false; error: string }) => {
        if (settled) return;
        settled = true;
        if (result.ok) resolve();
        else reject(new Error(result.error));
      };
      worker.once("message", settle);
      worker.once("error", (error) => settle({ ok: false, error: error.message }));
      worker.once("exit", (code) => {
        this.preparationWorkers.delete(worker);
        if (!settled) settle({ ok: false, error: `Duplicate cleanup preparation worker exited with code ${code}` });
      });
    });
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
      await this.recoveryPromise;
      while (!this.stopped) {
        const jobId = this.pendingJobs.shift();
        if (!jobId) break;
        // Belt-and-suspenders: even a stale queued task must never start the
        // metadata-only deletion worker after the public-safe default is enabled.
        if (this.jobs.getJob(jobId).workflowVersion === 3) continue;
        if (!this.jobs.start(jobId)) continue;
        this.currentJobId = jobId;
        this.publish(jobId);
        const job = this.jobs.getJob(jobId);
        if (job.workflowVersion === 3) await this.runFastDeletion(jobId);
        else if (job.phase === "verification") await this.runVerification(jobId, job.verificationRevision!);
        else if (job.phase === "deletion") await this.runDeletion(jobId);
        this.currentJobId = null;
      }
    } finally {
      this.currentVerificationAbort = null;
      this.currentJobId = null;
      this.pumping = false;
    }
  }

  private async runVerification(jobId: string, revision: string): Promise<void> {
    const controller = new AbortController();
    this.currentVerificationAbort = controller;
    const items = this.jobs.listVerificationItems(jobId);
    const byGroup = groupItems(items);
    try {
      for (const [groupKey, group] of byGroup) {
        if (this.stopped || this.jobs.isCancelling(jobId)) throw abortError();
        this.jobs.markVerificationGroupRunning(jobId, groupKey, revision);
        const result = await this.verifyGroup(group, controller.signal);
        if (this.stopped || this.jobs.isCancelling(jobId)) throw abortError();
        this.jobs.recordVerificationGroup(jobId, groupKey, revision, result.status,
          result.keepIdentity, result.deleteIdentities, result.error);
        this.publish(jobId);
      }
      if (!this.stopped) {
        this.jobs.completeVerification(jobId);
        this.publish(jobId, true);
      }
    } catch (error: unknown) {
      if (controller.signal.aborted || this.stopped || this.jobs.isCancelling(jobId) || isAbortError(error)) {
        if (!this.stopped) this.jobs.finishCancelled(jobId);
        this.publish(jobId, true);
        return;
      }
      // An unexpected verifier failure is non-destructive and invalidates every remaining authorization.
      this.jobs.requestCancel(jobId);
      this.jobs.finishCancelled(jobId);
      this.publish(jobId, true);
    } finally {
      if (this.currentVerificationAbort === controller) this.currentVerificationAbort = null;
    }
  }

  private async verifyGroup(group: DuplicateCleanupWorkItem[], signal: AbortSignal): Promise<{
    status: Extract<DuplicateVerificationStatus, "verified-identical" | "content-different" | "unverifiable">;
    keepIdentity: string | null; deleteIdentities: Map<string, string>; error: string | null;
  }> {
    const keep = group[0];
    const expected = parseDuplicateIdentity(keep.group_key);
    const deleteIdentities = new Map<string, string>();
    if (!expected) {
      return { status: "unverifiable", keepIdentity: null, deleteIdentities,
        error: "重复候选的大小/时长记录无效，请重新扫描候选。" };
    }

    const keepAttempt = await this.verifyExpectedMetadata(
      keep.keep_video_id, keep.keep_path, keep.expected_keep_size_bytes, keep.expected_keep_modified_at, expected
    );
    if (keepAttempt.status !== "matched") {
      return { status: keepAttempt.status === "different" ? "content-different" : "unverifiable",
        keepIdentity: keepAttempt.identity, deleteIdentities, error: keepAttempt.error };
    }

    const errors: string[] = [];
    const keepIdentity = keepAttempt.identity;
    let hasDifferentMetadata = false;
    for (const item of group) {
      if (signal.aborted) throw abortError();
      const attempt = await this.verifyExpectedMetadata(
        item.delete_video_id, item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at, expected
      );
      if (attempt.identity) deleteIdentities.set(item.id, attempt.identity);
      if (attempt.status === "different") hasDifferentMetadata = true;
      else if (attempt.status === "unverifiable") errors.push(`${item.filename}: ${attempt.error ?? "无法核对文件元数据。"}`);
    }
    if (hasDifferentMetadata) {
      return { status: "content-different", keepIdentity, deleteIdentities,
        error: "一个或多个候选文件的大小或时长已变化，不再符合重复条件。" };
    }
    if (errors.length > 0 || deleteIdentities.size !== group.length) {
      return { status: "unverifiable", keepIdentity, deleteIdentities,
        error: errors.join("; ") || "无法完成文件大小、时长和文件身份核对。" };
    }
    return { status: "verified-identical", keepIdentity, deleteIdentities, error: null };
  }

  private async verifyExpectedMetadata(
    videoId: string, filePath: string, expectedSize: number, expectedModifiedAt: string,
    expected: { sizeBytes: number; durationSeconds: number }
  ): Promise<MetadataAttempt> {
    let video;
    try { video = this.videos.getVideo(videoId); }
    catch (error: unknown) {
      return { status: "unverifiable", identity: null, error: `无法读取视频元数据：${toMessage(error)}` };
    }
    if (video.isMissing || video.metadataStatus !== "ready" || video.durationMs === null || video.durationMs <= 0) {
      return { status: "unverifiable", identity: null, error: "视频缺失或时长元数据尚未就绪。" };
    }
    const durationSeconds = Math.floor((video.durationMs + 500) / 1000);
    if (video.sizeBytes !== expected.sizeBytes || durationSeconds !== expected.durationSeconds) {
      return { status: "different", identity: null, error: "文件大小或时长与重复候选不一致。" };
    }
    if (video.path !== filePath || video.sizeBytes !== expectedSize || video.modifiedAt !== expectedModifiedAt) {
      return { status: "unverifiable", identity: null, error: "文件路径、大小或修改时间已变化，请重新扫描。" };
    }

    const before = await this.inspect(filePath, expectedSize, expectedModifiedAt);
    if (before.status !== "current") {
      await this.refreshChangedVideo(videoId, filePath, expectedSize, expectedModifiedAt, before);
      return { status: "unverifiable", identity: null, error: before.message };
    }
    try {
      const identityBefore = await this.readFileIdentity(filePath);
      const after = await this.inspect(filePath, expectedSize, expectedModifiedAt);
      if (after.status !== "current") {
        await this.refreshChangedVideo(videoId, filePath, expectedSize, expectedModifiedAt, after);
        return { status: "unverifiable", identity: null, error: `核对期间文件状态发生变化：${after.message}` };
      }
      const identityAfter = await this.readFileIdentity(filePath);
      if (identityBefore.version !== identityAfter.version) {
        return { status: "unverifiable", identity: null, error: "文件身份或版本在核对期间发生变化。" };
      }
      return { status: "matched", identity: JSON.stringify(identityAfter), error: null };
    } catch (error: unknown) {
      return { status: "unverifiable", identity: null, error: toMessage(error) };
    }
  }

  private async runDeletion(jobId: string): Promise<void> {
    const items = this.jobs.listDeletionWorkItems(jobId);
    for (const item of items) {
      if (this.stopped || this.jobs.isCancelling(jobId)) break;
      await this.processAuthorizedDelete(jobId, item);
      this.jobs.progress(jobId);
      this.publish(jobId);
    }
    if (!this.stopped) {
      const finished = this.jobs.finishDeletion(jobId);
      if (finished.successItems > 0) this.cacheManager.scheduleMaintenance(true);
      this.publish(jobId, true);
    }
  }

  private async runFastDeletion(jobId: string): Promise<void> {
    const items = this.jobs.listFastDeletionWorkItems(jobId);
    const batches = Array.from({ length: Math.ceil(items.length / 100) }, (_, index) => items.slice(index * 100, index * 100 + 100));
    let nextBatch = 0;
    const worker = async () => {
      while (!this.stopped && !this.jobs.isCancelling(jobId)) {
        const batchIndex = nextBatch++;
        if (batchIndex >= batches.length) return;
        await this.processFastBatch(jobId, batches[batchIndex]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, batches.length) }, () => worker()));
    if (!this.stopped) {
      const finished = this.jobs.finishDeletion(jobId);
      if (finished.successItems > 0) this.cacheManager.scheduleMaintenance(true);
      this.publish(jobId, true);
    }
  }

  private async processFastBatch(jobId: string, batch: DuplicateCleanupWorkItem[]): Promise<void> {
      const currentItems: DuplicateCleanupWorkItem[] = [];
      const alreadyMissingItemIds: string[] = [];
      const changedIdentityItemIds: string[] = [];
      for (const item of batch) {
        let current;
        try {
          current = this.videos.getVideo(item.delete_video_id);
        } catch {
          alreadyMissingItemIds.push(item.id);
          continue;
        }
        if (!item.delete_provider_file_id || !item.delete_provider_path ||
            current.providerFileId !== item.delete_provider_file_id || current.providerPath !== item.delete_provider_path ||
            current.sizeBytes !== item.expected_delete_size_bytes || current.modifiedAt !== item.expected_delete_modified_at) {
          changedIdentityItemIds.push(item.id);
          continue;
        }
        currentItems.push(item);
      }
      this.jobs.updateItems(alreadyMissingItemIds, "deleted", "already-missing", "The indexed target no longer exists.");
      this.jobs.updateItems(changedIdentityItemIds, "skipped", "provider-identity-changed",
        "The cached CloudDrive identity or file version changed after the deletion plan was created.");
      const claimed = new Set(this.jobs.claimFastDeletionItems(jobId, currentItems.map((item) => item.id)));
      await this.deleteFastBatch(jobId, currentItems.filter((item) => claimed.has(item.id)));
      this.jobs.progress(jobId);
      this.publish(jobId);
  }

  private async deleteFastBatch(jobId: string, items: DuplicateCleanupWorkItem[]): Promise<void> {
    if (items.length === 0) return;
    const isCancelled = () => this.stopped || this.jobs.isCancelling(jobId);
    if (isCancelled()) {
      this.jobs.updateItems(items.map(item => item.id), "cancelled", "delete-stop-requested", "Remaining API deletions were stopped.");
      return;
    }
    const binding = this.getCloudConnectionBinding();
    if (!binding || binding !== this.jobs.getCloudDriveConnectionBinding(jobId)) {
      this.jobs.updateItems(items.map(item => item.id), "skipped", "cloud-connection-changed", "CloudDrive connection changed; recreate the deletion plan.");
      return;
    }
    let result: CloudDriveFileOperationResult;
    try {
      result = await this.deleteCloudFiles(items.map((item) => item.delete_provider_path!), true, isCancelled);
    } catch (error: unknown) {
      result = { success: false, errorMessage: toMessage(error), resultFilePaths: [] };
    }
    if (result.success) {
      const videoIds = items.map((item) => item.delete_video_id);
      this.videos.removeVideos(videoIds);
      this.jobs.updateItems(items.map((item) => item.id), "deleted", result.permanentlyDeleted === false
        ? "moved-to-cloud-recycle-bin"
        : "deleted-via-clouddrive-api", result.permanentlyDeleted === false
        ? "CloudDrive does not expose permanent deletion; the file was moved to its recycle bin and freed space is not counted."
        : null);
      this.domainEvents.publish({ type: "video:removed", videoIds });
      return;
    }
    if (items.length > 1) {
      const middle = Math.ceil(items.length / 2);
      await this.deleteFastBatch(jobId, items.slice(0, middle));
      await this.deleteFastBatch(jobId, items.slice(middle));
      return;
    }
    const item = items[0]!;
    if (/not[\s_-]*found|不存在|ENOENT/i.test(result.errorMessage)) {
      this.videos.removeVideo(item.delete_video_id);
      this.jobs.updateItem(item.id, "deleted", "already-missing", result.errorMessage || null);
      this.domainEvents.publish({ type: "video:removed", videoIds: [item.delete_video_id] });
      return;
    }
    this.jobs.updateItem(item.id, "failed", "clouddrive-api-delete-failed",
      result.errorMessage || "CloudDrive API did not delete the remote file.");
  }

  private async processAuthorizedDelete(jobId: string, item: DuplicateCleanupWorkItem): Promise<void> {
    const keepCheck = await this.revalidateAuthorizedFile(item.keep_video_id, item.keep_path, item.expected_keep_size_bytes,
      item.expected_keep_modified_at, item.group_key, item.keep_file_identity);
    if (!keepCheck.ok) {
      this.jobs.updateItem(item.id, "skipped", "final-keep-integrity-changed", keepCheck.message);
      return;
    }
    const deleteCheck = await this.revalidateAuthorizedFile(item.delete_video_id, item.delete_path, item.expected_delete_size_bytes,
      item.expected_delete_modified_at, item.group_key, item.delete_file_identity);
    if (!deleteCheck.ok) {
      this.jobs.updateItem(item.id, "skipped", "final-delete-integrity-changed", deleteCheck.message);
      return;
    }

    // Preserve the no-overwrite isolation step and explicit second confirmation.
    // Duplicate identity itself is determined by the agreed size + duration rule;
    // filesystem identity/version checks only guard against a path swap or changed file.
    const stagedPath = path.join(path.dirname(item.delete_path), `.${path.basename(item.delete_path)}.movie-delete-${crypto.randomUUID()}`);
    if (!this.jobs.prepareIsolation(jobId, item.id, stagedPath)) {
      this.jobs.updateItem(item.id, "failed", "authorization-rejected", "重复候选授权在隔离文件前已失效。");
      return;
    }
    try {
      await this.renameFile(item.delete_path, stagedPath);
    } catch (error: unknown) {
      this.jobs.clearIsolation(item.id);
      this.jobs.updateItem(item.id, "failed", "isolation-failed", `无法安全隔离待删除文件：${toMessage(error)}`);
      return;
    }

    const isolatedCheck = await this.verifyIsolatedFileMetadata(stagedPath, item.expected_delete_size_bytes,
      item.expected_delete_modified_at, deleteCheck.identity?.stable ?? null);
    if (!isolatedCheck.ok) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "skipped" : "failed", "isolated-target-mismatch",
        `${isolatedCheck.message}${restored ? "" : ` 隔离文件保留在 ${stagedPath}；自动恢复失败，需要人工恢复。`}`);
      return;
    }
    if (this.stopped || this.jobs.isCancelling(jobId)) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "cancelled" : "failed", "delete-stop-requested",
        `已停止剩余删除。${restored ? "" : ` 隔离文件保留在 ${stagedPath}；自动恢复失败，需要人工恢复。`}`);
      return;
    }

    const finalKeep = await this.revalidateAuthorizedFile(item.keep_video_id, item.keep_path, item.expected_keep_size_bytes,
      item.expected_keep_modified_at, item.group_key, item.keep_file_identity);
    if (!finalKeep.ok) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "skipped" : "failed", "final-keep-integrity-changed",
        `${finalKeep.message}${restored ? "" : ` 隔离文件保留在 ${stagedPath}；自动恢复失败，需要人工恢复。`}`);
      return;
    }
    if (!this.jobs.claimDeletionItem(jobId, item.id)) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, "failed", "authorization-rejected",
        `重复候选授权已失效。${restored ? "" : ` 隔离文件保留在 ${stagedPath}；自动恢复失败，需要人工恢复。`}`);
      return;
    }
    try {
      const finalIsolatedIdentity = await this.readFileIdentity(stagedPath);
      if (!isolatedCheck.identity || finalIsolatedIdentity.version !== isolatedCheck.identity.version) {
        throw Object.assign(new Error("隔离后的文件状态发生变化，已停止删除并保留文件。"),
          { code: "final-isolated-target-changed" });
      }
      await this.deleteFile(stagedPath);
      this.jobs.clearIsolation(item.id);
      this.videos.removeVideo(item.delete_video_id);
      this.jobs.updateItem(item.id, "deleted", "deleted", null);
      this.domainEvents.publish({ type: "video:removed", videoIds: [item.delete_video_id] });
    } catch (error: unknown) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, "failed", getErrorCode(error),
        `${toMessage(error)}${restored ? "" : ` 隔离文件可能仍保留在 ${stagedPath}；自动恢复失败，需要人工恢复。`}`);
    }
  }

  private async revalidateAuthorizedFile(
    videoId: string, filePath: string, expectedSize: number, expectedModifiedAt: string,
    groupKey: string, persistedIdentity: string | null
  ): Promise<{ ok: boolean; message: string; identity: FileIdentityEvidence | null }> {
    const expectedGroup = parseDuplicateIdentity(groupKey);
    const expectedIdentity = persistedIdentity ? parseIdentity(persistedIdentity) : null;
    if (!expectedGroup || !expectedIdentity) {
      return { ok: false, message: "缺少有效的大小/时长核对记录或文件身份记录。", identity: null };
    }
    try {
      const video = this.videos.getVideo(videoId);
      if (video.isMissing || video.metadataStatus !== "ready" || video.durationMs === null ||
          video.sizeBytes !== expectedGroup.sizeBytes || video.sizeBytes !== expectedSize ||
          Math.floor((video.durationMs + 500) / 1000) !== expectedGroup.durationSeconds ||
          video.path !== filePath || video.modifiedAt !== expectedModifiedAt) {
        return { ok: false, message: "文件大小、时长、路径或修改时间已变化，已停止删除。", identity: null };
      }
      const beforeInspection = await this.inspect(filePath, expectedSize, expectedModifiedAt);
      if (beforeInspection.status !== "current") {
        return { ok: false, message: beforeInspection.message, identity: null };
      }
      const before = await this.readFileIdentity(filePath);
      const afterInspection = await this.inspect(filePath, expectedSize, expectedModifiedAt);
      if (afterInspection.status !== "current") {
        return { ok: false, message: afterInspection.message, identity: null };
      }
      const after = await this.readFileIdentity(filePath);
      if (before.version !== after.version || after.version !== expectedIdentity.version) {
        return { ok: false, message: "文件身份或版本在核对后发生变化，已停止删除。", identity: after };
      }
      return { ok: true, message: "", identity: after };
    } catch (error: unknown) {
      return { ok: false, message: `无法核对文件大小、时长或身份：${toMessage(error)}`, identity: null };
    }
  }

  private async verifyIsolatedFileMetadata(
    filePath: string, expectedSize: number, expectedModifiedAt: string, expectedStableIdentity: string | null
  ): Promise<{ ok: boolean; message: string; identity: FileIdentityEvidence | null }> {
    if (!expectedStableIdentity) return { ok: false, message: "隔离目标缺少有效的文件身份记录。", identity: null };
    try {
      const before = await this.readFileIdentity(filePath);
      const info = await stat(filePath);
      const after = await this.readFileIdentity(filePath);
      if (!info.isFile() || info.size !== expectedSize || info.mtime.toISOString() !== expectedModifiedAt ||
          before.stable !== expectedStableIdentity || after.stable !== expectedStableIdentity || before.version !== after.version) {
        return { ok: false, message: "隔离后的文件大小、修改时间或身份不符合已核对记录。", identity: null };
      }
      return { ok: true, message: "", identity: after };
    } catch (error: unknown) {
      return { ok: false, message: `无法核对隔离文件：${toMessage(error)}`, identity: null };
    }
  }

  private async restoreStagedFile(itemId: string, stagedPath: string, originalPath: string): Promise<boolean> {
    // Recovery is not deletion authorization. Require the recorded object and keep
    // every unexpected object intact; an atomic hard link can never replace a file
    // created at the original name while recovery is in progress.
    const item = this.jobs.listStagedItems().find(candidate => candidate.id === itemId);
    if (!item || item.staged_delete_path !== stagedPath || item.delete_path !== originalPath
        || path.resolve(stagedPath) === path.resolve(originalPath)
        || path.resolve(path.dirname(stagedPath)) !== path.resolve(path.dirname(originalPath))) return false;
    try {
      await this.assertRecoveryObject(stagedPath, item);
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") return false;
      try {
        await this.assertRecoveryObject(originalPath, item);
        this.jobs.clearIsolation(itemId);
        return true;
      } catch {
        return false;
      }
    }
    try {
      await link(stagedPath, originalPath);
      // Link success does not authorize removing a swapped isolated path. Recheck
      // both names against persisted evidence before removing the staging name.
      await this.assertRecoveryObject(stagedPath, item);
      await this.assertRecoveryObject(originalPath, item);
      await unlink(stagedPath);
      this.jobs.clearIsolation(itemId);
      return true;
    } catch {
      return false;
    }
  }

  private async assertRecoveryObject(filePath: string, item: DuplicateCleanupWorkItem): Promise<void> {
    const expected = item.delete_file_identity ? parseIdentity(item.delete_file_identity) : null;
    if (!expected) throw new Error("Persisted isolated-file identity is missing or invalid.");
    const actual = await this.readFileIdentity(filePath);
    const info = await stat(filePath);
    if (actual.stable !== expected.stable || info.size !== item.expected_delete_size_bytes
        || info.mtime.toISOString() !== item.expected_delete_modified_at) {
      throw new Error("Recorded isolated-file identity or version changed; manual recovery is required.");
    }
  }

  private async recoverStagedFiles(): Promise<void> {
    for (const item of this.jobs.listStagedItems()) {
      const stagedPath = item.staged_delete_path!;
      if (await this.restoreStagedFile(item.id, stagedPath, item.delete_path)) continue;
      const originalExists = await this.pathExists(item.delete_path);
      const reason = originalExists
        ? `Original path is occupied; no file was overwritten. Isolated media or its identity requires manual recovery: ${stagedPath}.`
        : `Automatic no-overwrite recovery could not safely restore the recorded object (including unsupported hard links). Isolated media is retained for manual recovery: ${stagedPath}.`;
      this.jobs.recordIsolationRecoveryFailure(item.id, reason);
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath);
      return true;
    } catch (error: unknown) {
      if (getErrorCode(error) === "ENOENT") return false;
      return true;
    }
  }

  private async readFileIdentity(filePath: string): Promise<FileIdentityEvidence> {
    const source = this.videos.listSourceFolders().find(folder => folder.enabled && isManagedPathWithin(filePath, folder.path));
    if (!source) throw new Error("File is outside enabled managed folders.");
    await assertManagedOrdinaryFile(filePath, source.path);
    const stats = await stat(filePath, { bigint: true });
    if (!stats.isFile()) throw new Error("Path is not a regular file.");
    const stable = [stats.dev, stats.ino, stats.birthtimeNs].map(String).join(":");
    return { stable, version: [stable, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":") };
  }

  private async inspect(filePath: string, expectedSize: number, expectedModifiedAt: string): Promise<Inspection> {
    if (!this.isManaged(filePath)) return { status: "unreadable", message: "File is outside enabled managed folders." };
    try {
      const source = this.videos.listSourceFolders().find(folder => folder.enabled && isManagedPathWithin(filePath, folder.path));
      if (!source) return { status: "unreadable", message: "File is outside enabled managed folders." };
      const stats = await assertManagedOrdinaryFile(filePath, source.path);
      if (!stats.isFile()) return { status: "unreadable", message: "Path is not a regular file." };
      if (stats.size !== expectedSize || stats.mtime.toISOString() !== expectedModifiedAt) {
        return { status: "stale", stats, message: "File size or modification time changed." };
      }
      return { status: "current", stats };
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") return { status: "unreadable", message: toMessage(error) };
      try {
        await readdir(path.dirname(filePath));
        return { status: "missing", message: "File no longer exists." };
      } catch (parentError: unknown) {
        return { status: "unreadable", message: `Parent directory is unreadable: ${toMessage(parentError)}` };
      }
    }
  }

  private async refreshChangedVideo(videoId: string, filePath: string, size: number, modifiedAt: string, inspection: Exclude<Inspection, { status: "current" }>): Promise<void> {
    if (inspection.status === "missing") this.videos.markMissingIfVersion(videoId, filePath, size, modifiedAt);
    else if (inspection.status === "stale") {
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

function groupItems(items: DuplicateCleanupWorkItem[]): Map<string, DuplicateCleanupWorkItem[]> {
  const groups = new Map<string, DuplicateCleanupWorkItem[]>();
  for (const item of items) groups.set(item.group_key, [...(groups.get(item.group_key) ?? []), item]);
  return groups;
}

function abortError(): Error {
  const error = new Error("Verification cancelled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function parseDuplicateIdentity(groupKey: string): { sizeBytes: number; durationSeconds: number } | null {
  const match = /^size-duration:(\d+):(\d+)$/.exec(groupKey);
  if (!match) return null;
  const sizeBytes = Number(match[1]);
  const durationMs = Number(match[2]);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
  return { sizeBytes, durationSeconds: Math.floor((durationMs + 500) / 1000) };
}
function parseIdentity(value: string): FileIdentityEvidence | null {
  try {
    const parsed = JSON.parse(value) as Partial<FileIdentityEvidence>;
    return typeof parsed.stable === "string" && parsed.stable.length > 0 &&
      typeof parsed.version === "string" && parsed.version.length > 0
      ? { stable: parsed.stable, version: parsed.version }
      : null;
  } catch {
    return null;
  }
}
function getErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
}
function toMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
