import type {
  CloudDriveLegacyBindingProgress,
  CloudDriveLegacyBindingResult,
  CloudDriveLegacyBindingState,
  SourceFolder
} from "../../shared/videoTypes.js";
import {
  createMountedCloudDriveDirectorySources,
  type MountedCloudDriveDirectorySource
} from "../clouddrive/mountedScanner.js";
import type {
  CloudDriveBindingCandidateRecord,
  CloudDriveIdentityUpdate,
  VideoRepository
} from "../db/videoRepository.js";

const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_INITIAL_CONCURRENCY = 16;
const DEFAULT_MIN_CONCURRENCY = 8;
const DEFAULT_MAX_CONCURRENCY = 32;
const MAX_REPORTED_ERRORS = 20;

interface BindingDependencies {
  createSources?(
    folders: readonly SourceFolder[],
    isCancelled: () => boolean
  ): Promise<Map<string, MountedCloudDriveDirectorySource>>;
  isCancelled?(): boolean;
  onProgress?(progress: CloudDriveLegacyBindingProgress): void;
  now?(): number;
  batchSize?: number;
  initialConcurrency?: number;
  minConcurrency?: number;
  maxConcurrency?: number;
}

interface DirectoryTask {
  folder: SourceFolder;
  source: MountedCloudDriveDirectorySource;
  directory: string;
  candidates: CloudDriveBindingCandidateRecord[];
}

export async function bindLegacyCloudDriveDuplicateCandidates(
  repo: VideoRepository,
  dependencies: BindingDependencies = {}
): Promise<CloudDriveLegacyBindingResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const isCancelled = dependencies.isCancelled ?? (() => false);
  const batchSize = positiveInteger(dependencies.batchSize, DEFAULT_BATCH_SIZE);
  const minConcurrency = positiveInteger(dependencies.minConcurrency, DEFAULT_MIN_CONCURRENCY);
  const maxConcurrency = Math.max(minConcurrency, positiveInteger(dependencies.maxConcurrency, DEFAULT_MAX_CONCURRENCY));
  let currentConcurrency = clamp(
    positiveInteger(dependencies.initialConcurrency, DEFAULT_INITIAL_CONCURRENCY),
    minConcurrency,
    maxConcurrency
  );
  let processedDirectoryCount = 0;

  const candidates = repo.listUnboundDuplicateCandidates();
  const candidateFolderIds = new Set(candidates.map((candidate) => candidate.sourceFolderId));
  const folders = repo.listSourceFolders().filter((folder) => candidateFolderIds.has(folder.id));
  const createSources = dependencies.createSources ?? ((sourceFolders, cancelled) =>
    createMountedCloudDriveDirectorySources(sourceFolders, process.env, cancelled, false, true));
  const sources = await createSources(folders, isCancelled);
  if (folders.length > 0 && sources.size === 0 && !isCancelled()) {
    throw new Error(
      `CloudDrive API 已连接，但 ${folders.length} 个候选资料库目录均无法匹配挂载点。请在设置中填写挂载映射，或检查 CloudDrive 返回的挂载路径。`
    );
  }

  const result: CloudDriveLegacyBindingResult = {
    sourceFolderCount: folders.length,
    boundSourceFolderCount: sources.size,
    unmappedSourceFolderCount: 0,
    unmappedCandidateFileCount: 0,
    scannedDirectoryCount: 0,
    failedDirectoryCount: 0,
    candidateFileCount: candidates.length,
    matchedFileCount: 0,
    missingFileCount: 0,
    sizeMismatchFileCount: 0,
    ambiguousFileCount: 0,
    cancelled: false,
    errors: []
  };

  const candidatesByFolder = groupBy(candidates, (candidate) => candidate.sourceFolderId);
  for (const folder of folders) {
    if (sources.has(folder.id)) continue;
    result.unmappedSourceFolderCount += 1;
    result.unmappedCandidateFileCount += candidatesByFolder.get(folder.id)?.length ?? 0;
  }

  const directoryTasks: DirectoryTask[] = [];
  for (const folder of folders) {
    const source = sources.get(folder.id);
    if (!source) continue;
    const byDirectory = groupBy(candidatesByFolder.get(folder.id) ?? [], (candidate) => candidate.directory);
    for (const [directory, directoryCandidates] of byDirectory) {
      directoryTasks.push({ folder, source, directory, candidates: directoryCandidates });
    }
  }

  const report = (state: CloudDriveLegacyBindingState = "running") => {
    dependencies.onProgress?.(createProgress(
      result,
      state,
      directoryTasks.length,
      processedDirectoryCount,
      currentConcurrency,
      startedAt,
      now()
    ));
  };
  report();

  for (let batchStart = 0; batchStart < directoryTasks.length; batchStart += batchSize) {
    if (isCancelled()) break;
    const batch = directoryTasks.slice(batchStart, batchStart + batchSize);
    const batchStartedAt = now();
    const processedBefore = processedDirectoryCount;
    const failuresBefore = result.failedDirectoryCount;
    const updatesByFolder = new Map<string, CloudDriveIdentityUpdate[]>();

    await forEachWithConcurrency(batch, currentConcurrency, isCancelled, async (task) => {
      try {
        const listing = await task.source.readDirectory(task.directory, isCancelled);
        result.scannedDirectoryCount += 1;
        const filesByName = groupBy(
          listing.entries.filter((entry) => entry.kind === "file"),
          (entry) => normalizeName(entry.name)
        );
        for (const candidate of task.candidates) {
          const sameName = filesByName.get(normalizeName(candidate.filename)) ?? [];
          if (sameName.length === 0) {
            result.missingFileCount += 1;
            continue;
          }
          const exact = sameName.filter((entry) => entry.fileInfo?.sizeBytes === candidate.sizeBytes
            && entry.fileInfo.providerFileId && entry.fileInfo.providerPath);
          if (exact.length === 0) {
            result.sizeMismatchFileCount += 1;
            continue;
          }
          if (exact.length > 1) {
            result.ambiguousFileCount += 1;
            continue;
          }
          const fileInfo = exact[0]!.fileInfo!;
          const updates = updatesByFolder.get(task.folder.id) ?? [];
          updates.push({
            videoId: candidate.videoId,
            expectedPath: candidate.path,
            expectedSizeBytes: candidate.sizeBytes,
            providerFileId: fileInfo.providerFileId!,
            providerPath: fileInfo.providerPath!,
            providerModifiedAt: fileInfo.modifiedAt
          });
          updatesByFolder.set(task.folder.id, updates);
        }
        processedDirectoryCount += 1;
      } catch (error) {
        if (isCancelled()) return;
        result.failedDirectoryCount += 1;
        processedDirectoryCount += 1;
        if (result.errors.length < MAX_REPORTED_ERRORS) {
          result.errors.push({ path: task.directory, message: toMessage(error) });
        }
      } finally {
        report(isCancelled() ? "cancelling" : "running");
      }
    });

    flushUpdates(repo, folders, sources, updatesByFolder, result);
    report(isCancelled() ? "cancelling" : "running");

    const completedInBatch = processedDirectoryCount - processedBefore;
    const failedInBatch = result.failedDirectoryCount - failuresBefore;
    currentConcurrency = adaptConcurrency(
      currentConcurrency,
      minConcurrency,
      maxConcurrency,
      completedInBatch,
      failedInBatch,
      Math.max(1, now() - batchStartedAt)
    );
  }

  result.cancelled = isCancelled();
  report(result.cancelled ? "cancelled" : "completed");
  return result;
}

