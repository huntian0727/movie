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
  cloudDirectorySource?(
    sourceFolder: SourceFolder,
    isCancelled?: () => boolean,
    forceRefresh?: boolean
  ): Promise<MountedCloudDriveDirectorySource | null>;
}

const FILE_STAT_TIMEOUT_MS = 15_000;
const DIRECTORY_ENTRY_TIMEOUT_MS = 30_000;
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
}

interface DirectoryEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
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
  reportProgress(context, "discovering", sourceFolder.path);
  const rootReadable = await scanDirectoryTree(context, sourceFolder.path, null, true);
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
  const directChildren = context.sourceFolder.recursive
    ? entries.filter((entry) => entry.isDirectory())
    : [];
  const directVideoPaths = directVideos.map((entry) => path.join(directoryPath, entry.name));
  const directChildPaths = directChildren.map((entry) => path.join(directoryPath, entry.name));
  context.totalFiles += directVideos.length;
  context.discoveredFilePaths.push(...directVideoPaths);

  const digest = createDirectEntryDigest(directVideos, directChildren);
  const previous = safeGetSnapshot(context.repo, context.sourceFolder.id, directoryPath);
  reportProgress(context, "comparing-snapshots", directoryPath);
  const canSkip = snapshotCanSkip(previous, directoryMtime, directVideos.length, directChildren.length, digest);

  reconcileDeletedChildDirectories(context, directoryPath, directChildPaths);
  if (canSkip) {
    context.counters.skippedDirectories += 1;
    context.counters.skippedVideos += directVideos.length;
    context.processedFiles += directVideos.length;
    context.counters.missingVideos += safeReconcileDirectory(context.repo, context.sourceFolder.id, directoryPath, directVideoPaths);
    reportProgress(context, "comparing-snapshots", directoryPath);
  } else {
    context.counters.changedDirectories += 1;
    let directFailures = 0;
    for (const entry of directVideos) {
      const filePath = path.join(directoryPath, entry.name);
      await context.dependencies.waitIfPaused?.();
      throwIfCancelled(context.dependencies);
      reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
      if (!await processVideoFile(context, filePath, entry.fileInfo)) directFailures += 1;
      context.processedFiles += 1;
      reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
    }
    context.counters.missingVideos += safeReconcileDirectory(context.repo, context.sourceFolder.id, directoryPath, directVideoPaths);
    safeUpsertSnapshot(context.repo, {
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

  for (const childPath of directChildPaths) await scanDirectoryTree(context, childPath, directoryPath, false);
  throwIfCancelled(context.dependencies);
  context.counters.resolvedFailures += safeResolveObjectFailures(context.repo, context.sourceFolder.id, directoryPath, "directory");
  return true;
}

async function processVideoFile(
  context: ScanContext,
  filePath: string,
  knownFileInfo?: Stats | CloudDriveScanFileInfo
): Promise<boolean> {
  context.counters.processedVideos += 1;
  if (context.incrementRetry) context.counters.retriedFailures += 1;
  try {
    const fileStat = knownFileInfo ?? await withTimeout(
      (context.dependencies.statImpl ?? stat)(filePath),
      FILE_STAT_TIMEOUT_MS,
      `File access timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
    );
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

function queuePendingMetadata(context: ScanContext, existing: VideoRecord): void {
  if (!context.dependencies.onMetadataPending) return;
  if (existing.providerFileId && existing.providerPath) return;
  if (existing.metadataStatus === "failed") {
    context.repo.markMetadataPending(existing.id, existing.path, existing.sizeBytes, existing.modifiedAt);
  }
  if (existing.metadataStatus !== "ready") context.dependencies.onMetadataPending(existing.id);
}

function finalizeScan(context: ScanContext, rootReadable: boolean): ScanResult {
  const failures = safeListFailures(context.repo, context.sourceFolder.id);
  context.counters.pendingFailures = failures.length;
  const latest = failures[0];
  const localFailureCount = context.directoryFailureCount + context.fileFailureCount;
  const message = latest
    ? `${failures.length} unresolved scan issue(s): ${latest.errorSummary}`
    : context.lastFailure
      ? `${localFailureCount} ${context.lastFailure.objectType === "file" ? "file" : "folder"}${localFailureCount === 1 ? "" : "s"} failed: ${context.lastFailure.objectPath}: ${context.lastFailure.message}`
      : null;
  const now = new Date().toISOString();
  context.repo.updateSourceFolderScanState(context.sourceFolder.id, now, message);

  if (!(context.repo as Partial<VideoRepository>).reconcileDirectoryMissing && context.directoryFailureCount === 0) {
    context.repo.reconcileSourceFolderMissing(context.sourceFolder.id, context.discoveredFilePaths);
  }
  return {
    state: !rootReadable ? "offline" : failures.length > 0 || localFailureCount > 0 ? "completed-with-errors" : "completed",
    totalFiles: context.totalFiles,
    processedFiles: context.processedFiles,
    failureCount: failures.length || localFailureCount,
    message,
    counters: { ...context.counters }
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
  const entries = [
    ...videos.map((entry) => `f:${entry.name.toLocaleLowerCase()}:${entry.scanIdentity ?? ""}`),
    ...children.map((entry) => `d:${entry.name.toLocaleLowerCase()}:${entry.scanIdentity ?? ""}`)
  ].sort();
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}

function isAcceptedVideoEntry(entry: DirectoryEntry): boolean {
  if (!entry.isFile()) return false;
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
    result.push(...source);
  }
  return result;
}

async function readScannedDirectory(context: ScanContext, directoryPath: string): Promise<ScannedDirectory> {
  if (context.cloudDirectorySource) {
    const listing = await context.cloudDirectorySource.readDirectory(directoryPath, context.dependencies.isCancelled);
    return {
      directoryMtime: listing.directoryMtime,
      entries: listing.entries.map((entry) => ({
        name: entry.name,
        isFile: () => entry.kind === "file",
        isDirectory: () => entry.kind === "directory",
        scanIdentity: entry.scanIdentity,
        fileInfo: entry.fileInfo
      }))
    };
  }
  const entries = await readDirectEntries(directoryPath, context.dependencies.discovery);
  const directoryStat = await withTimeout(
    (context.dependencies.statImpl ?? stat)(directoryPath),
    FILE_STAT_TIMEOUT_MS,
    `Directory metadata timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
  );
  return { entries, directoryMtime: directoryStat.mtime.toISOString() };
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
      return entry?.isFile() ? { state: "exists", fileStat: entry.fileInfo } : { state: "confirmed-missing" };
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
      entry.isDirectory() && normalizeManagedPath(path.join(parentDirectoryPath, entry.name)) === normalizedTarget
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
    counters: createEmptyScanCounters(),
    totalFiles: 0,
    processedFiles: 0,
    discoveredFilePaths: [],
    directoryFailureCount: 0,
    fileFailureCount: 0,
    incrementRetry,
    lastFailure: null,
    missingDirectoryParentReads: new Map(),
    cloudDirectorySource
  };
}

async function resolveCloudDirectorySource(
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies
): Promise<MountedCloudDriveDirectorySource | null> {
  const source = dependencies.cloudDirectorySource
    ? await dependencies.cloudDirectorySource(sourceFolder, dependencies.isCancelled, dependencies.mode === "current-folder")
    : await tryCreateMountedCloudDriveDirectorySource(sourceFolder, process.env, dependencies.isCancelled, dependencies.mode === "current-folder");
  throwIfCancelled(dependencies);
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
