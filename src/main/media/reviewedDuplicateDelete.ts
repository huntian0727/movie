import type { DuplicateResolvePlan, DuplicateResolveResult, VideoRecord } from "../../shared/videoTypes.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { MetadataQueue } from "./metadataQueue.js";
import { assertManagedOrdinaryFile, permanentlyDeleteManagedFile } from "../files/safePermanentDelete.js";
import { previewDuplicateResolveSafely } from "./duplicateResolveSafety.js";
import {
  deleteCloudDriveFiles, refreshMountedCloudDriveFilesMetadata, getCloudDriveConnectionBinding,
  type CloudDriveFileMetadataRefresh
} from "../clouddrive/mountedScanner.js";
import type { CloudDriveFileOperationResult } from "../clouddrive/grpcClient.js";

const MAX_REVIEWED_DELETE_FILES = 100;

export interface ReviewedRemoteOperations {
  refresh(paths: readonly string[]): Promise<Map<string, CloudDriveFileMetadataRefresh>>;
  delete(paths: readonly string[]): Promise<CloudDriveFileOperationResult>;
  binding(): string | null;
}

/**
 * Explicit user-confirmed duplicate-only delete. Ordinary video:delete continues
 * to reject duplicate candidates. Never use the disabled legacy fast-delete API.
 *
 * The main process validates the keep/delete plan, reservations, live file versions
 * and identities. Local ordinary files use managed isolation and no-overwrite restore;
 * CloudDrive virtual mounts use refreshed provider identity + CloudDrive API rather
 * than unsafe Windows realpath/unlink of reparse points. No media content is hashed.
 */