function flushUpdates(
  repo: VideoRepository,
  folders: readonly SourceFolder[],
  sources: ReadonlyMap<string, MountedCloudDriveDirectorySource>,
  updatesByFolder: ReadonlyMap<string, CloudDriveIdentityUpdate[]>,
  result: CloudDriveLegacyBindingResult
): void {
  for (const folder of folders) {
    const updates = updatesByFolder.get(folder.id);
    const provider = sources.get(folder.id)?.provider;
    if (!provider || !updates || updates.length === 0) continue;
    result.matchedFileCount += repo.bindCloudDriveVideoIdentities(folder.id, {
      rootPath: provider.rootPath,
      name: provider.name,
      readOnly: provider.readOnly
    }, updates);
  }
}

function createProgress(
  result: CloudDriveLegacyBindingResult,
  state: CloudDriveLegacyBindingState,
  totalDirectoryCount: number,
  processedDirectoryCount: number,
  currentConcurrency: number,
  startedAt: number,
  currentTime: number,
  errorMessage: string | null = null
): CloudDriveLegacyBindingProgress {
  const elapsedMs = Math.max(0, currentTime - startedAt);
  const directoriesPerSecond = elapsedMs > 0 ? processedDirectoryCount * 1_000 / elapsedMs : 0;
  const remainingDirectories = Math.max(0, totalDirectoryCount - processedDirectoryCount);
  return {
    state,
    totalDirectoryCount,
    processedDirectoryCount,
    scannedDirectoryCount: result.scannedDirectoryCount,
    failedDirectoryCount: result.failedDirectoryCount,
    candidateFileCount: result.candidateFileCount,
    matchedFileCount: result.matchedFileCount,
    missingFileCount: result.missingFileCount,
    sizeMismatchFileCount: result.sizeMismatchFileCount,
    ambiguousFileCount: result.ambiguousFileCount,
    currentConcurrency,
    elapsedMs,
    directoriesPerSecond,
    estimatedRemainingMs: directoriesPerSecond > 0 ? remainingDirectories / directoriesPerSecond * 1_000 : null,
    errorMessage
  };
}

function adaptConcurrency(
  current: number,
  minimum: number,
  maximum: number,
  completedCount: number,
  failedCount: number,
  elapsedMs: number
): number {
  if (completedCount === 0) return current;
  if (failedCount > 0) return Math.max(minimum, Math.floor(current / 2));
  const estimatedRequestLatencyMs = elapsedMs * current / completedCount;
  if (estimatedRequestLatencyMs <= 1_500) return Math.min(maximum, current + 8);
  if (estimatedRequestLatencyMs >= 4_000) return Math.max(minimum, current - 8);
  return current;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeName(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const itemKey = key(item);
    const group = groups.get(itemKey) ?? [];
    group.push(item);
    groups.set(itemKey, group);
  }
  return groups;
}

async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  isCancelled: () => boolean,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length && !isCancelled()) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!);
    }
  }));
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
