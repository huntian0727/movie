import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DomainEvent, DuplicateGroupPageQuery, IPC_CHANNELS as SharedIpcChannels, LibraryPageQuery, LibraryQuery, VideoManagerApi } from "../shared/videoTypes.js";

// Sandboxed preloads cannot load local modules, so keep a type-checked copy of the public channel names here.
const channels: typeof SharedIpcChannels = {
  libraryList: "library:list",
  libraryPage: "library:page",
  libraryNavigation: "library:navigation",
  libraryMissingList: "library:missing-list",
  videoListByIds: "video:list-by-ids",
  duplicateList: "duplicate:list",
  duplicatePreviewResolve: "duplicate:preview-resolve",
  duplicateResolve: "duplicate:resolve",
  folderList: "folder:list",
  folderAdd: "folder:add",
  folderScan: "folder:scan",
  folderRemove: "folder:remove",
  folderRemovePreview: "folder:remove-preview",
  folderScanStatusList: "folder-scan-status:list",
  folderScanPause: "folder-scan:pause",
  folderScanResume: "folder-scan:resume",
  folderScanRetry: "folder-scan:retry",
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
  resolveDuplicateGroups: (plan) => ipcRenderer.invoke(channels.duplicateResolve, plan),
  listFolders: () => ipcRenderer.invoke(channels.folderList),
  addFolder: () => ipcRenderer.invoke(channels.folderAdd),
  scanFolder: (folderId: string) => ipcRenderer.invoke(channels.folderScan, folderId),
  removeFolder: (folderId: string) => ipcRenderer.invoke(channels.folderRemove, folderId),
  previewRemoveFolder: (folderId: string) => ipcRenderer.invoke(channels.folderRemovePreview, folderId),
  listFolderScanStatuses: () => ipcRenderer.invoke(channels.folderScanStatusList),
  pauseFolderScan: (folderId: string) => ipcRenderer.invoke(channels.folderScanPause, folderId),
  resumeFolderScan: (folderId: string) => ipcRenderer.invoke(channels.folderScanResume, folderId),
  retryFolderScan: (folderId: string) => ipcRenderer.invoke(channels.folderScanRetry, folderId),
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
  contextBridge.exposeInMainWorld("videoManager", windowRole === "main" ? mainApi : playerApi);
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
