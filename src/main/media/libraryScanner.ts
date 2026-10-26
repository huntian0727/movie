import crypto from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { VideoRepository } from "../db/videoRepository.js";
import type {
  DirectorySnapshot,
  ScanCounters,
  ScanFailure,
  ScanMode,
  SourceFolder,
  VideoRecord
} from "../../shared/videoTypes.js";
import { isVideoExtension } from "../../shared/videoTypes.js";
import { isManagedPathWithin, normalizeManagedPath } from "../files/pathNormalization.js";
import {
  tryCreateMountedCloudDriveDirectorySource,
  type CloudDriveDirectoryListing,
  type CloudDriveScanFileInfo,
  type MountedCloudDriveDirectorySource
} from "../clouddrive/mountedScanner.js";
import { openDirectoryEntries, type FileDiscoveryDependencies, type DirectoryEntries } from "./fileDiscovery.js";
import { readMetadata, type MediaMetadata } from "./metadataService.js";

export interface ScanProgress {
  phase: "discovering" | "comparing-snapshots" | "processing" | "retrying-failures";
  totalFiles: number;
  processedFiles: number;
  currentPath: string | null;
  counters?: ScanCounters;
}

export interface ScanResult {
  state: "completed" | "completed-with-errors" | "offline";
  totalFiles: number;
  processedFiles: number;
  failureCount: number;
  message: string | null;
  counters?: ScanCounters;
  /** Aggregate diagnostic timings; never contains file or directory paths. */
  performance?: ScanPerformanceSummary;
}

export interface ScanPerformanceSummary {
  directoryReadCount: number;
  directoryReadDurationMs: number;
  directoryReadMaxDurationMs: number;
  directoryEntryCount: number;
  directoryReadMaxEntries: number;
  directoryReadFailures: number;
  cloudDirectoryReadCount: number;
  cloudDirectoryReadDurationMs: number;
  cloudDirectoryReadWallDurationMs: number;
  cloudDirectoryCacheHits: number;
  localDirectoryReadCount: number;
  localDirectoryReadDurationMs: number;
  localFileStatCount: number;
  localFileStatDurationMs: number;
  directoryDigestDurationMs: number;
  snapshotLookupDurationMs: number;
  existingVideoLookupCount: number;
  existingVideoLookupDurationMs: number;
  writeBatchCount: number;
  writeBatchDurationMs: number;
  missingReconciliationCount: number;
  missingReconciliationDurationMs: number;
  deletedChildReconciliationCount: number;
  deletedChildReconciliationDurationMs: number;
  snapshotWriteCount: number;
  snapshotWriteDurationMs: number;
}

export interface ScannerDependencies {
  readMetadata?: (filePath: string) => Promise<MediaMetadata>;
  statImpl?: (targetPath: string) => Promise<Stats>;
  onProgress?(progress: ScanProgress): void;
  waitIfPaused?(): Promise<void>;
  discovery?: FileDiscoveryDependencies;
  onMetadataPending?(videoId: string): void;
  isCancelled?(): boolean;
  taskId?: string;
  mode?: ScanMode;
  /** Restrict a manual scan to one directory without changing source identity. */
  scanRootPath?: string;
  scanRecursive?: boolean;
  cloudDirectorySource?(
    sourceFolder: SourceFolder,
    isCancelled?: () => boolean,
    forceRefresh?: boolean
  ): Promise<MountedCloudDriveDirectorySource | null>;
  cloudDirectoryConcurrency?: number;
}

const FILE_STAT_TIMEOUT_MS = 15_000;
const DIRECTORY_ENTRY_TIMEOUT_MS = 30_000;
const DEFAULT_CLOUD_DIRECTORY_CONCURRENCY = 16;
// Keep CloudDrive's database writes bounded even when one remote directory
// contains tens of thousands of videos. Missing reconciliation and the
// complete snapshot are committed only after every listed entry is handled.
const CLOUD_WRITE_BATCH_LIMIT = 128;
const CLOUD_WRITE_BATCH_BUDGET_MS = 8;
const SKIPPED_SUFFIXES = [".crdownload", ".part", ".tmp"];

export class ScanCancelledError extends Error {
  constructor() {
    super("Scan cancelled");
    this.name = "ScanCancelledError";
  }
}

interface ScanContext {
  repo: VideoRepository;
  sourceFolder: SourceFolder;
  dependencies: ScannerDependencies;
  taskId: string;
  mode: ScanMode;
  scanRecursive: boolean;
  counters: ScanCounters;
  totalFiles: number;
  processedFiles: number;
  discoveredFilePaths: string[];
  directoryFailureCount: number;
  fileFailureCount: number;
  incrementRetry: boolean;
  lastFailure: { objectType: "file" | "directory"; objectPath: string; message: string } | null;
  missingDirectoryParentReads: Map<string, Promise<DirectoryEntry[]>>;
  cloudDirectorySource: MountedCloudDriveDirectorySource | null;
  cloudDirectoryLimiter: AsyncWorkLimiter | null;
  cloudDirectoryPrefetches: Map<string, Promise<SettledCloudDirectoryListing>>;
  performance: ScanPerformanceSummary;
}

type SettledCloudDirectoryListing =
  | { ok: true; listing: CloudDriveDirectoryListing }
  | { ok: false; error: unknown };

interface DirectoryEntry {
  name: string;
  // CloudDrive entries already expose a compact kind field. Reuse them directly
  // instead of allocating two closure functions for every remote directory item.
  kind?: "file" | "directory" | "other";
  isFile?(): boolean;
  isDirectory?(): boolean;
  scanIdentity?: string;
  fileInfo?: CloudDriveScanFileInfo;
}

interface ScannedDirectory {
  entries: DirectoryEntry[];
  directoryMtime: string;
}

type FailedFilePresence =
  | { state: "exists"; fileStat?: Stats | CloudDriveScanFileInfo }
  | { state: "confirmed-missing" }
  | { state: "file-unreadable"; error: unknown }
  | { state: "parent-unreadable"; parentPath: string; error: unknown };

export function createEmptyScanCounters(): ScanCounters {
  return {
    totalFolders: 0,
    currentFolderIndex: 0,
    completedFolders: 0,
    failedFolders: 0,
    checkedDirectories: 0,
    changedDirectories: 0,
    skippedDirectories: 0,
    processedVideos: 0,
    skippedVideos: 0,
    addedVideos: 0,
    updatedVideos: 0,
    missingVideos: 0,
    fileFailures: 0,
    directoryFailures: 0,
    pendingFailures: 0,
    retriedFailures: 0,
    resolvedFailures: 0
  };
}

