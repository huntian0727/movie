import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, DomainEvent, DuplicateResolvePlan, FolderScanStatus, LibraryNavigationSnapshot, MediaCacheStatus, PlayerSessionSnapshot, PlayHistoryEntry, SourceFolder, VideoRecord, WindowSyncSnapshot } from "../shared/videoTypes";
import { getVideoManagerApi, type DesktopVideoManagerApi } from "./api/client";
import { LibraryShell } from "./components/LibraryShell";
import { PlayerPage } from "./components/PlayerPage";
import { SettingsPage } from "./components/SettingsPage";
import { choosePlaybackRoute } from "../shared/playbackRouting";
import { DEFAULT_SHORTCUTS } from "../shared/shortcuts";
import { areVisibleScanStatusesEqual } from "./scanStatus";
import { startWindowSync } from "./windowSync";

const defaultSettings: AppSettings = {
  defaultRecursiveScan: true,
  startupSync: true,
  autoPlayOnOpen: true,
  seekStepSeconds: 10,
  coverFrameTimeSeconds: 5,
  playbackPreference: "auto",
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
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [cacheLocation, setCacheLocation] = useState("");
  const [cacheStatus, setCacheStatus] = useState<MediaCacheStatus>(emptyCacheStatus);
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>([]);
  const [scanStatuses, setScanStatuses] = useState<FolderScanStatus[]>([]);
  const [navigation, setNavigation] = useState<LibraryNavigationSnapshot>(emptyNavigation);
  const [playerSession, setPlayerSession] = useState<PlayerSessionSnapshot | null>(null);
  const [libraryRefreshSequence, setLibraryRefreshSequence] = useState(0);
  const [scanFailureRefreshSequence, setScanFailureRefreshSequence] = useState(0);
  const previousScanStates = useRef(new Map<string, FolderScanStatus["state"]>());
  const isPlayerWindow = api.windowMode === "player";
  const recentVideoIds = useMemo(() => playHistory.map((entry) => entry.videoId), [playHistory]);
  const getCoverUrl = useCallback((video: VideoRecord) => video.metadataStatus === "ready"
    ? `local-video://cover/${encodeURIComponent(video.id)}?v=${encodeURIComponent(`${video.updatedAt}-${settings.coverFrameTimeSeconds}`)}`
    : null, [settings.coverFrameTimeSeconds]);

  const reload = useCallback(async (providedSnapshot?: WindowSyncSnapshot) => {
    setLoading(true);
    setError(null);

    try {
      const syncSnapshot = providedSnapshot ?? await api.getWindowSyncSnapshot();
      const nextPlayerSession = isPlayerWindow ? syncSnapshot.playerSession : null;
      const [nextFolders, settingsSnapshot, nextPlayHistory, nextNavigation] = await Promise.all([
        api.listFolders(),
        api.getSettings(),
        api.listPlayHistory(),
        api.getLibraryNavigation()
      ]);
      setVideos(nextPlayerSession?.videos ?? []);
      setPlayerSession(nextPlayerSession);
      setFolders(nextFolders);
      setNavigation(nextNavigation);
      setSettings(settingsSnapshot.settings);
      setCacheLocation(settingsSnapshot.cacheLocation);
      setCacheStatus(settingsSnapshot.cacheStatus);
      setPlayHistory(nextPlayHistory);
      setLibraryRefreshSequence((seq) => seq + 1);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, isPlayerWindow]);

  const handleDomainEvent = useCallback(async (event: DomainEvent) => {
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
    if (event.type === "source-folder:updated") {
      setFolders(await api.listFolders());
      return;
    }
    if (isPlayerWindow) {
      await reload();
      return;
    }
    // Main window: do not auto-reload video pages on background domain events.
    // Navigation counts are refreshed after user-initiated actions (toggle
    // favorite, toggle pending delete, manual refresh) instead.
    if (event.type === "library:rescanned") {
      setScanFailureRefreshSequence(event.sequence);
    }
  }, [api, isPlayerWindow, reload]);

  useEffect(() => {
    const subscription = startWindowSync(api, {
      onSnapshot: (snapshot) => reload(snapshot),
      onEvent: handleDomainEvent,
      onError: (cause) => setError(toMessage(cause))
    });
    return () => subscription.dispose();
  }, [api, handleDomainEvent, reload]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const statuses = await api.listFolderScanStatuses();
        if (disposed) return;
        previousScanStates.current = new Map(statuses.map((status) => [status.folderId, status.state]));
        setScanStatuses((current) => areVisibleScanStatusesEqual(current, statuses) ? current : statuses);
      } catch (cause) {
        if (!disposed) setError(toMessage(cause));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api, reload]);

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
    setLibraryRefreshSequence((seq) => seq + 1);
  };

  const togglePendingDelete = async (video: VideoRecord) => {
    const pendingDelete = !video.isPendingDelete;
    await api.setPendingDelete(video.id, pendingDelete);
    setNavigation(await api.getLibraryNavigation());
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
    setDirectoryPlaybackQueue((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
    setLibraryRefreshSequence((seq) => seq + 1);
  };

  const renameVideo = async (video: VideoRecord, baseName: string) => {
    const renamed = await api.renameVideo(video.id, baseName);
    setVideos((current) => current.map((item) => (item.id === video.id ? renamed : item)));
    setLibraryRefreshSequence((seq) => seq + 1);
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
    <LibraryShell
      videos={videos}
      folders={folders}
      navigation={navigation}
      refreshSequence={libraryRefreshSequence}
      scanFailureRefreshSequence={scanFailureRefreshSequence}
      shortcuts={settings.shortcuts}
      onLoadVideoPage={api.listVideoPage}
      scanStatuses={scanStatuses}
      loading={loading}
      error={error}
      onAddFolder={addFolder}
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
      onBatchRetryScanFailures={(failureIds) => api.batchRetryScanFailures(failureIds)}
      onBatchDeleteScanFailures={(failureIds) => api.batchDeleteScanFailures(failureIds)}
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
      onOpen={async (video, queue) => {
        const queueIds = queue.map((item) => item.id);
        setDirectoryPlaybackQueue([]);
        await api.openPlayer(video.id, queueIds);
        setPlayHistory(await api.listPlayHistory());
      }}
      getCoverUrl={getCoverUrl}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
