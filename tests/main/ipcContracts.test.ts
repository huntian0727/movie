import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "../../src/shared/videoTypes";

describe("IPC_CHANNELS", () => {
  it("defines stable channels for library, folders, files, and settings", () => {
    expect(IPC_CHANNELS).toEqual({
      libraryList: "library:list",
      libraryPage: "library:page",
      libraryNavigation: "library:navigation",
      assetCenterSummary: "asset-center:summary",
      assetCenterSources: "asset-center:sources",
      playbackDiagnosticSearch: "playback-diagnostic:search",
      libraryMissingList: "library:missing-list",
      videoListByIds: "video:list-by-ids",
      folderList: "folder:list",
      folderAdd: "folder:add",
      cloudDriveFolderRoots: "clouddrive-folder:roots",
      cloudDriveFolderBrowse: "clouddrive-folder:browse",
      cloudDriveFolderAdd: "clouddrive-folder:add",
      folderScan: "folder:scan",
      folderScanAll: "folder:scan-all",
      folderRemove: "folder:remove",
      folderRemovePreview: "folder:remove-preview",
      folderScanStatusList: "folder-scan-status:list",
      folderScanPause: "folder-scan:pause",
      folderScanResume: "folder-scan:resume",
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
      videoRevealInFolder: "video:reveal-in-folder",
      videoFavorite: "video:favorite",
      videoPendingDelete: "video:pending-delete",
      videoPendingDeleteClear: "video:pending-delete-clear",
      videoChooseMoveDestination: "video:choose-move-destination",
      videoPreviewMove: "video:preview-move",
      videoBatchMove: "video:batch-move",
      videoBatchDelete: "video:batch-delete",
      videoRename: "video:rename",
      videoDelete: "video:delete",
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
    });
  });

  it("does not expose or register the ambiguous legacy folder retry API", () => {
    expect("folderScanRetry" in IPC_CHANNELS).toBe(false);
    const projectRoot = path.resolve(import.meta.dirname, "../..");
    for (const relativePath of ["src/shared/videoTypes.ts", "src/main/preload.cts", "src/main/ipc.ts"]) {
      const source = readFileSync(path.join(projectRoot, relativePath), "utf8");
      expect(source).not.toContain("retryFolderScan");
      expect(source).not.toContain("folder-scan:retry");
      expect(source).not.toContain("folderScanRetry");
    }
  });

  it("keeps both Asset Center read APIs in the preload contract and validates paged queries strictly", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..");
    const preload = readFileSync(path.join(projectRoot, "src/main/preload.cts"), "utf8");
    const ipc = readFileSync(path.join(projectRoot, "src/main/ipc.ts"), "utf8");

    expect(preload).toContain("getAssetCenterSummary: () => ipcRenderer.invoke(channels.assetCenterSummary)");
    expect(preload).toContain("listAssetCenterSources: (query: AssetCenterSourceQuery) => ipcRenderer.invoke(channels.assetCenterSources, query)");
    expect(ipc).toMatch(/const assetCenterSourceQuerySchema = z\.object\([\s\S]+?\)\.strict\(\);/);
    expect(ipc).toContain("dependencies.assetCenterQueries.listSources(assetCenterSourceQuerySchema.parse(query))");
    expect(ipc).toContain("dependencies.assetCenterQueries.getSummary()");
  });

  it("keeps Playback Diagnostic search on its dedicated validated worker API", () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..");
    const preload = readFileSync(path.join(projectRoot, "src/main/preload.cts"), "utf8");
    const ipc = readFileSync(path.join(projectRoot, "src/main/ipc.ts"), "utf8");
    const renderer = readFileSync(path.join(projectRoot, "src/renderer/App.tsx"), "utf8");
    const worker = readFileSync(path.join(projectRoot, "src/main/playbackDiagnostic/playbackDiagnosticWorker.ts"), "utf8");

    expect(preload).toContain("searchPlaybackDiagnosticVideos: (query: PlaybackDiagnosticSearchQuery) => ipcRenderer.invoke(channels.playbackDiagnosticSearch, query)");
    expect(ipc).toMatch(/const playbackDiagnosticSearchQuerySchema = z\.object\([\s\S]+?\)\.strict\(\);/);
    expect(ipc).toContain("dependencies.playbackDiagnosticQueries.search(playbackDiagnosticSearchQuerySchema.parse(query))");
    expect(renderer).toContain("onSearchPlaybackDiagnosticVideos={api.searchPlaybackDiagnosticVideos}");
    expect(worker).toContain("openAssetCenterReadonlyDatabase(data.databasePath)");
    expect(worker).not.toMatch(/ffprobe|CloudDrive|scanFolder|thumbnail|coverCache/);
  });
});
