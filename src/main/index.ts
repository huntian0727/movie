import { app, BrowserWindow, dialog, protocol, session } from "electron";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConnection } from "./db/database.js";
import { createDatabase, DatabaseMigrationError } from "./db/database.js";
import { VideoRepository } from "./db/videoRepository.js";
import { AssetCenterQueryService } from "./assetCenter/assetCenterQueryService.js";
import { PlaybackDiagnosticQueryService } from "./playbackDiagnostic/playbackDiagnosticQueryService.js";
import { VideoDataService } from "./videoData/videoDataService.js";
import { LibraryPageQueryService } from "./libraryPage/libraryPageQueryService.js";
import { SourceFolderRemovalService } from "./sourceFolderRemoval/sourceFolderRemovalService.js";
import { DuplicateCleanupRepository } from "./db/duplicateCleanupRepository.js";
import { registerIpcHandlers } from "./ipc.js";
import { SubtitleService } from "./subtitles/subtitleService.js";
import { createSubtitleCredentialStore } from "./subtitles/secureStore.js";
import { ScanManager } from "./media/scanManager.js";
import { getMediaCacheRoot, migrateLegacyMediaCache } from "./media/cacheService.js";
import { MediaCacheManager } from "./media/cacheManager.js";
import { MEDIA_SCHEME, registerMediaProtocol } from "./media/mediaProtocol.js";
import { DirectoryImageService } from "./media/directoryImageService.js";
import { MetadataQueue } from "./media/metadataQueue.js";
import { PlaybackMetadataEnricher } from "./media/playbackMetadataEnricher.js";
import { PlaybackStartupPriority } from "./media/playbackStartupPriority.js";
import { mediaReadBudget } from "./media/mediaReadBudget.js";
import { DuplicateCleanupService } from "./media/duplicateCleanupService.js";
import {
  createDiagnosticEnvironment,
  StructuredLogger
} from "./logging/index.js";
import { DomainEventBus, PlayerWindowCoordinator } from "./playerWindow.js";
import { EmbeddedPlayer } from "./embeddedPlayer/embeddedPlayer.js";
import { runPackagedSmoke } from "./packagedSmoke.js";
import { configureSecurityLogger, configureWindowSecurity, installContentSecurityPolicy, installSessionPermissionPolicy, installMediaRequestPolicy } from "./security.js";
import { RENDERER_ENTRY_URL, RENDERER_ORIGIN, RENDERER_SCHEME, registerRendererProtocol } from "./rendererProtocol.js";
import { createSettingsStore } from "./settings/settingsStore.js";
import { configureCloudDriveRuntime } from "./clouddrive/mountedScanner.js";
import { showMainWindowMaximized } from "./windowPresentation.js";
import { legacyUserDataPath } from "./legacyUserDataPath.js";
import { readReleaseFlavor } from "./releaseFlavor.js";

// Renderer/webviews run without hardware acceleration so the app starts on
// machines without a usable GPU (remote desktops, VMs, older GPUs). Without
// this, Chromium's GPU process crashes at startup and the app exits silently.
app.disableHardwareAcceleration();
app.setName("拉面影视");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const rendererEntryUrl = app.isPackaged ? RENDERER_ENTRY_URL : devServerUrl;
const packagedSmokeUserData = process.env.VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA;
const releaseFlavor = app.isPackaged ? readReleaseFlavor(process.resourcesPath, app.getVersion()) : undefined;
if (packagedSmokeUserData) {
  app.setPath("userData", path.resolve(packagedSmokeUserData));
} else if (releaseFlavor?.releaseClass === "unsigned-test-build") {
  app.setPath("userData", path.join(app.getPath("appData"), releaseFlavor.userDataDirectoryName));
} else {
  // Keep existing libraries/settings after changing the visible product name.
  app.setPath("userData", legacyUserDataPath(app.getPath("appData")));
}
const startupUserDataPath = app.getPath("userData");
const databasePath = path.join(startupUserDataPath, "library.sqlite");
const uncleanShutdownMarkerPath = path.join(startupUserDataPath, "database-unclean-shutdown.marker");
const logger = new StructuredLogger(path.join(startupUserDataPath, "logs"));
configureSecurityLogger(logger);
let database: DatabaseConnection | undefined;
let metadataQueue: MetadataQueue | undefined;
let mediaCacheManager: MediaCacheManager | undefined;
let playerWindows: PlayerWindowCoordinator | undefined;
let embeddedPlayer: EmbeddedPlayer | undefined;
let duplicateCleanup: DuplicateCleanupService | undefined;
let assetCenterQueries: AssetCenterQueryService | undefined;
let playbackDiagnosticQueries: PlaybackDiagnosticQueryService | undefined;
let videoDataQueries: VideoDataService | undefined;
let libraryPageQueries: LibraryPageQueryService | undefined;
let sourceFolderRemoval: SourceFolderRemovalService | undefined;
let databaseOpened = false;

protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

process.on("uncaughtException", (error) => {
  logger.error({
    module: "process",
    event: "uncaught_exception",
    message: "The main process encountered an uncaught exception",
    error
  });
  if (app.isReady()) {
    dialog.showErrorBox("应用发生严重错误", "已生成脱敏诊断日志。应用将安全退出，请重新启动后在设置中导出诊断包。");
  }
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({
    module: "process",
    event: "unhandled_rejection",
    message: "The main process encountered an unhandled promise rejection",
    error: reason
  });
  if (app.isReady()) {
    dialog.showErrorBox("后台任务发生错误", "错误已写入脱敏诊断日志。可以继续使用；若问题重复出现，请在设置中导出诊断包。");
  }
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: releaseFlavor?.releaseClass === "unsigned-test-build" ? "拉面影视 · unsigned-test-build" : "拉面影视",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(currentDir, "preload.cjs"),
      additionalArguments: [
        "--video-manager-window-role=main",
        `--video-manager-entry-url=${encodeURIComponent(rendererEntryUrl)}`
      ]
    }
  });
  configureWindowSecurity(window, { role: "main", entryUrl: rendererEntryUrl });
  if (releaseFlavor?.releaseClass === "unsigned-test-build") {
    window.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      window.setTitle("拉面影视 · unsigned-test-build");
    });
  }

  if (app.isPackaged) {
    await window.loadURL(RENDERER_ENTRY_URL);
  } else {
    await window.loadURL(devServerUrl);
  }
  showMainWindowMaximized(window);
}

