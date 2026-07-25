import { stat } from "node:fs/promises";
import path from "node:path";
import type { VideoRepository } from "../db/videoRepository.js";
import type { SourceFolder } from "../../shared/videoTypes.js";
import { streamVideoFiles, type FileDiscoveryDependencies } from "./fileDiscovery.js";
import { readMetadata, type MediaMetadata } from "./metadataService.js";

export interface ScanProgress {
  phase: "discovering" | "processing";
  totalFiles: number;
  processedFiles: number;
  currentPath: string | null;
}

export interface ScanResult {
  state: "completed" | "offline";
  totalFiles: number;
  processedFiles: number;
  failureCount: number;
  message: string | null;
}

export interface ScannerDependencies {
  readMetadata?: (filePath: string) => Promise<MediaMetadata>;
  onProgress?(progress: ScanProgress): void;
  waitIfPaused?(): Promise<void>;
  discovery?: FileDiscoveryDependencies;
  onMetadataPending?(videoId: string): void;
}

const FILE_STAT_TIMEOUT_MS = 15_000;

export async function scanSourceFolder(
  repo: VideoRepository,
  sourceFolder: SourceFolder,
  dependencies: ScannerDependencies = {}
): Promise<ScanResult> {
  const metadataReader = dependencies.readMetadata ?? readMetadata;
  const files: string[] = [];
  const failures: Array<{ filePath: string; message: string }> = [];
  const directoryFailures: Array<{ filePath: string; message: string }> = [];
  let processedFiles = 0;

  dependencies.onProgress?.({ phase: "discovering", totalFiles: 0, processedFiles: 0, currentPath: sourceFolder.path });

  try {
    for await (const filePath of streamVideoFiles(sourceFolder.path, sourceFolder.recursive, {
      ...dependencies.discovery,
      beforeDirectory: async (directory) => {
        await dependencies.waitIfPaused?.();
        await dependencies.discovery?.beforeDirectory?.(directory);
        dependencies.onProgress?.({
          phase: "discovering",
          totalFiles: files.length,
          processedFiles,
          currentPath: directory
        });
      },
      onDirectoryError: (directory, error) => {
        directoryFailures.push({ filePath: directory, message: toErrorMessage(error) });
        dependencies.discovery?.onDirectoryError?.(directory, error);
      }
    })) {
      await dependencies.waitIfPaused?.();
      files.push(filePath);
      dependencies.onProgress?.({ phase: "processing", totalFiles: files.length, processedFiles, currentPath: filePath });

      try {
        const fileStat = await withTimeout(stat(filePath), FILE_STAT_TIMEOUT_MS, `File access timed out after ${FILE_STAT_TIMEOUT_MS / 1000}s`);
        const existing = repo.getVideoByPath(filePath);
        const modifiedAt = fileStat.mtime.toISOString();

        if (existing && existing.sizeBytes === fileStat.size && existing.modifiedAt === modifiedAt) {
          if (existing.isMissing) repo.markMissing(existing.id, false);
          if (dependencies.onMetadataPending) {
            if (existing.metadataStatus === "failed") {
              repo.markMetadataPending(existing.id, existing.path, existing.sizeBytes, existing.modifiedAt);
            }
            if (existing.metadataStatus !== "ready") dependencies.onMetadataPending(existing.id);
          }
          continue;
        }

        const parsed = path.parse(filePath);
        if (dependencies.onMetadataPending) {
          const stored = repo.upsertVideo({
            sourceFolderId: sourceFolder.id,
            path: filePath,
            directory: parsed.dir,
            filename: parsed.base,
            basename: parsed.name,
            extension: parsed.ext.toLowerCase(),
            sizeBytes: fileStat.size,
            durationMs: null,
            width: null,
            height: null,
            format: null,
            modifiedAt,
            metadataStatus: "pending"
          });
          dependencies.onMetadataPending(stored.id);
        } else {
          const metadata = await metadataReader(filePath);
          repo.upsertVideo({
            sourceFolderId: sourceFolder.id,
            path: filePath,
            directory: parsed.dir,
            filename: parsed.base,
            basename: parsed.name,
            extension: parsed.ext.toLowerCase(),
            sizeBytes: fileStat.size,
            durationMs: metadata.durationMs,
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            modifiedAt
          });
        }
      } catch (error) {
        failures.push({ filePath, message: toErrorMessage(error) });
      } finally {
        processedFiles += 1;
        dependencies.onProgress?.({ phase: "processing", totalFiles: files.length, processedFiles, currentPath: filePath });
      }
    }
  } catch (error) {
    const message = toErrorMessage(error);
    repo.updateSourceFolderScanState(
      sourceFolder.id,
      new Date().toISOString(),
      `1 folder failed: ${sourceFolder.path}: ${message}`
    );
    return { state: "offline", totalFiles: files.length, processedFiles, failureCount: failures.length + 1, message };
  }

  if (directoryFailures.length === 0) repo.reconcileSourceFolderMissing(sourceFolder.id, files);

  const message = summarizeFailures([...directoryFailures, ...failures]);
  repo.updateSourceFolderScanState(sourceFolder.id, new Date().toISOString(), message);
  return {
    state: "completed",
    totalFiles: files.length,
    processedFiles,
    failureCount: directoryFailures.length + failures.length,
    message
  };
}

export async function syncEnabledFolders(
  repo: VideoRepository,
  scan: (repo: VideoRepository, sourceFolder: SourceFolder) => Promise<unknown> = scanSourceFolder
): Promise<void> {
  const folders = repo.listSourceFolders().filter((folder) => folder.enabled);

  for (const folder of folders) {
    await scan(repo, folder);
  }
}

function summarizeFailures(failures: Array<{ filePath: string; message: string }>): string | null {
  if (failures.length === 0) {
    return null;
  }

  const [{ filePath, message }] = failures;
  const label = failures.length === 1 ? "file" : "files";
  return `${failures.length} ${label} failed: ${filePath}: ${message}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
