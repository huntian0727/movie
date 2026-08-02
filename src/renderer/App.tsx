import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, DomainEvent, DuplicateResolvePlan, FolderScanStatus, LibraryNavigationSnapshot, MediaCacheStatus, PlayerSessionSnapshot, PlayHistoryEntry, SourceFolder, VideoManagerApi, VideoRecord, WindowSyncSnapshot } from "../shared/videoTypes";
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

const demoFolders: SourceFolder[] = [
  {
    id: "demo-folder",
    path: "D:\\Movies\\Personal Library",
    recursive: true,
    enabled: true,
    lastScannedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scanError: null
  }
];

const demoVideos: VideoRecord[] = [
  createDemoVideo("v1", "City Walk - Shanghai.mp4", 1_744_830_464, 612_000, true, "mp4", 3840, 2160),
  createDemoVideo("v2", "Weekend in Kyoto.mkv", 4_358_144_000, 1_284_000, false, "matroska", 2560, 1440),
  createDemoVideo("v3", "Product Film Final.mov", 928_514_048, 248_000, false, "quicktime", 1920, 1080),
  createDemoVideo("v4", "Ocean Study 04.webm", 653_262_848, 431_000, true, "webm", 1920, 1080),
  createDemoVideo("v5", "Family Archive 1998.avi", 2_852_126_720, 2_743_000, false, "avi", 1280, 720),
  createDemoVideo("v6", "Motion Reference 12.mp4", 384_827_392, 192_000, false, "mp4", 1920, 1080)
];

