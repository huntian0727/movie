import { dialog, ipcMain as electronIpcMain, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { SubtitleService } from "./subtitles/subtitleService.js";
import { subtitleActionSchema, subtitleConfigSchema, subtitleSearchSchema, subtitleProviderSchema, subtitleProviderWebsites } from "../shared/subtitles.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS, MAX_PLAYER_QUEUE_ITEMS, SORT_FIELDS } from "../shared/videoTypes.js";
import type { CloudDriveLegacyBindingProgress } from "../shared/videoTypes.js";
import { isValidShortcutBinding } from "../shared/shortcuts.js";
import type { DatabaseConnection } from "./db/database.js";
import type { DuplicateCleanupRepository } from "./db/duplicateCleanupRepository.js";
import type { VideoRepository } from "./db/videoRepository.js";
import type { AssetCenterReadService } from "./assetCenter/assetCenterQueryService.js";
import type { PlaybackDiagnosticReadService } from "./playbackDiagnostic/playbackDiagnosticQueryService.js";
import type { VideoDataService } from "./videoData/videoDataService.js";
import type { LibraryPageQueryService } from "./libraryPage/libraryPageQueryService.js";
import type { SourceFolderRemovalService } from "./sourceFolderRemoval/sourceFolderRemovalService.js";
import { videoDataQuerySchema, videoDataSelectionSchema } from "../shared/videoDataTable.js";
import {
  configureCloudDriveRuntime,
  browseConfiguredCloudDriveFolder,
  confirmMountedCloudDriveFileMissing,
  confirmMountedCloudDriveFilesMissing,
  listConfiguredCloudDriveFolderRoots,
  refreshMountedCloudDriveFilesMetadata,
  resolveConfiguredCloudDriveFolder,
  testConfiguredCloudDriveConnection
} from "./clouddrive/mountedScanner.js";
import { commitMoveWithRollback, commitRenameWithRollback, inspectMoveTarget, moveFileWithConflictResolution, permanentlyDeleteFile, renamePreservingExtension } from "./files/fileOperations.js";
import { cleanupScanFailures, deleteScanFailureFile } from "./files/scanFailureActions.js";
import { ScanFailureBatchService } from "./files/scanFailureBatchService.js";
import { MissingVideoService } from "./files/missingVideoService.js";
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
import { loadPreviewImage } from "./media/mediaProtocol.js";
import type { MediaCacheManager } from "./media/cacheManager.js";
import type { DirectoryImageService } from "./media/directoryImageService.js";
import { previewDuplicateResolveSafely } from "./media/duplicateResolveSafety.js";
import { bindLegacyCloudDriveDuplicateCandidates } from "./media/cloudDriveLegacyBindingService.js";
import type { ScanManager } from "./media/scanManager.js";
import type { MetadataQueue } from "./media/metadataQueue.js";
import { registerPreviewMetadataHandlers } from "./media/previewMetadataIpc.js";
import { registerPreviewImageHandlers } from "./media/previewImageIpc.js";
import { MetadataFileRefreshService } from "./media/metadataFileRefreshService.js";
import type { DuplicateCleanupService } from "./media/duplicateCleanupService.js";
import { playWithMpv, waitForMpvStart } from "./media/mpvController.js";
import type { EmbeddedPlayer } from "./embeddedPlayer/embeddedPlayer.js";
import type { DomainEventBus, PlayerWindowCoordinator } from "./playerWindow.js";
import { wrapTrustedIpcHandler } from "./security.js";
import type { SettingsStore } from "./settings/settingsStore.js";
import { toPublicSettings } from "./settings/settingsStore.js";
import { isValidCloudDriveEndpoint } from "../shared/cloudDriveEndpoint.js";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

const readPurposeSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
function readScope(event: IpcMainInvokeEvent, operation: string, purpose: unknown): string {
  const validatedPurpose = purpose === undefined ? "default" : readPurposeSchema.parse(purpose);
  return `${event.sender.id}:${operation}:${validatedPurpose}`;
}

let ipcLogger: StructuredLogger | undefined;
const loggedIpcChannels = new Set<string>([
  IPC_CHANNELS.duplicateFastDelete,
  IPC_CHANNELS.duplicateCleanupConfirm,
  IPC_CHANNELS.duplicateCloudDriveBindLegacy,
  IPC_CHANNELS.cloudDriveTest,
  IPC_CHANNELS.cloudDriveFolderBrowse,
  IPC_CHANNELS.cloudDriveFolderAdd,
  IPC_CHANNELS.folderAdd,
  IPC_CHANNELS.folderScan,
  IPC_CHANNELS.folderScanDirectory,
  IPC_CHANNELS.folderScanAll,
  IPC_CHANNELS.folderScanFailuresRetry,
  IPC_CHANNELS.scanFailureReviewRetry,
  IPC_CHANNELS.scanFailureReviewDelete,
  IPC_CHANNELS.scanFailureReviewCleanup,
  IPC_CHANNELS.scanFailureBatchSubmit,
  IPC_CHANNELS.scanFailureBatchCancel,
  IPC_CHANNELS.libraryMetadataRefreshSizes,
  IPC_CHANNELS.folderRemove,
  IPC_CHANNELS.folderScanPause,
  IPC_CHANNELS.folderScanResume,
  IPC_CHANNELS.videoFavorite,
  IPC_CHANNELS.videoPendingDelete,
  IPC_CHANNELS.videoPendingDeleteClear,
  IPC_CHANNELS.videoRename,
  IPC_CHANNELS.videoDelete,
  IPC_CHANNELS.videoBatchDelete,
  IPC_CHANNELS.videoDataDelete,
  IPC_CHANNELS.videoBatchMove,
  IPC_CHANNELS.videoForget,
  IPC_CHANNELS.libraryMissingRecheck,
  IPC_CHANNELS.libraryMissingForget,
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
        if (channel === IPC_CHANNELS.settingsSet) {
          // Zod/filesystem errors may embed a write-only credential or invalid URL input.
          // Report a fixed message; neither raw error nor arguments enter Electron/logs.
          const message = error instanceof z.ZodError
            ? "设置参数无效：CloudDrive 非本机地址必须使用 HTTPS，请检查地址、Token 和超时配置"
            : "设置保存失败，请检查系统安全存储和数据目录权限";
          ipcLogger?.warn({ module: "ipc", event: "settings_save_failed", context: { channel } });
          throw new Error(message);
        }
        if (channel.startsWith("subtitles:")) {
          // Native filesystem/network and schema diagnostics may contain sensitive input.
          // Only our own user-facing messages cross this boundary, with no error logging.
          const message = error instanceof z.ZodError ? "字幕请求参数无效" : error instanceof Error && /^(字幕|请|保存的字幕|系统安全存储|这部影片|影片文件|OpenSubtitles)/.test(error.message) ? error.message : "字幕操作失败，请检查网络、磁盘权限和账号配置后重试";
          throw new Error(message);
        }
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

const directoryBrowserQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  parentPath: z.string().min(1).max(32767).optional(),
  search: z.string().trim().max(500),
  limit: z.union([z.literal(50), z.literal(100), z.literal(200)])
}).strict();
const directoryScanRequestSchema = z.object({
  sourceFolderId: z.string().min(1),
  directoryPath: z.string().min(1).max(32767),
  scope: z.enum(["exact", "recursive"])
}).strict();

const videoIdSchema = z.object({ videoId: z.string().min(1) }).strict();
const cloudDriveSourceSelectionSchema = z.object({
  mountPoint: z.string().min(1).max(32767),
  remotePath: z.string().min(1).max(32767)
}).strict();

const assetCenterSourceQuerySchema = z.object({
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)]),
  search: z.string().trim().max(500),
  type: z.enum(["all", "localOrMounted", "nas", "clouddrive"]),
  availability: z.enum(["all", "reachable", "offline", "checkFailed", "unknown", "disabled"]),
  sort: z.enum(["path", "videoCount", "sizeBytes", "lastScannedAt", "issueCount"]),
  direction: z.enum(["asc", "desc"])
}).strict();
const playbackDiagnosticSearchQuerySchema = z.object({
  search: z.string().trim().min(1).max(500),
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.literal(30)
}).strict();
const missingVideoPageQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  search: z.string().trim().max(500),
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();
const metadataIssuePageQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  status: z.enum(["all", "automatic", "deferred", "failed"]),
  zeroBytesOnly: z.boolean(),
  search: z.string().trim().max(500),
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();
const videoIdsSchema = z.array(z.string().min(1)).min(1).max(500);
const playerSessionSchema = videoIdSchema.extend({
  queueIds: z.array(z.string().min(1)).min(1).max(MAX_PLAYER_QUEUE_ITEMS),
  startPositionMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});
