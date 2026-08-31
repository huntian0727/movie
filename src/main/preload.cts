import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DomainEvent, DuplicateGroupPageQuery, IPC_CHANNELS as SharedIpcChannels, LibraryPageQuery, LibraryQuery, ScanFailureReviewQuery, VideoManagerApi } from "../shared/videoTypes.js";

// Sandboxed preloads cannot load local modules, so keep a type-checked copy of the public channel names here.
const channels: typeof SharedIpcChannels = {
  libraryList: "library:list",
  libraryPage: "library:page",
  libraryNavigation: "library:navigation",
  libraryMissingList: "library:missing-list",
  videoListByIds: "video:list-by-ids",
  duplicateList: "duplicate:list",
  duplicatePreviewResolve: "duplicate:preview-resolve",
  duplicateFastDelete: "duplicate:fast-delete",
  duplicateCheckMissing: "duplicate:check-missing",
  duplicateCleanupSubmit: "duplicate-cleanup:submit",
  duplicateCleanupSubmitFiltered: "duplicate-cleanup:submit-filtered",
  duplicateCloudDriveBindLegacy: "duplicate-clouddrive:bind-legacy",
  duplicateCloudDriveBindLegacyStatus: "duplicate-clouddrive:bind-legacy-status",
  duplicateCloudDriveBindLegacyCancel: "duplicate-clouddrive:bind-legacy-cancel",
  cloudDriveTest: "clouddrive:test",
  duplicatePreferredDirectoriesList: "duplicate-preferred-directories:list",
  duplicatePreferredDirectorySave: "duplicate-preferred-directory:save",
  duplicatePreferredDirectoryRemove: "duplicate-preferred-directory:remove",
  duplicateCleanupConfirm: "duplicate-cleanup:confirm",
  duplicateCleanupJobs: "duplicate-cleanup:jobs",
  duplicateCleanupJob: "duplicate-cleanup:job",
  duplicateCleanupItems: "duplicate-cleanup:items",
  duplicateCleanupCancel: "duplicate-cleanup:cancel",
  duplicateCleanupResume: "duplicate-cleanup:resume",
  duplicateCleanupRetry: "duplicate-cleanup:retry",
  duplicateCleanupClear: "duplicate-cleanup:clear",
  duplicateCleanupOpenItem: "duplicate-cleanup:open-item",
  folderList: "folder:list",
  folderAdd: "folder:add",
  cloudDriveFolderRoots: "clouddrive-folder:roots",
  cloudDriveFolderBrowse: "clouddrive-folder:browse",
  cloudDriveFolderAdd: "clouddrive-folder:add",
  folderScan: "folder:scan",
  folderScanAll: "folder:scan-all",
  folderScanFailuresRetry: "folder-scan-failures:retry",
  folderScanFailureSummary: "folder-scan-failures:summary",
  folderScanFailureList: "folder-scan-failures:list",
  scanFailureReviewPage: "scan-failure-review:page",
  scanFailureReviewRetry: "scan-failure-review:retry",
  scanFailureReviewDelete: "scan-failure-review:delete",
  scanFailureReviewCleanup: "scan-failure-review:cleanup",
  scanFailureBatchSubmit: "scan-failure-batch:submit",
  scanFailureBatchGet: "scan-failure-batch:get",
  scanFailureBatchCancel: "scan-failure-batch:cancel",
  scanFailureReviewOpen: "scan-failure-review:open",
  folderRemove: "folder:remove",
  folderRemovePreview: "folder:remove-preview",
  folderScanStatusList: "folder-scan-status:list",
  folderScanPause: "folder-scan:pause",
  folderScanResume: "folder-scan:resume",
  videoRevealInFolder: "video:reveal-in-folder",
  videoFavorite: "video:favorite",
  videoPendingDelete: "video:pending-delete",
  videoPendingDeleteClear: "video:pending-delete-clear",
  videoRename: "video:rename",
  videoDelete: "video:delete",
  videoBatchDelete: "video:batch-delete",
  videoChooseMoveDestination: "video:choose-move-destination",
  videoPreviewMove: "video:preview-move",
  videoBatchMove: "video:batch-move",
  videoForget: "video:forget",
  videoRegenerateCover: "video:regenerate-cover",
  previewImageLoad: "preview-image:load",
  previewImageCancel: "preview-image:cancel",
  videoRetryMetadata: "video:retry-metadata",
  videoOpenPlayer: "video:open-player",
  videoPlayExternal: "video:play-external",
  playHistoryList: "play-history:list",
  playHistoryRecord: "play-history:record",
  windowSyncSnapshot: "window-sync:snapshot",
  playerSessionSet: "player-session:set",
  playerSessionSelect: "player-session:select",
  domainEvent: "domain:event",
  diagnosticsPreview: "diagnostics:preview",
  diagnosticsExport: "diagnostics:export",
  cacheClear: "cache:clear",
  settingsGet: "settings:get",
  settingsSet: "settings:set"
};

