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
    const files = [...new Map(entries.flatMap((entry) => [entry.keepVideo, ...entry.deleteVideos])
      .map((video) => [video.id, video])).values()];
    const cloudFiles = files.filter((video) => sources.get(video.sourceFolderId)?.providerType === "clouddrive");
    // Mounted CloudDrive filesystem stat may be slow and inaccurate. For remote media
    // the authoritative proof is the refreshed provider ID/path/size/mtime below.
    // Keep the original filesystem preflight for ordinary, entirely local plans.
    if (cloudFiles.length === 0) {
      const preflight = await previewDuplicateResolveSafely(repo, queue, plan);
      if (preflight.status !== "ready") throw new Error("候选文件已缺失或版本变化；请刷新重复项后重新核对，不会删除。");
    } else {
      // Mixed plans must still verify ALL local files before any remote deletion.
      for (const file of files) {
        const folder = sources.get(file.sourceFolderId);
        if (!folder || folder.providerType === "clouddrive") continue;
        const info = await assertManagedOrdinaryFile(file.path, folder.path);
        if (info.size !== file.sizeBytes || info.mtime.toISOString() !== file.modifiedAt) {
          throw new Error("本地保留或待删文件已变化，请刷新重复项后重新核对。");
        }
      }
    }
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
      const seenRemoteIds = new Set<string>();
      for (const file of cloudFiles) {
        const remotePath = file.providerPath!.toLocaleLowerCase();
        const remoteId = file.providerFileId!;
        if (seenRemotePaths.has(remotePath) || seenRemoteIds.has(remoteId)) {
          throw new Error("多个资料库记录指向同一个 CloudDrive 远端文件；不能安全区分保留和删除目标。");
        }
        seenRemotePaths.add(remotePath);
        seenRemoteIds.add(remoteId);
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
  const unknownIds: string[] = [];
  let reclaimedBytes = 0;
  let recycledCount = 0;
  let unsubmittedCount = 0;
  let uncertainMessage: string | undefined;
  type Work = { entry: (typeof entries)[number]; video: VideoRecord };
  const work: Work[] = entries.flatMap((entry) => entry.deleteVideos.map((video) => ({ entry, video })));
  const recordFailure = (item: Work, cause: unknown) => {
    failures.push({
      videoId: item.video.id, groupKey: item.entry.groupKey, path: item.video.path,
      message: cause instanceof Error ? cause.message : String(cause)
    });
  };
  const currentRecords = (item: Work) => {
    const keep = repo.getVideo(item.entry.keepVideo.id);
    const target = repo.getVideo(item.video.id);
    if (!sameVersion(keep, item.entry.keepVideo) || !sameVersion(target, item.video) ||
        !sameRoundedDuration(keep, target)) {
      throw new Error("重复组、文件版本或计划保留项已变化，取消删除。");
    }
    const keepSource = sources.get(keep.sourceFolderId);
    const targetSource = sources.get(target.sourceFolderId);
    if (!keepSource || !targetSource) throw new Error("来源目录已失效，无法安全删除。");
    return { keep, target, keepSource, targetSource };
  };
  const verifyLocalKeep = async (keep: VideoRecord, sourceRoot: string) => {
    const keptFile = await assertManagedOrdinaryFile(keep.path, sourceRoot);
    if (keptFile.size !== keep.sizeBytes || keptFile.mtime.toISOString() !== keep.modifiedAt) {
      throw new Error("保留文件状态已变化，拒绝删除同组副本。");
    }
  };

  // One fresh parent-directory listing can verify all three in-flight objects
  // and their keepers. CloudDrive RPC deletes still address ONE file each:
  // each reply remains attributable even if another request disconnects.
  const MAX_REMOTE_IN_FLIGHT = 3;
  let offset = 0;
  while (offset < work.length) {
    const item = work[offset]!;
    const source = sources.get(item.video.sourceFolderId);
    if (source?.providerType !== "clouddrive") {
      offset += 1;
      try {
        const { keep, target, keepSource, targetSource } = currentRecords(item);
        if (keepSource.providerType === "clouddrive") {
          if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
          // For a local target, the remotely kept copy still needs fresh proof.
          const freshKeep = await remote.refresh([keep.path]);
          assertFreshRemoteMetadata(keep, freshKeep);
        } else {
          await verifyLocalKeep(keep, keepSource.path);
        }
        await permanentlyDeleteManagedFile(target.path, {
          sourceRoot: targetSource.path, sizeBytes: target.sizeBytes, modifiedAt: target.modifiedAt
        });
        repo.removeVideo(item.video.id);
        removedIds.push(item.video.id);
        reclaimedBytes += item.video.sizeBytes;
      } catch (error) {
        recordFailure(item, error);
      }
      continue;
    }

    const wave: Work[] = [];
    while (offset < work.length && wave.length < MAX_REMOTE_IN_FLIGHT &&
           sources.get(work[offset]!.video.sourceFolderId)?.providerType === "clouddrive") {
      wave.push(work[offset++]!);
    }
    // Coalesce refresh of the current wave's remote targets and keepers,
    // instead of repeating GetMountPoints/GetSubFiles for each video.
    const refreshPaths = [...new Set(wave.flatMap(({ entry, video }) => {
      const keeper = sources.get(entry.keepVideo.sourceFolderId)?.providerType === "clouddrive"
        ? [entry.keepVideo.path] : [];
      return [...keeper, video.path];
    }))];
    let fresh: Map<string, CloudDriveFileMetadataRefresh>;
    try {
      if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
      fresh = await remote.refresh(refreshPaths);
      if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
    } catch (error) {
      // No delete RPC has been submitted, so these are definite failures.
      for (const current of wave) recordFailure(current, error);
      continue;
    }
    const approved: Work[] = [];
    for (const current of wave) {
      try {
        const { keep, target, keepSource } = currentRecords(current);
        if (remote.binding() !== cloudBinding) throw new Error("CloudDrive 连接已变化，取消删除。");
        if (keepSource.providerType === "clouddrive") {
          assertFreshRemoteMetadata(keep, providerSnapshot);
          assertFreshRemoteMetadata(keep, fresh);
        } else {
          await verifyLocalKeep(keep, keepSource.path);
        }
        assertFreshRemoteMetadata(target, providerSnapshot);
        assertFreshRemoteMetadata(target, fresh);
        approved.push(current);
      } catch (error) {
        recordFailure(current, error);
      }
    }
    if (approved.length === 0) continue;
    if (remote.binding() !== cloudBinding) {
      for (const current of approved) recordFailure(current, new Error("CloudDrive 连接已变化，取消删除。"));
      continue;
    }

    // Bounded parallelism: fail-closed at the next wave boundary. Always await
    // all already-issued replies before reporting, so every success is counted.
    const replies = await Promise.all(approved.map(async (current) => {
      try {
        return { item: current, reply: await remote.delete([current.video.providerPath!]), unknown: null };
      } catch (cause) {
        return { item: current, reply: null,
          unknown: cause instanceof Error ? cause.message : String(cause) };
      }
    }));
    for (const { item: submitted, reply, unknown } of replies) {
      if (unknown !== null) {
        unknownIds.push(submitted.video.id);
        continue;
      }
      if (!reply?.success) {
        // A negative API response does NOT prove nothing happened remotely.
        // Report confirmed failure only if a forced read still finds the exact
        // same remote object; otherwise outcome is unknown and cannot be retried.
        try {
          const freshRejected = await remote.refresh([submitted.video.path]);
          assertFreshRemoteMetadata(submitted.video, freshRejected);
          recordFailure(submitted, new Error(reply?.errorMessage || "CloudDrive API 拒绝删除该文件。"));
        } catch {
          unknownIds.push(submitted.video.id);
        }
        continue;
      }
      try {
        repo.removeVideo(submitted.video.id);
        removedIds.push(submitted.video.id);
        if (reply.permanentlyDeleted === false) recycledCount++;
        else reclaimedBytes += submitted.video.sizeBytes;
      } catch {
        // Remote success but local DB update failed: user must verify the item.
        unknownIds.push(submitted.video.id);
      }
    }
    if (unknownIds.length > 0) {
      unsubmittedCount = work.length - offset;
      uncertainMessage = "CloudDrive 有 " + unknownIds.length +
        " 个已提交文件的结果无法确认（含网盘响应中断或本地记录更新失败）。" +
        "已等待同批所有请求完成，并停止提交后续文件；请核对网盘文件状态，不能直接重试结果未知的文件。";
      break;
    }
  }

  if (removedIds.length > 0) {
    try { onRemoved(removedIds); } catch { /* The caller also refreshes after returning. */ }
  }
  return {
    groupCount: entries.length, keepCount: entries.length, successCount: removedIds.length,
    failureCount: failures.length, reclaimedBytes, failures, recycledCount,
    uncertainCount: unknownIds.length, unsubmittedCount,
    uncertainMessage
  };
}

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
