import { dialog, ipcMain as electronIpcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS, MAX_PLAYER_QUEUE_ITEMS, SORT_FIELDS } from "../shared/videoTypes.js";
import { isValidShortcutBinding } from "../shared/shortcuts.js";
import type { DatabaseConnection } from "./db/database.js";
import type { DuplicateCleanupRepository } from "./db/duplicateCleanupRepository.js";
import type { VideoRepository } from "./db/videoRepository.js";
import { commitMoveWithRollback, commitRenameWithRollback, inspectMoveTarget, moveFileWithConflictResolution, permanentlyDeleteFile, renamePreservingExtension } from "./files/fileOperations.js";
import { deleteScanFailureFile } from "./files/scanFailureActions.js";
import { isManagedPathWithin } from "./files/pathNormalization.js";
import {
  buildDiagnosticPackage,
  buildDiagnosticsPreview,
  runDiagnosticChecks,
  summarizeOperationResult
} from "./logging/index.js";
import type { DiagnosticEnvironment } from "./logging/types.js";
import type { StructuredLogger } from "./logging/logger.js";
import { buildCacheKey, getCoverPath, getCoverTimeSeconds } from "./media/cacheService.js";
import type { MediaCacheManager } from "./media/cacheManager.js";
import { previewDuplicateResolveSafely, resolveDuplicatePlanSafely } from "./media/duplicateResolveSafety.js";
import type { ScanManager } from "./media/scanManager.js";
import type { MetadataQueue } from "./media/metadataQueue.js";
import type { DuplicateCleanupService } from "./media/duplicateCleanupService.js";
import { playWithMpv, waitForMpvStart } from "./media/mpvController.js";
import type { DomainEventBus, PlayerWindowCoordinator } from "./playerWindow.js";
import { wrapTrustedIpcHandler } from "./security.js";
import type { SettingsStore } from "./settings/settingsStore.js";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

let ipcLogger: StructuredLogger | undefined;
const loggedIpcChannels = new Set<string>([
  IPC_CHANNELS.duplicateResolve,
  IPC_CHANNELS.folderAdd,
  IPC_CHANNELS.folderScan,
  IPC_CHANNELS.folderScanAll,
  IPC_CHANNELS.folderScanFailuresRetry,
  IPC_CHANNELS.scanFailureReviewRetry,
  IPC_CHANNELS.scanFailureReviewDelete,
  IPC_CHANNELS.folderRemove,
  IPC_CHANNELS.folderScanPause,
  IPC_CHANNELS.folderScanResume,
  IPC_CHANNELS.videoFavorite,
  IPC_CHANNELS.videoPendingDelete,
  IPC_CHANNELS.videoPendingDeleteClear,
  IPC_CHANNELS.videoRename,
  IPC_CHANNELS.videoDelete,
  IPC_CHANNELS.videoBatchDelete,
  IPC_CHANNELS.videoBatchMove,
  IPC_CHANNELS.videoForget,
  IPC_CHANNELS.videoRegenerateCover,
  IPC_CHANNELS.videoOpenPlayer,
  IPC_CHANNELS.videoPlayExternal,
  IPC_CHANNELS.settingsSet,
  IPC_CHANNELS.cacheClear,
  IPC_CHANNELS.diagnosticsExport
]);

const ipcMain = {
  handle(channel: string, listener: IpcHandler): void {
    electronIpcMain.handle(channel, wrapTrustedIpcHandler(channel, async (event, ...args) => {
      const operationId = ipcLogger?.createOperationId() ?? "";
      const startedAt = Date.now();
      if (loggedIpcChannels.has(channel)) {
        ipcLogger?.info({
          module: "ipc",
          operationId,
          event: "operation_started",
          context: { channel, argumentCount: args.length }
        });
      }
      try {
        const result = await listener(event, ...args);
        if (loggedIpcChannels.has(channel)) {
          ipcLogger?.info({
            module: "ipc",
            operationId,
            event: "operation_completed",
            durationMs: Date.now() - startedAt,
            context: { channel, ...summarizeOperationResult(result) }
          });
        }
        return result;
      } catch (error) {
        ipcLogger?.error({
          module: "ipc",
          operationId,
          event: "operation_failed",
          durationMs: Date.now() - startedAt,
          message: `IPC operation failed: ${channel}`,
          context: { channel },
          error
        });
        throw error;
      }
    }));
  }
};