const mainApi: VideoManagerApi = {
  listVideos: (query: LibraryQuery) => ipcRenderer.invoke(channels.libraryList, query),
  listVideoPage: (query: LibraryPageQuery) => ipcRenderer.invoke(channels.libraryPage, query),
  getLibraryNavigation: () => ipcRenderer.invoke(channels.libraryNavigation),
  listMissingVideos: () => ipcRenderer.invoke(channels.libraryMissingList),
  listVideosByIds: (videoIds: string[]) => ipcRenderer.invoke(channels.videoListByIds, videoIds),
  listDuplicateGroups: (query: DuplicateGroupPageQuery) => ipcRenderer.invoke(channels.duplicateList, query),
  previewDuplicateResolve: (plan) => ipcRenderer.invoke(channels.duplicatePreviewResolve, plan),
  fastDeleteDuplicateCandidates: (plan) => ipcRenderer.invoke(channels.duplicateFastDelete, plan),
  checkDuplicateMissing: (plan) => ipcRenderer.invoke(channels.duplicateCheckMissing, plan),
  submitDuplicateCleanup: (request) => ipcRenderer.invoke(channels.duplicateCleanupSubmit, request),
  submitFilteredDuplicateCleanup: (request) => ipcRenderer.invoke(channels.duplicateCleanupSubmitFiltered, request),
  bindLegacyCloudDriveDuplicates: () => ipcRenderer.invoke(channels.duplicateCloudDriveBindLegacy),
  getLegacyCloudDriveBindingStatus: () => ipcRenderer.invoke(channels.duplicateCloudDriveBindLegacyStatus),
  cancelLegacyCloudDriveBinding: () => ipcRenderer.invoke(channels.duplicateCloudDriveBindLegacyCancel),
  testCloudDriveConnection: () => ipcRenderer.invoke(channels.cloudDriveTest),
  listDuplicatePreferredDirectories: () => ipcRenderer.invoke(channels.duplicatePreferredDirectoriesList),
  saveDuplicatePreferredDirectory: (path) => ipcRenderer.invoke(channels.duplicatePreferredDirectorySave, path),
  removeDuplicatePreferredDirectory: (id) => ipcRenderer.invoke(channels.duplicatePreferredDirectoryRemove, id),
  confirmDuplicateCleanup: (request) => ipcRenderer.invoke(channels.duplicateCleanupConfirm, request),
  listDuplicateCleanupJobs: (page, pageSize) => ipcRenderer.invoke(channels.duplicateCleanupJobs, { page, pageSize }),
  getDuplicateCleanupJob: (jobId) => ipcRenderer.invoke(channels.duplicateCleanupJob, jobId),
  listDuplicateCleanupItems: (jobId, page, pageSize) => ipcRenderer.invoke(channels.duplicateCleanupItems, { jobId, page, pageSize }),
  cancelDuplicateCleanup: (jobId) => ipcRenderer.invoke(channels.duplicateCleanupCancel, jobId),
  resumeDuplicateCleanup: (jobId) => ipcRenderer.invoke(channels.duplicateCleanupResume, jobId),
  retryDuplicateCleanup: (jobId) => ipcRenderer.invoke(channels.duplicateCleanupRetry, jobId),
  clearDuplicateCleanup: (jobId) => ipcRenderer.invoke(channels.duplicateCleanupClear, jobId),
  openDuplicateCleanupItem: (itemId) => ipcRenderer.invoke(channels.duplicateCleanupOpenItem, itemId),
  listFolders: () => ipcRenderer.invoke(channels.folderList),
  addFolder: () => ipcRenderer.invoke(channels.folderAdd),
  listCloudDriveFolderRoots: () => ipcRenderer.invoke(channels.cloudDriveFolderRoots),
  browseCloudDriveFolder: (selection) => ipcRenderer.invoke(channels.cloudDriveFolderBrowse, selection),
  addCloudDriveFolder: (selection) => ipcRenderer.invoke(channels.cloudDriveFolderAdd, selection),
  scanFolder: (folderId: string) => ipcRenderer.invoke(channels.folderScan, folderId),
  scanAllFolders: () => ipcRenderer.invoke(channels.folderScanAll),
  retryScanFailures: (folderId: string) => ipcRenderer.invoke(channels.folderScanFailuresRetry, folderId),
  getScanFailureSummary: (folderId: string) => ipcRenderer.invoke(channels.folderScanFailureSummary, folderId),
  listScanFailures: (folderId: string) => ipcRenderer.invoke(channels.folderScanFailureList, folderId),
  listScanFailureReviewPage: (query: ScanFailureReviewQuery) => ipcRenderer.invoke(channels.scanFailureReviewPage, query),
  retryScanFailure: (failureId: string) => ipcRenderer.invoke(channels.scanFailureReviewRetry, { failureId }),
  deleteScanFailureFile: (failureId: string) => ipcRenderer.invoke(channels.scanFailureReviewDelete, { failureId }),
  cleanupScanFailures: (failureIds, action) => ipcRenderer.invoke(channels.scanFailureReviewCleanup, { failureIds, action }),
  submitScanFailureBatch: (request) => ipcRenderer.invoke(channels.scanFailureBatchSubmit, request),
  getScanFailureBatch: (jobId) => ipcRenderer.invoke(channels.scanFailureBatchGet, { jobId }),
  cancelScanFailureBatch: (jobId) => ipcRenderer.invoke(channels.scanFailureBatchCancel, { jobId }),
  openScanFailureLocation: (failureId: string) => ipcRenderer.invoke(channels.scanFailureReviewOpen, { failureId }),
  removeFolder: (folderId: string) => ipcRenderer.invoke(channels.folderRemove, folderId),
  previewRemoveFolder: (folderId: string) => ipcRenderer.invoke(channels.folderRemovePreview, folderId),
  listFolderScanStatuses: () => ipcRenderer.invoke(channels.folderScanStatusList),
  pauseFolderScan: (folderId: string) => ipcRenderer.invoke(channels.folderScanPause, folderId),
  resumeFolderScan: (folderId: string) => ipcRenderer.invoke(channels.folderScanResume, folderId),
  revealVideoInFolder: (videoId: string) => ipcRenderer.invoke(channels.videoRevealInFolder, { videoId }),
  setFavorite: (videoId: string, favorite: boolean) => ipcRenderer.invoke(channels.videoFavorite, { videoId, favorite }),
  setPendingDelete: (videoId: string, pendingDelete: boolean) => ipcRenderer.invoke(channels.videoPendingDelete, { videoId, pendingDelete }),
  deletePendingVideos: () => ipcRenderer.invoke(channels.videoPendingDeleteClear),
  renameVideo: (videoId: string, baseName: string) => ipcRenderer.invoke(channels.videoRename, { videoId, baseName }),
  deleteVideo: (videoId: string) => ipcRenderer.invoke(channels.videoDelete, { videoId }),
  deleteVideos: (videoIds: string[]) => ipcRenderer.invoke(channels.videoBatchDelete, videoIds),
  chooseMoveDestination: () => ipcRenderer.invoke(channels.videoChooseMoveDestination),
  previewMoveVideos: (videoIds, targetDirectory, addTargetToLibrary) => ipcRenderer.invoke(channels.videoPreviewMove, { videoIds, targetDirectory, addTargetToLibrary }),
  moveVideos: (videoIds, targetDirectory, addTargetToLibrary) => ipcRenderer.invoke(channels.videoBatchMove, { videoIds, targetDirectory, addTargetToLibrary }),
  forgetVideo: (videoId: string) => ipcRenderer.invoke(channels.videoForget, { videoId }),
  regenerateCover: (videoId: string) => ipcRenderer.invoke(channels.videoRegenerateCover, { videoId }),
  loadPreviewImage: (request: import("../shared/videoTypes.js").PreviewImageRequest) => ipcRenderer.invoke(channels.previewImageLoad, request),
  cancelPreviewImage: (requestId: string) => ipcRenderer.invoke(channels.previewImageCancel, requestId),
  retryMetadata: (videoId: string) => ipcRenderer.invoke(channels.videoRetryMetadata, { videoId }),
  openPlayer: (videoId: string, queueIds: string[]) => ipcRenderer.invoke(channels.videoOpenPlayer, { videoId, queueIds }),
  playExternalVideo: (videoId: string) => ipcRenderer.invoke(channels.videoPlayExternal, { videoId }),
  listPlayHistory: () => ipcRenderer.invoke(channels.playHistoryList),
  recordPlayback: (videoId: string, positionMs = 0) => ipcRenderer.invoke(channels.playHistoryRecord, { videoId, positionMs }),
  getWindowSyncSnapshot: () => ipcRenderer.invoke(channels.windowSyncSnapshot),
  setPlayerSession: (videoId: string, queueIds: string[]) => ipcRenderer.invoke(channels.playerSessionSet, { videoId, queueIds }),
  selectPlayerVideo: (videoId: string) => ipcRenderer.invoke(channels.playerSessionSelect, { videoId }),
  subscribeDomainEvents: (listener: (event: DomainEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: DomainEvent) => listener(payload);
    ipcRenderer.on(channels.domainEvent, handler);
    return () => ipcRenderer.removeListener(channels.domainEvent, handler);
  },
  previewDiagnostics: (includeFullPaths: boolean) => ipcRenderer.invoke(channels.diagnosticsPreview, { includeFullPaths }),
  exportDiagnostics: (includeFullPaths: boolean) => ipcRenderer.invoke(channels.diagnosticsExport, { includeFullPaths }),
  getSettings: () => ipcRenderer.invoke(channels.settingsGet),
  setSettings: (settings) => ipcRenderer.invoke(channels.settingsSet, settings),
  clearCache: () => ipcRenderer.invoke(channels.cacheClear)
};