function createEmptyScanPerformanceSummary(): ScanPerformanceSummary {
  return {
    directoryReadCount: 0,
    directoryReadDurationMs: 0,
    directoryReadMaxDurationMs: 0,
    directoryEntryCount: 0,
    directoryReadMaxEntries: 0,
    directoryReadFailures: 0,
    cloudDirectoryReadCount: 0,
    cloudDirectoryReadDurationMs: 0,
    cloudDirectoryReadWallDurationMs: 0,
    cloudDirectoryCacheHits: 0,
    localDirectoryReadCount: 0,
    localDirectoryReadDurationMs: 0,
    localFileStatCount: 0,
    localFileStatDurationMs: 0,
    directoryDigestDurationMs: 0,
    snapshotLookupDurationMs: 0,
    existingVideoLookupCount: 0,
    existingVideoLookupDurationMs: 0,
    writeBatchCount: 0,
    writeBatchDurationMs: 0,
    missingReconciliationCount: 0,
    missingReconciliationDurationMs: 0,
    deletedChildReconciliationCount: 0,
    deletedChildReconciliationDurationMs: 0,
    snapshotWriteCount: 0,
    snapshotWriteDurationMs: 0
  };
}

/** Mode A: incrementally scan one source folder using per-directory snapshots. */
export async function scanSourceFolder(
  repo: VideoRepository,
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies = {}
): Promise<ScanResult> {
  const normalizedDependencies = { ...dependencies, mode: dependencies.mode ?? "current-folder" };
  const cloudDirectorySource = await resolveCloudDirectorySource(sourceFolder, normalizedDependencies);
  if (cloudDirectorySource?.provider) {
    repo.setSourceFolderProvider?.(sourceFolder.id, cloudDirectorySource.provider);
  }
  const context = createContext(
    repo,
    sourceFolder,
    normalizedDependencies,
    false,
    cloudDirectorySource
  );
  const rootPath = normalizedDependencies.scanRootPath ?? sourceFolder.path;
  const sourceRoot = !normalizedDependencies.scanRootPath;
  reportProgress(context, "discovering", rootPath);
  const rootReadable = await scanDirectoryTree(context, rootPath, sourceRoot ? null : path.dirname(rootPath), sourceRoot);
  return finalizeScan(context, rootReadable);
}

/** Mode B: retry only unresolved file failures and failed directory subtrees. */
export async function retryScanFailures(
  repo: VideoRepository,
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies = {}
): Promise<ScanResult> {
  const normalizedDependencies = { ...dependencies, mode: "retry-failures" as const };
  const context = createContext(
    repo,
    sourceFolder,
    normalizedDependencies,
    true,
    await resolveCloudDirectorySource(sourceFolder, normalizedDependencies)
  );
  const failures = safeListFailures(repo, sourceFolder.id);
  context.counters.pendingFailures = failures.length;
  if (failures.length === 0) return finalizeScan(context, true);

  const directoryFailures = failures.filter((failure) => failure.objectType === "directory");
  const directoryRoots = directoryFailures
    .filter((failure) => !directoryFailures.some((other) => other.id !== failure.id && isManagedPathWithin(failure.objectPath, other.objectPath)))
    .map((failure) => failure.objectPath);
  const fileFailures = failures.filter((failure) =>
    failure.objectType === "file" && !directoryRoots.some((root) => isManagedPathWithin(failure.objectPath, root))
  );

  for (const failure of failures) safeMarkRetrying(repo, failure.id);
  const confirmedMissingPaths = new Set<string>();
  for (const directoryPath of directoryRoots) {
    await dependencies.waitIfPaused?.();
    reportProgress(context, "retrying-failures", directoryPath);
    await scanDirectoryTree(context, directoryPath, path.dirname(directoryPath), normalizeManagedPath(directoryPath) === normalizeManagedPath(sourceFolder.path));
  }
  for (const failure of fileFailures) {
    if (confirmedMissingPaths.has(failure.normalizedPath)) continue;
    await dependencies.waitIfPaused?.();
    throwIfCancelled(dependencies);
    reportProgress(context, "retrying-failures", failure.objectPath);
    const presence = await inspectFailedFilePresence(context, failure.objectPath);
    if (presence.state === "confirmed-missing") {
      confirmedMissingPaths.add(failure.normalizedPath);
      context.counters.retriedFailures += 1;
      const video = repo.getVideoByPath(failure.objectPath);
      if (video && !video.isMissing) {
        repo.markMissing(video.id, true);
        context.counters.missingVideos += 1;
      }
      context.counters.resolvedFailures += safeResolveAllObjectFailures(repo, sourceFolder.id, failure.objectPath);
      continue;
    }
    if (presence.state === "parent-unreadable") {
      context.counters.retriedFailures += 1;
      context.directoryFailureCount += 1;
      context.counters.directoryFailures += 1;
      safeRecordFailure(context, "directory", presence.parentPath, "directory-enumeration", presence.error);
      context.fileFailureCount += 1;
      context.counters.fileFailures += 1;
      safeRecordFailure(context, "file", failure.objectPath, failure.failureStage, presence.error);
      continue;
    }
    if (presence.state === "file-unreadable") {
      context.counters.retriedFailures += 1;
      context.fileFailureCount += 1;
      context.counters.fileFailures += 1;
      safeRecordFailure(context, "file", failure.objectPath, failure.failureStage, presence.error);
      continue;
    }
    if (failure.failureStage === "metadata" && dependencies.onMetadataPending) {
      const video = repo.getVideoByPath(failure.objectPath);
      context.counters.retriedFailures += 1;
      if (video && !video.isMissing) {
        if (video.metadataStatus === "failed") {
          repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt);
        }
        dependencies.onMetadataPending(video.id);
        continue;
      }
    }
    const succeeded = await processVideoFile(context, failure.objectPath, presence.fileStat);
    if (succeeded) {
      context.counters.resolvedFailures += safeResolveFailure(repo, failure.id);
    }
  }

  return finalizeScan(context, true);
}