const libraryQuerySchema = z
  .object({
    view: z.enum(["all", "favorites", "pendingDelete", "folder", "recent", "duplicates"]),
    folderId: z.string().optional(),
    search: z.string(),
    sortField: z.enum(SORT_FIELDS),
    sortDirection: z.enum(["asc", "desc"]),
    includeMissing: z.boolean()
  })
  .strict();

const libraryPageQuerySchema = z.object({
  view: z.enum(["all", "favorites", "pendingDelete", "folder", "recent"]),
  directoryPath: z.string().optional(),
  folderScope: z.enum(["recursive", "exact"]).optional(),
  search: z.string(),
  sortField: z.enum(SORT_FIELDS),
  sortDirection: z.enum(["asc", "desc"]),
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100), z.literal(200), z.literal(300)])
}).strict();

const videoIdSchema = z.object({ videoId: z.string().min(1) }).strict();
const videoIdsSchema = z.array(z.string().min(1)).min(1).max(500);
const playerSessionSchema = videoIdSchema.extend({
  queueIds: z.array(z.string().min(1)).min(1).max(MAX_PLAYER_QUEUE_ITEMS)
});
const batchMoveSchema = z.object({ videoIds: videoIdsSchema, targetDirectory: z.string().min(1), addTargetToLibrary: z.boolean() }).strict();
const duplicateGroupPageQuerySchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(500)]),
  sortDirection: z.enum(["asc", "desc"]),
  preferredDirectoryPath: z.string().min(1).optional(),
  preferredDirectoryScope: z.enum(["recursive", "exact"]).optional()
}).strict();
const duplicateResolvePlanSchema = z
  .object({
    groups: z.array(
      z
        .object({
          groupKey: z.string().min(1),
          keepVideoId: z.string().min(1),
          deleteVideoIds: z.array(z.string().min(1)).min(1)
        })
        .strict()
    )
  })
  .strict();
const duplicateCleanupSubmitSchema = z.object({
  requestId: z.string().min(1).max(200),
  plan: duplicateResolvePlanSchema,
  sourceView: z.string().max(100).optional()
}).strict();
const duplicateCleanupPageSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)])
}).strict();
const duplicateCleanupItemPageSchema = duplicateCleanupPageSchema.extend({ jobId: z.string().uuid() }).strict();
const shortcutBindingSchema = z.string().min(1).max(64).refine(isValidShortcutBinding, "Invalid shortcut binding");
const shortcutSettingsSchema = z.object({
  libraryPreviousPage: shortcutBindingSchema,
  libraryNextPage: shortcutBindingSchema,
  playerTogglePlayback: shortcutBindingSchema,
  playerSeekBackward: shortcutBindingSchema,
  playerSeekForward: shortcutBindingSchema,
  playerVolumeUp: shortcutBindingSchema,
  playerVolumeDown: shortcutBindingSchema,
  playerRotateLeft: shortcutBindingSchema,
  playerRotateRight: shortcutBindingSchema,
  playerDelete: shortcutBindingSchema
}).strict().refine((shortcuts) => {
  const libraryBindings = [shortcuts.libraryPreviousPage, shortcuts.libraryNextPage];
  const playerBindings = [
    shortcuts.playerTogglePlayback,
    shortcuts.playerSeekBackward,
    shortcuts.playerSeekForward,
    shortcuts.playerVolumeUp,
    shortcuts.playerVolumeDown,
    shortcuts.playerRotateLeft,
    shortcuts.playerRotateRight,
    shortcuts.playerDelete
  ];
  return new Set(libraryBindings).size === libraryBindings.length
    && new Set(playerBindings).size === playerBindings.length;
}, "Shortcut bindings must be unique within each window");
const settingsSchema = z.object({
  defaultRecursiveScan: z.boolean(),
  startupSync: z.boolean(),
  autoPlayOnOpen: z.boolean(),
  seekStepSeconds: z.number().int().min(1).max(120),
  coverFrameTimeSeconds: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10), z.literal(15)]),
  playbackPreference: z.enum(["auto", "native-first", "mpv-first"]),
  shortcuts: shortcutSettingsSchema
}).strict();
const diagnosticsOptionsSchema = z.object({ includeFullPaths: z.boolean() }).strict();
const scanFailureIdSchema = z.object({ failureId: z.string().min(1) }).strict();
const scanFailureReviewQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  kind: z.enum(["all", "video", "unindexed-file", "directory"]),
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();


