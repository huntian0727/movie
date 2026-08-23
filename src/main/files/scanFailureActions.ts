import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { ScanFailureCleanupAction, ScanFailureCleanupResult } from "../../shared/videoTypes.js";
import { classifyScanFailureForCleanup } from "../../shared/scanFailureCleanup.js";
import type { VideoRepository } from "../db/videoRepository.js";
import type { CloudDriveMissingConfirmation } from "../clouddrive/mountedScanner.js";
import { isManagedPathWithin } from "./pathNormalization.js";
import { permanentlyDeleteFile } from "./fileOperations.js";

export interface DeleteScanFailureFileDependencies {
  statImpl?: (targetPath: string) => Promise<Stats>;
  deleteImpl?: (targetPath: string) => Promise<void>;
  assertPermanentDeleteAllowed?: (videoIds: string[]) => void;
  confirmRemoteMissing?: (targetPath: string) => Promise<CloudDriveMissingConfirmation>;
}

export interface DeleteScanFailureFileResult {
  deleted: boolean;
  videoId: string | null;
}

export async function deleteScanFailureFile(
  repo: VideoRepository,
  failureId: string,
  dependencies: DeleteScanFailureFileDependencies = {}
): Promise<DeleteScanFailureFileResult> {
  const failure = repo.getScanFailure(failureId);
  if (!failure || failure.status === "resolved") throw new Error("Scan failure is no longer available");
  if (failure.objectType !== "file") throw new Error("Directories cannot be deleted from scan failures");
  if (classifyScanFailureForCleanup(failure).category !== "confirmed-corrupt") {
    throw new Error("该异常不能证明文件已经损坏，请先重试或人工确认");
  }
  const sourceFolder = repo.listSourceFolders().find((folder) => folder.id === failure.sourceFolderId);
  if (!sourceFolder) throw new Error("Source folder not found for scan failure");
  if (!isManagedPathWithin(failure.objectPath, sourceFolder.path)) {
    throw new Error("Refusing to delete a path outside its source folder");
  }

  const video = repo.getVideoByPath(failure.objectPath);
  if (!video) throw new Error("文件尚未入库，无法校验文件版本，未执行永久删除");
  try {
    const fileStat = await (dependencies.statImpl ?? stat)(failure.objectPath);
    if (!fileStat.isFile()) throw new Error("Scan failure path is not a file");
    if (fileStat.size !== video.sizeBytes || fileStat.mtime.toISOString() !== video.modifiedAt) {
      throw new Error("文件状态已变化，请先重新扫描，未执行删除");
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error("文件已不存在；请通过“清理网盘失效记录”重新确认远端状态");
    }
    throw error;
  }

  if (!dependencies.assertPermanentDeleteAllowed) {
    throw new Error("Permanent deletion requires the trusted duplicate-candidate full SHA-256 verification guard.");
  }
  dependencies.assertPermanentDeleteAllowed([video.id]);
  await (dependencies.deleteImpl ?? permanentlyDeleteFile)(failure.objectPath);
  repo.resolveScanFailuresForObject(failure.sourceFolderId, failure.objectPath);
  repo.removeVideo(video.id);
  return { deleted: true, videoId: video.id };
}

export async function removeConfirmedMissingScanFailureRecord(
  repo: VideoRepository,
  failureId: string,
  dependencies: DeleteScanFailureFileDependencies = {}
): Promise<{ videoId: string | null }> {
  const failure = repo.getScanFailure(failureId);
  if (!failure || failure.status === "resolved") throw new Error("Scan failure is no longer available");
  if (failure.objectType !== "file") throw new Error("Directories cannot be cleaned as missing files");
  if (classifyScanFailureForCleanup(failure).category !== "missing") {
    throw new Error("该异常不是文件不存在类型，不能清理为网盘失效记录");
  }
  const sourceFolder = repo.listSourceFolders().find((folder) => folder.id === failure.sourceFolderId);
  if (!sourceFolder) throw new Error("Source folder not found for scan failure");
  if (!isManagedPathWithin(failure.objectPath, sourceFolder.path)) {
    throw new Error("Refusing to clean a path outside its source folder");
  }
  if (!dependencies.confirmRemoteMissing) {
    throw new Error("清理网盘失效记录需要在线强制刷新验证");
  }
  const confirmation = await dependencies.confirmRemoteMissing(failure.objectPath);
  if (confirmation === "not-cloud-drive") throw new Error("该文件不属于已配置的 CloudDrive 挂载目录");
  if (confirmation === "present") throw new Error("强制刷新后远端文件仍然存在，未清理记录");

  const video = repo.getVideoByPath(failure.objectPath);
  repo.resolveScanFailuresForObject(failure.sourceFolderId, failure.objectPath);
  if (video) repo.removeVideo(video.id);
  return { videoId: video?.id ?? null };
}

export async function cleanupScanFailures(
  repo: VideoRepository,
  failureIds: string[],
  action: ScanFailureCleanupAction,
  dependencies: DeleteScanFailureFileDependencies = {}
): Promise<ScanFailureCleanupResult> {
  const result: ScanFailureCleanupResult = {
    action,
    successCount: 0,
    skippedCount: 0,
    failureCount: 0,
    reclaimedBytes: 0,
    items: []
  };

  for (const failureId of [...new Set(failureIds)]) {
    const failure = repo.getScanFailure(failureId);
    const classification = failure ? classifyScanFailureForCleanup(failure) : null;
    const expectedCategory = action === "remove-missing-record" ? "missing" : "confirmed-corrupt";
    if (!failure || failure.status === "resolved" || classification?.category !== expectedCategory) {
      result.skippedCount += 1;
      result.items.push({ failureId, status: "skipped", message: "异常已解决或不属于确认损坏文件" });
      continue;
    }

    const video = repo.getVideoByPath(failure.objectPath);
    if (action === "remove-missing-record") {
      try {
        await removeConfirmedMissingScanFailureRecord(repo, failureId, dependencies);
        result.successCount += 1;
        result.items.push({ failureId, status: "record-removed", message: "远端已确认不存在，本地记录已清理" });
      } catch (error) {
        result.failureCount += 1;
        result.items.push({ failureId, status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    if (action === "mark-pending-delete") {
      if (!video) {
        result.skippedCount += 1;
        result.items.push({ failureId, status: "skipped", message: "文件尚未入库，无法加入待删除" });
        continue;
      }
      repo.setPendingDelete(video.id, true);
      result.successCount += 1;
      result.items.push({ failureId, status: "marked", message: "已加入待删除" });
      continue;
    }

    try {
      const sizeBytes = video?.sizeBytes ?? 0;
      const deleted = await deleteScanFailureFile(repo, failureId, dependencies);
      result.successCount += 1;
      if (deleted.deleted) result.reclaimedBytes += sizeBytes;
      result.items.push({ failureId, status: "deleted", message: deleted.deleted ? "已永久删除" : "文件已不存在，资料库记录已清理" });
    } catch (error) {
      result.failureCount += 1;
      result.items.push({ failureId, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

function getErrorCode(error: unknown): string | null {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : null;
}