/** Retry exactly one unresolved failure. The caller is responsible for deduplicating concurrent requests. */
export async function retryScanFailure(
  repo: VideoRepository,
  sourceFolder: SourceFolder,
  failureId: string,
  dependencies: ScannerDependencies = {}
): Promise<ScanResult> {
  const failure = repo.getScanFailure(failureId);
  if (!failure || failure.status === "resolved") throw new Error("Scan failure is no longer available");
  if (failure.sourceFolderId !== sourceFolder.id || !isManagedPathWithin(failure.objectPath, sourceFolder.path)) {
    throw new Error("Scan failure is outside its source folder");
  }

  const normalizedDependencies = { ...dependencies, mode: "retry-failures" as const };
  const context = createContext(
    repo,
    sourceFolder,
    normalizedDependencies,
    true,
    await resolveCloudDirectorySource(sourceFolder, normalizedDependencies)
  );
  context.counters.pendingFailures = 1;
  safeMarkRetrying(repo, failure.id);
  await dependencies.waitIfPaused?.();
  throwIfCancelled(dependencies);
  reportProgress(context, "retrying-failures", failure.objectPath);

  if (failure.objectType === "directory") {
    const readable = await scanDirectoryTree(
      context,
      failure.objectPath,
      path.dirname(failure.objectPath),
      normalizeManagedPath(failure.objectPath) === normalizeManagedPath(sourceFolder.path)
    );
    return finalizeScan(context, readable);
  }

  const presence = await inspectFailedFilePresence(context, failure.objectPath);
  context.counters.retriedFailures += 1;
  if (presence.state === "confirmed-missing") {
    const video = repo.getVideoByPath(failure.objectPath);
    if (video && !video.isMissing) {
      repo.markMissing(video.id, true);
      context.counters.missingVideos += 1;
    }
    context.counters.resolvedFailures += safeResolveAllObjectFailures(repo, sourceFolder.id, failure.objectPath);
    return finalizeScan(context, true);
  }
  if (presence.state === "parent-unreadable") {
    context.directoryFailureCount += 1;
    context.counters.directoryFailures += 1;
    safeRecordFailure(context, "directory", presence.parentPath, "directory-enumeration", presence.error);
    context.fileFailureCount += 1;
    context.counters.fileFailures += 1;
    safeRecordFailure(context, "file", failure.objectPath, failure.failureStage, presence.error);
    return finalizeScan(context, true);
  }
  if (presence.state === "file-unreadable") {
    context.fileFailureCount += 1;
    context.counters.fileFailures += 1;
    safeRecordFailure(context, "file", failure.objectPath, failure.failureStage, presence.error);
    return finalizeScan(context, true);
  }
  if (failure.failureStage === "metadata" && dependencies.onMetadataPending) {
    const video = repo.getVideoByPath(failure.objectPath);
    if (video && !video.isMissing) {
      if (video.metadataStatus === "failed") repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt);
      dependencies.onMetadataPending(video.id);
      return finalizeScan(context, true);
    }
  }
  if (await processVideoFile(context, failure.objectPath, presence.fileStat)) {
    context.counters.resolvedFailures += safeResolveFailure(repo, failure.id);
  }
  return finalizeScan(context, true);
}

export async function syncEnabledFolders(
  repo: VideoRepository,
  scan: (repo: VideoRepository, sourceFolder: SourceFolder) => Promise<unknown> = scanSourceFolder
): Promise<void> {
  for (const folder of repo.listSourceFolders().filter((candidate) => candidate.enabled)) await scan(repo, folder);
}

async function scanDirectoryTree(
  context: ScanContext,
  directoryPath: string,
  parentDirectoryPath: string | null,
  isRoot: boolean
): Promise<boolean> {
  await context.dependencies.waitIfPaused?.();
  throwIfCancelled(context.dependencies);
  reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "discovering", directoryPath);

  let scannedDirectory: ScannedDirectory;
  try {
    scannedDirectory = await readScannedDirectory(context, directoryPath);
    throwIfCancelled(context.dependencies);
    context.counters.checkedDirectories += 1;
  } catch (error) {
    throwIfCancelled(context.dependencies);
    if (getErrorCode(error) === "ENOENT" && !isRoot && parentDirectoryPath) {
      const confirmedMissing = await confirmMissingDirectory(context, directoryPath, parentDirectoryPath);
      if (confirmedMissing) {
        context.counters.missingVideos += safeMarkSubtreeMissing(context.repo, context.sourceFolder.id, directoryPath);
        context.counters.resolvedFailures += safeResolveFailureSubtree(context.repo, context.sourceFolder.id, directoryPath);
        safeDeleteSnapshotSubtree(context.repo, context.sourceFolder.id, directoryPath);
        return true;
      }
    }
    context.directoryFailureCount += 1;
    context.counters.directoryFailures += 1;
    safeRecordFailure(context, "directory", directoryPath, "directory-enumeration", error);
    safeMarkSnapshotIncomplete(context.repo, context.sourceFolder.id, directoryPath);
    return !isRoot;
  }

  const { entries, directoryMtime } = scannedDirectory;

  const directVideos = entries.filter((entry) => isAcceptedVideoEntry(entry));
  const directChildren = context.scanRecursive
    ? entries.filter(isDirectoryEntry)
    : [];

  const shouldTrackDiscoveredFilePaths = !context.dependencies.scanRootPath
    && !(context.repo as Partial<VideoRepository>).reconcileDirectoryMissing;
  const directChildPaths = directChildren.map((entry) => path.join(directoryPath, entry.name));
  prefetchCloudDirectories(context, directChildPaths);
  context.totalFiles += directVideos.length;
  if (shouldTrackDiscoveredFilePaths) {
    for (const entry of directVideos) context.discoveredFilePaths.push(path.join(directoryPath, entry.name));
  }

  const digestStartedAt = performance.now();
  const digest = createDirectEntryDigest(directVideos, directChildren);
  context.performance.directoryDigestDurationMs += performance.now() - digestStartedAt;
  const snapshotLookupStartedAt = performance.now();
  const previous = safeGetSnapshot(context.repo, context.sourceFolder.id, directoryPath);
  context.performance.snapshotLookupDurationMs += performance.now() - snapshotLookupStartedAt;
  reportProgress(context, "comparing-snapshots", directoryPath);
  const canSkip = snapshotCanSkip(previous, directoryMtime, directVideos.length, directChildren.length, digest);
  const shouldReconcileUnchangedLocalVideos = canSkip
    && context.mode === "current-folder"
    && !context.cloudDirectorySource;

  if (context.scanRecursive || !context.dependencies.scanRootPath) {
    const reconcileStartedAt = performance.now();
    try {
      reconcileDeletedChildDirectories(context, directoryPath, directChildPaths);
    } finally {
      context.performance.deletedChildReconciliationCount += 1;
      context.performance.deletedChildReconciliationDurationMs += performance.now() - reconcileStartedAt;
    }
  }
  if (canSkip && !shouldReconcileUnchangedLocalVideos) {
    context.counters.skippedDirectories += 1;
    context.counters.skippedVideos += directVideos.length;
    context.processedFiles += directVideos.length;
    context.counters.missingVideos += reconcileDirectoryEntries(context, directoryPath, directVideos);
    reportProgress(context, "comparing-snapshots", directoryPath);
  } else if (shouldReconcileUnchangedLocalVideos) {
    context.counters.skippedDirectories += 1;
    let directFailures = 0;
    for (const entry of directVideos) {
      const filePath = path.join(directoryPath, entry.name);
      await context.dependencies.waitIfPaused?.();
      throwIfCancelled(context.dependencies);
      reportProgress(context, "processing", filePath);
      if (!await processVideoFile(context, filePath)) directFailures += 1;
      context.processedFiles += 1;
      reportProgress(context, "processing", filePath);
    }
    context.counters.missingVideos += reconcileDirectoryEntries(context, directoryPath, directVideos);
    if (directFailures > 0) safeMarkSnapshotIncomplete(context.repo, context.sourceFolder.id, directoryPath);
  } else {
    context.counters.changedDirectories += 1;
    let directFailures = 0;
    const canBatchCloudDirectory = Boolean(
      context.cloudDirectorySource
      && context.dependencies.onMetadataPending
      && directVideos.every((entry) => entry.fileInfo?.providerFileId && entry.fileInfo.providerPath)
    );
    if (canBatchCloudDirectory) {
      let nextVideo = 0;
      const supportsBatchLookup = typeof context.repo.getVideosByPaths === "function";
      const existingByPathCache = new Map<string, VideoRecord>();
      let lookupWindowEnd = 0;
      let sourceFolderCandidates: SourceFolder[] | undefined;
      while (nextVideo < directVideos.length) {
        await context.dependencies.waitIfPaused?.();
        throwIfCancelled(context.dependencies);
        let batchEnd = Math.min(nextVideo + CLOUD_WRITE_BATCH_LIMIT, directVideos.length);
        if (nextVideo >= lookupWindowEnd) {
          lookupWindowEnd = Math.min(nextVideo + CLOUD_WRITE_BATCH_LIMIT, directVideos.length);
          existingByPathCache.clear();
          if (supportsBatchLookup) {
            const lookupPaths = directVideos.slice(nextVideo, lookupWindowEnd).map((entry) => path.join(directoryPath, entry.name));
            const lookupStartedAt = performance.now();
            const existing = context.repo.getVideosByPaths(lookupPaths);
            context.performance.existingVideoLookupCount += 1;
            context.performance.existingVideoLookupDurationMs += performance.now() - lookupStartedAt;
            for (const [filePath, video] of existing) existingByPathCache.set(filePath, video);
          }
          const listSourceFolders = (context.repo as Partial<VideoRepository>).listSourceFolders;
          sourceFolderCandidates = typeof listSourceFolders === "function"
            ? listSourceFolders.call(context.repo).filter((folder) => folder.enabled)
            : undefined;
        }
        batchEnd = Math.min(batchEnd, lookupWindowEnd);
        const batchStartedAt = performance.now();
        try {
          context.repo.runInTransaction(() => {
            do {
              const entry = directVideos[nextVideo]!;
              const filePath = path.join(directoryPath, entry.name);
              throwIfCancelled(context.dependencies);
              reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
              if (!processCloudVideoFile(context, filePath, entry.fileInfo!, supportsBatchLookup ? existingByPathCache : undefined, sourceFolderCandidates)) directFailures += 1;
              context.processedFiles += 1;
              nextVideo += 1;
              if (supportsBatchLookup) {
                existingByPathCache.delete(filePath);

              }
              reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
            } while (nextVideo < batchEnd && performance.now() - batchStartedAt < CLOUD_WRITE_BATCH_BUDGET_MS);
          });
        } finally {
          context.performance.writeBatchCount += 1;
          context.performance.writeBatchDurationMs += performance.now() - batchStartedAt;
        }
        if (nextVideo < directVideos.length) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await context.dependencies.waitIfPaused?.();
      throwIfCancelled(context.dependencies);
      const finalWriteStartedAt = performance.now();
      try {
        context.repo.runInTransaction(() => {
          context.counters.missingVideos += reconcileDirectoryEntries(context, directoryPath, directVideos);
          upsertDirectorySnapshot(context, {
            sourceFolderId: context.sourceFolder.id,
            directoryPath,
            parentDirectoryPath,
            directoryMtime,
            directVideoCount: directVideos.length,
            directChildCount: directChildren.length,
            directEntryDigest: digest,
            isComplete: true,
            hasUnresolvedFailure: directFailures > 0,
            successful: directFailures === 0
          });
        });
      } finally {
        context.performance.writeBatchCount += 1;
        context.performance.writeBatchDurationMs += performance.now() - finalWriteStartedAt;
      }
    } else {
      for (const entry of directVideos) {
        const filePath = path.join(directoryPath, entry.name);
        await context.dependencies.waitIfPaused?.();
        throwIfCancelled(context.dependencies);
        reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
        if (!await processVideoFile(context, filePath, entry.fileInfo)) directFailures += 1;
        context.processedFiles += 1;
        reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
      }
      context.counters.missingVideos += reconcileDirectoryEntries(context, directoryPath, directVideos);
      upsertDirectorySnapshot(context, {
        sourceFolderId: context.sourceFolder.id,
        directoryPath,
        parentDirectoryPath,
        directoryMtime,
        directVideoCount: directVideos.length,
        directChildCount: directChildren.length,
        directEntryDigest: digest,
        isComplete: true,
        hasUnresolvedFailure: directFailures > 0,
        successful: directFailures === 0
      });
    }
  }

  for (const childPath of directChildPaths) await scanDirectoryTree(context, childPath, directoryPath, false);
  throwIfCancelled(context.dependencies);
  context.counters.resolvedFailures += safeResolveObjectFailures(context.repo, context.sourceFolder.id, directoryPath, "directory");
  return true;
}