export async function deleteReviewedDuplicatePlan(
  repo: VideoRepository,
  queue: Pick<MetadataQueue, "enqueue">,
  plan: DuplicateResolvePlan,
  assertNotReserved: (videoIds: string[]) => void,
  onRemoved: (videoIds: string[]) => void,
  remote: ReviewedRemoteOperations = {
    refresh: (paths) => refreshMountedCloudDriveFilesMetadata(paths),
    delete: (paths) => deleteCloudDriveFiles(paths),
    binding: () => getCloudDriveConnectionBinding()
  }
): Promise<DuplicateResolveResult> {
  const attempted = plan.groups.flatMap((group) => group.deleteVideoIds.map((videoId) => ({ groupKey: group.groupKey, videoId })));
  if (!attempted.length || attempted.length > MAX_REVIEWED_DELETE_FILES || plan.groups.length > MAX_REVIEWED_DELETE_FILES) {
    throw new Error("重复文件手动删除单批必须为 1–100 项。");
  }
  const failureResult = (message: string): DuplicateResolveResult => ({
    groupCount: plan.groups.length, keepCount: plan.groups.length,
    successCount: 0, failureCount: attempted.length, reclaimedBytes: 0,
    failures: attempted.map(({ videoId, groupKey }) => ({ videoId, groupKey, path: "", message }))
  });
  let entries: ReturnType<VideoRepository["validateDuplicateResolvePlan"]>;
  let providerSnapshot = new Map<string, CloudDriveFileMetadataRefresh>();
  let cloudBinding: string | null = null;
  const sources = new Map(repo.listSourceFolders().filter((folder) => folder.enabled).map((folder) => [folder.id, folder]));
  try {
    const keepIds = new Set(plan.groups.map((group) => group.keepVideoId));
    const deleteIds = attempted.map((item) => item.videoId);
    if (new Set(deleteIds).size !== deleteIds.length || deleteIds.some((id) => keepIds.has(id))) {
      throw new Error("计划中有重复删除目标或试图删除同页需要保留的文件。");
    }
    entries = repo.validateDuplicateResolvePlan(plan);
    assertNotReserved([...keepIds, ...deleteIds]);
    const preflight = await previewDuplicateResolveSafely(repo, queue, plan);
    if (preflight.status !== "ready") throw new Error("候选文件已缺失或版本变化；请刷新重复项后重新核对，不会删除。");

    const files = [...new Map(entries.flatMap((entry) => [entry.keepVideo, ...entry.deleteVideos])
      .map((video) => [video.id, video])).values()];
    const cloudFiles = files.filter((video) => sources.get(video.sourceFolderId)?.providerType === "clouddrive");
    for (const file of files) {
      const source = sources.get(file.sourceFolderId);
      if (!source) throw new Error("来源目录未启用，无法安全处理重复项。");
      if (source.providerReadOnly) throw new Error("存在只读来源，已停止删除。");
      if (source.providerType === "clouddrive" && (!file.providerFileId || !file.providerPath)) {
        throw new Error("CloudDrive 文件未绑定远端文件身份；请先完成旧文件身份绑定。");
      }
    }
    if (cloudFiles.length > 0) {
      // A remote object may be indexed via multiple mount roots; never delete
      // a path that the same submitted plan treats as an independent keeper.
      const seenRemotePaths = new Set<string>();
      for (const file of cloudFiles) {
        const remotePath = file.providerPath!.toLocaleLowerCase();
        if (seenRemotePaths.has(remotePath)) {
          throw new Error("多个资料库记录指向同一个 CloudDrive 远端文件；不能安全区分保留和删除目标。");
        }
        seenRemotePaths.add(remotePath);
      }
      cloudBinding = remote.binding();
      if (!cloudBinding) throw new Error("CloudDrive API 未连接，不能安全执行虚拟挂载文件的删除。");
      // Force-refresh remote parent directories; do not trust the local mount's realpath.
      providerSnapshot = await remote.refresh(cloudFiles.map((video) => video.path));
      if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，请重新确认。");
      for (const file of cloudFiles) assertFreshRemoteMetadata(file, providerSnapshot);
    }
  } catch (cause) {
    return failureResult(cause instanceof Error ? cause.message : String(cause));
  }

  const failures: DuplicateResolveResult["failures"] = [];
  const removedIds: string[] = [];
  let reclaimedBytes = 0;
  let recycledCount = 0;
  let uncertainMessage: string | undefined;
  reviewLoop: for (const entry of entries) {
    for (const video of entry.deleteVideos) {
      try {
        const keep = repo.getVideo(entry.keepVideo.id);
        const target = repo.getVideo(video.id);
        if (!sameVersion(keep, entry.keepVideo) || !sameVersion(target, video) ||
          !sameRoundedDuration(keep, target)) {
          throw new Error("重复组、文件版本或计划保留项已变化，取消删除。");
        }
        const keepSource = sources.get(keep.sourceFolderId);
        const targetSource = sources.get(target.sourceFolderId);
        if (!keepSource || !targetSource) throw new Error("来源目录已失效，无法安全删除。");

        if (keepSource.providerType === "clouddrive") {
          if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
          assertFreshRemoteMetadata(keep, providerSnapshot);
        } else {
          const keptFile = await assertManagedOrdinaryFile(keep.path, keepSource.path);
          if (keptFile.size !== keep.sizeBytes || keptFile.mtime.toISOString() !== keep.modifiedAt) {
            throw new Error("保留文件状态已变化，拒绝删除同组副本。");
          }
        }

        if (targetSource.providerType === "clouddrive") {
          if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
          // Re-read both remote identities directly before each irreversible action.
          // This is slower than a cached scan, but handles virtual mount replacement.
          const latest = await remote.refresh(keepSource.providerType === "clouddrive"
            ? [keep.path, target.path] : [target.path]);
          if (keepSource.providerType === "clouddrive") assertFreshRemoteMetadata(keep, latest);
          assertFreshRemoteMetadata(target, latest);
          if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
          let result: CloudDriveFileOperationResult;
          try { result = await remote.delete([target.providerPath!]); }
          catch (cause) { throw new RemoteOutcomeUnknown(cause instanceof Error ? cause.message : String(cause)); }
          if (!result.success) throw new Error(result.errorMessage || "CloudDrive 未确认删除该文件。请核查网盘真实状态。");
          try { repo.removeVideo(video.id); }
          catch (cause) { throw new RemoteOutcomeUnknown(`云端操作已返回成功，但本地记录更新失败：${cause instanceof Error ? cause.message : String(cause)}`); }
          if (result.permanentlyDeleted === false) recycledCount += 1;
          else reclaimedBytes += video.sizeBytes;
        } else {
          await permanentlyDeleteManagedFile(target.path, {
            sourceRoot: targetSource.path, sizeBytes: target.sizeBytes, modifiedAt: target.modifiedAt
          });
          repo.removeVideo(video.id);
          reclaimedBytes += video.sizeBytes;
        }
        removedIds.push(video.id);
      } catch (cause) {
        if (cause instanceof RemoteOutcomeUnknown) {
          uncertainMessage = `网盘请求中断，当前文件结果未知：${cause.message}。已停止后续提交，请先在 CloudDrive 中核实，再决定是否重试。`;
          break reviewLoop;
        }
        failures.push({
          videoId: video.id, groupKey: entry.groupKey, path: video.path,
          message: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
  }
  if (removedIds.length > 0) {
    try { onRemoved(removedIds); } catch { /* The caller also refreshes after returning. */ }
  }
  return {
    groupCount: entries.length, keepCount: entries.length, successCount: removedIds.length,
    failureCount: failures.length, reclaimedBytes, failures, recycledCount,
    uncertainCount: uncertainMessage ? 1 : 0,
    unsubmittedCount: uncertainMessage ? Math.max(0, attempted.length - removedIds.length - failures.length - 1) : 0,
    uncertainMessage
  };
}

class RemoteOutcomeUnknown extends Error {}

function assertFreshRemoteMetadata(
  video: VideoRecord,
  snapshot: ReadonlyMap<string, CloudDriveFileMetadataRefresh>
): void {
  const live = snapshot.get(video.path);
  if (live?.status !== "present" || !video.providerFileId || !video.providerPath ||
      live.providerFileId !== video.providerFileId ||
      live.providerPath !== video.providerPath ||
      live.sizeBytes !== video.sizeBytes ||
      live.modifiedAt !== video.modifiedAt) {
    throw new Error("CloudDrive 远端文件身份、路径、大小或修改时间已变化，已阻止删除；请重新同步或扫描。");
  }
}

function sameRoundedDuration(left: VideoRecord, right: VideoRecord): boolean {
  return left.sizeBytes === right.sizeBytes && left.sizeBytes > 0
    && left.durationMs !== null && right.durationMs !== null
    && left.durationMs > 0 && right.durationMs > 0
    && Math.floor((left.durationMs + 500) / 1000) === Math.floor((right.durationMs + 500) / 1000);
}
function sameVersion(left: VideoRecord, right: VideoRecord): boolean {
  return left.id === right.id && left.path === right.path && left.modifiedAt === right.modifiedAt
    && left.sizeBytes === right.sizeBytes && left.durationMs === right.durationMs
    && left.providerFileId === right.providerFileId && left.providerPath === right.providerPath
    && left.metadataStatus === "ready" && !left.isMissing;
}
