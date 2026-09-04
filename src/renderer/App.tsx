import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, DomainEvent, DuplicateResolvePlan, FolderScanStatus, LibraryNavigationSnapshot, MediaCacheStatus, PlayerSessionSnapshot, PlayHistoryEntry, SourceFolder, VideoRecord, WindowSyncSnapshot } from "../shared/videoTypes";
import { getVideoManagerApi, type DesktopVideoManagerApi } from "./api/client";
import { LibraryShell } from "./components/LibraryShell";
import { CloudDriveFolderDialog } from "./components/CloudDriveFolderDialog";
import { PlayerPage } from "./components/PlayerPage";
import { SettingsPage } from "./components/SettingsPage";
import { choosePlaybackRoute } from "../shared/playbackRouting";
import { DEFAULT_SHORTCUTS } from "../shared/shortcuts";
import { areVisibleScanStatusesEqual } from "./scanStatus";
import { startWindowSync } from "./windowSync";
import { getCoverUrl as getStableCoverUrl } from "../shared/previewIdentity";

const defaultSettings: AppSettings = {
  defaultRecursiveScan: true,
  startupSync: true,
  autoPlayOnOpen: true,
  seekStepSeconds: 10,
  coverFrameTimeSeconds: 5,
  playbackPreference: "auto",
  cloudDrive: {
    endpoint: "http://127.0.0.1:19798",
    apiToken: "",
    timeoutMs: 20_000,
    mountMapJson: ""
  },
  shortcuts: { ...DEFAULT_SHORTCUTS }
};

const emptyNavigation: LibraryNavigationSnapshot = {
  totalVideos: 0,
  favoriteVideos: 0,
  pendingDeleteVideos: 0,
  pendingDeleteBytes: 0,
  pendingMetadataVideos: 0,
  scanFailureCount: 0,
  directoryPaths: []
};

const emptyCacheStatus: MediaCacheStatus = {
  totalBytes: 0,
  coverBytes: 0,
  timelineBytes: 0,
  itemCount: 0,
  maxBytes: 10 * 1024 * 1024 * 1024,
  automaticCleanup: true,
  lastMaintenanceAt: null,
  lastCleanup: null
};

export function App() {
  const api = getVideoManagerApi();
  if (!api) return <UnsupportedRuntime />;
  return <DesktopApp api={api} />;
}

export function UnsupportedRuntime() {
  return (
    <main className="unsupported-runtime" role="main">
      <div className="unsupported-runtime-card">
        <div className="unsupported-runtime-mark" aria-hidden="true">映</div>
        <h1>映匣仅支持 Windows 桌面应用运行</h1>
        <p>请从映匣桌面客户端启动。</p>
      </div>
    </main>
  );
}

