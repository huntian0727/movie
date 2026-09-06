import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { MissingVideoActionItem, MissingVideoActionResult, SourceFolder, VideoRecord } from "../../shared/videoTypes.js";
import type { CloudDriveMissingConfirmation } from "../clouddrive/mountedScanner.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "./pathNormalization.js";

interface MissingVideoServiceDependencies {
  confirmRemoteMissingBatch(paths: readonly string[]): Promise<Map<string, CloudDriveMissingConfirmation>>;
  assertVideosAvailable(videoIds: string[]): void;
  enqueueMetadata(videoId: string): void;
  statPath?(targetPath: string): Promise<Stats>;
}

interface InspectionResult {
  requestedCount: number;
  items: MissingVideoActionItem[];
  confirmedMissingVideos: VideoRecord[];
}

export class MissingVideoService {
  constructor(private readonly repo: VideoRepository, private readonly dependencies: MissingVideoServiceDependencies) {}

  async recheck(videoIds: readonly string[]): Promise<MissingVideoActionResult> {
    const inspection = await this.inspect(videoIds);
    return summarize("recheck", inspection.requestedCount, inspection.items);
  }

  async forget(videoIds: readonly string[]): Promise<MissingVideoActionResult> {
    const inspection = await this.inspect(videoIds);
    if (inspection.confirmedMissingVideos.length > 0) {
      const confirmedMissingIds = inspection.confirmedMissingVideos.map((video) => video.id);
      this.dependencies.assertVideosAvailable(confirmedMissingIds);
      const removedIds = new Set(this.repo.removeMissingVideosIfVersions(inspection.confirmedMissingVideos));
      inspection.items = inspection.items.map((item) => {
        if (item.status !== "still-missing") return item;
        return removedIds.has(item.videoId)
          ? { ...item, status: "record-removed", message: "已仅移除资料库记录，未执行任何磁盘文件删除" }
          : { ...item, status: "skipped", message: "记录状态已变化，本次未移除" };
      });
    }
    return summarize("forget", inspection.requestedCount, inspection.items);
  }

  private async inspect(videoIds: readonly string[]): Promise<InspectionResult> {
    const uniqueIds = [...new Set(videoIds)];
    const videosById = new Map(this.repo.listVideosByIds(uniqueIds).map((video) => [video.id, video]));
    const foldersById = new Map(this.repo.listSourceFolders().map((folder) => [folder.id, folder]));
    const items: MissingVideoActionItem[] = [];
    const candidates: VideoRecord[] = [];

    for (const videoId of uniqueIds) {
      const video = videosById.get(videoId);
      if (!video) {
        items.push({ videoId, path: "", status: "skipped", message: "资料库记录已不存在" });
      } else if (!video.isMissing) {
        items.push({ videoId, path: video.path, status: "skipped", message: "记录已恢复为可访问状态" });
      } else {
        candidates.push(video);
      }
    }

    const cloudCandidates = candidates.filter((video) => foldersById.get(video.sourceFolderId)?.providerType === "clouddrive");
    const localCandidates = candidates.filter((video) => !cloudCandidates.includes(video));
    if (cloudCandidates.length > 0) {
      try {
        const confirmations = await this.dependencies.confirmRemoteMissingBatch(cloudCandidates.map((video) => video.path));
        for (const video of cloudCandidates) {
          const confirmation = confirmations.get(video.path);
          if (confirmation === "present") {
            items.push(this.restoreUnchanged(video));
          } else if (confirmation === "missing") {
            items.push({ videoId: video.id, path: video.path, status: "still-missing", message: "CloudDrive 强制刷新后确认远端文件不存在" });
          } else if (confirmation === "not-cloud-drive") {
            localCandidates.push(video);
          } else {
            items.push({ videoId: video.id, path: video.path, status: "failed", message: "CloudDrive 未返回可确认的文件状态" });
          }
        }
      } catch (cause) {
        const message = `CloudDrive 在线复查失败：${toMessage(cause)}`;
        for (const video of cloudCandidates) items.push({ videoId: video.id, path: video.path, status: "failed", message });
      }
    }

    const localGroups = groupBySource(localCandidates);
    for (const [sourceFolderId, videos] of localGroups) {
      const folder = foldersById.get(sourceFolderId);
      if (!folder) {
        for (const video of videos) items.push({ videoId: video.id, path: video.path, status: "failed", message: "所属资料库目录已不存在" });
        continue;
      }
      await this.inspectLocalGroup(folder, videos, items);
    }

    return {
      requestedCount: uniqueIds.length,
      items,
      confirmedMissingVideos: items
        .filter((item) => item.status === "still-missing")
        .map((item) => videosById.get(item.videoId))
        .filter((video): video is VideoRecord => Boolean(video))
    };
  }