async function readFileStat(
  context: ScanContext,
  filePath: string,
  knownFileInfo?: Stats | CloudDriveScanFileInfo
): Promise<Stats | CloudDriveScanFileInfo> {
  if (knownFileInfo) return knownFileInfo;
  const startedAt = performance.now();
  try {
    return await withTimeout(
      (context.dependencies.statImpl ?? stat)(filePath),
      FILE_STAT_TIMEOUT_MS,
      "File access timed out after " + (FILE_STAT_TIMEOUT_MS / 1000) + "s"
    );
  } finally {
    context.performance.localFileStatCount += 1;
    context.performance.localFileStatDurationMs += performance.now() - startedAt;
  }
}

async function processVideoFile(
  context: ScanContext,
  filePath: string,
  knownFileInfo?: Stats | CloudDriveScanFileInfo
): Promise<boolean> {
  context.counters.processedVideos += 1;
  if (context.incrementRetry) context.counters.retriedFailures += 1;
  try {
    const fileStat = await readFileStat(context, filePath, knownFileInfo);
    const existing = context.repo.getVideoByPath(filePath);
    const sizeBytes = "sizeBytes" in fileStat ? fileStat.sizeBytes : fileStat.size;
    const modifiedAt = "modifiedAt" in fileStat ? fileStat.modifiedAt : fileStat.mtime.toISOString();
    if (existing && existing.sizeBytes === sizeBytes && existing.modifiedAt === modifiedAt) {
      context.counters.skippedVideos += 1;
      if ("providerFileId" in fileStat && fileStat.providerFileId && fileStat.providerPath) {
        context.repo.updateVideoProviderIdentityIfVersion?.(
          existing.id,
          existing.path,
          existing.sizeBytes,
          existing.modifiedAt,
          { fileId: fileStat.providerFileId, path: fileStat.providerPath }
        );
      }
      if (existing.isMissing) context.repo.markMissing(existing.id, false);
      queuePendingMetadata(context, existing);
    } else {
      const parsed = path.parse(filePath);
      const stored = await upsertScannedVideo(context, existing, filePath, parsed, sizeBytes, modifiedAt,
        "providerFileId" in fileStat && fileStat.providerFileId && fileStat.providerPath ? fileStat : undefined);
      if (existing) context.counters.updatedVideos += 1;
      else context.counters.addedVideos += 1;
      if (context.dependencies.onMetadataPending && !("providerFileId" in fileStat && fileStat.providerFileId)) {
        context.dependencies.onMetadataPending(stored.id);
      }
    }
    context.counters.resolvedFailures += safeResolveObjectStageFailures(
      context.repo,
      context.sourceFolder.id,
      filePath,
      "file",
      "file-processing"
    );
    return true;
  } catch (error) {
    context.fileFailureCount += 1;
    context.counters.fileFailures += 1;
    safeRecordFailure(context, "file", filePath, "file-processing", error);
    return false;
  }
}