const batchMoveSchema = z.object({ videoIds: videoIdsSchema, targetDirectory: z.string().min(1), addTargetToLibrary: z.boolean() }).strict();
const duplicateGroupPageQuerySchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(500)]),
  sortField: z.enum(["reclaimableBytes", "sizeBytes", "duplicateCount", "durationMs"]).default("sizeBytes"),
  sortDirection: z.enum(["asc", "desc"]),
  preferredDirectoryPath: z.string().min(1).optional(),
  preferredDirectoryPaths: z.array(z.string().min(1)).max(100).optional(),
  filterDirectoryPath: z.string().min(1).optional()
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
  sourceView: z.string().max(100).optional(),
  autoDeleteAfterVerification: z.boolean().optional()
}).strict();
const duplicateCleanupConfirmSchema = z.object({
  jobId: z.string().uuid(),
  verificationRevision: z.string().uuid(),
  confirmation: z.literal("DELETE")
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
  playbackPreference: z.enum(["auto", "native-first", "mpv-first", "embedded-first"]),
  cloudDrive: z.object({
    endpoint: z.string().trim().refine(isValidCloudDriveEndpoint, "CloudDrive non-loopback endpoints require HTTPS"),
    configured: z.boolean(),
    apiToken: z.string().trim().max(16_384).optional(),
    timeoutMs: z.number().int().min(1_000).max(120_000),
    mountMapJson: z.string().trim().max(100_000)
  }).strict(),
  shortcuts: shortcutSettingsSchema
}).strict();
const diagnosticsOptionsSchema = z.object({ includeFullPaths: z.boolean() }).strict();
const scanFailureIdSchema = z.object({ failureId: z.string().min(1) }).strict();
const scanFailureCleanupSchema = z.object({
  failureIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["mark-pending-delete", "permanent-delete", "remove-missing-record"])
}).strict();
const duplicateCleanupFilteredSubmitSchema = z.object({
  requestId: z.string().min(1).max(200),
  query: duplicateGroupPageQuerySchema,
  sourceView: z.string().max(100).optional()
}).strict();
const scanFailureBatchSubmitSchema = z.object({
  operation: z.enum(["recheck-accessibility", "analyze-metadata", "permanent-delete", "remove-missing-record"]),
  scope: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("selected"), failureIds: z.array(z.string().min(1)).min(1).max(10_000) }).strict(),
    z.object({
      mode: z.literal("filtered"),
      query: z.object({
        sourceFolderId: z.string().min(1).optional(),
        kind: z.enum(["all", "video", "unindexed-file", "directory"]),
        cleanupCategory: z.enum(["all", "confirmed-corrupt", "missing", "transient", "manual-review"])
      }).strict()
    }).strict()
  ])
}).strict();
const scanFailureReviewQuerySchema = z.object({
  sourceFolderId: z.string().min(1).optional(),
  kind: z.enum(["all", "video", "unindexed-file", "directory"]),
  page: z.number().int().min(1),
  pageSize: z.union([z.literal(30), z.literal(50), z.literal(100)])
}).strict();


