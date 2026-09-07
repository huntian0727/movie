import type { MetadataSizeRefreshItem, MetadataSizeRefreshResult, VideoRecord } from "../../shared/videoTypes.js";
import type { CloudDriveFileMetadataRefresh } from "../clouddrive/mountedScanner.js";
import type { VideoRepository } from "../db/videoRepository.js";

interface MetadataFileRefreshDependencies {
  refreshRemote(paths: readonly string[]): Promise<Map<string, CloudDriveFileMetadataRefresh>>;
  enqueueMetadata(videoId: string): void;
  onVideosUpdated?(videoIds: string[]): void;
  onSourcesUpdated?(sourceFolderIds: string[]): void;
}

export class MetadataFileRefreshService {
  constructor(
    private readonly repo: VideoRepository,
    private readonly dependencies: MetadataFileRefreshDependencies
  ) {}

  async refreshZeroByteFiles(videoIds: readonly string[]): Promise<MetadataSizeRefreshResult> {
    const uniqueIds = [...new Set(videoIds)];
    const videosById = new Map(this.repo.listVideosByIds(uniqueIds).map((video) => [video.id, video]));
    const items: MetadataSizeRefreshItem[] = [];
    const zeroByteVideos: VideoRecord[] = [];

    for (const videoId of uniqueIds) {
      const video = videosById.get(videoId);
      if (!video) {
        items.push(result(videoId, "", "failed", 0, null, "资料库记录不存在"));
      } else if (video.isMissing) {
        items.push(result(video.id, video.path, "missing", video.sizeBytes, null, "文件已标记为缺失，请先在文件缺失页复查"));
      } else if (video.sizeBytes !== 0) {
        items.push(result(video.id, video.path, "not-zero", video.sizeBytes, video.sizeBytes, "文件大小已不是 0B，无需重新读取"));
      } else {
        zeroByteVideos.push(video);
      }
    }

    if (zeroByteVideos.length > 0) {
      let remoteResults: Map<string, CloudDriveFileMetadataRefresh>;
      try {
        remoteResults = await this.dependencies.refreshRemote(zeroByteVideos.map((video) => video.path));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const video of zeroByteVideos) {
          items.push(result(video.id, video.path, "failed", video.sizeBytes, null, `CloudDrive 刷新失败：${message}`));
        }
        return summarize(uniqueIds.length, items);
      }

      const updatedVideoIds: string[] = [];
      const updatedSourceIds = new Set<string>();
      for (const expected of zeroByteVideos) {
        const remote = remoteResults.get(expected.path) ?? { status: "not-cloud-drive" as const };
        const current = safeGetVideo(this.repo, expected.id);
        if (!current || !sameVersion(current, expected)) {
          items.push(result(expected.id, expected.path, "stale", expected.sizeBytes, current?.sizeBytes ?? null, "记录已在刷新期间变化，请重新加载后再试"));
          continue;
        }
        if (remote.status === "not-cloud-drive") {
          items.push(result(expected.id, expected.path, "not-cloud-drive", 0, null, "不是可通过 CloudDrive API 刷新的文件"));
          continue;
        }
        if (remote.status === "missing") {
          this.repo.markMissing(current.id, true);
          this.repo.resolveScanFailuresForObject?.(current.sourceFolderId, current.path);
          updatedVideoIds.push(current.id);
          updatedSourceIds.add(current.sourceFolderId);
          items.push(result(current.id, current.path, "missing", 0, null, "CloudDrive 强制刷新后未找到该文件，已转入文件缺失复查"));
          continue;
        }
        if (remote.sizeBytes === 0) {
          if (current.metadataStatus === "pending") {
            this.repo.markMetadataFailed(current.id, current.path, current.sizeBytes, current.modifiedAt);
          }
          this.repo.recordScanFailure?.({
            sourceFolderId: current.sourceFolderId,
            scanTaskId: `metadata:${current.id}`,
            objectType: "file",
            objectPath: current.path,
            failureStage: "metadata",
            errorCode: "EMPTY_FILE",
            errorSummary: "CloudDrive 强制刷新后文件大小仍为 0B，已跳过媒体分析",
            incrementRetry: false
          });
          updatedVideoIds.push(current.id);
          updatedSourceIds.add(current.sourceFolderId);
          items.push(result(current.id, current.path, "still-zero", 0, 0, "远端大小仍为 0B，已标记为空文件或占位文件，不会调用 ffprobe"));
          continue;
        }
        const refreshed = this.repo.refreshVideoFileVersion(
          current.id,
          current.path,
          current.sizeBytes,
          current.modifiedAt,
          remote.sizeBytes,
          remote.modifiedAt
        );
        if (!refreshed) {
          items.push(result(current.id, current.path, "stale", 0, remote.sizeBytes, "记录版本已变化，请刷新页面后再试"));
          continue;
        }
        this.repo.updateVideoProviderIdentityIfVersion(current.id, current.path, remote.sizeBytes, remote.modifiedAt, {
          fileId: remote.providerFileId,
          path: remote.providerPath
        });
        this.repo.resolveScanFailuresForObjectStage?.(current.sourceFolderId, current.path, "file", "metadata");
        this.dependencies.enqueueMetadata(current.id);
        updatedVideoIds.push(current.id);
        updatedSourceIds.add(current.sourceFolderId);
        items.push(result(current.id, current.path, "updated", 0, remote.sizeBytes, "已更新文件大小并优先加入元数据分析队列"));
      }
      if (updatedVideoIds.length > 0) this.dependencies.onVideosUpdated?.(updatedVideoIds);
      if (updatedSourceIds.size > 0) this.dependencies.onSourcesUpdated?.([...updatedSourceIds]);
    }

    return summarize(uniqueIds.length, items);
  }
}

function result(
  videoId: string,
  path: string,
  status: MetadataSizeRefreshItem["status"],
  previousSizeBytes: number,
  currentSizeBytes: number | null,
  message: string
): MetadataSizeRefreshItem {
  return { videoId, path, status, previousSizeBytes, currentSizeBytes, message };
}

function summarize(requestedCount: number, items: MetadataSizeRefreshItem[]): MetadataSizeRefreshResult {
  return {
    requestedCount,
    updatedCount: items.filter((item) => item.status === "updated").length,
    stillZeroCount: items.filter((item) => item.status === "still-zero").length,
    missingCount: items.filter((item) => item.status === "missing").length,
    skippedCount: items.filter((item) => item.status === "not-cloud-drive" || item.status === "not-zero" || item.status === "stale").length,
    failureCount: items.filter((item) => item.status === "failed").length,
    items
  };
}

function safeGetVideo(repo: VideoRepository, videoId: string): VideoRecord | null {
  try {
    return repo.getVideo(videoId);
  } catch {
    return null;
  }
}

function sameVersion(current: VideoRecord, expected: VideoRecord): boolean {
  return current.path === expected.path
    && current.sizeBytes === expected.sizeBytes
    && current.modifiedAt === expected.modifiedAt;
}