async function upsertScannedVideo(
  context: ScanContext,
  existing: VideoRecord | null,
  filePath: string,
  parsed: path.ParsedPath,
  sizeBytes: number,
  modifiedAt: string,
  providerInfo?: CloudDriveScanFileInfo
): Promise<VideoRecord> {
  if (context.dependencies.onMetadataPending) {
    return context.repo.upsertVideo({
      sourceFolderId: context.sourceFolder.id,
      path: filePath,
      directory: parsed.dir,
      filename: parsed.base,
      basename: parsed.name,
      extension: parsed.ext.toLowerCase(),
      sizeBytes,
      durationMs: null,
      width: null,
      height: null,
      format: null,
      videoCodec: null,
      videoProfile: null,
      pixelFormat: null,
      audioCodec: null,
      codecProbeStatus: "unprobed",
      modifiedAt,
      metadataStatus: "pending",
      providerFileId: providerInfo?.providerFileId ?? null,
      providerPath: providerInfo?.providerPath ?? null,
      durationSource: "unknown"
    });
  }
  const metadata = await (context.dependencies.readMetadata ?? readMetadata)(filePath);
  return context.repo.upsertVideo({
    sourceFolderId: context.sourceFolder.id,
    path: filePath,
    directory: parsed.dir,
    filename: parsed.base,
    basename: parsed.name,
    extension: parsed.ext.toLowerCase(),
    sizeBytes,
    durationMs: metadata.durationMs,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    videoCodec: metadata.videoCodec ?? null,
    videoProfile: metadata.videoProfile ?? null,
    pixelFormat: metadata.pixelFormat ?? null,
    audioCodec: metadata.audioCodec ?? null,
    codecProbeStatus: "ready",
    modifiedAt,
    providerFileId: providerInfo?.providerFileId ?? null,
    providerPath: providerInfo?.providerPath ?? null,
    durationSource: metadata.durationMs === null ? "unknown" : "local-probe"
  });
}

function processCloudVideoFile(
  context: ScanContext,
  filePath: string,
  fileInfo: CloudDriveScanFileInfo,
  existingByPath?: ReadonlyMap<string, VideoRecord>,
  sourceFolders?: SourceFolder[]
): boolean {
  context.counters.processedVideos += 1;
  if (context.incrementRetry) context.counters.retriedFailures += 1;
  try {
    const existing = existingByPath ? existingByPath.get(filePath) ?? null : context.repo.getVideoByPath(filePath);
    if (existing && existing.sizeBytes === fileInfo.sizeBytes && existing.modifiedAt === fileInfo.modifiedAt) {
      context.counters.skippedVideos += 1;
      if (fileInfo.providerFileId && fileInfo.providerPath) {
        context.repo.updateVideoProviderIdentityIfVersion?.(
          existing.id,
          existing.path,
          existing.sizeBytes,
          existing.modifiedAt,
          { fileId: fileInfo.providerFileId, path: fileInfo.providerPath }
        );
      }
      if (existing.isMissing) context.repo.markMissing(existing.id, false);
      queuePendingMetadata(context, existing);
    } else {
      const parsed = path.parse(filePath);
      const input: Parameters<VideoRepository["upsertVideo"]>[0] = {
        sourceFolderId: context.sourceFolder.id,
        path: filePath,
        directory: parsed.dir,
        filename: parsed.base,
        basename: parsed.name,
        extension: parsed.ext.toLowerCase(),
        sizeBytes: fileInfo.sizeBytes,
        durationMs: null,
        width: null,
        height: null,
        format: null,
        videoCodec: null,
        videoProfile: null,
        pixelFormat: null,
        audioCodec: null,
        codecProbeStatus: "unprobed",
        modifiedAt: fileInfo.modifiedAt,
        metadataStatus: "pending",
        providerFileId: fileInfo.providerFileId ?? null,
        providerPath: fileInfo.providerPath ?? null,
        durationSource: "unknown"
      };
      const upsertWithoutReadback = (context.repo as Partial<VideoRepository>).upsertVideoWithoutReadback;
      if (typeof upsertWithoutReadback === "function") {
        upsertWithoutReadback.call(context.repo, input, sourceFolders);
      } else {
        context.repo.upsertVideo(input);
      }
      if (existing) context.counters.updatedVideos += 1;
      else context.counters.addedVideos += 1;
    }
    context.counters.resolvedFailures += safeResolveObjectStageFailures(
      context.repo,
      context.sourceFolder.id,
      filePath,
      "file",
      "file-processing"
    );
    return true;
  } catch (error) {
    context.fileFailureCount += 1;
    context.counters.fileFailures += 1;
    safeRecordFailure(context, "file", filePath, "file-processing", error);
    return false;
  }
}

function queuePendingMetadata(context: ScanContext, existing: VideoRecord): void {
  if (!context.dependencies.onMetadataPending) return;
  if (existing.providerFileId && existing.providerPath) return;
  if (existing.metadataStatus === "failed") {
    context.repo.markMetadataPending(existing.id, existing.path, existing.sizeBytes, existing.modifiedAt);
  }
  if (existing.metadataStatus !== "ready") context.dependencies.onMetadataPending(existing.id);
}

function finalizeScan(context: ScanContext, rootReadable: boolean): ScanResult {
  const failures = safeListFailures(context.repo, context.sourceFolder.id).filter((failure) => {
    const root = context.dependencies.scanRootPath;
    if (!root) return true;
    if (!isManagedPathWithin(failure.objectPath, root)) return false;
    return context.scanRecursive || normalizeManagedPath(failure.objectPath) === normalizeManagedPath(root)
      || normalizeManagedPath(path.dirname(failure.objectPath)) === normalizeManagedPath(root);
  });
  context.counters.pendingFailures = failures.length;
  const latest = failures[0];
  const localFailureCount = context.directoryFailureCount + context.fileFailureCount;
  const message = latest
    ? `${failures.length} unresolved scan issue(s): ${latest.errorSummary}`
    : context.lastFailure
      ? `${localFailureCount} ${context.lastFailure.objectType === "file" ? "file" : "folder"}${localFailureCount === 1 ? "" : "s"} failed: ${context.lastFailure.objectPath}: ${context.lastFailure.message}`
      : null;
  const now = new Date().toISOString();
  if (!context.dependencies.scanRootPath) context.repo.updateSourceFolderScanState(context.sourceFolder.id, now, message);

  if (!context.dependencies.scanRootPath && !(context.repo as Partial<VideoRepository>).reconcileDirectoryMissing && context.directoryFailureCount === 0) {
    context.repo.reconcileSourceFolderMissing(context.sourceFolder.id, context.discoveredFilePaths);
  }
  return {
    state: !rootReadable ? "offline" : failures.length > 0 || localFailureCount > 0 ? "completed-with-errors" : "completed",
    totalFiles: context.totalFiles,
    processedFiles: context.processedFiles,
    failureCount: failures.length || localFailureCount,
    message,
    counters: { ...context.counters },
    performance: roundScanPerformanceSummary(context.performance)
  };
}