interface IpcDependencies {
  database: DatabaseConnection;
  logger: StructuredLogger;
  diagnosticEnvironment: DiagnosticEnvironment;
  settings: SettingsStore;
  cacheRoot: string;
  cacheManager: MediaCacheManager;
  playerWindows: PlayerWindowCoordinator;
  domainEvents: DomainEventBus;
  scanManager: ScanManager;
  metadataQueue: MetadataQueue;
  duplicateCleanup: DuplicateCleanupService;
  duplicateCleanupJobs: DuplicateCleanupRepository;
}

async function previewBatchMove(repo: VideoRepository, videoIds: string[], targetDirectory: string, addTargetToLibrary: boolean) {
  const failures: Array<{ videoId: string; path: string; message: string; code?: string }> = [];
  let directCount = 0;
  let renameCount = 0;
  let skipCount = 0;
  const uniqueVideoIds = [...new Set(videoIds)];
  const targetWillBeAdded = !repo.listSourceFolders().some((folder) => pathContains(targetDirectory, folder.path));
  if (targetWillBeAdded && !addTargetToLibrary) {
    return { targetDirectory, totalCount: uniqueVideoIds.length, directCount, renameCount, skipCount, targetWillBeAdded, failures: uniqueVideoIds.map((videoId) => ({ videoId, path: safeVideoPath(repo, videoId), message: "目标目录未纳入资料库", code: "TARGET_NOT_MANAGED" })) };
  }
  for (const videoId of uniqueVideoIds) {
    try {
      const video = repo.getVideo(videoId);
      const move = await inspectMoveTarget(video.path, targetDirectory);
      if (move.plan === "direct") directCount += 1;
      if (move.plan === "rename") renameCount += 1;
      if (move.plan === "skip") skipCount += 1;
    } catch (cause) {
      failures.push({ videoId, path: safeVideoPath(repo, videoId), message: toMessage(cause), code: toErrorCode(cause) });
    }
  }
  return { targetDirectory, totalCount: uniqueVideoIds.length, directCount, renameCount, skipCount, targetWillBeAdded, failures };
}