export function DesktopApp({ api }: { api: DesktopVideoManagerApi }) {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [folders, setFolders] = useState<SourceFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<string[]>([]);
  const [directoryPlaybackQueue, setDirectoryPlaybackQueue] = useState<VideoRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudDriveFolderOpen, setCloudDriveFolderOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [cacheLocation, setCacheLocation] = useState("");
  const [cacheStatus, setCacheStatus] = useState<MediaCacheStatus>(emptyCacheStatus);
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>([]);
  const [scanStatuses, setScanStatuses] = useState<FolderScanStatus[]>([]);
  const [navigation, setNavigation] = useState<LibraryNavigationSnapshot>(emptyNavigation);
  const [playerSession, setPlayerSession] = useState<PlayerSessionSnapshot | null>(null);
  const [libraryRefreshSequence, setLibraryRefreshSequence] = useState(0);
  const [duplicateRefreshSequence, setDuplicateRefreshSequence] = useState(0);
  const [duplicateCleanupRefreshSequence, setDuplicateCleanupRefreshSequence] = useState(0);
  const duplicateRemovalRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceFolderRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRemovalSequence = useRef(0);
  const pendingMetadataSequence = useRef(0);
  const lastAppliedSequence = useRef(0);
  const focusCheckPending = useRef(false);
  const initialized = useRef(false);
  const playerVideoIds = useRef(new Set<string>());
  const [scanFailureRefreshSequence, setScanFailureRefreshSequence] = useState(0);
  const previousScanStates = useRef(new Map<string, FolderScanStatus["state"]>());
  const isPlayerWindow = api.windowMode === "player";
  const recentVideoIds = useMemo(() => playHistory.map((entry) => entry.videoId), [playHistory]);
  const getCoverUrl = useCallback((video: VideoRecord) =>
    getStableCoverUrl(video, settings.coverFrameTimeSeconds),
  [settings.coverFrameTimeSeconds]);

  const reload = useCallback(async (providedSnapshot?: WindowSyncSnapshot) => {
    if (!initialized.current) setLoading(true);
    setError(null);

    try {
      const syncSnapshot = providedSnapshot ?? await api.getWindowSyncSnapshot();
      lastAppliedSequence.current = Math.max(lastAppliedSequence.current, syncSnapshot.sequence);
      const nextPlayerSession = isPlayerWindow ? syncSnapshot.playerSession : null;
      if (isPlayerWindow) {
        const [settingsSnapshot, nextPlayHistory] = await Promise.all([
          api.getSettings(),
          api.listPlayHistory()
        ]);
        setVideos(nextPlayerSession?.videos ?? []);
        setPlayerSession(nextPlayerSession);
        setSettings(settingsSnapshot.settings);
        setCacheLocation(settingsSnapshot.cacheLocation);
        setCacheStatus(settingsSnapshot.cacheStatus);
        setPlayHistory(nextPlayHistory);
      } else {
        const [nextFolders, settingsSnapshot, nextPlayHistory, nextNavigation] = await Promise.all([
          api.listFolders(),
          api.getSettings(),
          api.listPlayHistory(),
          api.getLibraryNavigation()
        ]);
        setFolders(nextFolders);
        setNavigation(nextNavigation);
        setSettings(settingsSnapshot.settings);
        setCacheLocation(settingsSnapshot.cacheLocation);
        setCacheStatus(settingsSnapshot.cacheStatus);
        setPlayHistory(nextPlayHistory);
      }
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      initialized.current = true;
      setLoading(false);
    }
  }, [api, isPlayerWindow]);

  useEffect(() => {
    playerVideoIds.current = new Set(videos.map((video) => video.id));
  }, [videos]);

  const handleDomainEvent = useCallback(async (event: DomainEvent) => {
    lastAppliedSequence.current = Math.max(lastAppliedSequence.current, event.sequence);
    if (event.type === "settings:changed") {
      const snapshot = await api.getSettings();
      setSettings(snapshot.settings);
      setCacheLocation(snapshot.cacheLocation);
      setCacheStatus(snapshot.cacheStatus);
      return;
    }
    if (event.type === "playback:changed") {
      setPlayHistory(await api.listPlayHistory());
      return;
    }
    if (isPlayerWindow) {
      if (event.type === "source-folder:updated" || event.type === "library:rescanned" || event.type === "duplicate-cleanup:changed") {
        return;
      }
      const affectedIds = event.videoIds.filter((videoId) => playerVideoIds.current.has(videoId));
      if (affectedIds.length === 0) return;
      if (event.type === "video:removed") {
        await reload();
        return;
      }
      const refreshed = await api.listVideosByIds(affectedIds);
      const refreshedById = new Map(refreshed.filter((video) => !video.isMissing).map((video) => [video.id, video]));
      const patchVideos = (current: VideoRecord[]) => current
        .map((video) => refreshedById.get(video.id) ?? video)
        .filter((video) => !affectedIds.includes(video.id) || refreshedById.has(video.id));
      setVideos(patchVideos);
      setPlayerSession((current) => current ? { ...current, videos: patchVideos(current.videos) } : current);
      return;
    }
    if (event.type === "source-folder:updated") {
      if (sourceFolderRefreshTimer.current) clearTimeout(sourceFolderRefreshTimer.current);
      sourceFolderRefreshTimer.current = setTimeout(() => {
        sourceFolderRefreshTimer.current = null;
        void api.listFolders().then(setFolders).catch((cause) => setError(toMessage(cause)));
      }, 750);
      return;
    }
    if (event.type === "duplicate-cleanup:changed") {
      setDuplicateCleanupRefreshSequence(event.sequence);
      return;
    }
    if (event.type === "video:removed") {
      pendingRemovalSequence.current = Math.max(pendingRemovalSequence.current, event.sequence);
      if (duplicateRemovalRefreshTimer.current) {
        clearTimeout(duplicateRemovalRefreshTimer.current);
      }
      duplicateRemovalRefreshTimer.current = setTimeout(() => {
        duplicateRemovalRefreshTimer.current = null;
        const sequence = pendingRemovalSequence.current;
        setLibraryRefreshSequence(sequence);
        setDuplicateRefreshSequence(sequence);
        void api.getLibraryNavigation().then(setNavigation);
      }, 500);
      return;
    }
    if (event.type === "video:updated") {
      pendingMetadataSequence.current = Math.max(pendingMetadataSequence.current, event.sequence);
      if (metadataRefreshTimer.current) clearTimeout(metadataRefreshTimer.current);
      metadataRefreshTimer.current = setTimeout(() => {
        metadataRefreshTimer.current = null;
        setLibraryRefreshSequence(pendingMetadataSequence.current);
      }, 350);
      return;
    }
    setLibraryRefreshSequence(event.sequence);
    if (event.type === "library:rescanned") {
      setDuplicateRefreshSequence(event.sequence);
    }
    if (event.type === "library:rescanned") {
      setScanFailureRefreshSequence(event.sequence);
      await reload();
      return;
    }
    setNavigation(await api.getLibraryNavigation());
  }, [api, isPlayerWindow, reload]);

  useEffect(() => () => {
    if (duplicateRemovalRefreshTimer.current) {
      clearTimeout(duplicateRemovalRefreshTimer.current);
    }
    if (metadataRefreshTimer.current) clearTimeout(metadataRefreshTimer.current);
    if (sourceFolderRefreshTimer.current) clearTimeout(sourceFolderRefreshTimer.current);
  }, []);

  useEffect(() => {
    const subscription = startWindowSync(api, {
      onSnapshot: (snapshot) => reload(snapshot),
      onEvent: handleDomainEvent,
      onError: (cause) => setError(toMessage(cause))
    });
    return () => subscription.dispose();
  }, [api, handleDomainEvent, reload]);

  useEffect(() => {
    const reloadOnFocus = () => {
      if (focusCheckPending.current) return;
      focusCheckPending.current = true;
      void api.getWindowSyncSnapshot().then((snapshot) => {
        if (snapshot.sequence > lastAppliedSequence.current) return reload(snapshot);
      }).catch((cause) => setError(toMessage(cause))).finally(() => {
        focusCheckPending.current = false;
      });
    };
    window.addEventListener("focus", reloadOnFocus);
    return () => window.removeEventListener("focus", reloadOnFocus);
  }, [api, reload]);

  useEffect(() => {
    if (isPlayerWindow) return;
    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const statuses = await api.listFolderScanStatuses();
        if (disposed) return;
        const shouldReload = statuses.some((status) => {
          const previous = previousScanStates.current.get(status.folderId);
          return (previous === "queued" || previous === "scanning" || previous === "paused") &&
            (status.state === "completed" || status.state === "completed-with-errors" || status.state === "offline" || status.state === "error");
        });
        previousScanStates.current = new Map(statuses.map((status) => [status.folderId, status.state]));
        setScanStatuses((current) => areVisibleScanStatusesEqual(current, statuses) ? current : statuses);
        if (shouldReload) void reload();
        const hasActiveScan = statuses.some((status) => status.state === "queued" || status.state === "scanning" || status.state === "paused");
        if (!disposed) timer = window.setTimeout(() => void poll(), hasActiveScan ? 1_000 : 4_000);
      } catch (cause) {
        if (!disposed) setError(toMessage(cause));
        if (!disposed) timer = window.setTimeout(() => void poll(), 4_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [api, isPlayerWindow, reload]);

  const addFolder = async () => {
    const folder = await api.addFolder();
    if (!folder) return;
    await reload();
    void api.scanFolder(folder.id).then(() => reload()).catch((cause) => setError(toMessage(cause)));
  };

  const removeFolder = async (folder: SourceFolder) => {
    await api.removeFolder(folder.id);
    await reload();
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await api.scanAllFolders();
      await reload();
    } catch (cause) {
      setError(toMessage(cause));
      setLoading(false);
    }
  };

  const toggleFavorite = async (video: VideoRecord) => {
    const favorite = !video.isFavorite;
    await api.setFavorite(video.id, favorite);
    setNavigation(await api.getLibraryNavigation());
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, isFavorite: favorite } : item)));
    setDirectoryPlaybackQueue((current) => current.map((item) => (item.id === video.id ? { ...item, isFavorite: favorite } : item)));
  };

  const togglePendingDelete = async (video: VideoRecord) => {
    const pendingDelete = !video.isPendingDelete;
    await api.setPendingDelete(video.id, pendingDelete);
    setNavigation(await api.getLibraryNavigation());
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
    setDirectoryPlaybackQueue((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
  };

  const renameVideo = async (video: VideoRecord, baseName: string) => {
    const renamed = await api.renameVideo(video.id, baseName);
    setVideos((current) => current.map((item) => (item.id === video.id ? renamed : item)));
  };

  const deleteVideo = async (video: VideoRecord) => {
    if (selectedVideoId === video.id) setSelectedVideoId(null);
    await api.deleteVideo(video.id);
    await reload();
  };

  const deleteVideos = async (batch: VideoRecord[]) => {
    const result = await api.deleteVideos(batch.map((video) => video.id));
    await reload();
    return result;
  };

  const regenerateCover = async (video: VideoRecord) => {
    const refreshed = await api.regenerateCover(video.id);
    setVideos((current) => current.map((item) => (item.id === video.id ? refreshed : item)));
  };

  const retryMetadata = async (video: VideoRecord) => {
    const refreshed = await api.retryMetadata(video.id);
    setVideos((current) => current.map((item) => (item.id === video.id ? refreshed : item)));
  };

  const playerQueueIds = playerSession?.queueIds ?? playbackQueue;
  const playerVideoId = playerSession?.selectedVideoId ?? selectedVideoId;
  const originalPlayerQueue = playerQueueIds.map((id) => videos.find((video) => video.id === id)).filter((video): video is VideoRecord => Boolean(video));
  const playerQueuedVideos = directoryPlaybackQueue.some((video) => video.id === playerVideoId)
    ? directoryPlaybackQueue
    : originalPlayerQueue;
  const selectedIndex = playerQueuedVideos.findIndex((video) => video.id === playerVideoId);
  const selectedVideo = selectedIndex >= 0 ? playerQueuedVideos[selectedIndex] : null;
  const playbackRoute = selectedVideo ? choosePlaybackRoute(selectedVideo, settings.playbackPreference) : "native";

  if (isPlayerWindow && !selectedVideo) {
    return <div className="loading-state"><span /><p>正在打开播放器...</p></div>;
  }

  if (settingsOpen) {
    return (
      <SettingsPage
        settings={settings}
        cacheLocation={cacheLocation}
        cacheStatus={cacheStatus}
        onBack={() => setSettingsOpen(false)}
        onChange={async (next) => setSettings(await api.setSettings(next))}
        onTestCloudDrive={() => api.testCloudDriveConnection()}
        onClearCache={async () => {
          const result = await api.clearCache();
          setCacheStatus(result.status);
          return result;
        }}
        onPreviewDiagnostics={(includeFullPaths) => api.previewDiagnostics(includeFullPaths)}
        onExportDiagnostics={(includeFullPaths) => api.exportDiagnostics(includeFullPaths)}
      />
    );
  }

  if (selectedVideo) {
    return (
      <PlayerPage
        video={selectedVideo}
        mediaUrl={playbackRoute === "native" ? `local-video://media/${encodeURIComponent(selectedVideo.id)}` : undefined}
        autoPlayOnOpen={settings.autoPlayOnOpen}
        seekStepSeconds={settings.seekStepSeconds}
        shortcuts={settings.shortcuts}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex < playerQueuedVideos.length - 1}
        playbackRoute={playbackRoute}
        onBack={isPlayerWindow ? undefined : () => setSelectedVideoId(null)}
        onPrevious={async () => {
          const nextId = playerQueuedVideos[selectedIndex - 1]?.id ?? selectedVideo.id;
          if (isPlayerWindow) {
            const snapshot = await api.selectPlayerVideo(nextId);
            setPlayerSession(snapshot);
            setVideos(snapshot.videos);
          }
          else setSelectedVideoId(nextId);
        }}
        onNext={async () => {
          const nextId = playerQueuedVideos[selectedIndex + 1]?.id ?? selectedVideo.id;
          if (isPlayerWindow) {
            const snapshot = await api.selectPlayerVideo(nextId);
            setPlayerSession(snapshot);
            setVideos(snapshot.videos);
          }
          else setSelectedVideoId(nextId);
        }}
        onToggleFavorite={toggleFavorite}
        onTogglePendingDelete={togglePendingDelete}
        onDelete={async (video) => {
          const usingDirectoryQueue = directoryPlaybackQueue.some((item) => item.id === video.id);
          const remainingQueue = playerQueuedVideos.filter((item) => item.id !== video.id);
          const nextVideo = playerQueuedVideos[selectedIndex + 1] ?? playerQueuedVideos[selectedIndex - 1] ?? null;
          await api.deleteVideo(video.id);
          setDirectoryPlaybackQueue((current) => current.filter((item) => item.id !== video.id));
          if (nextVideo) {
            if (isPlayerWindow) {
              const snapshot = await api.setPlayerSession(
                nextVideo.id,
                usingDirectoryQueue ? [nextVideo.id] : remainingQueue.map((item) => item.id)
              );
              setPlayerSession(snapshot);
              setVideos(snapshot.videos);
            }
            else {
              setPlaybackQueue(remainingQueue.map((item) => item.id));
              setSelectedVideoId(nextVideo.id);
            }
          } else if (isPlayerWindow) {
            window.close();
          } else {
            setSelectedVideoId(null);
          }
        }}
        onPlayExternal={async () => { await api.playExternalVideo(selectedVideo.id); }}
        getTimelinePreviewUrl={(timeMs) =>
          `local-video://preview/${encodeURIComponent(selectedVideo.id)}/${timeMs}?v=${encodeURIComponent(selectedVideo.updatedAt)}`
        }
        getCoverUrl={getCoverUrl}
        loadDirectoryPlaylist={(page) => api.listVideoPage({
          view: "folder",
          directoryPath: selectedVideo.directory,
          folderScope: "exact",
          search: "",
          sortField: "filename",
          sortDirection: "asc",
          page,
          pageSize: 100
        })}
        onSelectPlaylistVideo={async (nextVideo, loadedVideos) => {
          setDirectoryPlaybackQueue(loadedVideos);
          if (isPlayerWindow) {
            const snapshot = await api.setPlayerSession(nextVideo.id, loadedVideos.map((item) => item.id));
            setPlayerSession(snapshot);
            setVideos(snapshot.videos);
          }
          else {
            setPlaybackQueue(loadedVideos.map((item) => item.id));
            setSelectedVideoId(nextVideo.id);
          }
        }}
      />
    );
  }

  return (
    <>
    <LibraryShell
      videos={videos}
      folders={folders}
      navigation={navigation}
      refreshSequence={libraryRefreshSequence}
      duplicateRefreshSequence={duplicateRefreshSequence}
      duplicateCleanupRefreshSequence={duplicateCleanupRefreshSequence}
      scanFailureRefreshSequence={scanFailureRefreshSequence}
      shortcuts={settings.shortcuts}
      onLoadVideoPage={api.listVideoPage}
      onSearchPlaybackDiagnosticVideos={api.searchPlaybackDiagnosticVideos}
      onLoadVideosByIds={api.listVideosByIds}
      playbackPreference={settings.playbackPreference}
      onLoadAssetCenterSummary={api.getAssetCenterSummary}
      onLoadAssetCenterSources={api.listAssetCenterSources}
      scanStatuses={scanStatuses}
      loading={loading}
      error={error}
      onAddFolder={addFolder}
      onAddCloudDriveFolder={() => setCloudDriveFolderOpen(true)}
      onRemoveFolder={removeFolder}
      onPreviewRemoveFolder={(folder) => api.previewRemoveFolder(folder.id)}
      onPauseFolderScan={(folder) => api.pauseFolderScan(folder.id)}
      onResumeFolderScan={(folder) => api.resumeFolderScan(folder.id)}
      onScanFolder={(folder) => api.scanFolder(folder.id)}
      onRetryFolderFailures={(folder) => api.retryScanFailures(folder.id)}
      onLoadScanFailureSummary={(folder) => api.getScanFailureSummary(folder.id)}
      onLoadScanFailures={(folder) => api.listScanFailures(folder.id)}
      onLoadScanFailureReviewPage={api.listScanFailureReviewPage}
      onRetryScanFailure={(failureId) => api.retryScanFailure(failureId)}
      onDeleteScanFailureFile={(failureId) => api.deleteScanFailureFile(failureId)}
      onCleanupScanFailures={(failureIds, action) => api.cleanupScanFailures(failureIds, action)}
      onSubmitScanFailureBatch={(request) => api.submitScanFailureBatch(request)}
      onGetScanFailureBatch={(jobId) => api.getScanFailureBatch(jobId)}
      onCancelScanFailureBatch={(jobId) => api.cancelScanFailureBatch(jobId)}
      onOpenScanFailureLocation={(failureId) => api.openScanFailureLocation(failureId)}
      onRefresh={refresh}
      onToggleFavorite={toggleFavorite}
      onTogglePendingDelete={togglePendingDelete}
      onRename={renameVideo}
      onDelete={deleteVideo}
      onBatchDelete={deleteVideos}
      onDeleteAllPending={async () => {
        const result = await api.deletePendingVideos();
        await reload();
        return result;
      }}
      onChooseMoveDestination={() => api.chooseMoveDestination()}
      onPreviewBatchMove={(batch, targetDirectory, addTargetToLibrary) =>
        api.previewMoveVideos(batch.map((video) => video.id), targetDirectory, addTargetToLibrary)}
      onBatchMove={async (batch, targetDirectory, addTargetToLibrary) => {
        const result = await api.moveVideos(batch.map((video) => video.id), targetDirectory, addTargetToLibrary);
        await reload();
        return result;
      }}
      onRegenerateCover={regenerateCover}
      onRetryMetadata={retryMetadata}
      onLoadDuplicateGroups={api.listDuplicateGroups}
      duplicateCleanupApi={api}
      recentVideoIds={recentVideoIds}
      onPreviewDuplicateResolve={(plan: DuplicateResolvePlan) => api.previewDuplicateResolve(plan)}
      onRevealInFolder={(video) => api.revealVideoInFolder(video.id).then(() => undefined)}
      onPlayExternal={(video) => api.playExternalVideo(video.id).then(() => undefined)}
      onOpen={async (video, queue) => {
        const queueIds = queue.map((item) => item.id);
        setDirectoryPlaybackQueue([]);
        await api.openPlayer(video.id, queueIds);
        setPlayHistory(await api.listPlayHistory());
      }}
      getCoverUrl={getCoverUrl}
      onOpenSettings={() => setSettingsOpen(true)}
    />
    {cloudDriveFolderOpen && <CloudDriveFolderDialog
      listRoots={api.listCloudDriveFolderRoots}
      browse={api.browseCloudDriveFolder}
      add={api.addCloudDriveFolder}
      onClose={() => setCloudDriveFolderOpen(false)}
      onAdded={async (folder) => {
        await reload();
        void api.scanFolder(folder.id).then(() => reload()).catch((cause) => setError(toMessage(cause)));
      }}
    />}
    </>
  );
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
