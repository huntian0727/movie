import crypto from "node:crypto";
import path from "node:path";
import { readdir, rename, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type {
  DuplicateCleanupAccepted, DuplicateCleanupConfirmRequest, DuplicateCleanupJob,
  DuplicateCleanupSubmitRequest, DuplicateVerificationStatus
} from "../../shared/videoTypes.js";
import type { DuplicateCleanupRepository, DuplicateCleanupWorkItem } from "../db/duplicateCleanupRepository.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "../files/pathNormalization.js";
import { permanentlyDeleteFile } from "../files/fileOperations.js";
import { buildFullContentHash } from "./contentFingerprint.js";
import type { MediaCacheManager } from "./cacheManager.js";
import type { MetadataQueue } from "./metadataQueue.js";
import type { DomainEventBus } from "../playerWindow.js";
import { deleteCloudDriveFiles } from "../clouddrive/mountedScanner.js";
import type { CloudDriveFileOperationResult } from "../clouddrive/grpcClient.js";

type Inspection =
  | { status: "current"; stats: Stats }
  | { status: "missing"; message: string }
  | { status: "stale"; stats: Stats; message: string }
  | { status: "unreadable"; message: string };

interface DuplicateCleanupServiceOptions {
  deleteFile?: (filePath: string) => Promise<void>;
  hashFile?: (filePath: string, signal?: AbortSignal) => Promise<string>;
  renameFile?: (source: string, destination: string) => Promise<void>;
  deleteCloudFiles?: (
    remotePaths: readonly string[],
    permanently?: boolean,
    isCancelled?: () => boolean
  ) => Promise<CloudDriveFileOperationResult>;
}

interface FileIdentityEvidence { stable: string; version: string }
interface HashAttempt { hash: string | null; identity: string | null; error: string | null }

export class DuplicateCleanupService {
  private readonly pendingJobs: string[] = [];
  private pumping = false;
  private stopped = false;
  private currentJobId: string | null = null;
  private currentVerificationAbort: AbortController | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly legacyAutoDeleteJobIds = new Set<string>();
  private readonly deleteFile: (filePath: string) => Promise<void>;
  private readonly hashFile: (filePath: string, signal?: AbortSignal) => Promise<string>;
  private readonly renameFile: (source: string, destination: string) => Promise<void>;
  private readonly deleteCloudFiles: NonNullable<DuplicateCleanupServiceOptions["deleteCloudFiles"]>;
  private readonly recoveryPromise: Promise<void>;

  constructor(
    private readonly jobs: DuplicateCleanupRepository,
    private readonly videos: VideoRepository,
    private readonly metadataQueue: MetadataQueue,
    private readonly cacheManager: MediaCacheManager,
    private readonly domainEvents: DomainEventBus,
    options: DuplicateCleanupServiceOptions = {}
  ) {
    this.deleteFile = options.deleteFile ?? permanentlyDeleteFile;
    this.hashFile = options.hashFile ?? buildFullContentHash;
    this.renameFile = options.renameFile ?? rename;
    this.deleteCloudFiles = options.deleteCloudFiles ?? ((remotePaths, permanently, isCancelled) =>
      deleteCloudDriveFiles(remotePaths, permanently, process.env, isCancelled));
    this.jobs.interruptActiveJobs();
    this.recoveryPromise = this.recoverStagedFiles();
    for (const jobId of this.jobs.recoverFastJobs()) this.enqueue(jobId);
  }

  preview(request: DuplicateCleanupSubmitRequest) { return this.jobs.preview(request); }

  submit(request: DuplicateCleanupSubmitRequest): DuplicateCleanupAccepted {
    let accepted: DuplicateCleanupAccepted;
    if (request.autoDeleteAfterVerification) {
      try {
        accepted = this.jobs.submitFast(request);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("not managed by CloudDrive API")) throw error;
        // Preserve the retired local-filesystem workflow for old persisted callers.
        // The renderer no longer exposes it; current CloudDrive plans always use the API path above.
        accepted = this.jobs.submit(request);
        this.legacyAutoDeleteJobIds.add(accepted.jobId);
      }
    } else {
      accepted = this.jobs.submit(request);
    }
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

  assertVideosAvailable(videoIds: string[]): void { this.jobs.assertVideosAvailable(videoIds); }

  assertSourceFolderVideosAvailable(sourceFolderId: string): void {
    this.jobs.assertSourceFolderVideosAvailable(sourceFolderId);
  }

  stop(): void {
    this.stopped = true;
    this.currentVerificationAbort?.abort();
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
      await this.recoveryPromise;
      while (!this.stopped) {
        const jobId = this.pendingJobs.shift();
        if (!jobId) break;
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
        this.jobs.recordVerificationGroup(jobId, groupKey, revision, result.status, result.keepHash, result.deleteHashes,
          result.keepIdentity, result.deleteIdentities, result.error);
        this.publish(jobId);
      }
      if (!this.stopped) {
        const verifiedJob = this.jobs.completeVerification(jobId);
        this.publish(jobId, true);
        if (this.legacyAutoDeleteJobIds.delete(jobId) && verifiedJob.verificationRevision && verifiedJob.identicalItems > 0) {
          this.jobs.authorizeDeletion({ jobId, verificationRevision: verifiedJob.verificationRevision, confirmation: "DELETE" });
          if (this.jobs.start(jobId)) await this.runDeletion(jobId);
        }
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
    keepHash: string | null; deleteHashes: Map<string, string>;
    keepIdentity: string | null; deleteIdentities: Map<string, string>; error: string | null;
  }> {
    const keep = group[0];
    const keepAttempt = await this.hashExpected(
      keep.keep_video_id, keep.keep_path, keep.expected_keep_size_bytes, keep.expected_keep_modified_at, signal
    );
    const deleteHashes = new Map<string, string>();
    const deleteIdentities = new Map<string, string>();
    const errors: string[] = keepAttempt.error ? [`keep: ${keepAttempt.error}`] : [];
    for (const item of group) {
      if (signal.aborted) throw abortError();
      const attempt = await this.hashExpected(
        item.delete_video_id, item.delete_path, item.expected_delete_size_bytes, item.expected_delete_modified_at, signal
      );
      if (attempt.hash) deleteHashes.set(item.id, attempt.hash);
      if (attempt.identity) deleteIdentities.set(item.id, attempt.identity);
      if (attempt.error) errors.push(`${item.filename}: ${attempt.error}`);
    }
    if (errors.length > 0 || !keepAttempt.hash || deleteHashes.size !== group.length) {
      return { status: "unverifiable", keepHash: keepAttempt.hash, deleteHashes,
        keepIdentity: keepAttempt.identity, deleteIdentities,
        error: errors.join("; ") || "Full SHA-256 verification was incomplete." };
    }
    const different = [...deleteHashes.values()].some((hash) => hash !== keepAttempt.hash);
    return { status: different ? "content-different" : "verified-identical", keepHash: keepAttempt.hash, deleteHashes,
      keepIdentity: keepAttempt.identity, deleteIdentities, error: null };
  }

  private async hashExpected(videoId: string, filePath: string, size: number, modifiedAt: string, signal: AbortSignal): Promise<HashAttempt> {
    const before = await this.inspect(filePath, size, modifiedAt);
    if (before.status !== "current") {
      await this.refreshChangedVideo(videoId, filePath, size, modifiedAt, before);
      return { hash: null, identity: null, error: before.message };
    }
    try {
      const identityBefore = await this.readFileIdentity(filePath);
      const hash = await this.hashFile(filePath, signal);
      const after = await this.inspect(filePath, size, modifiedAt);
      if (after.status !== "current") {
        await this.refreshChangedVideo(videoId, filePath, size, modifiedAt, after);
        return { hash: null, identity: null, error: `File changed during verification: ${after.message}` };
      }
      const identityAfter = await this.readFileIdentity(filePath);
      if (identityBefore.version !== identityAfter.version) {
        return { hash: null, identity: null, error: "File identity or content version changed during verification." };
      }
      return { hash, identity: JSON.stringify(identityAfter), error: null };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) throw error;
      return { hash: null, identity: null, error: toMessage(error) };
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
      for (const item of batch) {
        let current;
        try {
          current = this.videos.getVideo(item.delete_video_id);
        } catch {
          this.jobs.updateItem(item.id, "deleted", "already-missing", "The indexed target no longer exists.");
          continue;
        }
        if (!item.delete_provider_file_id || !item.delete_provider_path ||
            current.providerFileId !== item.delete_provider_file_id || current.providerPath !== item.delete_provider_path ||
            current.sizeBytes !== item.expected_delete_size_bytes || current.modifiedAt !== item.expected_delete_modified_at) {
          this.jobs.updateItem(item.id, "skipped", "provider-identity-changed",
            "The cached CloudDrive identity or file version changed after the deletion plan was created.");
          continue;
        }
        currentItems.push(item);
      }
      const claimed = new Set(this.jobs.claimFastDeletionItems(jobId, currentItems.map((item) => item.id)));
      await this.deleteFastBatch(jobId, currentItems.filter((item) => claimed.has(item.id)));
      this.jobs.progress(jobId);
      this.publish(jobId);
  }

  private async deleteFastBatch(jobId: string, items: DuplicateCleanupWorkItem[]): Promise<void> {
    if (items.length === 0) return;
    let result: CloudDriveFileOperationResult;
    try {
      result = await this.deleteCloudFiles(items.map((item) => item.delete_provider_path!), true);
    } catch (error: unknown) {
      result = { success: false, errorMessage: toMessage(error), resultFilePaths: [] };
    }
    if (result.success) {
      for (const item of items) {
        this.videos.removeVideo(item.delete_video_id);
        this.jobs.updateItem(item.id, "deleted", result.permanentlyDeleted === false
          ? "moved-to-cloud-recycle-bin"
          : "deleted-via-clouddrive-api", result.permanentlyDeleted === false
          ? "CloudDrive does not expose permanent deletion; the file was moved to its recycle bin and freed space is not counted."
          : null);
        this.domainEvents.publish({ type: "video:removed", videoIds: [item.delete_video_id] });
      }
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
    const keepCheck = await this.rehashAuthorizedFile(item.keep_path, item.expected_keep_size_bytes,
      item.expected_keep_modified_at, item.keep_sha256, item.keep_file_identity);
    if (!keepCheck.ok) {
      this.jobs.updateItem(item.id, "skipped", "final-keep-integrity-changed", keepCheck.message);
      return;
    }
    const deleteCheck = await this.rehashAuthorizedFile(item.delete_path, item.expected_delete_size_bytes,
      item.expected_delete_modified_at, item.delete_sha256, item.delete_file_identity);
    if (!deleteCheck.ok) {
      this.jobs.updateItem(item.id, "skipped", "final-delete-integrity-changed", deleteCheck.message);
      return;
    }

    // Isolate the exact target with an atomic same-directory rename before the irreversible call. A swap
    // between the path check and rename is detected by hashing the isolated object and comparing its stable identity.
    const stagedPath = path.join(path.dirname(item.delete_path), `.${path.basename(item.delete_path)}.movie-delete-${crypto.randomUUID()}`);
    if (!this.jobs.prepareIsolation(jobId, item.id, stagedPath)) {
      this.jobs.updateItem(item.id, "failed", "authorization-rejected", "Fresh authorization was lost before target isolation.");
      return;
    }
    try {
      await this.renameFile(item.delete_path, stagedPath);
    } catch (error: unknown) {
      this.jobs.clearIsolation(item.id);
      this.jobs.updateItem(item.id, "failed", "isolation-failed", `Could not isolate the authorized target: ${toMessage(error)}`);
      return;
    }

    const isolatedCheck = await this.rehashIsolatedFile(stagedPath, item.expected_delete_size_bytes,
      item.delete_sha256, deleteCheck.identity?.stable ?? null);
    if (!isolatedCheck.ok) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "skipped" : "failed", "isolated-target-mismatch",
        `${isolatedCheck.message}${restored ? "" : ` Isolated file retained at ${stagedPath}.`}`);
      return;
    }
    if (this.stopped || this.jobs.isCancelling(jobId)) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "cancelled" : "failed", "delete-stop-requested",
        `Remaining deletion was stopped.${restored ? "" : ` Isolated file retained at ${stagedPath}.`}`);
      return;
    }

    // The keep file is rehashed after target isolation, so a concurrent change invalidates the delete while
    // the target can still be restored. This is stronger than size/mtime and closes the path-swap race.
    const finalKeep = await this.rehashAuthorizedFile(item.keep_path, item.expected_keep_size_bytes,
      item.expected_keep_modified_at, item.keep_sha256, item.keep_file_identity);
    if (!finalKeep.ok) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, restored ? "skipped" : "failed", "final-keep-integrity-changed",
        `${finalKeep.message}${restored ? "" : ` Isolated file retained at ${stagedPath}.`}`);
      return;
    }
    if (!this.jobs.claimDeletionItem(jobId, item.id)) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, "failed", "authorization-rejected",
        `Fresh full SHA-256 authorization is missing or stale.${restored ? "" : ` Isolated file retained at ${stagedPath}.`}`);
      return;
    }
    try {
      await this.deleteFile(stagedPath);
      this.jobs.clearIsolation(item.id);
      this.videos.removeVideo(item.delete_video_id);
      this.jobs.updateItem(item.id, "deleted", "deleted", null);
      this.domainEvents.publish({ type: "video:removed", videoIds: [item.delete_video_id] });
    } catch (error: unknown) {
      const restored = await this.restoreStagedFile(item.id, stagedPath, item.delete_path);
      this.jobs.updateItem(item.id, "failed", getErrorCode(error),
        `${toMessage(error)}${restored ? "" : ` Isolated file may remain at ${stagedPath}.`}`);
    }
  }

  private async rehashAuthorizedFile(
    filePath: string, expectedSize: number, expectedModifiedAt: string,
    expectedHash: string | null, persistedIdentity: string | null
  ): Promise<{ ok: boolean; message: string; identity: FileIdentityEvidence | null }> {
    if (!expectedHash || !/^[a-f\d]{64}$/i.test(expectedHash) || !persistedIdentity) {
      return { ok: false, message: "Persisted full SHA-256 or file identity evidence is missing.", identity: null };
    }
    const expectedIdentity = parseIdentity(persistedIdentity);
    if (!expectedIdentity) return { ok: false, message: "Persisted file identity evidence is invalid.", identity: null };
    const inspection = await this.inspect(filePath, expectedSize, expectedModifiedAt);
    if (inspection.status !== "current") return { ok: false, message: inspection.message, identity: null };
    try {
      const before = await this.readFileIdentity(filePath);
      const actualHash = await this.hashFile(filePath);
      const after = await this.readFileIdentity(filePath);
      const unchangedDuringHash = before.version === after.version;
      const sameVerifiedIdentity = after.version === expectedIdentity.version;
      const sameVerifiedHash = actualHash === expectedHash;
      if (!unchangedDuringHash || !sameVerifiedIdentity || !sameVerifiedHash) {
        return { ok: false, message: "Full SHA-256 or strong file identity changed after verification.", identity: after };
      }
      return { ok: true, message: "", identity: after };
    } catch (error: unknown) {
      return { ok: false, message: `Could not revalidate full SHA-256: ${toMessage(error)}`, identity: null };
    }
  }

  private async rehashIsolatedFile(
    filePath: string, expectedSize: number, expectedHash: string | null, expectedStableIdentity: string | null
  ): Promise<{ ok: boolean; message: string }> {
    if (!expectedHash || !expectedStableIdentity) return { ok: false, message: "Isolated target authorization is incomplete." };
    try {
      const before = await this.readFileIdentity(filePath);
      const actualHash = await this.hashFile(filePath);
      const after = await this.readFileIdentity(filePath);
      if (Number((await stat(filePath)).size) !== expectedSize || before.stable !== expectedStableIdentity ||
          after.stable !== expectedStableIdentity || before.version !== after.version || actualHash !== expectedHash) {
        return { ok: false, message: "The isolated target does not match the persistently authorized full SHA-256 and file identity." };
      }
      return { ok: true, message: "" };
    } catch (error: unknown) {
      return { ok: false, message: `Could not verify the isolated target: ${toMessage(error)}` };
    }
  }

  private async restoreStagedFile(itemId: string, stagedPath: string, originalPath: string): Promise<boolean> {
    try {
      await stat(stagedPath);
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") return false;
      try {
        await stat(originalPath);
        this.jobs.clearIsolation(itemId);
        return true;
      } catch {
        return false;
      }
    }
    try {
      await stat(originalPath);
      return false;
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") return false;
    }
    try {
      await this.renameFile(stagedPath, originalPath);
      this.jobs.clearIsolation(itemId);
      return true;
    } catch {
      return false;
    }
  }

  private async recoverStagedFiles(): Promise<void> {
    for (const item of this.jobs.listStagedItems()) {
      const stagedPath = item.staged_delete_path!;
      const [stagedExists, originalExists] = await Promise.all([
        this.pathExists(stagedPath), this.pathExists(item.delete_path)
      ]);
      if (!stagedExists && originalExists) {
        this.jobs.clearIsolation(item.id);
        continue;
      }
      if (stagedExists && !originalExists) {
        try {
          await this.renameFile(stagedPath, item.delete_path);
          this.jobs.clearIsolation(item.id);
          continue;
        } catch (error: unknown) {
          this.jobs.recordIsolationRecoveryFailure(item.id,
            `Automatic isolation recovery failed; the media remains at ${stagedPath}. ${toMessage(error)}`);
          continue;
        }
      }
      const reason = stagedExists
        ? `Original path is occupied; no file was overwritten. Recoverable media remains at ${stagedPath}.`
        : `Neither original nor recorded isolated path exists. Manual recovery is required: ${stagedPath}.`;
      this.jobs.recordIsolationRecoveryFailure(item.id, reason);
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error: unknown) {
      if (getErrorCode(error) === "ENOENT") return false;
      return true;
    }
  }

  private async readFileIdentity(filePath: string): Promise<FileIdentityEvidence> {
    const stats = await stat(filePath, { bigint: true });
    if (!stats.isFile()) throw new Error("Path is not a regular file.");
    const stable = [stats.dev, stats.ino, stats.birthtimeNs].map(String).join(":");
    return { stable, version: [stable, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":") };
  }

  private async inspect(filePath: string, expectedSize: number, expectedModifiedAt: string): Promise<Inspection> {
    if (!this.isManaged(filePath)) return { status: "unreadable", message: "File is outside enabled managed folders." };
    try {
      const stats = await stat(filePath);
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
