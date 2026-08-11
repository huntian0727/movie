import { stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { VideoRepository } from "../db/videoRepository.js";
import { isManagedPathWithin } from "./pathNormalization.js";
import { permanentlyDeleteFile } from "./fileOperations.js";

export interface DeleteScanFailureFileDependencies {
  statImpl?: (targetPath: string) => Promise<Stats>;
  deleteImpl?: (targetPath: string) => Promise<void>;
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
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") throw error;
    missing = true;
  }

  if (!missing) await (dependencies.deleteImpl ?? permanentlyDeleteFile)(failure.objectPath);
  repo.resolveScanFailuresForObject(failure.sourceFolderId, failure.objectPath);
  if (video) repo.removeVideo(video.id);
  return { deleted: !missing, videoId: video?.id ?? null };
}

function getErrorCode(error: unknown): string | null {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : null;
}
