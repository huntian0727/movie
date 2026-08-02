import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type {
  DuplicateResolveChangedItem,
  DuplicateResolveChangeType,
  DuplicateResolvePlan,
  DuplicateResolvePreviewResult,
  DuplicateResolveResult,
  VideoRecord
} from "../../shared/videoTypes.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { permanentlyDeleteFile } from "../files/fileOperations.js";
import { assertFileVersion } from "./contentFingerprint.js";
import type { MetadataQueue } from "./metadataQueue.js";

interface DuplicateResolveSafetyDependencies {
  statFile?: (filePath: string) => Promise<Stats>;
  listDirectory?: (directoryPath: string) => Promise<string[]>;
}

interface InspectedVideo {
  video: VideoRecord;
  changedItem: DuplicateResolveChangedItem | null;
}

export async function previewDuplicateResolveSafely(
  repo: VideoRepository,
  metadataQueue: Pick<MetadataQueue, "enqueue">,
  plan: DuplicateResolvePlan,
  dependencies: DuplicateResolveSafetyDependencies = {}
): Promise<DuplicateResolvePreviewResult> {
  const entries = repo.validateDuplicateResolvePlan(plan);
  const videos = uniqueVideos(entries.flatMap((entry) => [entry.keepVideo, ...entry.deleteVideos]));
  const inspected = await mapWithConcurrency(videos, 4, (video) => inspectVideo(video, dependencies));
  const changedItems = inspected.flatMap((item) => item.changedItem ? [item.changedItem] : []);

  if (changedItems.length === 0) {
    return {
      status: "ready",
      preview: { ...repo.previewDuplicateResolve(plan), verificationStatus: "file_versions_current" }
    };
  }

  for (const { video, changedItem } of inspected) {
    if (!changedItem || changedItem.changeType === "unreadable") continue;
    if (changedItem.changeType === "missing") {
      if (repo.markMissingIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt)) {
        repo.resolveScanFailuresForObject(video.sourceFolderId, video.path);
      }
      continue;
    }

    const refreshed = repo.refreshVideoFileVersion(
      video.id,
      video.path,
      video.sizeBytes,
      video.modifiedAt,
      changedItem.currentSizeBytes!,
      changedItem.currentModifiedAt!
    );
    if (refreshed) metadataQueue.enqueue(video.id);
  }

  return { status: "stale", changedItems };
}