app.whenReady().then(async () => {
  const startupOperationId = logger.createOperationId();
  const startupStartedAt = Date.now();
  logger.info({
    module: "application",
    operationId: startupOperationId,
    event: "startup_started",
    context: {
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      nodeModuleVersion: process.versions.modules
    }
  });
  installSessionPermissionPolicy(session.defaultSession);
  installMediaRequestPolicy(session.defaultSession);
  registerRendererProtocol(protocol, path.join(currentDir, "../../dist-renderer"));
  installContentSecurityPolicy(session.defaultSession, {
    isPackaged: app.isPackaged,
    devServerUrl,
    entryUrl: rendererEntryUrl
  });
  const verifyExistingIntegrity = existsSync(uncleanShutdownMarkerPath);
  database = createDatabase(databasePath, { verifyExistingIntegrity });
  writeFileSync(uncleanShutdownMarkerPath, new Date().toISOString(), "utf8");
  databaseOpened = true;
  const repo = new VideoRepository(database);
  assetCenterQueries = new AssetCenterQueryService(databasePath);
  playbackDiagnosticQueries = new PlaybackDiagnosticQueryService(databasePath);
  videoDataQueries = new VideoDataService(databasePath);
  libraryPageQueries = new LibraryPageQueryService(databasePath);
  sourceFolderRemoval = new SourceFolderRemovalService(databasePath);
  const settings = await createSettingsStore();
  configureCloudDriveRuntime(settings.get().cloudDrive, settings.getCloudDriveToken(), process.env);
  const userDataPath = app.getPath("userData");
  const subtitles = new SubtitleService(repo, path.join(userDataPath, "subtitles"), createSubtitleCredentialStore(userDataPath));
  const cacheRoot = getMediaCacheRoot(userDataPath);
  try {
    await migrateLegacyMediaCache(userDataPath, cacheRoot);
  } catch (error: unknown) {
    logger.warn({
      module: "media.cache",
      event: "legacy_cache_migration_failed",
      message: "Unable to migrate legacy media cache; continuing with the persistent cache directory",
      context: { error }
    });
  }
  mediaCacheManager = new MediaCacheManager(cacheRoot, {}, {
    getRetainedCachePaths: async () => new Set(await assetCenterQueries!.listRetainedCachePaths()),
    onEntriesRemoved: (cachePaths) => repo.forgetMediaCachePaths(cachePaths),
    logger
  });
  await mediaCacheManager.initialize({ deferMaintenance: true });
  const directoryImages = new DirectoryImageService(() => repo.listSourceFolders(), mediaCacheManager);
  const domainEvents = new DomainEventBus();
  metadataQueue = new MetadataQueue(
    repo,
    undefined,
    3,
    logger,
    (videoId) => domainEvents.publish({ type: "video:updated", videoIds: [videoId] }),
    () => domainEvents.publish({ type: "source-folder:updated", videoIds: [] })
  );
  const scanManager = new ScanManager(repo, undefined, metadataQueue, logger);
  const duplicateCleanupJobs = new DuplicateCleanupRepository(database, repo);
  duplicateCleanup = new DuplicateCleanupService(duplicateCleanupJobs, repo, metadataQueue, mediaCacheManager, domainEvents,
    { databasePath });
  const playbackMetadata = new PlaybackMetadataEnricher(repo, undefined, logger);
  const playbackStartup = new PlaybackStartupPriority((paused) => {
    mediaReadBudget.setPlaybackPaused(paused);
    mediaCacheManager?.setPlaybackPaused(paused);
    metadataQueue?.setPlaybackPaused(paused);
  }, logger);
  playerWindows = new PlayerWindowCoordinator(
    repo,
    { currentDir, devServerUrl, isPackaged: app.isPackaged,
      skipCodecProbe: () => settings.get().playbackPreference === "embedded-first",
      onPlaybackStartup: (videoId) => playbackStartup.begin(videoId),
      onPlaybackClosed: () => playbackStartup.finish(undefined, "closed") },
    (videoId) => playbackMetadata.ensureCodecMetadata(videoId),
    logger
  );
  embeddedPlayer = new EmbeddedPlayer(repo, () => playerWindows?.getPlayerWindow() ?? null, {
    host: app.isPackaged ? path.join(process.resourcesPath, "native-player", "NativeHost.exe") : path.resolve(currentDir, "../../native-bin/NativeHost.exe"),
    directory: path.join(userDataPath, "native-player")
  }, playbackStartup, logger, videoId => subtitles.getPlaybackSubtitle(videoId));
  registerIpcHandlers(repo, {
    database,
    assetCenterQueries,
    playbackDiagnosticQueries,
    videoDataQueries,
    libraryPageQueries,
    sourceFolderRemoval,
    logger,
    diagnosticEnvironment: createDiagnosticEnvironment({
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? "none",
      nodeModuleVersion: process.versions.modules,
      schemaVersion: 0,
      packaged: app.isPackaged,
      userDataPath,
      databasePath,
      cachePath: cacheRoot
    }),
    settings,
    cacheRoot,
    cacheManager: mediaCacheManager,
    directoryImages,
    scanManager,
    metadataQueue,
    playerWindows,
    embeddedPlayer,
    subtitles,
    domainEvents,
    duplicateCleanup,
    duplicateCleanupJobs
  });
  registerMediaProtocol(repo, mediaCacheManager, () => settings.get().coverFrameTimeSeconds, directoryImages,
    app.isPackaged ? RENDERER_ORIGIN : new URL(devServerUrl).origin);
  const packagedSmokePhase = process.env.VIDEO_MANAGER_PACKAGED_SMOKE_PHASE;
  const packagedSmokeResult = process.env.VIDEO_MANAGER_PACKAGED_SMOKE_RESULT;
  if ((packagedSmokePhase === "create" || packagedSmokePhase === "verify") && packagedSmokeResult) {
    await runPackagedSmoke({
      phase: packagedSmokePhase,
      resultPath: packagedSmokeResult,
      userDataPath,
      currentDir,
      db: database,
      repo,
      scanManager,
      metadataQueue,
      assetCenterQueries,
      playbackDiagnosticQueries,
      videoDataQueries
    });
    app.quit();
    return;
  }
  await createWindow();
  mediaCacheManager.scheduleStartupMaintenance();
  logger.info({
    module: "application",
    operationId: startupOperationId,
    event: "startup_completed",
    durationMs: Date.now() - startupStartedAt
  });
  if (settings.get().startupSync) {
    metadataQueue.pause();
    void (async () => {
      try {
        await scanManager.scanAll(repo.listSourceFolders());
        metadataQueue?.enqueuePending();
        domainEvents.publish({ type: "library:rescanned", videoIds: [] });
      } finally {
        metadataQueue?.resume();
      }
    })().catch((error: unknown) => {
      logger.error({
        module: "library.scan",
        event: "startup_sync_failed",
        message: "Startup synchronization failed",
        error
      });
    });
  } else {
    metadataQueue.enqueuePending();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}).catch((error: unknown) => {
  logger.error({
    module: "application",
    event: "startup_failed",
    message: "Failed to start video manager",
    error
  });
  if (error instanceof DatabaseMigrationError) {
    const recoveryLocation = error.backupPath
      ? `\n\n升级前备份：${error.backupPath}`
      : "\n\n数据库未被自动修改。请保留原文件并查看日志。";
    dialog.showErrorBox(
      "资料库升级失败",
      `${error.message}\n\n原数据库：${error.databasePath}${recoveryLocation}\n\n应用已停止启动，以避免继续使用不完整的数据结构。`
    );
  }
  const smokeResultPath = process.env.VIDEO_MANAGER_PACKAGED_SMOKE_RESULT;
  if (process.env.VIDEO_MANAGER_PACKAGED_SMOKE_PHASE && smokeResultPath) {
    void writeFile(
      smokeResultPath,
      JSON.stringify(
        {
          ok: false,
          phase: process.env.VIDEO_MANAGER_PACKAGED_SMOKE_PHASE,
          error: error instanceof Error ? error.stack ?? error.message : String(error)
        },
        null,
        2
      ),
      "utf8"
    ).finally(() => app.exit(1));
  } else {
    app.quit();
  }
});

app.on("before-quit", () => {
  embeddedPlayer?.dispose();
  embeddedPlayer = undefined;
  void playbackDiagnosticQueries?.dispose().catch((error) => {
    logger.warn({
      module: "playback.diagnostic",
      event: "query_worker_shutdown_failed",
      message: "Unable to stop the Playback Diagnostic query worker cleanly",
      context: { error }
    });
  });
  playbackDiagnosticQueries = undefined;
  void videoDataQueries?.dispose();
  videoDataQueries = undefined;
  libraryPageQueries?.dispose();
  libraryPageQueries = undefined;
  sourceFolderRemoval?.dispose();
  sourceFolderRemoval = undefined;
  assetCenterQueries?.dispose();
  assetCenterQueries = undefined;
  duplicateCleanup?.stop();
  duplicateCleanup = undefined;
  playerWindows?.close();
  playerWindows = undefined;
  mediaCacheManager?.stop();
  mediaCacheManager = undefined;
  metadataQueue?.stop();
  metadataQueue = undefined;
  database?.close();
  database = undefined;
  if (databaseOpened) {
    rmSync(uncleanShutdownMarkerPath, { force: true });
    databaseOpened = false;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !process.env.VIDEO_MANAGER_PACKAGED_SMOKE_PHASE) {
    app.quit();
  }
});