function reconcileDeletedChildDirectories(context: ScanContext, parentPath: string, currentChildren: string[]): void {
  const currentKeys = new Set(currentChildren.map(normalizeManagedPath));
  for (const previousChild of safeListDirectChildSnapshots(context.repo, context.sourceFolder.id, parentPath)) {
    if (currentKeys.has(previousChild.normalizedPath)) continue;
    context.counters.missingVideos += safeMarkSubtreeMissing(context.repo, context.sourceFolder.id, previousChild.directoryPath);
    context.counters.resolvedFailures += safeResolveFailureSubtree(context.repo, context.sourceFolder.id, previousChild.directoryPath);
    safeDeleteSnapshotSubtree(context.repo, context.sourceFolder.id, previousChild.directoryPath);
  }
}

function snapshotCanSkip(
  previous: DirectorySnapshot | null,
  directoryMtime: string,
  videoCount: number,
  childCount: number,
  digest: string
): boolean {
  return Boolean(previous?.isComplete && !previous.hasUnresolvedFailure &&
    previous.directoryMtime === directoryMtime && previous.directVideoCount === videoCount &&
    previous.directChildCount === childCount && previous.directEntryDigest === digest);
}

function createDirectEntryDigest(videos: DirectoryEntry[], children: DirectoryEntry[]): string {
  // Keep the persisted digest byte-for-byte compatible with the previous
  // sorted-token SHA-256, but sort shallow copies of entry references rather
  // than materializing one additional large string for every directory item.
  const sortedChildren = children.slice().sort(compareDigestEntries);
  const sortedVideos = videos.slice().sort(compareDigestEntries);
  const hash = crypto.createHash("sha256");
  let first = true;
  const append = (entry: DirectoryEntry, prefix: "d" | "f"): void => {
    if (!first) hash.update("\n");
    first = false;
    hash.update(prefix);
    hash.update(":");
    hash.update(entry.name.toLocaleLowerCase());
    hash.update(":");
    hash.update(entry.scanIdentity ?? "");
  };
  // "d:" sorts before "f:" in the original global lexicographic ordering.
  for (const entry of sortedChildren) append(entry, "d");
  for (const entry of sortedVideos) append(entry, "f");
  return hash.digest("hex");
}

function compareDigestEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  const leftName = left.name.toLocaleLowerCase();
  const rightName = right.name.toLocaleLowerCase();
  const leftIdentity = left.scanIdentity ?? "";
  const rightIdentity = right.scanIdentity ?? "";
  const leftLength = leftName.length + 1 + leftIdentity.length;
  const rightLength = rightName.length + 1 + rightIdentity.length;
  const limit = Math.min(leftLength, rightLength);
  for (let index = 0; index < limit; index += 1) {
    const leftCode = index < leftName.length
      ? leftName.charCodeAt(index)
      : index === leftName.length ? 58 : leftIdentity.charCodeAt(index - leftName.length - 1);
    const rightCode = index < rightName.length
      ? rightName.charCodeAt(index)
      : index === rightName.length ? 58 : rightIdentity.charCodeAt(index - rightName.length - 1);
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
  return leftLength - rightLength;
}

function isFileEntry(entry: DirectoryEntry): boolean {
  return entry.kind !== undefined ? entry.kind === "file" : Boolean(entry.isFile?.());
}

function isDirectoryEntry(entry: DirectoryEntry): boolean {
  return entry.kind !== undefined ? entry.kind === "directory" : Boolean(entry.isDirectory?.());
}

function isAcceptedVideoEntry(entry: DirectoryEntry): boolean {
  if (!isFileEntry(entry)) return false;
  const lowerName = entry.name.toLocaleLowerCase();
  return !SKIPPED_SUFFIXES.some((suffix) => lowerName.endsWith(suffix)) && isVideoExtension(entry.name);
}

async function readDirectEntries(directory: string, dependencies: FileDiscoveryDependencies = {}): Promise<Dirent[]> {
  const timeoutMs = dependencies.directoryEntryTimeoutMs ?? DIRECTORY_ENTRY_TIMEOUT_MS;
  let source: DirectoryEntries;
  // Some mapped/cloud drives incorrectly return ENOENT/EINVAL from readdir()
  // for an existing empty directory. The shared discovery implementation uses
  // opendir() by default, which those providers support, and streams large
  // directories without buffering every entry at once.
  source = await withTimeout(openDirectoryEntries(directory, dependencies), timeoutMs, directoryTimeoutMessage(timeoutMs));
  const result: Dirent[] = [];
  if (Symbol.asyncIterator in source) {
    const iterator = source[Symbol.asyncIterator]();
    while (true) {
      const next = await withTimeout(Promise.resolve(iterator.next()), timeoutMs, directoryTimeoutMessage(timeoutMs));
      if (next.done) break;
      result.push(next.value);
    }
  } else {
    for (const entry of source) result.push(entry);
  }
  return result;
}

async function readScannedDirectory(context: ScanContext, directoryPath: string): Promise<ScannedDirectory> {
  if (context.cloudDirectorySource) {
    const key = normalizeManagedPath(directoryPath);
    const prefetched = context.cloudDirectoryPrefetches.get(key);
    if (prefetched) context.cloudDirectoryPrefetches.delete(key);
    const settled = prefetched
      ? await prefetched
      : await readCloudDirectorySettled(context, directoryPath);
    if (!settled.ok) throw settled.error;
    const listing = settled.listing;
    // CloudDriveDirectoryEntry already satisfies the compact scanner entry contract.
    // Avoid duplicating the full listing and per-entry closures.
    return {
      directoryMtime: listing.directoryMtime,
      entries: listing.entries
    };
  }
  const localReadStartedAt = performance.now();
  try {
    const entries = await readDirectEntries(directoryPath, context.dependencies.discovery);
    const directoryStat = await withTimeout(
      (context.dependencies.statImpl ?? stat)(directoryPath),
      FILE_STAT_TIMEOUT_MS,
      `Directory metadata timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
    );
    recordDirectoryRead(context, performance.now() - localReadStartedAt, entries.length, "local", false);
    return { entries, directoryMtime: directoryStat.mtime.toISOString() };
  } catch (error) {
    recordDirectoryRead(context, performance.now() - localReadStartedAt, 0, "local", true);
    throw error;
  }
}

async function inspectFailedFilePresence(context: ScanContext, filePath: string): Promise<FailedFilePresence> {
  if (context.cloudDirectorySource) {
    const parentPath = path.dirname(filePath);
    try {
      const listing = await readScannedDirectory(context, parentPath);
      const normalizedTarget = normalizeManagedPath(filePath);
      const entry = listing.entries.find((candidate) =>
        normalizeManagedPath(path.join(parentPath, candidate.name)) === normalizedTarget
      );
      return entry && isFileEntry(entry) ? { state: "exists", fileStat: entry.fileInfo } : { state: "confirmed-missing" };
    } catch (error) {
      throwIfCancelled(context.dependencies);
      return { state: "parent-unreadable", parentPath, error };
    }
  }
  try {
    const fileStat = await withTimeout(
      (context.dependencies.statImpl ?? stat)(filePath),
      FILE_STAT_TIMEOUT_MS,
      `File access timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
    );
    return { state: "exists", fileStat };
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") return { state: "file-unreadable", error };
  }

  const parentPath = path.dirname(filePath);
  try {
    const entries = await readDirectEntries(parentPath, context.dependencies.discovery);
    const normalizedTarget = normalizeManagedPath(filePath);
    const stillListed = entries.some((entry) => normalizeManagedPath(path.join(parentPath, entry.name)) === normalizedTarget);
    return stillListed ? { state: "exists" } : { state: "confirmed-missing" };
  } catch (error) {
    throwIfCancelled(context.dependencies);
    return { state: "parent-unreadable", parentPath, error };
  }
}