function pathContains(candidatePath: string, parentPath: string): boolean {
  const candidate = path.resolve(candidatePath).toLowerCase();
  const parent = path.resolve(parentPath).toLowerCase();
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function safeVideoPath(repo: VideoRepository, videoId: string): string {
  try { return repo.getVideo(videoId).path; } catch { return ""; }
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toErrorCode(cause: unknown): string {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string" ? cause.code : "MOVE_FAILED";
}

async function permanentlyDeleteVideos(repo: VideoRepository, videoIds: string[]) {
  const failures: Array<{ videoId: string; path: string; message: string }> = [];
  let successCount = 0;
  let reclaimedBytes = 0;
  for (const videoId of [...new Set(videoIds)]) {
    try {
      const video = repo.getVideo(videoId);
      await permanentlyDeleteFile(video.path);
      repo.removeVideo(videoId);
      successCount += 1;
      reclaimedBytes += video.sizeBytes;
    } catch (cause) {
      failures.push({ videoId, path: safeVideoPath(repo, videoId), message: toMessage(cause) });
    }
  }
  return { successCount, failureCount: failures.length, reclaimedBytes, failures };
}

export function registerIpcHandlers(repo: VideoRepository, dependencies: IpcDependencies): void {
  ipcLogger = dependencies.logger;
  ipcMain.handle(IPC_CHANNELS.libraryList, (_event, query) => {
    return repo.listVideos(libraryQuerySchema.parse(query));
  });
  ipcMain.handle(IPC_CHANNELS.libraryPage, (_event, query) => repo.listVideoPage(libraryPageQuerySchema.parse(query)));
  ipcMain.handle(IPC_CHANNELS.libraryNavigation, () => repo.getLibraryNavigation());
  ipcMain.handle(IPC_CHANNELS.libraryMissingList, () => repo.listMissingVideos());
  ipcMain.handle(IPC_CHANNELS.videoListByIds, (_event, videoIds) => repo.listVideosByIds(z.array(z.string().min(1)).max(300).parse(videoIds)));

  ipcMain.handle(IPC_CHANNELS.duplicateList, (_event, query) =>
    repo.listDuplicateGroupsPage(duplicateGroupPageQuerySchema.parse(query))
  );

  ipcMain.handle(IPC_CHANNELS.duplicatePreviewResolve, async (_event, payload) => {
    const result = await previewDuplicateResolveSafely(
      repo,
      dependencies.metadataQueue,
      duplicateResolvePlanSchema.parse(payload)
    );
    if (result.status === "stale") {
      dependencies.domainEvents.publish({
        type: "video:updated",
        videoIds: result.changedItems.filter((item) => item.changeType !== "unreadable").map((item) => item.videoId)
      });
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.duplicateResolve, async (_event, payload) => {
    const plan = duplicateResolvePlanSchema.parse(payload);
    const execution = await resolveDuplicatePlanSafely(repo, plan);
    dependencies.cacheManager.scheduleMaintenance(true);
    publishRemovedVideos(repo, execution.removedVideoIds, dependencies.domainEvents);
    return execution.result;
  });

  ipcMain.handle(IPC_CHANNELS.duplicateCleanupSubmit, (_event, payload) =>
    dependencies.duplicateCleanup.submit(duplicateCleanupSubmitSchema.parse(payload))
  );
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupJobs, (_event, payload) => {
    const parsed = duplicateCleanupPageSchema.parse(payload);
    return dependencies.duplicateCleanupJobs.listJobs(parsed.page, parsed.pageSize);
  });
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupJob, (_event, jobId) =>
    dependencies.duplicateCleanupJobs.getJob(z.string().uuid().parse(jobId))
  );
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupItems, (_event, payload) => {
    const parsed = duplicateCleanupItemPageSchema.parse(payload);
    return dependencies.duplicateCleanupJobs.listItems(parsed.jobId, parsed.page, parsed.pageSize);
  });
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupCancel, (_event, jobId) => dependencies.duplicateCleanup.cancel(z.string().uuid().parse(jobId)));
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupResume, (_event, jobId) => dependencies.duplicateCleanup.resume(z.string().uuid().parse(jobId)));
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupRetry, (_event, jobId) => dependencies.duplicateCleanup.retry(z.string().uuid().parse(jobId)));
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupClear, (_event, jobId) => dependencies.duplicateCleanupJobs.clear(z.string().uuid().parse(jobId)));
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupOpenItem, async (_event, itemId) => {
    const error = await shell.openPath(dependencies.duplicateCleanupJobs.getItemDirectory(z.string().uuid().parse(itemId)));
    if (error) throw new Error("无法打开文件所在目录");
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderList, () => repo.listSourceFolders());

  ipcMain.handle(IPC_CHANNELS.folderAdd, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const folder = repo.addSourceFolder(result.filePaths[0], dependencies.settings.get().defaultRecursiveScan);
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return folder;
  });

  ipcMain.handle(IPC_CHANNELS.folderScan, async (_event, folderId: unknown) => {
    const parsedFolderId = z.string().min(1).parse(folderId);
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === parsedFolderId);

    if (!folder) {
      throw new Error(`Source folder not found: ${parsedFolderId}`);
    }

    await dependencies.scanManager.start(folder);
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderScanAll, async () => {
    await dependencies.scanManager.scanAll(repo.listSourceFolders());
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderScanFailuresRetry, async (_event, folderId: unknown) => {
    const parsedFolderId = z.string().min(1).parse(folderId);
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === parsedFolderId);
    if (!folder) throw new Error(`Source folder not found: ${parsedFolderId}`);
    dependencies.scanManager.retryFailuresInBackground(
      folder,
      () => dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] }),
      (error: unknown) => dependencies.logger.error({
        module: "library.scan",
        event: "queued_retry_failed",
        message: "Queued scan failure retry failed",
        context: { folderId: folder.id },
        error
      })
    );
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderScanFailureSummary, (_event, folderId: unknown) =>
    repo.getScanFailureSummary(z.string().min(1).parse(folderId))
  );
  ipcMain.handle(IPC_CHANNELS.folderScanFailureList, (_event, folderId: unknown) =>
    repo.listScanFailures(z.string().min(1).parse(folderId))
  );
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewPage, (_event, query) =>
    repo.listScanFailureReviewPage(scanFailureReviewQuerySchema.parse(query))
  );
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewRetry, (_event, payload) => {
    const { failureId } = scanFailureIdSchema.parse(payload);
    const failure = repo.getScanFailure(failureId);
    if (!failure) throw new Error("Scan failure not found");
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === failure.sourceFolderId);
    if (!folder) throw new Error("Source folder not found for scan failure");
    return dependencies.scanManager.retryFailure(folder, failureId).then(() => {
      dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
      return true;
    });
  });
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewDelete, async (_event, payload) => {
    const { failureId } = scanFailureIdSchema.parse(payload);
    const failure = repo.getScanFailure(failureId);
    const linkedVideo = failure?.objectType === "file" ? repo.getVideoByPath(failure.objectPath) : null;
    if (linkedVideo) dependencies.duplicateCleanup.assertVideosAvailable([linkedVideo.id]);
    const result = await deleteScanFailureFile(repo, failureId);
    if (result.videoId) dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({
      type: result.videoId ? "video:removed" : "library:rescanned",
      videoIds: result.videoId ? [result.videoId] : []
    });
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewOpen, async (_event, payload) => {
    const { failureId } = scanFailureIdSchema.parse(payload);
    const failure = repo.getScanFailure(failureId);
    if (!failure || failure.status === "resolved") throw new Error("Scan failure is no longer available");
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === failure.sourceFolderId);
    if (!folder) throw new Error("Source folder not found for scan failure");
    if (!isManagedPathWithin(failure.objectPath, folder.path)) throw new Error("Scan failure is outside its source folder");
    if (failure.objectType === "file") shell.showItemInFolder(failure.objectPath);
    else {
      const errorMessage = await shell.openPath(failure.objectPath);
      if (errorMessage) throw new Error(errorMessage);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderRemove, (_event, folderId: unknown) => {
    const parsedFolderId = z.string().min(1).parse(folderId);
    dependencies.duplicateCleanup.assertVideosAvailable(repo.listVideosBySourceFolder(parsedFolderId).map((video) => video.id));
    dependencies.scanManager.forget(parsedFolderId);
    const result = repo.removeSourceFolder(parsedFolderId);
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.folderRemovePreview, (_event, folderId: unknown) => repo.previewRemoveSourceFolder(z.string().min(1).parse(folderId)));

  ipcMain.handle(IPC_CHANNELS.folderScanStatusList, () => dependencies.scanManager.listStatuses());
  ipcMain.handle(IPC_CHANNELS.folderScanPause, (_event, folderId: unknown) => dependencies.scanManager.pause(z.string().min(1).parse(folderId)));
  ipcMain.handle(IPC_CHANNELS.folderScanResume, (_event, folderId: unknown) => dependencies.scanManager.resume(z.string().min(1).parse(folderId)));
  ipcMain.handle(IPC_CHANNELS.videoFavorite, (_event, payload) => {
    const parsed = videoIdSchema.extend({ favorite: z.boolean() }).parse(payload);
    repo.getVideo(parsed.videoId);
    repo.setFavorite(parsed.videoId, parsed.favorite);
    dependencies.domainEvents.publish({ type: "favorite:changed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoPendingDelete, (_event, payload) => {
    const parsed = videoIdSchema.extend({ pendingDelete: z.boolean() }).parse(payload);
    repo.getVideo(parsed.videoId);
    repo.setPendingDelete(parsed.videoId, parsed.pendingDelete);
    dependencies.domainEvents.publish({ type: "video:updated", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoPendingDeleteClear, () => {
    const videoIds = repo.listPendingDeleteVideos().map((video) => video.id);
    dependencies.duplicateCleanup.assertVideosAvailable(videoIds);
    return permanentlyDeleteVideos(repo, videoIds).then((result) => {
      dependencies.cacheManager.scheduleMaintenance(true);
      publishRemovedVideos(repo, videoIds, dependencies.domainEvents);
      return result;
    });
  });

  ipcMain.handle(IPC_CHANNELS.videoRevealInFolder, async (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    const video = repo.getVideo(parsed.videoId);
    if (video.isMissing) {
      const error = await shell.openPath(video.directory);
      if (error) throw new Error("无法打开文件所在目录");
    } else {
      shell.showItemInFolder(video.path);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoRename, async (_event, payload) => {
    const parsed = videoIdSchema.extend({ baseName: z.string() }).parse(payload);
    dependencies.duplicateCleanup.assertVideosAvailable([parsed.videoId]);
    const video = repo.getVideo(parsed.videoId);
    const nextPath = await renamePreservingExtension(video.path, parsed.baseName);
    const renamed = await commitRenameWithRollback(video.path, nextPath, () => repo.updateVideoPath(parsed.videoId, nextPath));
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "video:updated", videoIds: [parsed.videoId] });
    return renamed;
  });

  ipcMain.handle(IPC_CHANNELS.videoDelete, async (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    dependencies.duplicateCleanup.assertVideosAvailable([parsed.videoId]);
    const video = repo.getVideo(parsed.videoId);
    await permanentlyDeleteFile(video.path);
    repo.removeVideo(parsed.videoId);
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "video:removed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoBatchDelete, async (_event, videoIds) => {
    const parsedVideoIds = videoIdsSchema.parse(videoIds);
    dependencies.duplicateCleanup.assertVideosAvailable(parsedVideoIds);
    const result = await permanentlyDeleteVideos(repo, parsedVideoIds);
    dependencies.cacheManager.scheduleMaintenance(true);
    publishRemovedVideos(repo, parsedVideoIds, dependencies.domainEvents);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.videoChooseMoveDestination, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.videoPreviewMove, async (_event, payload) => {
    const parsed = batchMoveSchema.parse(payload);
    dependencies.duplicateCleanup.assertVideosAvailable(parsed.videoIds);
    return previewBatchMove(repo, parsed.videoIds, parsed.targetDirectory, parsed.addTargetToLibrary);
  });

  ipcMain.handle(IPC_CHANNELS.videoBatchMove, async (_event, payload) => {
    const parsed = batchMoveSchema.parse(payload);
    dependencies.duplicateCleanup.assertVideosAvailable(parsed.videoIds);
    const preview = await previewBatchMove(repo, parsed.videoIds, parsed.targetDirectory, parsed.addTargetToLibrary);
    if (preview.failures.length > 0) return { ...preview, successCount: 0, failureCount: preview.failures.length, itemResults: [], failures: preview.failures };
    const covered = repo.listSourceFolders().some((folder) => pathContains(parsed.targetDirectory, folder.path));
    if (!covered && parsed.addTargetToLibrary) repo.addSourceFolder(parsed.targetDirectory, dependencies.settings.get().defaultRecursiveScan);
    const failures: Array<{ videoId: string; path: string; message: string; code: string }> = [];
    const itemResults: Array<{ videoId: string; sourcePath: string; finalPath: string; plan: "direct" | "rename" | "skip"; status: "moved" | "skipped" }> = [];
    let successCount = 0;
    let directCount = 0;
    let renameCount = 0;
    let skipCount = 0;
    for (const videoId of [...new Set(parsed.videoIds)]) {
      let moved: Awaited<ReturnType<typeof moveFileWithConflictResolution>> | null = null;
      try {
        const video = repo.getVideo(videoId);
        moved = await moveFileWithConflictResolution(video.path, parsed.targetDirectory);
        if (moved.plan === "skip") {
          skipCount += 1;
          itemResults.push({ videoId, sourcePath: video.path, finalPath: moved.targetPath, plan: moved.plan, status: "skipped" });
          continue;
        }
        await commitMoveWithRollback(moved, () => repo.updateVideoPath(videoId, moved!.targetPath));
        if (moved.plan === "direct") directCount += 1;
        if (moved.plan === "rename") renameCount += 1;
        itemResults.push({ videoId, sourcePath: video.path, finalPath: moved.targetPath, plan: moved.plan, status: "moved" });
        successCount += 1;
      } catch (cause) {
        failures.push({ videoId, path: safeVideoPath(repo, videoId) || moved?.sourcePath || "", message: toMessage(cause), code: toErrorCode(cause) });
      }
    }
    dependencies.cacheManager.scheduleMaintenance(true);
    const movedVideoIds = itemResults.filter((item) => item.status === "moved").map((item) => item.videoId);
    if (movedVideoIds.length > 0) dependencies.domainEvents.publish({ type: "video:updated", videoIds: movedVideoIds });
    if (!covered && parsed.addTargetToLibrary) {
      dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    }
    return { targetDirectory: preview.targetDirectory, totalCount: preview.totalCount, targetWillBeAdded: preview.targetWillBeAdded, directCount, renameCount, skipCount, successCount, failureCount: failures.length, itemResults, failures };
  });

  ipcMain.handle(IPC_CHANNELS.videoForget, (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    dependencies.duplicateCleanup.assertVideosAvailable([parsed.videoId]);
    repo.removeVideo(parsed.videoId);
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "video:removed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoRegenerateCover, async (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    const video = repo.getVideo(parsed.videoId);
    const timeSeconds = getCoverTimeSeconds(dependencies.settings.get().coverFrameTimeSeconds, video.durationMs);
    const cacheKey = buildCacheKey(video.path, video.sizeBytes, video.modifiedAt);
    await dependencies.cacheManager.invalidate(getCoverPath(dependencies.cacheRoot, cacheKey, timeSeconds));
    repo.markThumbnailPending(video.id);
    const refreshed = repo.getVideo(video.id);
    dependencies.domainEvents.publish({ type: "video:updated", videoIds: [parsed.videoId] });
    return refreshed;
  });

  ipcMain.handle(IPC_CHANNELS.videoRetryMetadata, (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    const video = repo.getVideo(parsed.videoId);
    if (video.isMissing) throw new Error("文件当前不可访问，无法重新分析");
    if (video.metadataStatus === "failed") {
      repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt);
    }
    dependencies.metadataQueue.enqueue(video.id);
    const refreshed = repo.getVideo(video.id);
    dependencies.domainEvents.publish({ type: "video:updated", videoIds: [video.id] });
    return refreshed;
  });

  ipcMain.handle(IPC_CHANNELS.videoOpenPlayer, async (_event, payload) => {
    const parsed = playerSessionSchema.parse(payload);
    await dependencies.playerWindows.open(parsed, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId);
    dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.windowSyncSnapshot, () =>
    dependencies.playerWindows.getSnapshot(dependencies.domainEvents.getSequence())
  );

  ipcMain.handle(IPC_CHANNELS.playerSessionSet, (_event, payload) => {
    const parsed = playerSessionSchema.parse(payload);
    dependencies.playerWindows.setSession(parsed, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId);
    const event = dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return dependencies.playerWindows.getSnapshot(event.sequence).playerSession;
  });

  ipcMain.handle(IPC_CHANNELS.playerSessionSelect, (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    dependencies.playerWindows.select(parsed.videoId, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId);
    const event = dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return dependencies.playerWindows.getSnapshot(event.sequence).playerSession;
  });

  ipcMain.handle(IPC_CHANNELS.videoPlayExternal, async (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    const video = repo.getVideo(parsed.videoId);
    try {
      await waitForMpvStart(playWithMpv(video.path));
    } catch (cause) {
      const fallbackError = await shell.openPath(video.path);
      if (fallbackError) {
        const mpvError = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`无法启动 mpv，也无法用系统默认播放器打开：${fallbackError || mpvError}`);
      }
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.playHistoryList, () => repo.listPlayHistory());

  ipcMain.handle(IPC_CHANNELS.playHistoryRecord, (_event, payload) => {
    const parsed = videoIdSchema.extend({ positionMs: z.number().int().min(0).optional() }).parse(payload);
    repo.recordPlayback(parsed.videoId, parsed.positionMs ?? 0);
    dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return true;
  });

  const previewDiagnostics = (includeFullPaths: boolean) =>
    buildDiagnosticsPreview(
      {
        ...dependencies.diagnosticEnvironment,
        schemaVersion: Number(dependencies.database.pragma("user_version", { simple: true }))
      },
      runDiagnosticChecks(dependencies.database, dependencies.logger),
      dependencies.logger,
      { includeFullPaths }
    );

  ipcMain.handle(IPC_CHANNELS.diagnosticsPreview, (_event, payload) => {
    const { includeFullPaths } = diagnosticsOptionsSchema.parse(payload);
    return previewDiagnostics(includeFullPaths);
  });

  ipcMain.handle(IPC_CHANNELS.diagnosticsExport, async (_event, payload) => {
    const { includeFullPaths } = diagnosticsOptionsSchema.parse(payload);
    const preview = previewDiagnostics(includeFullPaths);
    const result = await dialog.showSaveDialog({
      title: "导出诊断包",
      defaultPath: `video-manager-diagnostics-${preview.generatedAt.slice(0, 10)}.json`,
      filters: [{ name: "JSON 诊断包", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { exported: false };
    await writeFile(result.filePath, JSON.stringify(buildDiagnosticPackage(preview, dependencies.logger), null, 2), "utf8");
    return { exported: true, filePath: result.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => ({
    settings: dependencies.settings.get(),
    cacheLocation: dependencies.cacheRoot,
    cacheStatus: dependencies.cacheManager.getStatus()
  }));

  ipcMain.handle(IPC_CHANNELS.settingsSet, (_event, payload) => {
    const settings = dependencies.settings.set(settingsSchema.parse(payload));
    dependencies.domainEvents.publish({ type: "settings:changed", videoIds: [] });
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.cacheClear, async () => {
    const result = await dependencies.cacheManager.clear();
    repo.resetMediaCacheState();
    return result;
  });
}

function publishRemovedVideos(
  repo: VideoRepository,
  candidateVideoIds: readonly string[],
  domainEvents: DomainEventBus
): void {
  const removedVideoIds = [...new Set(candidateVideoIds)].filter((videoId) => {
    try {
      repo.getVideo(videoId);
      return false;
    } catch {
      return true;
    }
  });
  if (removedVideoIds.length > 0) {
    domainEvents.publish({ type: "video:removed", videoIds: removedVideoIds });
  }
}