const playerApi = {
  loadPreviewImage: mainApi.loadPreviewImage,
  cancelPreviewImage: mainApi.cancelPreviewImage,
  listVideoPage: mainApi.listVideoPage,
  getLibraryNavigation: mainApi.getLibraryNavigation,
  listMissingVideos: mainApi.listMissingVideos,
  listVideosByIds: mainApi.listVideosByIds,
  listFolders: mainApi.listFolders,
  listFolderScanStatuses: mainApi.listFolderScanStatuses,
  setFavorite: mainApi.setFavorite,
  setPendingDelete: mainApi.setPendingDelete,
  deleteVideo: mainApi.deleteVideo,
  playExternalVideo: mainApi.playExternalVideo,
  listPlayHistory: mainApi.listPlayHistory,
  recordPlayback: mainApi.recordPlayback,
  getWindowSyncSnapshot: mainApi.getWindowSyncSnapshot,
  setPlayerSession: mainApi.setPlayerSession,
  selectPlayerVideo: mainApi.selectPlayerVideo,
  subscribeDomainEvents: mainApi.subscribeDomainEvents,
  getSettings: mainApi.getSettings
} satisfies Partial<VideoManagerApi>;

const roleArgument = process.argv.find((argument) => argument.startsWith("--video-manager-window-role="));
const windowRole = roleArgument?.slice("--video-manager-window-role=".length);
const entryArgument = process.argv.find((argument) => argument.startsWith("--video-manager-entry-url="));
const trustedEntryUrl = entryArgument
  ? decodeURIComponent(entryArgument.slice("--video-manager-entry-url=".length))
  : "";

if (isTrustedRendererLocation(window.location.href, trustedEntryUrl)) {
  const api = windowRole === "main" ? mainApi : playerApi;
  const windowMode = windowRole === "player" ? "player" : "main";
  contextBridge.exposeInMainWorld("videoManager", { ...api, windowMode });
}

function isTrustedRendererLocation(candidateUrl: string, entryUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const entry = new URL(entryUrl);
    if (candidate.protocol !== entry.protocol) return false;
    if (entry.protocol === "file:") {
      candidate.search = "";
      candidate.hash = "";
      entry.search = "";
      entry.hash = "";
      return candidate.href === entry.href;
    }
    return candidate.origin === entry.origin && candidate.pathname === entry.pathname;
  } catch {
    return false;
  }
}