export async function resolveDuplicatePlanSafely(
  repo: VideoRepository,
  plan: DuplicateResolvePlan,
  deleteFile: (filePath: string) => Promise<void> = permanentlyDeleteFile
): Promise<{ result: DuplicateResolveResult; removedVideoIds: string[] }> {
  const entries = repo.validateDuplicateResolvePlan(plan);
  const preview = repo.previewDuplicateResolve(plan);
  const failures: DuplicateResolveResult["failures"] = [];
  const removedVideoIds: string[] = [];
  let reclaimedBytes = 0;

  for (const group of entries) {
    for (const video of group.deleteVideos) {
      try {
        await assertFileVersion(group.keepVideo.path, {
          sizeBytes: group.keepVideo.sizeBytes,
          modifiedAt: group.keepVideo.modifiedAt
        });
        await assertFileVersion(video.path, {
          sizeBytes: video.sizeBytes,
          modifiedAt: video.modifiedAt
        });
        await deleteFile(video.path);
        repo.removeVideo(video.id);
        removedVideoIds.push(video.id);
        reclaimedBytes += video.sizeBytes;
      } catch (cause) {
        failures.push({
          groupKey: group.groupKey,
          videoId: video.id,
          path: safeVideoPath(repo, video.id),
          message: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
  }

  return {
    removedVideoIds,
    result: {
      groupCount: preview.groupCount,
      keepCount: preview.keepCount,
      successCount: removedVideoIds.length,
      failureCount: failures.length,
      reclaimedBytes,
      failures
    }
  };
}

async function inspectVideo(
  video: VideoRecord,
  dependencies: DuplicateResolveSafetyDependencies
): Promise<InspectedVideo> {
  const statFile = dependencies.statFile ?? stat;
  try {
    const current = await statFile(video.path);
    if (!current.isFile()) {
      return { video, changedItem: unreadableItem(video, "NOT_A_FILE", "目标路径不再是普通文件") };
    }
    const currentModifiedAt = current.mtime.toISOString();
    const sizeChanged = current.size !== video.sizeBytes;
    const mtimeChanged = currentModifiedAt !== video.modifiedAt;
    if (!sizeChanged && !mtimeChanged) return { video, changedItem: null };

    const changeType: DuplicateResolveChangeType = sizeChanged && mtimeChanged
      ? "size-and-mtime-changed"
      : sizeChanged ? "size-changed" : "mtime-changed";
    return {
      video,
      changedItem: {
        videoId: video.id,
        filename: video.filename,
        path: video.path,
        changeType,
        previousSizeBytes: video.sizeBytes,
        currentSizeBytes: current.size,
        previousModifiedAt: video.modifiedAt,
        currentModifiedAt,
        message: changeMessage(changeType)
      }
    };
  } catch (cause) {
    if (!isMissingError(cause)) {
      return { video, changedItem: unreadableItem(video, errorCode(cause), errorSummary(cause)) };
    }
    return { video, changedItem: await inspectMissingVideo(video, cause, dependencies) };
  }
}

async function inspectMissingVideo(
  video: VideoRecord,
  missingCause: unknown,
  dependencies: DuplicateResolveSafetyDependencies
): Promise<DuplicateResolveChangedItem> {
  const listDirectory = dependencies.listDirectory ?? (async (directoryPath: string) =>
    (await readdir(directoryPath, { withFileTypes: true })).map((entry) => entry.name));
  try {
    const names = await listDirectory(path.dirname(video.path));
    const targetName = path.basename(video.path).toLocaleLowerCase();
    if (names.some((name) => name.toLocaleLowerCase() === targetName)) {
      return unreadableItem(video, errorCode(missingCause), "目录中仍存在同名项，但文件状态无法读取");
    }
    return {
      videoId: video.id,
      filename: video.filename,
      path: video.path,
      changeType: "missing",
      previousSizeBytes: video.sizeBytes,
      previousModifiedAt: video.modifiedAt,
      errorCode: errorCode(missingCause),
      message: "文件已不存在"
    };
  } catch (parentCause) {
    return unreadableItem(video, errorCode(parentCause), `无法读取父目录：${errorSummary(parentCause)}`);
  }
}

function unreadableItem(video: VideoRecord, code: string, message: string): DuplicateResolveChangedItem {
  return {
    videoId: video.id,
    filename: video.filename,
    path: video.path,
    changeType: "unreadable",
    previousSizeBytes: video.sizeBytes,
    previousModifiedAt: video.modifiedAt,
    errorCode: code,
    message
  };
}

function changeMessage(changeType: DuplicateResolveChangeType): string {
  if (changeType === "size-changed") return "文件大小已变化";
  if (changeType === "mtime-changed") return "文件修改时间已变化";
  return "文件大小和修改时间均已变化";
}

function isMissingError(cause: unknown): boolean {
  return errorCode(cause) === "ENOENT" || (cause instanceof Error && /\bENOENT\b|no such file/i.test(cause.message));
}

function errorCode(cause: unknown): string {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "UNREADABLE";
}

function errorSummary(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : "文件无法访问";
}

function uniqueVideos(videos: VideoRecord[]): VideoRecord[] {
  const seen = new Set<string>();
  return videos.filter((video) => !seen.has(video.id) && Boolean(seen.add(video.id)));
}

function safeVideoPath(repo: VideoRepository, videoId: string): string {
  try {
    return repo.getVideo(videoId).path;
  } catch {
    return "";
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}