interface IpcDependencies {
  database: DatabaseConnection;
  assetCenterQueries: AssetCenterReadService;
  playbackDiagnosticQueries: PlaybackDiagnosticReadService;
  videoDataQueries?: VideoDataService;
  libraryPageQueries: LibraryPageQueryService;
  sourceFolderRemoval: SourceFolderRemovalService;
  logger: StructuredLogger;
  diagnosticEnvironment: DiagnosticEnvironment;
  settings: SettingsStore;
  cacheRoot: string;
  cacheManager: MediaCacheManager;
  directoryImages?: DirectoryImageService;
  playerWindows: PlayerWindowCoordinator;
  embeddedPlayer?: EmbeddedPlayer;
  subtitles?: SubtitleService;
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
  ipcMain.handle(IPC_CHANNELS.imageDirectoryList, (_event, query) => {
    const parsed = z.object({ sourceFolderId: z.string().min(1).max(100), directoryPath: z.string().min(1).max(32767), sessionId: z.string().uuid().optional(), offset: z.number().int().min(0).max(20_000).optional() }).strict().parse(query);
    if (!dependencies.directoryImages) throw new Error("图片查看服务未连接");
    return dependencies.directoryImages.list(parsed);
  });
  ipcMain.handle(IPC_CHANNELS.imageDirectoryClose, (_event, id) => dependencies.directoryImages?.close(z.string().uuid().parse(id)));
  const subtitles = () => { if (!dependencies.subtitles) throw new Error("字幕服务未就绪"); return dependencies.subtitles; };
  ipcMain.handle(IPC_CHANNELS.subtitleConfigGet, () => subtitles().credentials.status());
  ipcMain.handle(IPC_CHANNELS.subtitleWebsite, (_event, payload) => shell.openExternal(subtitleProviderWebsites[subtitleProviderSchema.parse(payload)]));
  ipcMain.handle(IPC_CHANNELS.subtitleConfigSave, (_event, payload) => subtitles().credentials.save(subtitleConfigSchema.parse(payload)));
  ipcMain.handle(IPC_CHANNELS.subtitleSearch, (_event, payload) => subtitles().search(subtitleSearchSchema.parse(payload)));
  ipcMain.handle(IPC_CHANNELS.subtitleState, (_event, videoId) => subtitles().getState(z.string().min(1).max(128).parse(videoId)));
  ipcMain.handle(IPC_CHANNELS.subtitleAction, async (event, payload) => {
    const request = subtitleActionSchema.parse(payload);
    if (request.op === "export") {
      const asset = await subtitles().exportAsset(request.videoId, request.id!);
      const selected = await dialog.showSaveDialog({ title: "导出原始字幕（不含播放偏移）", defaultPath: asset.filename,
        filters: [{ name: "字幕", extensions: [path.extname(asset.filename).slice(1)] }] });
      if (!event.sender.isDestroyed() && !selected.canceled && selected.filePath) await writeFile(selected.filePath, asset.data);
      return subtitles().getState(request.videoId);
    }
    const state = await subtitles().action(request);
    try { await dependencies.embeddedPlayer?.applySavedSubtitle(request.videoId); }
    catch { state.message = "字幕已保存，播放器加载未完成；请重新选择字幕或重试播放"; }
    return state;
  });
  ipcMain.handle(IPC_CHANNELS.playerTimelinePreview, (event, payload) => dependencies.playerWindows.showTimelinePreview(event.sender.id, payload));
  ipcMain.handle(IPC_CHANNELS.embeddedPlayback, (event, payload) => {
    if (!dependencies.embeddedPlayer) throw new Error("内嵌播放服务不可用");
    return dependencies.embeddedPlayer.handle(event, payload);
  });
  ipcLogger = dependencies.logger;
  registerPreviewMetadataHandlers(ipcMain, repo, dependencies.metadataQueue);
  registerPreviewImageHandlers(ipcMain, (url, options) =>
    loadPreviewImage(repo, dependencies.cacheManager, url, dependencies.settings.get().coverFrameTimeSeconds, options));
  let legacyCloudDriveBindingInFlight: Promise<Awaited<ReturnType<typeof bindLegacyCloudDriveDuplicateCandidates>>> | null = null;
  let legacyCloudDriveBindingAbortController: AbortController | null = null;
  let legacyCloudDriveBindingStatus: CloudDriveLegacyBindingProgress = {
    state: "idle",
    totalDirectoryCount: 0,
    processedDirectoryCount: 0,
    scannedDirectoryCount: 0,
    failedDirectoryCount: 0,
    candidateFileCount: 0,
    matchedFileCount: 0,
    missingFileCount: 0,
    sizeMismatchFileCount: 0,
    ambiguousFileCount: 0,
    currentConcurrency: 0,
    elapsedMs: 0,
    directoriesPerSecond: 0,
    estimatedRemainingMs: null,
    errorMessage: null
  };
  const scanFailureBatches = new ScanFailureBatchService(repo, {
    analyzeFailure: async (failureId) => {
      const failure = repo.getScanFailure(failureId);
      if (!failure) throw new Error("Scan failure not found");
      const folder = repo.listSourceFolders().find((candidate) => candidate.id === failure.sourceFolderId);
      if (!folder) throw new Error("Source folder not found for scan failure");
      await dependencies.scanManager.retryFailure(folder, failureId);
    },
    confirmRemoteMissing: (targetPath, isCancelled) => confirmMountedCloudDriveFileMissing(targetPath, process.env, isCancelled),
    confirmRemoteMissingBatch: (targetPaths, isCancelled) => confirmMountedCloudDriveFilesMissing(targetPaths, process.env, isCancelled),
    assertPermanentDeleteAllowed: (videoIds) => dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed(videoIds),
    onLibraryChanged: (removedVideoIds) => {
      if (removedVideoIds.length > 0) dependencies.cacheManager.scheduleMaintenance(true);
      dependencies.domainEvents.publish({ type: removedVideoIds.length > 0 ? "video:removed" : "library:rescanned", videoIds: removedVideoIds });
    }
  });
  const missingVideos = new MissingVideoService(repo, {
    confirmRemoteMissingBatch: (targetPaths) => confirmMountedCloudDriveFilesMissing(targetPaths, process.env),
    assertVideosAvailable: (videoIds) => dependencies.duplicateCleanup.assertVideosAvailable(videoIds),
    enqueueMetadata: (videoId) => { dependencies.metadataQueue.enqueue(videoId); }
  });
  const metadataFileRefresh = new MetadataFileRefreshService(repo, {
    refreshRemote: (paths) => refreshMountedCloudDriveFilesMetadata(paths, process.env),
    enqueueMetadata: (videoId) => { dependencies.metadataQueue.enqueue(videoId, true); },
    onVideosUpdated: (videoIds) => dependencies.domainEvents.publish({ type: "video:updated", videoIds })
  });
  ipcMain.handle(IPC_CHANNELS.libraryList, (_event, query) => {
    return repo.listVideos(libraryQuerySchema.parse(query));
  });
  ipcMain.handle(IPC_CHANNELS.libraryPage, (event, query, purpose) =>
    dependencies.libraryPageQueries.page(libraryPageQuerySchema.parse(query), readScope(event, "library-page", purpose))
  );
  ipcMain.handle(IPC_CHANNELS.libraryDirectoryBrowser, (event, query, purpose) =>
    dependencies.assetCenterQueries.listDirectories(directoryBrowserQuerySchema.parse(query), readScope(event, "directories", purpose))
  );
  ipcMain.handle(IPC_CHANNELS.libraryNavigation, () => dependencies.assetCenterQueries.getLibraryNavigation());
  ipcMain.handle(IPC_CHANNELS.assetCenterSummary, () => dependencies.assetCenterQueries.getSummary());
  ipcMain.handle(IPC_CHANNELS.assetCenterSources, (event, query, purpose) =>
    dependencies.assetCenterQueries.listSources(assetCenterSourceQuerySchema.parse(query), readScope(event, "sources", purpose))
  );
  ipcMain.handle(IPC_CHANNELS.playbackDiagnosticSearch, (_event, query) =>
    dependencies.playbackDiagnosticQueries.search(playbackDiagnosticSearchQuerySchema.parse(query))
  );
  ipcMain.handle(IPC_CHANNELS.libraryMissingList, () => repo.listMissingVideos());
  ipcMain.handle(IPC_CHANNELS.videoDataPage, (_event, query) => {
    if (!dependencies.videoDataQueries) throw new Error("数据表服务未连接");
    return dependencies.videoDataQueries.page(videoDataQuerySchema.parse(query));
  });
  ipcMain.handle(IPC_CHANNELS.videoDataExport, async (_event, query, selection) => {
    const parsed = videoDataQuerySchema.parse(query);
    const selected = videoDataSelectionSchema.parse(selection);
    if (!dependencies.videoDataQueries) throw new Error("数据表服务未连接");
    const target = await dialog.showSaveDialog({ title: "导出视频数据表", defaultPath: "视频数据表.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (target.canceled || !target.filePath) return { cancelled: true, count: 0 };
    const count = await dependencies.videoDataQueries.export(parsed, selected, target.filePath);
    return { cancelled: false, count, path: target.filePath };
  });
  ipcMain.handle(IPC_CHANNELS.videoDataDelete, async (_event, query, selection) => {
    const parsed = videoDataQuerySchema.parse(query);
    const selected = videoDataSelectionSchema.parse(selection);
    if (!dependencies.videoDataQueries) throw new Error("数据表服务未连接");
    const videoIds = await dependencies.videoDataQueries.selectIds(parsed, selected);
    if (videoIds.length === 0) return { successCount: 0, failureCount: 0, reclaimedBytes: 0, failures: [] };
    dependencies.duplicateCleanupJobs.assertVideosAvailable(videoIds);
    const result = await permanentlyDeleteVideos(repo, videoIds);
    if (result.successCount > 0) {
      dependencies.cacheManager.scheduleMaintenance(true);
      dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.libraryMissingPage, (_event, query) => repo.listMissingVideoPage(missingVideoPageQuerySchema.parse(query)));
  ipcMain.handle(IPC_CHANNELS.libraryMetadataIssuePage, async (event, query, purpose) => {
    const page = await dependencies.assetCenterQueries.listMetadataIssues(metadataIssuePageQuerySchema.parse(query), readScope(event, "metadata-issues", purpose));
    const queueStatus = dependencies.metadataQueue.getStatus();
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, queueState: dependencies.metadataQueue.getVideoState(item.video.id) })),
      queuedCount: queueStatus.queued,
      activeCount: queueStatus.active
    };
  });
  ipcMain.handle(IPC_CHANNELS.libraryMetadataRefreshSizes, (_event, videoIds) =>
    metadataFileRefresh.refreshZeroByteFiles(videoIdsSchema.parse(videoIds))
  );
  ipcMain.handle(IPC_CHANNELS.libraryMissingRecheck, async (_event, videoIds) => {
    const parsedVideoIds = videoIdsSchema.parse(videoIds);
    const previouslyAvailableIds = new Set(repo.listVideosByIds(parsedVideoIds).filter((video) => !video.isMissing).map((video) => video.id));
    const result = await missingVideos.recheck(parsedVideoIds);
    const restoredIds = result.items.filter((item) => item.status === "restored").map((item) => item.videoId);
    const newlyMissingIds = result.items
      .filter((item) => item.status === "still-missing" && previouslyAvailableIds.has(item.videoId))
      .map((item) => item.videoId);
    if (restoredIds.length > 0) dependencies.domainEvents.publish({ type: "video:updated", videoIds: restoredIds });
    if (newlyMissingIds.length > 0) dependencies.domainEvents.publish({ type: "video:removed", videoIds: newlyMissingIds });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.libraryMissingForget, async (_event, videoIds) => {
    const result = await missingVideos.forget(videoIdsSchema.parse(videoIds));
    const restoredIds = result.items.filter((item) => item.status === "restored").map((item) => item.videoId);
    const removedIds = result.items.filter((item) => item.status === "record-removed").map((item) => item.videoId);
    if (restoredIds.length > 0) dependencies.domainEvents.publish({ type: "video:updated", videoIds: restoredIds });
    if (removedIds.length > 0) {
      dependencies.cacheManager.scheduleMaintenance(true);
      dependencies.domainEvents.publish({ type: "video:removed", videoIds: removedIds });
    }
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.videoListByIds, (_event, videoIds) => repo.listVideosByIds(z.array(z.string().min(1)).max(300).parse(videoIds)));

  ipcMain.handle(IPC_CHANNELS.duplicateList, (event, query, purpose) =>
    dependencies.assetCenterQueries.listDuplicates(duplicateGroupPageQuerySchema.parse(query), readScope(event, "duplicates", purpose))
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

  ipcMain.handle(IPC_CHANNELS.duplicateFastDelete, async (_event, payload) => {
    duplicateResolvePlanSchema.parse(payload);
    throw new Error("未完成完整 SHA-256 验证的快速永久删除已禁用；请使用一键验证并删除。");
  });

  ipcMain.handle(IPC_CHANNELS.duplicateCheckMissing, async (_event, payload) => {
    const plan = duplicateResolvePlanSchema.parse(payload);
    const videoIds = plan.groups.flatMap((group) => [group.keepVideoId, ...group.deleteVideoIds]);
    const result = await previewDuplicateResolveSafely(repo, dependencies.metadataQueue, plan);
    if (result.status === "stale") {
      dependencies.domainEvents.publish({
        type: "video:updated",
        videoIds: result.changedItems.filter((item) => item.changeType !== "unreadable").map((item) => item.videoId)
      });
    }
    const changedItems = result.status === "stale" ? result.changedItems : [];
    return {
      checkedFileCount: videoIds.length,
      removedCount: changedItems.filter((item) => item.changeType === "missing").length,
      changedCount: changedItems.filter((item) => item.changeType !== "missing" && item.changeType !== "unreadable").length
    };
  });

  ipcMain.handle(IPC_CHANNELS.duplicateCleanupSubmit, (_event, payload) =>
    dependencies.duplicateCleanup.submit(duplicateCleanupSubmitSchema.parse(payload))
  );
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupSubmitFiltered, (_event, payload) => {
    const parsed = duplicateCleanupFilteredSubmitSchema.parse(payload);
    return dependencies.duplicateCleanup.submitFiltered(parsed);
  });
  ipcMain.handle(IPC_CHANNELS.duplicateCloudDriveBindLegacy, async () => {
    if (!legacyCloudDriveBindingInFlight) {
      legacyCloudDriveBindingAbortController = new AbortController();
      const abortController = legacyCloudDriveBindingAbortController;
      legacyCloudDriveBindingStatus = {
        ...legacyCloudDriveBindingStatus,
        state: "running",
        totalDirectoryCount: 0,
        processedDirectoryCount: 0,
        scannedDirectoryCount: 0,
        failedDirectoryCount: 0,
        candidateFileCount: 0,
        matchedFileCount: 0,
        missingFileCount: 0,
        sizeMismatchFileCount: 0,
        ambiguousFileCount: 0,
        currentConcurrency: 16,
        elapsedMs: 0,
        directoriesPerSecond: 0,
        estimatedRemainingMs: null,
        errorMessage: null
      };
      legacyCloudDriveBindingInFlight = bindLegacyCloudDriveDuplicateCandidates(repo, {
        isCancelled: () => abortController.signal.aborted,
        onProgress: (progress) => { legacyCloudDriveBindingStatus = progress; }
      }).catch((cause) => {
        legacyCloudDriveBindingStatus = {
          ...legacyCloudDriveBindingStatus,
          state: abortController.signal.aborted ? "cancelled" : "failed",
          estimatedRemainingMs: null,
          errorMessage: abortController.signal.aborted ? null : toMessage(cause)
        };
        throw cause;
      });
    }
    const activeBinding = legacyCloudDriveBindingInFlight;
    try {
      const result = await activeBinding;
      if (result.matchedFileCount > 0) {
        dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
      }
      return result;
    } finally {
      if (legacyCloudDriveBindingInFlight === activeBinding) {
        legacyCloudDriveBindingInFlight = null;
        legacyCloudDriveBindingAbortController = null;
      }
    }
  });
  ipcMain.handle(IPC_CHANNELS.duplicateCloudDriveBindLegacyStatus, () => legacyCloudDriveBindingStatus);
  ipcMain.handle(IPC_CHANNELS.duplicateCloudDriveBindLegacyCancel, () => {
    if (legacyCloudDriveBindingStatus.state === "running" && legacyCloudDriveBindingAbortController) {
      legacyCloudDriveBindingStatus = { ...legacyCloudDriveBindingStatus, state: "cancelling" };
      legacyCloudDriveBindingAbortController.abort();
    }
    return legacyCloudDriveBindingStatus;
  });
  ipcMain.handle(IPC_CHANNELS.cloudDriveTest, async () => testConfiguredCloudDriveConnection());
  ipcMain.handle(IPC_CHANNELS.duplicatePreferredDirectoriesList, () => repo.listDuplicatePreferredDirectories());
  ipcMain.handle(IPC_CHANNELS.duplicatePreferredDirectorySave, (_event, directoryPath) =>
    repo.saveDuplicatePreferredDirectory(z.string().min(1).max(32767).parse(directoryPath))
  );
  ipcMain.handle(IPC_CHANNELS.duplicatePreferredDirectoryRemove, (_event, id) =>
    repo.removeDuplicatePreferredDirectory(z.string().uuid().parse(id))
  );
  ipcMain.handle(IPC_CHANNELS.duplicateCleanupConfirm, (_event, payload) =>
    dependencies.duplicateCleanup.confirm(duplicateCleanupConfirmSchema.parse(payload))
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

  ipcMain.handle(IPC_CHANNELS.folderList, () => dependencies.assetCenterQueries.listFolders());

  ipcMain.handle(IPC_CHANNELS.cloudDriveFolderRoots, () => listConfiguredCloudDriveFolderRoots());
  ipcMain.handle(IPC_CHANNELS.cloudDriveFolderBrowse, (_event, selection) =>
    browseConfiguredCloudDriveFolder(cloudDriveSourceSelectionSchema.parse(selection))
  );
  ipcMain.handle(IPC_CHANNELS.cloudDriveFolderAdd, async (_event, selection) => {
    const resolved = await resolveConfiguredCloudDriveFolder(cloudDriveSourceSelectionSchema.parse(selection));
    const folder = repo.addCloudDriveSourceFolder({
      ...resolved,
      recursive: dependencies.settings.get().defaultRecursiveScan
    });
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return folder;
  });

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
    await dependencies.scanManager.retryFailures(folder);
    dependencies.domainEvents.publish({ type: "source-folder:updated", videoIds: [] });
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.folderScanFailureSummary, (_event, folderId: unknown) =>
    repo.getScanFailureSummary(z.string().min(1).parse(folderId))
  );
  ipcMain.handle(IPC_CHANNELS.folderScanFailureList, (_event, folderId: unknown) =>
    repo.listScanFailures(z.string().min(1).parse(folderId))
  );
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewPage, (event, query, purpose) =>
    dependencies.assetCenterQueries.listScanFailures(scanFailureReviewQuerySchema.parse(query), readScope(event, "scan-failures", purpose))
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
    const result = await deleteScanFailureFile(repo, failureId, {
      assertPermanentDeleteAllowed: (videoIds) => dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed(videoIds)
    });
    if (result.videoId) dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({
      type: result.videoId ? "video:removed" : "library:rescanned",
      videoIds: result.videoId ? [result.videoId] : []
    });
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.scanFailureReviewCleanup, async (_event, payload) => {
    const parsed = scanFailureCleanupSchema.parse(payload);
    const linkedVideoIds = parsed.failureIds
      .map((failureId) => repo.getScanFailure(failureId))
      .filter((failure) => failure?.objectType === "file")
      .map((failure) => repo.getVideoByPath(failure!.objectPath)?.id)
      .filter((videoId): videoId is string => Boolean(videoId));
    if (parsed.action !== "permanent-delete") dependencies.duplicateCleanup.assertVideosAvailable(linkedVideoIds);
    const result = await cleanupScanFailures(repo, parsed.failureIds, parsed.action, {
      assertPermanentDeleteAllowed: (videoIds) => dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed(videoIds),
      confirmRemoteMissing: (targetPath) => confirmMountedCloudDriveFileMissing(targetPath)
    });
    if ((parsed.action === "permanent-delete" || parsed.action === "remove-missing-record") && result.successCount > 0) {
      dependencies.cacheManager.scheduleMaintenance(true);
    }
    dependencies.domainEvents.publish({
      type: parsed.action === "permanent-delete" || parsed.action === "remove-missing-record" ? "video:removed" : "video:updated",
      videoIds: linkedVideoIds
    });
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.scanFailureBatchSubmit, (_event, payload) => scanFailureBatches.submit(scanFailureBatchSubmitSchema.parse(payload)));
  ipcMain.handle(IPC_CHANNELS.scanFailureBatchGet, (_event, payload) => scanFailureBatches.get(z.object({ jobId: z.string().min(1) }).strict().parse(payload).jobId));
  ipcMain.handle(IPC_CHANNELS.scanFailureBatchCancel, (_event, payload) => scanFailureBatches.cancel(z.object({ jobId: z.string().min(1) }).strict().parse(payload).jobId));
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

  ipcMain.handle(IPC_CHANNELS.folderRemove, async (_event, folderId: unknown) => {
    const parsedFolderId = z.string().min(1).parse(folderId);
    dependencies.duplicateCleanup.assertSourceFolderVideosAvailable(parsedFolderId);
    dependencies.scanManager.forget(parsedFolderId);
    const result = await dependencies.sourceFolderRemoval.remove(parsedFolderId);
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.folderScanDirectory, async (_event, request: unknown) => {
    const parsed = directoryScanRequestSchema.parse(request);
    const folder = repo.listSourceFolders().find((candidate) => candidate.id === parsed.sourceFolderId);
    if (!folder || !folder.enabled) throw new Error("Source folder is not available");
    const directoryPath = path.win32.normalize(parsed.directoryPath.replaceAll("/", "\\"));
    if (!isManagedPathWithin(directoryPath, folder.path)) throw new Error("Directory is outside the selected source");
    await dependencies.scanManager.startDirectory(folder, directoryPath, parsed.scope === "recursive");
    dependencies.domainEvents.publish({ type: "library:rescanned", videoIds: [] });
    const status = dependencies.scanManager.getStatus(folder.id);
    if (!status) throw new Error("Directory scan status is unavailable");
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.folderRemovePreview, (_event, folderId: unknown) =>
    dependencies.sourceFolderRemoval.preview(z.string().min(1).parse(folderId))
  );

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
    dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed(videoIds);
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
    dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed([parsed.videoId]);
    const video = repo.getVideo(parsed.videoId);
    await permanentlyDeleteFile(video.path);
    repo.removeVideo(parsed.videoId);
    dependencies.cacheManager.scheduleMaintenance(true);
    dependencies.domainEvents.publish({ type: "video:removed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.videoBatchDelete, async (_event, videoIds) => {
    const parsedVideoIds = videoIdsSchema.parse(videoIds);
    dependencies.duplicateCleanupJobs.assertGenericPermanentDeleteAllowed(parsedVideoIds);
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
    if (video.sizeBytes === 0) throw new Error("文件大小为 0B，请先使用“重新读取大小”；远端仍为 0B 时不会执行媒体分析");
    if (video.metadataStatus === "failed") {
      repo.markMetadataPending(video.id, video.path, video.sizeBytes, video.modifiedAt);
    }
    dependencies.metadataQueue.enqueue(video.id, true);
    const refreshed = repo.getVideo(video.id);
    dependencies.domainEvents.publish({ type: "video:updated", videoIds: [video.id] });
    return refreshed;
  });

  ipcMain.handle(IPC_CHANNELS.videoOpenPlayer, async (_event, payload) => {
    const parsed = playerSessionSchema.parse(payload);
    const snapshot = await dependencies.playerWindows.open(parsed, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId, snapshot.startPositionMs ?? 0);
    dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.windowSyncSnapshot, () =>
    dependencies.playerWindows.getSnapshot(dependencies.domainEvents.getSequence())
  );

  ipcMain.handle(IPC_CHANNELS.playerSessionSet, async (_event, payload) => {
    const parsed = playerSessionSchema.parse(payload);
    const snapshot = await dependencies.playerWindows.setSession(parsed, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId, snapshot.startPositionMs ?? 0);
    const event = dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return dependencies.playerWindows.getSnapshot(event.sequence).playerSession;
  });

  ipcMain.handle(IPC_CHANNELS.playerSessionSelect, async (_event, payload) => {
    const parsed = videoIdSchema.parse(payload);
    const snapshot = await dependencies.playerWindows.select(parsed.videoId, dependencies.domainEvents.getSequence());
    repo.recordPlayback(parsed.videoId, snapshot.startPositionMs ?? 0);
    const event = dependencies.domainEvents.publish({ type: "playback:changed", videoIds: [parsed.videoId] });
    return dependencies.playerWindows.getSnapshot(event.sequence).playerSession;
  });

  ipcMain.handle(IPC_CHANNELS.videoPlayExternal, async (_event, payload) => {
    const parsed = videoIdSchema.extend({ startPositionMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).parse(payload);
    const video = repo.getVideo(parsed.videoId);
    try {
      await waitForMpvStart(playWithMpv(video.path, undefined, parsed.startPositionMs));
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
    settings: toPublicSettings(dependencies.settings.get()),
    cacheLocation: dependencies.cacheRoot,
    cacheStatus: dependencies.cacheManager.getStatus()
  }));

  ipcMain.handle(IPC_CHANNELS.settingsSet, (_event, payload) => {
    const settings = dependencies.settings.set(settingsSchema.parse(payload));
    configureCloudDriveRuntime(settings.cloudDrive, dependencies.settings.getCloudDriveToken(), process.env);
    dependencies.domainEvents.publish({ type: "settings:changed", videoIds: [] });
    return toPublicSettings(settings);
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