async function confirmMissingDirectory(
  context: ScanContext,
  directoryPath: string,
  parentDirectoryPath: string
): Promise<boolean> {
  const parentKey = normalizeManagedPath(parentDirectoryPath);
  let parentRead = context.missingDirectoryParentReads.get(parentKey);
  if (!parentRead) {
    parentRead = readScannedDirectory(context, parentDirectoryPath).then((result) => result.entries);
    context.missingDirectoryParentReads.set(parentKey, parentRead);
  }
  try {
    const entries = await parentRead;
    const normalizedTarget = normalizeManagedPath(directoryPath);
    return !entries.some((entry) =>
      isDirectoryEntry(entry) && normalizeManagedPath(path.join(parentDirectoryPath, entry.name)) === normalizedTarget
    );
  } catch {
    return false;
  }
}

function createContext(
  repo: VideoRepository,
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies,
  incrementRetry: boolean,
  cloudDirectorySource: MountedCloudDriveDirectorySource | null
): ScanContext {
  return {
    repo,
    sourceFolder,
    dependencies,
    taskId: dependencies.taskId ?? crypto.randomUUID(),
    mode: dependencies.mode ?? "current-folder",
    scanRecursive: dependencies.scanRecursive ?? sourceFolder.recursive,
    counters: createEmptyScanCounters(),
    totalFiles: 0,
    processedFiles: 0,
    discoveredFilePaths: [],
    directoryFailureCount: 0,
    fileFailureCount: 0,
    incrementRetry,
    lastFailure: null,
    missingDirectoryParentReads: new Map(),
    cloudDirectorySource,
    cloudDirectoryLimiter: cloudDirectorySource
      ? new AsyncWorkLimiter(normalizeCloudDirectoryConcurrency(dependencies.cloudDirectoryConcurrency))
      : null,
    cloudDirectoryPrefetches: new Map(),
    performance: createEmptyScanPerformanceSummary()
  };
}

function normalizeCloudDirectoryConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CLOUD_DIRECTORY_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1) throw new Error("CloudDrive directory concurrency must be a positive integer");
  return Math.min(value, 64);
}

class AsyncWorkLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

function prefetchCloudDirectories(context: ScanContext, directoryPaths: readonly string[]): void {
  if (!context.cloudDirectorySource || !context.cloudDirectoryLimiter) return;
  for (const directoryPath of directoryPaths) {
    const key = normalizeManagedPath(directoryPath);
    if (!context.cloudDirectoryPrefetches.has(key)) {
      context.cloudDirectoryPrefetches.set(key, readCloudDirectorySettled(context, directoryPath));
    }
  }
}

async function readCloudDirectorySettled(
  context: ScanContext,
  directoryPath: string
): Promise<SettledCloudDirectoryListing> {
  const startedAt = performance.now();
  try {
    const listing = await context.cloudDirectoryLimiter!.run(async () => {
      throwIfCancelled(context.dependencies);
      return context.cloudDirectorySource!.readDirectory(directoryPath, context.dependencies.isCancelled);
    });
    const wallDurationMs = performance.now() - startedAt;
    recordDirectoryRead(context, listing.readDurationMs ?? wallDurationMs, listing.entries.length, "cloud", false, wallDurationMs, listing.cacheHit ?? false);
    return { ok: true, listing };
  } catch (error) {
    const wallDurationMs = performance.now() - startedAt;
    recordDirectoryRead(context, wallDurationMs, 0, "cloud", true, wallDurationMs);
    return { ok: false, error };
  }
}

async function resolveCloudDirectorySource(
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies
): Promise<MountedCloudDriveDirectorySource | null> {
  const source = dependencies.cloudDirectorySource
    ? await dependencies.cloudDirectorySource(sourceFolder, dependencies.isCancelled, dependencies.mode === "current-folder" || Boolean(dependencies.scanRootPath))
    : await tryCreateMountedCloudDriveDirectorySource(sourceFolder, process.env, dependencies.isCancelled, dependencies.mode === "current-folder" || Boolean(dependencies.scanRootPath));
  throwIfCancelled(dependencies);
  if (sourceFolder.providerType === "clouddrive" && !source) {
    throw new Error("CloudDrive API 资料来源当前不可用；已保留数据库中的原有文件索引，未执行缺失对账");
  }
  return source;
}

function reportProgress(context: ScanContext, phase: ScanProgress["phase"], currentPath: string): void {
  context.dependencies.onProgress?.({
    phase,
    totalFiles: context.totalFiles,
    processedFiles: context.processedFiles,
    currentPath,
    counters: { ...context.counters }
  });
}

function recordDirectoryRead(
  context: ScanContext,
  durationMs: number,
  entryCount: number,
  source: "cloud" | "local",
  failed: boolean,
  wallDurationMs = durationMs,
  cacheHit = false
): void {
  const metrics = context.performance;
  const duration = Math.max(0, durationMs);
  metrics.directoryReadCount += 1;
  metrics.directoryReadDurationMs += duration;
  metrics.directoryReadMaxDurationMs = Math.max(metrics.directoryReadMaxDurationMs, duration);
  if (failed) metrics.directoryReadFailures += 1;
  else {
    metrics.directoryEntryCount += entryCount;
    metrics.directoryReadMaxEntries = Math.max(metrics.directoryReadMaxEntries, entryCount);
  }
  if (source === "cloud") {
    metrics.cloudDirectoryReadCount += 1;
    metrics.cloudDirectoryReadDurationMs += duration;
    metrics.cloudDirectoryReadWallDurationMs += Math.max(0, wallDurationMs);
    if (cacheHit) metrics.cloudDirectoryCacheHits += 1;
  } else {
    metrics.localDirectoryReadCount += 1;
    metrics.localDirectoryReadDurationMs += duration;
  }
}

