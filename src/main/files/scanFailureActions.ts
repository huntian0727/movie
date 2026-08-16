import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { ScanFailureCleanupAction, ScanFailureCleanupResult } from "../../shared/videoTypes.js";
import { classifyScanFailureForCleanup } from "../../shared/scanFailureCleanup.js";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "./pathNormalization.js";
import { permanentlyDeleteFile } from "./fileOperations.js";

export interface DeleteScanFailureFileDependencies {
  statImpl?: (targetPath: string) => Promise<Stats>;
  deleteImpl?: (targetPath: string) => Promise<void>;
  assertPermanentDeleteAllowed?: (videoIds: string[]) => void;
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
  let missing = false;
  try {
    const fileStat = await (dependencies.statImpl ?? stat)(failure.objectPath);
    if (!fileStat.isFile()) throw new Error("Scan failure path is not a file");
    if (video && (fileStat.size !== video.sizeBytes || fileStat.mtime.toISOString() !== video.modifiedAt)) {
      throw new Error("文件状态已变化，请先重新扫描，未执行删除");
    }
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") throw error;
    missing = true;
  }

  if (!missing) {
    if (video) {
      if (!dependencies.assertPermanentDeleteAllowed) {
        throw new Error("Permanent deletion requires the trusted duplicate-candidate full SHA-256 verification guard.");
      }
      dependencies.assertPermanentDeleteAllowed([video.id]);
    }
    await (dependencies.deleteImpl ?? permanentlyDeleteFile)(failure.objectPath);
  }
  repo.resolveScanFailuresForObject(failure.sourceFolderId, failure.objectPath);
  if (video) repo.removeVideo(video.id);
  return { deleted: !missing, videoId: video?.id ?? null };
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
    if (!failure || failure.status === "resolved" || classification?.category !== "confirmed-corrupt") {
      result.skippedCount += 1;
      result.items.push({ failureId, status: "skipped", message: "异常已解决或不属于确认损坏文件" });
      continue;
    }

    const video = repo.getVideoByPath(failure.objectPath);
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
