import crypto from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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
import type { FileDiscoveryDependencies, DirectoryEntries } from "./fileDiscovery.js";
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
}

type FailedFilePresence =
  | { state: "exists"; fileStat?: Stats }
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
  const context = createContext(repo, sourceFolder, { ...dependencies, mode: dependencies.mode ?? "current-folder" }, false);
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
  const context = createContext(repo, sourceFolder, { ...dependencies, mode: "retry-failures" }, true);
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

  let entries: Dirent[];
  let directoryStat: Stats;
  try {
    entries = await readDirectEntries(directoryPath, context.dependencies.discovery);
    directoryStat = await withTimeout(
      (context.dependencies.statImpl ?? stat)(directoryPath),
      FILE_STAT_TIMEOUT_MS,
      `Directory metadata timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
    );
    throwIfCancelled(context.dependencies);
    context.counters.checkedDirectories += 1;
  } catch (error) {
    context.directoryFailureCount += 1;
    context.counters.directoryFailures += 1;
    safeRecordFailure(context, "directory", directoryPath, "directory-enumeration", error);
    safeMarkSnapshotIncomplete(context.repo, context.sourceFolder.id, directoryPath);
    return !isRoot;
  }

  const directVideos = entries.filter((entry) => isAcceptedVideoEntry(entry));
  const directChildren = context.sourceFolder.recursive
    ? entries.filter((entry) => entry.isDirectory())
    : [];
  const directVideoPaths = directVideos.map((entry) => path.join(directoryPath, entry.name));
  const directChildPaths = directChildren.map((entry) => path.join(directoryPath, entry.name));
  context.totalFiles += directVideos.length;
  context.discoveredFilePaths.push(...directVideoPaths);

  const digest = createDirectEntryDigest(directVideos, directChildren);
  const directoryMtime = directoryStat.mtime.toISOString();
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
    for (const filePath of directVideoPaths) {
      await context.dependencies.waitIfPaused?.();
      throwIfCancelled(context.dependencies);
      reportProgress(context, context.mode === "retry-failures" ? "retrying-failures" : "processing", filePath);
      if (!await processVideoFile(context, filePath)) directFailures += 1;
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

async function processVideoFile(context: ScanContext, filePath: string, knownFileStat?: Stats): Promise<boolean> {
  context.counters.processedVideos += 1;
  if (context.incrementRetry) context.counters.retriedFailures += 1;
  try {
    const fileStat = knownFileStat ?? await withTimeout(
      (context.dependencies.statImpl ?? stat)(filePath),
      FILE_STAT_TIMEOUT_MS,
      `File access timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`
    );
    const existing = context.repo.getVideoByPath(filePath);
    const modifiedAt = fileStat.mtime.toISOString();
    if (existing && existing.sizeBytes === fileStat.size && existing.modifiedAt === modifiedAt) {
      context.counters.skippedVideos += 1;
      if (existing.isMissing) context.repo.markMissing(existing.id, false);
      queuePendingMetadata(context, existing);
    } else {
      const parsed = path.parse(filePath);
      const stored = await upsertScannedVideo(context, existing, filePath, parsed, fileStat.size, modifiedAt);
      if (existing) context.counters.updatedVideos += 1;
      else context.counters.addedVideos += 1;
      if (context.dependencies.onMetadataPending) context.dependencies.onMetadataPending(stored.id);
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
  modifiedAt: string
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
      modifiedAt,
      metadataStatus: "pending"
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
    modifiedAt
  });
}

function queuePendingMetadata(context: ScanContext, existing: VideoRecord): void {
  if (!context.dependencies.onMetadataPending) return;
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
    safeResolveFailureSubtree(context.repo, context.sourceFolder.id, previousChild.directoryPath);
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

function createDirectEntryDigest(videos: Dirent[], children: Dirent[]): string {
  const entries = [
    ...videos.map((entry) => `f:${entry.name.toLocaleLowerCase()}`),
    ...children.map((entry) => `d:${entry.name.toLocaleLowerCase()}`)
  ].sort();
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}

function isAcceptedVideoEntry(entry: Dirent): boolean {
  if (!entry.isFile()) return false;
  const lowerName = entry.name.toLocaleLowerCase();
  return !SKIPPED_SUFFIXES.some((suffix) => lowerName.endsWith(suffix)) && isVideoExtension(entry.name);
}

async function readDirectEntries(directory: string, dependencies: FileDiscoveryDependencies = {}): Promise<Dirent[]> {
  const timeoutMs = dependencies.directoryEntryTimeoutMs ?? DIRECTORY_ENTRY_TIMEOUT_MS;
  let source: DirectoryEntries;
  if (dependencies.directoryEntriesImpl) {
    source = await withTimeout(dependencies.directoryEntriesImpl(directory), timeoutMs, directoryTimeoutMessage(timeoutMs));
  } else if (dependencies.readdirImpl) {
    source = await withTimeout(dependencies.readdirImpl(directory), timeoutMs, directoryTimeoutMessage(timeoutMs));
  } else {
    source = await withTimeout(readdir(directory, { withFileTypes: true }), timeoutMs, directoryTimeoutMessage(timeoutMs));
  }
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

async function inspectFailedFilePresence(context: ScanContext, filePath: string): Promise<FailedFilePresence> {
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
    return { state: "parent-unreadable", parentPath, error };
  }
}

function createContext(repo: VideoRepository, sourceFolder: SourceFolder, dependencies: ScannerDependencies, incrementRetry: boolean): ScanContext {
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
    lastFailure: null
  };
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

function safeResolveFailureSubtree(repo: VideoRepository, sourceFolderId: string, directoryPath: string): void {
  repo.resolveScanFailuresInSubtree?.(sourceFolderId, directoryPath);
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
