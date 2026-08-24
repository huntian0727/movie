import type { CloudDriveLegacyBindingResult, SourceFolder } from "../../shared/videoTypes.js";
import {
  createMountedCloudDriveDirectorySources,
  type MountedCloudDriveDirectorySource
} from "../clouddrive/mountedScanner.js";
import type {
  CloudDriveBindingCandidateRecord,
  CloudDriveIdentityUpdate,
  VideoRepository
} from "../db/videoRepository.js";

const BINDING_CONCURRENCY = 8;
const MAX_REPORTED_ERRORS = 20;

interface BindingDependencies {
  createSources?(
    folders: readonly SourceFolder[]
  ): Promise<Map<string, MountedCloudDriveDirectorySource>>;
}

export async function bindLegacyCloudDriveDuplicateCandidates(
  repo: VideoRepository,
  dependencies: BindingDependencies = {}
): Promise<CloudDriveLegacyBindingResult> {
  const candidates = repo.listUnboundDuplicateCandidates();
  const candidateFolderIds = new Set(candidates.map((candidate) => candidate.sourceFolderId));
  const folders = repo.listSourceFolders().filter((folder) => candidateFolderIds.has(folder.id));
  const createSources = dependencies.createSources ?? ((sourceFolders) =>
    createMountedCloudDriveDirectorySources(sourceFolders, process.env, undefined, false, true));
  const sources = await createSources(folders);
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
    errors: []
  };

  const candidatesByFolder = groupBy(candidates, (candidate) => candidate.sourceFolderId);
  for (const folder of folders) {
    if (sources.has(folder.id)) continue;
    result.unmappedSourceFolderCount += 1;
    result.unmappedCandidateFileCount += candidatesByFolder.get(folder.id)?.length ?? 0;
  }

  const directoryTasks: Array<{
    folder: SourceFolder;
    source: MountedCloudDriveDirectorySource;
    directory: string;
    candidates: CloudDriveBindingCandidateRecord[];
  }> = [];
  for (const folder of folders) {
    const source = sources.get(folder.id);
    if (!source) continue;
    const byDirectory = groupBy(candidatesByFolder.get(folder.id) ?? [], (candidate) => candidate.directory);
    for (const [directory, directoryCandidates] of byDirectory) {
      directoryTasks.push({ folder, source, directory, candidates: directoryCandidates });
    }
  }

  const updatesByFolder = new Map<string, CloudDriveIdentityUpdate[]>();
  await forEachWithConcurrency(directoryTasks, BINDING_CONCURRENCY, async (task) => {
    try {
      const listing = await task.source.readDirectory(task.directory);
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
    } catch (error) {
      result.failedDirectoryCount += 1;
      if (result.errors.length < MAX_REPORTED_ERRORS) {
        result.errors.push({ path: task.directory, message: toMessage(error) });
      }
    }
  });

  for (const folder of folders) {
    const source = sources.get(folder.id);
    if (!source?.provider) continue;
    result.matchedFileCount += repo.bindCloudDriveVideoIdentities(folder.id, {
      rootPath: source.provider.rootPath,
      name: source.provider.name,
      readOnly: source.provider.readOnly
    }, updatesByFolder.get(folder.id) ?? []);
  }
  return result;
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
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!);
    }
  }));
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