function reconcileDirectoryEntries(context: ScanContext, directoryPath: string, entries: readonly DirectoryEntry[]): number {
  const startedAt = performance.now();
  try {
    return safeReconcileDirectoryEntries(context.repo, context.sourceFolder.id, directoryPath, entries);
  } finally {
    context.performance.missingReconciliationCount += 1;
    context.performance.missingReconciliationDurationMs += performance.now() - startedAt;
  }
}

function upsertDirectorySnapshot(context: ScanContext, input: Parameters<VideoRepository["upsertDirectorySnapshot"]>[0]): void {
  const startedAt = performance.now();
  try {
    safeUpsertSnapshot(context.repo, input);
  } finally {
    context.performance.snapshotWriteCount += 1;
    context.performance.snapshotWriteDurationMs += performance.now() - startedAt;
  }
}

function roundScanPerformanceSummary(metrics: ScanPerformanceSummary): ScanPerformanceSummary {
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    ...metrics,
    directoryReadDurationMs: round(metrics.directoryReadDurationMs),
    directoryReadMaxDurationMs: round(metrics.directoryReadMaxDurationMs),
    cloudDirectoryReadDurationMs: round(metrics.cloudDirectoryReadDurationMs),
    cloudDirectoryReadWallDurationMs: round(metrics.cloudDirectoryReadWallDurationMs),
    localDirectoryReadDurationMs: round(metrics.localDirectoryReadDurationMs),
    localFileStatDurationMs: round(metrics.localFileStatDurationMs),
    directoryDigestDurationMs: round(metrics.directoryDigestDurationMs),
    snapshotLookupDurationMs: round(metrics.snapshotLookupDurationMs),
    existingVideoLookupDurationMs: round(metrics.existingVideoLookupDurationMs),
    writeBatchDurationMs: round(metrics.writeBatchDurationMs),
    missingReconciliationDurationMs: round(metrics.missingReconciliationDurationMs),
    deletedChildReconciliationDurationMs: round(metrics.deletedChildReconciliationDurationMs),
    snapshotWriteDurationMs: round(metrics.snapshotWriteDurationMs)
  };
}

function safeGetSnapshot(repo: VideoRepository, sourceFolderId: string, directoryPath: string): DirectorySnapshot | null {
  return repo.getDirectorySnapshot?.(sourceFolderId, directoryPath) ?? null;
}

function safeUpsertSnapshot(repo: VideoRepository, input: Parameters<VideoRepository["upsertDirectorySnapshot"]>[0]): void {
  repo.upsertDirectorySnapshot?.(input);
}

function safeMarkSnapshotIncomplete(repo: VideoRepository, sourceFolderId: string, directoryPath: string): void {
  repo.markDirectorySnapshotIncomplete?.(sourceFolderId, directoryPath);
}

function safeListDirectChildSnapshots(repo: VideoRepository, sourceFolderId: string, parentPath: string): DirectorySnapshot[] {
  return repo.listDirectChildSnapshots?.(sourceFolderId, parentPath) ?? [];
}

function safeDeleteSnapshotSubtree(repo: VideoRepository, sourceFolderId: string, directoryPath: string): void {
  repo.deleteDirectorySnapshotSubtree?.(sourceFolderId, directoryPath);
}

function safeReconcileDirectoryEntries(
  repo: VideoRepository,
  sourceFolderId: string,
  directoryPath: string,
  entries: readonly DirectoryEntry[]
): number {
  const filenameReconciler = (repo as Partial<VideoRepository>).reconcileDirectoryMissingByFilenames;
  const safeFilenames = entries.every((entry) =>
    entry.name.length > 0
    && entry.name !== "."
    && entry.name !== ".."
    && !entry.name.includes(String.fromCharCode(47))
    && !entry.name.includes(String.fromCharCode(92))
  );
  if (typeof filenameReconciler === "function" && safeFilenames) {
    function* currentFilenames(): IterableIterator<string> {
      for (const entry of entries) yield entry.name;
    }
    return filenameReconciler.call(repo, sourceFolderId, directoryPath, currentFilenames());
  }
  return safeReconcileDirectory(
    repo,
    sourceFolderId,
    directoryPath,
    entries.map((entry) => path.join(directoryPath, entry.name))
  );
}

function safeReconcileDirectory(repo: VideoRepository, sourceFolderId: string, directoryPath: string, currentPaths: string[]): number {
  return repo.reconcileDirectoryMissing?.(sourceFolderId, directoryPath, currentPaths) ?? 0;
}

function safeMarkSubtreeMissing(repo: VideoRepository, sourceFolderId: string, directoryPath: string): number {
  return repo.markDirectorySubtreeMissing?.(sourceFolderId, directoryPath) ?? 0;
}

function safeRecordFailure(context: ScanContext, objectType: "file" | "directory", objectPath: string, failureStage: string, error: unknown): void {
  context.lastFailure = { objectType, objectPath, message: toErrorMessage(error) };
  context.repo.recordScanFailure?.({
    sourceFolderId: context.sourceFolder.id,
    scanTaskId: context.taskId,
    objectType,
    objectPath,
    failureStage,
    errorCode: getErrorCode(error),
    errorSummary: toErrorMessage(error),
    incrementRetry: context.incrementRetry
  });
}

function safeListFailures(repo: VideoRepository, sourceFolderId: string): ScanFailure[] {
  return repo.listScanFailures?.(sourceFolderId) ?? [];
}

function safeMarkRetrying(repo: VideoRepository, failureId: string): void {
  repo.markScanFailureRetrying?.(failureId);
}

function safeResolveFailure(repo: VideoRepository, failureId: string): number {
  return repo.resolveScanFailure?.(failureId) ?? 0;
}

function safeResolveObjectFailures(repo: VideoRepository, sourceFolderId: string, objectPath: string, objectType: "file" | "directory"): number {
  return repo.resolveScanFailuresForObject?.(sourceFolderId, objectPath, objectType) ?? 0;
}

function safeResolveAllObjectFailures(repo: VideoRepository, sourceFolderId: string, objectPath: string): number {
  return repo.resolveScanFailuresForObject?.(sourceFolderId, objectPath) ?? 0;
}

function safeResolveObjectStageFailures(
  repo: VideoRepository,
  sourceFolderId: string,
  objectPath: string,
  objectType: "file" | "directory",
  failureStage: string
): number {
  return repo.resolveScanFailuresForObjectStage?.(sourceFolderId, objectPath, objectType, failureStage) ?? 0;
}

function safeResolveFailureSubtree(repo: VideoRepository, sourceFolderId: string, directoryPath: string): number {
  return repo.resolveScanFailuresInSubtree?.(sourceFolderId, directoryPath) ?? 0;
}

function directoryTimeoutMessage(timeoutMs: number): string {
  return `Directory stopped responding for ${timeoutMs / 1000}s`;
}

function getErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") || null : null;
}

function throwIfCancelled(dependencies: ScannerDependencies): void {
  if (dependencies.isCancelled?.()) throw new ScanCancelledError();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