export function App() {
  const api = getApi();
  const [videos, setVideos] = useState<VideoRecord[]>(api ? [] : demoVideos);
  const [folders, setFolders] = useState<SourceFolder[]>(api ? [] : demoFolders);
  const [loading, setLoading] = useState(Boolean(api));
  const [error, setError] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<string[]>([]);
  const [directoryPlaybackQueue, setDirectoryPlaybackQueue] = useState<VideoRecord[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [cacheLocation, setCacheLocation] = useState("C:\\Users\\Public\\AppData\\Local Video Manager\\cache");
  const [cacheStatus, setCacheStatus] = useState<MediaCacheStatus>(emptyCacheStatus);
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>([]);
  const [scanStatuses, setScanStatuses] = useState<FolderScanStatus[]>([]);
  const [navigation, setNavigation] = useState<LibraryNavigationSnapshot>(emptyNavigation);
  const [playerSession, setPlayerSession] = useState<PlayerSessionSnapshot | null>(null);
  const [libraryRefreshSequence, setLibraryRefreshSequence] = useState(0);
  const [scanFailureRefreshSequence, setScanFailureRefreshSequence] = useState(0);
  const previousScanStates = useRef(new Map<string, FolderScanStatus["state"]>());
  const isPlayerWindow = new URLSearchParams(window.location.search).get("player") === "1";
  const recentVideoIds = useMemo(() => playHistory.map((entry) => entry.videoId), [playHistory]);
  const getCoverUrl = useCallback((video: VideoRecord) => video.metadataStatus === "ready"
    ? `local-video://cover/${encodeURIComponent(video.id)}?v=${encodeURIComponent(`${video.updatedAt}-${settings.coverFrameTimeSeconds}`)}`
    : null, [settings.coverFrameTimeSeconds]);

  const reload = useCallback(async (providedSnapshot?: WindowSyncSnapshot) => {
    if (!api) return;
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
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, isPlayerWindow]);

  const handleDomainEvent = useCallback(async (event: DomainEvent) => {
    if (!api) return;
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
    setLibraryRefreshSequence(event.sequence);
    if (event.type === "library:rescanned") {
      setScanFailureRefreshSequence(event.sequence);
      await reload();
      return;
    }
    setNavigation(await api.getLibraryNavigation());
  }, [api, isPlayerWindow, reload]);

  useEffect(() => {
    if (!api) return;
    const subscription = startWindowSync(api, {
      onSnapshot: (snapshot) => reload(snapshot),
      onEvent: handleDomainEvent,
      onError: (cause) => setError(toMessage(cause))
    });
    return () => subscription.dispose();
  }, [api, handleDomainEvent, reload]);

  useEffect(() => {
    const reloadOnFocus = () => void reload();
    window.addEventListener("focus", reloadOnFocus);
    return () => window.removeEventListener("focus", reloadOnFocus);
  }, [reload]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
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
      } catch (cause) {
        if (!disposed) setError(toMessage(cause));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api, reload]);

  useEffect(() => {
    if (!api || !videos.some((video) => video.metadataStatus === "pending")) return;
    let disposed = false;
    let polling = false;
    const refreshMetadata = async () => {
      if (polling) return;
      polling = true;
      try {
        const refreshedVideos = await api.listVideosByIds(videos.map((video) => video.id));
        if (!disposed) {
          setVideos(refreshedVideos.filter((video) => !video.isMissing));
        }
      } catch (cause) {
        if (!disposed) setError(toMessage(cause));
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void refreshMetadata(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [api, videos]);

  const addFolder = async () => {
    if (!api) return;
    const folder = await api.addFolder();
    if (!folder) return;
    await reload();
    void api.scanFolder(folder.id).then(() => reload()).catch((cause) => setError(toMessage(cause)));
  };

  const removeFolder = async (folder: SourceFolder) => {
    if (!api) return;
    await api.removeFolder(folder.id);
    await reload();
  };

  const refresh = async () => {
    if (!api) return;
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
    if (api) {
      await api.setFavorite(video.id, favorite);
      setNavigation(await api.getLibraryNavigation());
    }
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, isFavorite: favorite } : item)));
    setDirectoryPlaybackQueue((current) => current.map((item) => (item.id === video.id ? { ...item, isFavorite: favorite } : item)));
  };

  const togglePendingDelete = async (video: VideoRecord) => {
    const pendingDelete = !video.isPendingDelete;
    if (api) {
      await api.setPendingDelete(video.id, pendingDelete);
      setNavigation(await api.getLibraryNavigation());
    }
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
    setDirectoryPlaybackQueue((current) => current.map((item) => (item.id === video.id ? { ...item, isPendingDelete: pendingDelete } : item)));
  };

  const renameVideo = async (video: VideoRecord, baseName: string) => {
    if (api) {
      const renamed = await api.renameVideo(video.id, baseName);
      setVideos((current) => current.map((item) => (item.id === video.id ? renamed : item)));
      return;
    }

    setVideos((current) =>
      current.map((item) =>
        item.id === video.id ? { ...item, basename: baseName, filename: `${baseName}${item.extension}` } : item
      )
    );
  };

  const deleteVideo = async (video: VideoRecord) => {
    if (selectedVideoId === video.id) setSelectedVideoId(null);
    if (api) {
      await api.deleteVideo(video.id);
      await reload();
      return;
    }
    setVideos((current) => current.filter((item) => item.id !== video.id));
  };

  const deleteVideos = async (batch: VideoRecord[]) => {
    if (api) { const result = await api.deleteVideos(batch.map((video) => video.id)); await reload(); return result; }
    setVideos((current) => current.filter((video) => !batch.some((item) => item.id === video.id)));
    return { successCount: batch.length, failureCount: 0, reclaimedBytes: batch.reduce((total, video) => total + video.sizeBytes, 0), failures: [] };
  };

  const regenerateCover = async (video: VideoRecord) => {
    if (api) {
      const refreshed = await api.regenerateCover(video.id);
      setVideos((current) => current.map((item) => (item.id === video.id ? refreshed : item)));
      return;
    }
    setVideos((current) => current.map((item) => (item.id === video.id ? { ...item, thumbnailStatus: "pending", coverCachePath: null, updatedAt: new Date().toISOString() } : item)));
  };

  const retryMetadata = async (video: VideoRecord) => {
    if (!api) return;
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
  const playbackRoute = selectedVideo ? choosePlaybackRoute(selectedVideo.extension, settings.playbackPreference) : "native";

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
        onChange={async (next) => setSettings(api ? await api.setSettings(next) : next)}
        onClearCache={async () => {
          if (!api) return null;
          const result = await api.clearCache();
          setCacheStatus(result.status);
          return result;
        }}
        onPreviewDiagnostics={async (includeFullPaths) => {
          if (!api) throw new Error("桌面诊断仅在应用中可用");
          return api.previewDiagnostics(includeFullPaths);
        }}
        onExportDiagnostics={async (includeFullPaths) => {
          if (!api) return { exported: false };
          return api.exportDiagnostics(includeFullPaths);
        }}
      />
    );
  }

  if (selectedVideo) {
    return (
      <PlayerPage
        video={selectedVideo}
        mediaUrl={api && playbackRoute === "native" ? `local-video://media/${encodeURIComponent(selectedVideo.id)}` : undefined}
        autoPlayOnOpen={settings.autoPlayOnOpen}
        seekStepSeconds={settings.seekStepSeconds}
        shortcuts={settings.shortcuts}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex < playerQueuedVideos.length - 1}
        playbackRoute={playbackRoute}
        onBack={isPlayerWindow ? undefined : () => setSelectedVideoId(null)}
        onPrevious={async () => {
          const nextId = playerQueuedVideos[selectedIndex - 1]?.id ?? selectedVideo.id;
          if (isPlayerWindow && api) {
            const snapshot = await api.selectPlayerVideo(nextId);
            setPlayerSession(snapshot);
            setVideos(snapshot.videos);
          }
          else setSelectedVideoId(nextId);
        }}
        onNext={async () => {
          const nextId = playerQueuedVideos[selectedIndex + 1]?.id ?? selectedVideo.id;
          if (isPlayerWindow && api) {
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
          if (api) await api.deleteVideo(video.id);
          else setVideos((current) => current.filter((item) => item.id !== video.id));
          setDirectoryPlaybackQueue((current) => current.filter((item) => item.id !== video.id));
          if (nextVideo) {
            if (isPlayerWindow && api) {
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
        onPlayExternal={async () => {
          if (api) await api.playExternalVideo(selectedVideo.id);
        }}
        getTimelinePreviewUrl={
          api
            ? (timeMs) =>
                `local-video://preview/${encodeURIComponent(selectedVideo.id)}/${timeMs}?v=${encodeURIComponent(selectedVideo.updatedAt)}`
            : undefined
        }
        getCoverUrl={api ? getCoverUrl : undefined}
        loadDirectoryPlaylist={async (page) => {
          if (api) {
            return api.listVideoPage({
              view: "folder",
              directoryPath: selectedVideo.directory,
              folderScope: "exact",
              search: "",
              sortField: "filename",
              sortDirection: "asc",
              page,
              pageSize: 100
            });
          }
          const matching = demoVideos.filter((item) => item.directory === selectedVideo.directory);
          return { videos: matching, page: 1, pageSize: 100, totalPages: 1, totalCount: matching.length };
        }}
        onSelectPlaylistVideo={async (nextVideo, loadedVideos) => {
          setDirectoryPlaybackQueue(loadedVideos);
          if (isPlayerWindow && api) {
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
      navigation={api ? navigation : undefined}
      refreshSequence={libraryRefreshSequence}
      scanFailureRefreshSequence={scanFailureRefreshSequence}
      shortcuts={settings.shortcuts}
      onLoadVideoPage={api?.listVideoPage}
      scanStatuses={scanStatuses}
      loading={loading}
      error={error}
      onAddFolder={addFolder}
      onRemoveFolder={removeFolder}
      onPreviewRemoveFolder={(folder) => api ? api.previewRemoveFolder(folder.id) : Promise.resolve({ removedVideoCount: 0, retainedVideoCount: 0 })}
      onPauseFolderScan={(folder) => api?.pauseFolderScan(folder.id)}
      onResumeFolderScan={(folder) => api?.resumeFolderScan(folder.id)}
      onScanFolder={(folder) => api?.scanFolder(folder.id)}
      onRetryFolderFailures={(folder) => api?.retryScanFailures(folder.id)}
      onLoadScanFailureSummary={(folder) => api
        ? api.getScanFailureSummary(folder.id)
        : Promise.resolve({ sourceFolderId: folder.id, failedFileCount: 0, failedDirectoryCount: 0, totalUnresolved: 0, latestError: null, latestFailedAt: null, totalRetryCount: 0 })}
      onLoadScanFailures={(folder) => api ? api.listScanFailures(folder.id) : Promise.resolve([])}
      onLoadScanFailureReviewPage={api?.listScanFailureReviewPage}
      onRetryScanFailure={(failureId) => api ? api.retryScanFailure(failureId) : Promise.resolve(false)}
      onDeleteScanFailureFile={(failureId) => api ? api.deleteScanFailureFile(failureId) : Promise.resolve(false)}
      onOpenScanFailureLocation={(failureId) => api ? api.openScanFailureLocation(failureId) : Promise.resolve(false)}
      onRefresh={refresh}
      onToggleFavorite={toggleFavorite}
      onTogglePendingDelete={togglePendingDelete}
      onRename={renameVideo}
      onDelete={deleteVideo}
      onBatchDelete={deleteVideos}
      onDeleteAllPending={async () => {
        if (api) {
          const result = await api.deletePendingVideos();
          await reload();
          return result;
        }
        const pending = videos.filter((video) => video.isPendingDelete);
        setVideos((current) => current.filter((video) => !video.isPendingDelete));
        return { successCount: pending.length, failureCount: 0, reclaimedBytes: pending.reduce((total, video) => total + video.sizeBytes, 0), failures: [] };
      }}
      onChooseMoveDestination={() => api ? api.chooseMoveDestination() : Promise.resolve(null)}
      onPreviewBatchMove={(batch, targetDirectory, addTargetToLibrary) => api
        ? api.previewMoveVideos(batch.map((video) => video.id), targetDirectory, addTargetToLibrary)
        : Promise.resolve({ targetDirectory, totalCount: batch.length, directCount: batch.length, renameCount: 0, skipCount: 0, targetWillBeAdded: false, failures: [] })}
      onBatchMove={async (batch, targetDirectory, addTargetToLibrary) => {
        if (!api) return { targetDirectory, totalCount: batch.length, directCount: 0, renameCount: 0, skipCount: 0, targetWillBeAdded: false, successCount: 0, failureCount: batch.length, itemResults: [], failures: batch.map((video) => ({ videoId: video.id, path: video.path, message: "演示模式不支持移动", code: "DEMO_UNSUPPORTED" })) };
        const result = await api.moveVideos(batch.map((video) => video.id), targetDirectory, addTargetToLibrary);
        await reload();
        return result;
      }}
      onRegenerateCover={regenerateCover}
      onRetryMetadata={retryMetadata}
      onLoadDuplicateGroups={api?.listDuplicateGroups}
      recentVideoIds={recentVideoIds}
      onPreviewDuplicateResolve={async (plan: DuplicateResolvePlan) => (api ? api.previewDuplicateResolve(plan) : {
        verificationStatus: "file_versions_current",
        groupCount: plan.groups.length,
        keepCount: plan.groups.length,
        deleteCount: plan.groups.reduce((total, group) => total + group.deleteVideoIds.length, 0),
        reclaimableBytes: 0
      })}
      onResolveDuplicateGroups={async (plan: DuplicateResolvePlan) => {
        if (!api) {
          return {
            groupCount: plan.groups.length,
            keepCount: plan.groups.length,
            successCount: 0,
            failureCount: 0,
            reclaimedBytes: 0,
            failures: []
          };
        }

        const result = await api.resolveDuplicateGroups(plan);
        await reload();
        return result;
      }}
      onRevealInFolder={async (video) => {
        if (api) {
          await api.revealVideoInFolder(video.id);
        }
      }}
      onOpen={async (video, queue) => {
        const queueIds = queue.map((item) => item.id);
        setDirectoryPlaybackQueue([]);
        if (api) {
          await api.openPlayer(video.id, queueIds);
          setPlayHistory(await api.listPlayHistory());
          return;
        }
        setPlaybackQueue(queueIds);
        setSelectedVideoId(video.id);
      }}
      getCoverUrl={api ? getCoverUrl : undefined}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );
}

function getApi(): VideoManagerApi | null {
  return typeof window.videoManager === "object" ? window.videoManager : null;
}

function createDemoVideo(
  id: string,
  filename: string,
  sizeBytes: number,
  durationMs: number,
  isFavorite: boolean,
  format: string,
  width: number,
  height: number
): VideoRecord {
  const extension = `.${filename.split(".").pop()?.toLowerCase() ?? "mp4"}`;
  return {
    id,
    sourceFolderId: "demo-folder",
    path: `D:\\Movies\\Personal Library\\${filename}`,
    directory: "D:\\Movies\\Personal Library",
    filename,
    basename: filename.slice(0, -extension.length),
    extension,
    sizeBytes,
    durationMs,
    width,
    height,
    format,
    modifiedAt: new Date(Date.now() - Number(id.slice(1)) * 86_400_000).toISOString(),
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isFavorite,
    isPendingDelete: false,
    isMissing: false,
    metadataStatus: "ready",
    thumbnailStatus: "pending",
    timelinePreviewStatus: "pending",
    coverCachePath: null,
    contentFingerprint: null,
    fingerprintStatus: "pending",
    fingerprintUpdatedAt: null,
    fingerprintError: null
  };
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