  private async inspectLocalGroup(folder: SourceFolder, videos: VideoRecord[], items: MissingVideoActionItem[]): Promise<void> {
    const statPath = this.dependencies.statPath ?? stat;
    try {
      const sourceStats = await statPath(folder.path);
      if (!sourceStats.isDirectory()) throw new Error("来源路径不是目录");
    } catch (cause) {
      const message = `来源目录当前不可访问，本次未更改记录：${toMessage(cause)}`;
      for (const video of videos) items.push({ videoId: video.id, path: video.path, status: "failed", message });
      return;
    }

    const results = await mapWithConcurrency(videos, 16, async (video): Promise<MissingVideoActionItem> => {
      if (!isManagedPathWithin(video.path, folder.path)) {
        return { videoId: video.id, path: video.path, status: "failed", message: "文件路径已超出所属资料库目录" };
      }
      try {
        const fileStats = await statPath(video.path);
        if (!fileStats.isFile()) return { videoId: video.id, path: video.path, status: "failed", message: "目标路径存在，但不是普通文件" };
        const currentModifiedAt = fileStats.mtime.toISOString();
        if (fileStats.size === video.sizeBytes && currentModifiedAt === video.modifiedAt) return this.restoreUnchanged(video);
        const restored = this.repo.refreshVideoFileVersion(
          video.id,
          video.path,
          video.sizeBytes,
          video.modifiedAt,
          fileStats.size,
          currentModifiedAt
        );
        if (!restored) return { videoId: video.id, path: video.path, status: "skipped", message: "记录版本已变化，本次未覆盖" };
        this.dependencies.enqueueMetadata(video.id);
        return { videoId: video.id, path: video.path, status: "restored", message: "文件已恢复且版本发生变化，已重新加入元数据分析" };
      } catch (cause) {
        if (isMissingError(cause)) return { videoId: video.id, path: video.path, status: "still-missing", message: "已确认来源目录可访问，但文件不存在" };
        return { videoId: video.id, path: video.path, status: "failed", message: `文件状态无法确认：${toMessage(cause)}` };
      }
    });
    items.push(...results);
  }

  private restoreUnchanged(video: VideoRecord): MissingVideoActionItem {
    const restored = this.repo.restoreMissingIfVersion(video.id, video.path, video.sizeBytes, video.modifiedAt);
    return restored
      ? { videoId: video.id, path: video.path, status: "restored", message: "文件已恢复为可访问状态" }
      : { videoId: video.id, path: video.path, status: "skipped", message: "记录版本已变化，本次未覆盖" };
  }
}

function groupBySource(videos: readonly VideoRecord[]): Map<string, VideoRecord[]> {
  const groups = new Map<string, VideoRecord[]>();
  for (const video of videos) groups.set(video.sourceFolderId, [...(groups.get(video.sourceFolderId) ?? []), video]);
  return groups;
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) results[index] = await operation(item);
    }
  }));
  return results;
}

function summarize(operation: MissingVideoActionResult["operation"], requestedCount: number, items: MissingVideoActionItem[]): MissingVideoActionResult {
  const count = (status: MissingVideoActionItem["status"]) => items.filter((item) => item.status === status).length;
  return {
    operation,
    requestedCount,
    restoredCount: count("restored"),
    stillMissingCount: count("still-missing"),
    removedCount: count("record-removed"),
    skippedCount: count("skipped"),
    failureCount: count("failed"),
    items
  };
}

function isMissingError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR");
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
