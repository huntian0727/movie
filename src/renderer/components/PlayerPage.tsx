import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { ArrowLeft, BookmarkX, ChevronLeft, ChevronRight, Expand, ExternalLink, Heart, Info, ListVideo, Pause, Play, RotateCcw, RotateCw, Trash2, Volume2, VolumeX, X } from "lucide-react";
import type { LibraryPage, PlaybackRoute, ShortcutSettings, VideoManagerApi, VideoRecord } from "../../shared/videoTypes";
import { useEmbeddedEngine } from "./useEmbeddedEngine";
import { usePlayerWindowFullscreen } from "./usePlayerWindowFullscreen";
import { DEFAULT_SHORTCUTS, formatShortcutBinding, matchesShortcut } from "../../shared/shortcuts";
import { formatBytes, formatDuration } from "./formatters";
import { PreviewImage } from "./PreviewImage";
import { VideoDetailsDialog } from "./VideoDetailsDialog";

const FULLSCREEN_CONTROLS_HIDE_DELAY_MS = 2200;
const VOLUME_KEYBOARD_STEP = 0.05;

interface PlayerPageProps {
  video: VideoRecord;
  mediaUrl?: string;
  autoPlayOnOpen?: boolean;
  seekStepSeconds?: number;
  shortcuts?: ShortcutSettings;
  hasPrevious?: boolean;
  hasNext?: boolean;
  playbackRoute?: PlaybackRoute;
  embeddedApi?: Pick<VideoManagerApi, "embeddedPlayback" | "subscribeEmbeddedInput" | "showPlayerTimelinePreview">;
  startPositionMs?: number;
  startRequestId?: string;
  onBack?(): void;
  onPrevious?(): void;
  onNext?(): void;
  onToggleFavorite?(video: VideoRecord): void;
  onTogglePendingDelete?(video: VideoRecord): void | Promise<void>;
  onDelete?(video: VideoRecord): void | Promise<void>;
  onPlayExternal?(positionMs?: number): Promise<void> | void;
  getTimelinePreviewUrl?(timeMs: number): string;
  getCoverUrl?(video: VideoRecord): string | null;
  loadDirectoryPlaylist?(page: number): Promise<LibraryPage>;
  onSelectPlaylistVideo?(video: VideoRecord, loadedVideos: VideoRecord[]): void;
}

export function PlayerPage({
  video,
  mediaUrl,
  autoPlayOnOpen = false,
  seekStepSeconds = 10,
  shortcuts = DEFAULT_SHORTCUTS,
  hasPrevious = true,
  hasNext = true,
  playbackRoute = "native",
  embeddedApi,
  startPositionMs = 0,
  startRequestId,
  onBack,
  onPrevious,
  onNext,
  onToggleFavorite,
  onTogglePendingDelete,
  onDelete,
  onPlayExternal,
  getTimelinePreviewUrl,
  getCoverUrl,
  loadDirectoryPlaylist,
  onSelectPlaylistVideo
}: PlayerPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stageClickBeforeRef = useRef<{ session: string; paused: boolean } | null>(null);
  const controlsHideTimeoutRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState((video.durationMs ?? 0) / 1000);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [externalLaunching, setExternalLaunching] = useState(false);
  const [failedPreviewUrls, setFailedPreviewUrls] = useState<Set<string>>(() => new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const windowFullscreen = usePlayerWindowFullscreen(embeddedApi, setIsFullscreen);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [rotationDegrees, setRotationDegrees] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [decodedVideoSize, setDecodedVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistVideos, setPlaylistVideos] = useState<VideoRecord[]>([]);
  const [playlistPage, setPlaylistPage] = useState(0);
  const [playlistTotalCount, setPlaylistTotalCount] = useState(0);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistDirectory, setPlaylistDirectory] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletePendingRef = useRef(false);
  const playlistLoadingRef = useRef(false);
  const currentDirectoryRef = useRef(video.directory);
  currentDirectoryRef.current = video.directory;
  const isExternalPlayback = playbackRoute === "mpv";
  const externalAutoplayKeyRef = useRef<string | null>(null);
  const pendingStartRef = useRef<number | null>(null);
  const [nativeFailedId, setNativeFailedId] = useState<string | null>(null);
  const isEmbeddedPlayback = Boolean(embeddedApi) && playbackRoute !== "mpv" && (playbackRoute === "embedded" || nativeFailedId === video.id);
  const embeddedStageRef = useRef<HTMLDivElement>(null);
  const fallbackPositionRef = useRef(0);
  const endedSessionRef = useRef<string | null>(null);
  const embedded = useEmbeddedEngine({
    api: embeddedApi, enabled: isEmbeddedPlayback, videoId: video.id, autoplay: autoPlayOnOpen,
    positionMs: nativeFailedId === video.id ? fallbackPositionRef.current : startPositionMs,
    requestId: startRequestId, stage: embeddedStageRef,
    visible: !detailsOpen && !deleteConfirmOpen && !externalLaunching,
    layoutKey: `${playlistOpen}:${isFullscreen}`,
    onInput: input => {
      if (detailsOpen || deleteConfirmOpen) return;
      if (input.kind === "click") {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        handleStageClick();
      }
      else if (input.kind === "double-click") handleStageDoubleClick();
      else if (input.kind === "key") {
        const focused = document.activeElement;
        const event = new KeyboardEvent("keydown", { code: input.code, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt });
        if (focused instanceof HTMLElement && (blocksPlayerShortcut(focused, event, shortcuts) || focused.closest("[role='dialog']"))) return;
        if (input.code === "KeyF" && !input.control && !input.alt) void toggleFullscreen();
        else if (input.code === "Escape" && isFullscreen && !playlistOpen) void toggleFullscreen();
        else window.dispatchEvent(event);
      }
    }
  });
  useEffect(() => {
    if (!isEmbeddedPlayback || !embedded.state) return;
    const s = embedded.state;
    setPlaying(!s.paused && !["idle", "loading", "failed", "ended"].includes(s.phase)); setCurrentTime(s.time);
    if (!["idle", "loading"].includes(s.phase)) {
      setMuted(s.volume === 0);
      if (s.volume > 0) setVolume(s.volume / 100);
    }
    if (s.duration > 0) setDuration(s.duration);
    if (s.phase === "ended" && endedSessionRef.current !== s.sessionKey) {
      endedSessionRef.current = s.sessionKey; onNext?.();
    }
  }, [embedded.state, isEmbeddedPlayback]);
  const embeddedError = embedded.error ?? embedded.state?.error;

  const applyStartingPosition = () => {
    const element = videoRef.current;
    if (!element || pendingStartRef.current === null || element.readyState < 1) return;
    const seconds = pendingStartRef.current / 1000;
    element.currentTime = Number.isFinite(element.duration) ? Math.min(seconds, Math.max(0, element.duration - 0.001)) : seconds;
    pendingStartRef.current = null;
    setCurrentTime(element.currentTime);
  };

  useEffect(() => {
    pendingStartRef.current = startPositionMs;
    if (!isExternalPlayback && !isEmbeddedPlayback) applyStartingPosition();
  }, [video.id, mediaUrl, isExternalPlayback, isEmbeddedPlayback, startPositionMs, startRequestId]);

  const clearControlsHideTimeout = () => {
    if (controlsHideTimeoutRef.current !== null) {
      window.clearTimeout(controlsHideTimeoutRef.current);
      controlsHideTimeoutRef.current = null;
    }
  };

  const scheduleControlsHide = () => {
    clearControlsHideTimeout();
    if (!isFullscreen || isEmbeddedPlayback || detailsOpen || playlistOpen || deleteConfirmOpen) {
      setControlsVisible(true);
      return;
    }

    controlsHideTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsHideTimeoutRef.current = null;
    }, FULLSCREEN_CONTROLS_HIDE_DELAY_MS);
  };

  const showControls = () => {
    setControlsVisible(true);
    scheduleControlsHide();
  };

  useEffect(() => {
    if (!autoPlayOnOpen || !isExternalPlayback || !onPlayExternal) {
      externalAutoplayKeyRef.current = null;
      return;
    }

    const autoplayKey = `${video.id}:${playbackRoute}:${startRequestId ?? ""}`;
    if (externalAutoplayKeyRef.current === autoplayKey) {
      return;
    }

    externalAutoplayKeyRef.current = autoplayKey;
    void launchExternalPlayback();
  }, [autoPlayOnOpen, isExternalPlayback, onPlayExternal, playbackRoute, video.id, startRequestId]);

  useEffect(() => {
    if (windowFullscreen.managed) return;
    const syncFullscreenState = () => {
      const fullscreenNow = document.fullscreenElement === pageRef.current;
      setIsFullscreen(fullscreenNow);
      setControlsVisible(true);
      if (fullscreenNow) scheduleControlsHide();
      else clearControlsHideTimeout();
    };

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [deleteConfirmOpen, detailsOpen, isFullscreen, playlistOpen, windowFullscreen.managed]);

  useEffect(() => {
    if (!isFullscreen) {
      clearControlsHideTimeout();
      setControlsVisible(true);
      return;
    }

    if (detailsOpen || playlistOpen || deleteConfirmOpen) {
      clearControlsHideTimeout();
      setControlsVisible(true);
      return;
    }

    scheduleControlsHide();

    return () => clearControlsHideTimeout();
  }, [deleteConfirmOpen, detailsOpen, isFullscreen, playlistOpen]);

  useEffect(() => () => {
    clearControlsHideTimeout();
  }, []);

  useEffect(() => {
    setRotationDegrees(0);
    stageClickBeforeRef.current = null;
    setPlaybackError(null);
    endedSessionRef.current = null;
    setDecodedVideoSize(null);
    setCurrentTime(startPositionMs / 1000);
    setDuration((video.durationMs ?? 0) / 1000);
  }, [video.id]);

  const embeddedRotationReady = isEmbeddedPlayback && !!embedded.state && !["loading", "idle", "failed", "ended"].includes(embedded.state.phase);
  useEffect(() => {
    if (embeddedRotationReady) {
      void embedded.send({ op: "rotate", value: rotationDegrees });
    }
  }, [embeddedRotationReady, embedded.state?.sessionKey, rotationDegrees]);

  useEffect(() => {
    if (playlistDirectory === null || sameDirectory(playlistDirectory, video.directory)) return;
    setPlaylistOpen(false);
    setPlaylistVideos([]);
    setPlaylistPage(0);
    setPlaylistTotalCount(0);
    setPlaylistError(null);
    setPlaylistDirectory(null);
  }, [playlistDirectory, video.directory]);

  useEffect(() => {
    const stage = surfaceRef.current;
    if (!stage) return;
    const updateSize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (deleteConfirmOpen) {
        if (event.code === "Escape") {
          event.preventDefault();
          if (!deletePending) setDeleteConfirmOpen(false);
        } else if (event.code === "Enter") {
          event.preventDefault();
          if (!deletePending) void confirmDelete();
        }
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest("[role='dialog']")) return;
      if (event.target instanceof HTMLElement && blocksPlayerShortcut(event.target, event, shortcuts)) return;
      // Embedded keys are forwarded once by the main process, even when the
      // Chromium HWND has focus but its DOM does not. Leave text entry intact.
      if (isEmbeddedPlayback && event.isTrusted) {
        if (Object.values(shortcuts).some(binding => matchesShortcut(event, binding)) || event.code === "Escape" && playlistOpen) event.preventDefault();
        return;
      }
      if (matchesShortcut(event, shortcuts.playerDelete)) {
        event.preventDefault();
        if (!detailsOpen && !playlistOpen && onDelete && !event.repeat) openDeleteConfirmation();
        return;
      }
      if (event.code === "Escape" && playlistOpen) {
        event.preventDefault();
        setPlaylistOpen(false);
        return;
      }
      if ((event.code === "Escape" && isFullscreen) || (event.code === "KeyF" && !event.ctrlKey && !event.altKey && !event.repeat)) {
        event.preventDefault(); void toggleFullscreen(); return;
      }
      if (matchesShortcut(event, shortcuts.playerTogglePlayback)) {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerRotateLeft)) {
        event.preventDefault();
        setRotationDegrees((current) => (current + 270) % 360);
        return;
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerRotateRight)) {
        event.preventDefault();
        setRotationDegrees((current) => (current + 90) % 360);
        return;
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerVolumeUp)) {
        event.preventDefault();
        updateVolume(Math.max(0, Math.min(1, volume + VOLUME_KEYBOARD_STEP)));
        return;
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerVolumeDown)) {
        event.preventDefault();
        updateVolume(Math.max(0, Math.min(1, volume - VOLUME_KEYBOARD_STEP)));
        return;
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerSeekBackward)) {
        event.preventDefault();
        seekBy(-seekStepSeconds);
      }
      if (!isExternalPlayback && matchesShortcut(event, shortcuts.playerSeekForward)) {
        event.preventDefault();
        seekBy(seekStepSeconds);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmOpen, deletePending, detailsOpen, isExternalPlayback, isEmbeddedPlayback, isFullscreen, playing, currentTime, onDelete, playlistOpen, seekStepSeconds, shortcuts, volume]);

  const launchExternalPlayback = async () => {
    if (!onPlayExternal || externalLaunching) return;
    setExternalLaunching(true);
    try {
      if (isEmbeddedPlayback) await embedded.stop();
      await onPlayExternal(Math.round(currentTime * 1000));
      setPlaybackError(null);
    } catch (cause) {
      setPlaybackError(cause instanceof Error ? cause.message : "无法启动 mpv");
      if (isEmbeddedPlayback) embedded.reload(currentTime);
    } finally {
      setExternalLaunching(false);
    }
  };

  const togglePlayback = async () => {
    if (isExternalPlayback) {
      await launchExternalPlayback();
      return;
    }
    if (isEmbeddedPlayback) {
      if (embeddedError || ["idle", "failed", "ended"].includes(embedded.state?.phase ?? "loading")) embedded.reload(embedded.state?.phase === "ended" ? 0 : currentTime);
      else await embedded.send({ op: "pause", value: !embedded.getPaused() });
      return;
    }

    const element = videoRef.current;
    if (!element || !mediaUrl) return;
    try {
      if (element.paused) await element.play();
      else element.pause();
      setPlaybackError(null);
    } catch (cause) {
      setPlaybackError(cause instanceof Error ? cause.message : "无法播放此视频");
    }
  };

  const handleNativePlaybackError = () => {
    if (embeddedApi) {
      fallbackPositionRef.current = Math.max(0, (videoRef.current?.currentTime || currentTime) * 1000);
      setPlaybackError(null); setNativeFailedId(video.id);
      return;
    }
    setPlaybackError("内置播放器无法播放，正在尝试 mpv");
    if (onPlayExternal) {
      void launchExternalPlayback();
    }
  };

  const seekBy = (seconds: number) => {
    if (isEmbeddedPlayback) { seekTo(Math.max(0, Math.min(duration, currentTime + seconds))); return; }
    const element = videoRef.current;
    if (!element || isExternalPlayback) return;
    element.currentTime = Math.max(0, Math.min(element.duration || duration, element.currentTime + seconds));
    setCurrentTime(element.currentTime);
  };

  const seekTo = (seconds: number) => {
    if (isEmbeddedPlayback) { void embedded.send({ op: "seek", value: seconds }); return; }
    if (videoRef.current && !isExternalPlayback) videoRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const updateVolume = (value: number) => {
    if (isEmbeddedPlayback) void embedded.send({ op: "volume", value: value * 100 });
    if (videoRef.current && !isExternalPlayback) {
      videoRef.current.volume = value;
      videoRef.current.muted = false;
    }
    setVolume(value);
    setMuted(false);
  };

  const toggleMute = () => {
    if (isEmbeddedPlayback) void embedded.send({ op: "volume", value: muted ? volume * 100 : 0 });
    if (videoRef.current && !isExternalPlayback) videoRef.current.muted = !muted;
    setMuted((value) => !value);
  };

  const toggleFullscreen = async () => {
    if (windowFullscreen.managed) {
      await windowFullscreen.toggle(); setControlsVisible(true);
      return;
    }
    if (!document.fullscreenElement) await pageRef.current?.requestFullscreen();
    else await document.exitFullscreen();
  };

  const handleStageClick = (event?: MouseEvent) => {
    if (event && event.detail > 1) return;
    stageClickBeforeRef.current = { session: embedded.state?.sessionKey ?? video.id, paused: isEmbeddedPlayback ? embedded.getPaused() : videoRef.current?.paused ?? true };
    void togglePlayback();
  };

  const handleStageDoubleClick = () => {
    const before = stageClickBeforeRef.current;
    stageClickBeforeRef.current = null;
    // Single-click is immediate. A second click restores its pre-click intent,
    // so double-click still changes fullscreen without leaving playback toggled.
    if (before?.session === (embedded.state?.sessionKey ?? video.id)) {
      if (isEmbeddedPlayback) void embedded.send({ op: "pause", value: before.paused });
      else if (videoRef.current && mediaUrl) {
        if (before.paused) videoRef.current.pause();
        else void videoRef.current.play().catch(() => setPlaybackError("无法恢复播放此视频"));
      }
    }
    void toggleFullscreen();
  };

  const openDeleteConfirmation = () => {
    if (!onDelete || deletePendingRef.current) return;
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
    if (isEmbeddedPlayback) void embedded.send({ op: "pause", value: true });
    setDeleteError(null);
    setDeleteConfirmOpen(true);
    setControlsVisible(true);
  };

  const confirmDelete = async () => {
    if (!onDelete || deletePendingRef.current) return;
    deletePendingRef.current = true;
    setDeletePending(true);
    setDeleteError(null);
    try {
      // Release the decoder's file handle before the existing delete API acts.
      if (isEmbeddedPlayback) await embedded.stop();
      await onDelete(video);
      setDeleteConfirmOpen(false);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "无法永久删除视频");
      if (isEmbeddedPlayback) embedded.reload(currentTime);
    } finally {
      deletePendingRef.current = false;
      setDeletePending(false);
    }
  };

  const loadPlaylistPage = async (page: number, replace = false) => {
    if (!loadDirectoryPlaylist || playlistLoadingRef.current) return;
    const requestedDirectory = video.directory;
    playlistLoadingRef.current = true;
    setPlaylistLoading(true);
    setPlaylistError(null);
    try {
      const result = await loadDirectoryPlaylist(page);
      if (!sameDirectory(currentDirectoryRef.current, requestedDirectory)) return;
      setPlaylistVideos((current) => replace ? result.videos : mergeUniqueVideos(current, result.videos));
      setPlaylistPage(result.page);
      setPlaylistTotalCount(result.totalCount);
      setPlaylistDirectory(requestedDirectory);
    } catch (cause) {
      setPlaylistError(cause instanceof Error ? cause.message : "无法加载播放列表");
    } finally {
      playlistLoadingRef.current = false;
      setPlaylistLoading(false);
    }
  };

  const togglePlaylist = () => {
    if (playlistOpen) {
      setPlaylistOpen(false);
      return;
    }
    setPlaylistOpen(true);
    setControlsVisible(true);
    if (!sameDirectory(playlistDirectory, video.directory) || playlistVideos.length === 0) {
      setPlaylistVideos([]);
      setPlaylistPage(0);
      setPlaylistTotalCount(0);
      setPlaylistDirectory(video.directory);
      void loadPlaylistPage(1, true);
    }
  };

  const playlistHasPendingMetadata = playlistVideos.some((item) => item.metadataStatus === "pending");

  useEffect(() => {
    if (!playlistOpen || !loadDirectoryPlaylist || !playlistHasPendingMetadata || playlistPage < 1) return;
    let disposed = false;
    const refreshLoadedPages = async () => {
      if (playlistLoadingRef.current) return;
      const requestedDirectory = video.directory;
      playlistLoadingRef.current = true;
      try {
        const refreshed: VideoRecord[] = [];
        let latestTotalCount = playlistTotalCount;
        for (let page = 1; page <= playlistPage; page += 1) {
          const result = await loadDirectoryPlaylist(page);
          refreshed.push(...result.videos);
          latestTotalCount = result.totalCount;
        }
        if (!disposed && sameDirectory(currentDirectoryRef.current, requestedDirectory)) {
          setPlaylistVideos(mergeUniqueVideos([], refreshed));
          setPlaylistTotalCount(latestTotalCount);
        }
      } catch {
        // Keep the existing rows visible; the normal loader exposes actionable errors.
      } finally {
        playlistLoadingRef.current = false;
      }
    };
    void refreshLoadedPages();
    const timer = window.setInterval(() => void refreshLoadedPages(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadDirectoryPlaylist, playlistHasPendingMetadata, playlistOpen, playlistPage, playlistTotalCount, video.directory]);

  const progressMax = Math.max(duration, 1);
  const hoverPreviewTimeMs = hoverTime === null ? null : quantizePreviewTimeMs(hoverTime * 1000, duration * 1000);
  const hoverPreviewUrl = hoverPreviewTimeMs !== null && getTimelinePreviewUrl ? getTimelinePreviewUrl(hoverPreviewTimeMs) : null;
  const showHoverPreviewImage = hoverPreviewUrl !== null && !failedPreviewUrls.has(hoverPreviewUrl);
  const floatingPreview = isEmbeddedPlayback && Boolean(embeddedApi?.showPlayerTimelinePreview);
  useEffect(() => {
    const show = embeddedApi?.showPlayerTimelinePreview;
    if (!show || !floatingPreview) return;
    if (hoverTime === null || hoverPreviewTimeMs === null || detailsOpen || deleteConfirmOpen || externalLaunching) { void show(null).catch(() => undefined); return; }
    // Debounce pointer movement before crossing IPC; leaving hides immediately.
    const timer = window.setTimeout(() => {
      const rect = progressRef.current?.getBoundingClientRect();
      if (!rect) return;
      void show({ videoId: video.id, timeMs: hoverPreviewTimeMs,
        x: rect.left + rect.width * hoverTime / progressMax, y: rect.top - 8 }).catch(() => undefined);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [embeddedApi, floatingPreview, hoverTime, hoverPreviewTimeMs, progressMax, video.id, isFullscreen, playlistOpen, detailsOpen, deleteConfirmOpen, externalLaunching]);
  useEffect(() => () => { void embeddedApi?.showPlayerTimelinePreview?.(null).catch(() => undefined); }, [embeddedApi, video.id, floatingPreview]);
  const previewAspectRatio = getAspectRatioValue(video.width, video.height);
  const fullscreenToggleLabel = isFullscreen ? "退出全屏" : "全屏";
  const controlsStateClassName = isFullscreen && !controlsVisible ? " is-hidden" : " is-visible";
  const videoStyle = getRotatedVideoStyle(
    rotationDegrees,
    stageSize,
    decodedVideoSize?.width ?? video.width,
    decodedVideoSize?.height ?? video.height
  );
  const visiblePlaylistVideos = playlistVideos.some((item) => item.id === video.id)
    ? playlistVideos
    : [video, ...playlistVideos];

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      className={`player-page${isFullscreen ? " is-fullscreen" : ""}${isEmbeddedPlayback ? " uses-embedded-engine" : ""}${playlistOpen ? " has-playlist" : ""}`}
      onMouseMove={() => {
        if (isFullscreen) {
          showControls();
        }
      }}
    >
      <header
        className={`player-topbar${controlsStateClassName}`}
        onMouseEnter={() => {
          if (isFullscreen) {
            clearControlsHideTimeout();
            setControlsVisible(true);
          }
        }}
        onMouseLeave={() => {
          if (isFullscreen) {
            scheduleControlsHide();
          }
        }}
      >
        <button className="player-icon-button" aria-label="返回视频库" title="返回视频库" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <div className="player-title">
          <h1>{video.filename}</h1>
          <p>
            {formatBytes(video.sizeBytes)}
            <span />
            {formatDuration(video.durationMs)}
            <span />
            {video.width && video.height ? `${video.width}x${video.height}` : video.extension.toUpperCase()}
            {isEmbeddedPlayback && <><span />内嵌解码</>}
          </p>
        </div>
        <div className="player-topbar-actions">
          {isFullscreen && (
            <button
              className="player-icon-button player-exit-fullscreen"
              aria-label="退出全屏"
              title="退出全屏"
              onClick={() => void toggleFullscreen()}
            >
              退出全屏
            </button>
          )}
          <button
            className="player-icon-button"
            aria-label="查看详情"
            title="查看详情"
            onClick={() => setDetailsOpen(true)}
          >
            <Info size={18} />
          </button>
          {!isExternalPlayback && onPlayExternal && (
            <button
              className="player-icon-button"
              aria-label="使用外部播放器"
              title="内置播放卡住或不兼容？使用外部播放器"
              disabled={externalLaunching}
              onClick={() => void launchExternalPlayback()}
            >
              <ExternalLink size={18} />
            </button>
          )}
          <button
            className={video.isFavorite ? "player-icon-button is-favorite" : "player-icon-button"}
            aria-label={video.isFavorite ? "取消收藏" : "收藏"}
            title={video.isFavorite ? "取消收藏" : "收藏"}
            onClick={() => onToggleFavorite?.(video)}
          >
            <Heart size={19} fill={video.isFavorite ? "currentColor" : "none"} />
          </button>
          <button
            className={video.isPendingDelete ? "player-icon-button is-pending-delete" : "player-icon-button"}
            aria-label={video.isPendingDelete ? "取消待删除标记" : "标记待删除"}
            title={video.isPendingDelete ? "取消待删除标记" : "标记待删除"}
            onClick={() => void onTogglePendingDelete?.(video)}
          >
            <BookmarkX size={19} />
          </button>
          <button
            className="player-icon-button"
            aria-label="永久删除视频"
            title={`永久删除视频（${formatShortcutBinding(shortcuts.playerDelete)}）`}
            onClick={openDeleteConfirmation}
          >
            <Trash2 size={19} />
          </button>
        </div>
      </header>

      <div className="player-stage" ref={surfaceRef} onDoubleClick={handleStageDoubleClick}>
        {isEmbeddedPlayback && <div ref={embeddedStageRef} className="player-embedded-surface" aria-label="视频画面" />}
        {!isExternalPlayback && !isEmbeddedPlayback && (
          <video
            ref={videoRef}
            src={mediaUrl}
            autoPlay={autoPlayOnOpen}
            style={videoStyle}
            onClick={handleStageClick}
            onLoadedMetadata={(event) => {
              applyStartingPosition();
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth > 0 && videoHeight > 0) {
                setDecodedVideoSize({ width: videoWidth, height: videoHeight });
              }
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : duration)}
            onVolumeChange={(event) => {
              setVolume(event.currentTarget.volume);
              setMuted(event.currentTarget.muted);
            }}
            onEnded={() => {
              setPlaying(false);
              onNext?.();
            }}
            onError={handleNativePlaybackError}
          />
        )}
        {isExternalPlayback && (
          <button className="player-placeholder external-playback" aria-label="用 mpv 播放" onClick={() => void launchExternalPlayback()}>
            <Play size={48} fill="currentColor" />
            <strong>{video.extension.slice(1).toUpperCase()}</strong>
            <span>{externalLaunching ? "正在启动 mpv..." : "用 mpv 播放"}</span>
          </button>
        )}
        {!isExternalPlayback && !isEmbeddedPlayback && !mediaUrl && (
          <div className="player-placeholder">
            <Play size={48} fill="currentColor" />
            <strong>{video.extension.slice(1).toUpperCase()}</strong>
            <span>桌面应用中加载本地视频</span>
          </div>
        )}
        {!isExternalPlayback && !isEmbeddedPlayback && !playing && mediaUrl && (
          <button className="player-center-play" aria-label="播放" onClick={() => void togglePlayback()}>
            <Play size={34} fill="currentColor" />
          </button>
        )}
        {!isEmbeddedPlayback && (playbackError || windowFullscreen.error) && <div className="player-error" role="alert">{playbackError || windowFullscreen.error}</div>}
      </div>

      {playlistOpen && (
        <aside className="player-playlist" aria-label="播放列表">
          <header className="player-playlist-header">
            <div>
              <strong><ListVideo size={19} /> 播放列表</strong>
              <span title={video.directory}>{playlistTotalCount || visiblePlaylistVideos.length} 个视频 · 当前文件夹</span>
            </div>
            <button aria-label="关闭播放列表" title="关闭播放列表" onClick={() => setPlaylistOpen(false)}>
              <X size={20} />
            </button>
          </header>
          <div
            className="player-playlist-items"
            onScroll={(event) => {
              const element = event.currentTarget;
              const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 180;
              if (nearBottom && playlistVideos.length < playlistTotalCount && !playlistLoading) {
                void loadPlaylistPage(playlistPage + 1);
              }
            }}
          >
            {visiblePlaylistVideos.map((item) => {
              const coverUrl = getCoverUrl?.(item) ?? item.coverCachePath;
              const isCurrent = item.id === video.id;
              const decodedDurationMs = isCurrent && duration > 0 ? Math.round(duration * 1000) : null;
              return (
                <button
                  key={item.id}
                  className={isCurrent ? "player-playlist-item is-current" : "player-playlist-item"}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => {
                    if (!isCurrent) onSelectPlaylistVideo?.(item, playlistVideos);
                  }}
                >
                  <span className="player-playlist-cover">
                    {coverUrl ? <PreviewImage src={coverUrl} priority={0} /> : <Play size={22} fill="currentColor" />}
                    <em>{formatPlaylistDuration(item, decodedDurationMs)}</em>
                  </span>
                  <span className="player-playlist-meta">
                    <strong title={item.filename}>{item.filename}</strong>
                    <small>{formatBytes(item.sizeBytes)}</small>
                    {isCurrent && <b>正在播放</b>}
                  </span>
                </button>
              );
            })}
            {playlistLoading && <div className="player-playlist-status">正在加载...</div>}
            {playlistError && (
              <div className="player-playlist-status is-error">
                <span>{playlistError}</span>
                <button onClick={() => void loadPlaylistPage(Math.max(1, playlistPage + 1), playlistPage === 0)}>重试</button>
              </div>
            )}
            {!playlistLoading && !playlistError && playlistVideos.length >= playlistTotalCount && playlistTotalCount > 0 && (
              <div className="player-playlist-status">已加载全部视频</div>
            )}
          </div>
        </aside>
      )}

      <footer
        className={`player-controls${controlsStateClassName}`}
        onMouseEnter={() => {
          if (isFullscreen) {
            clearControlsHideTimeout();
            setControlsVisible(true);
          }
        }}
        onMouseLeave={() => {
          if (isFullscreen) {
            scheduleControlsHide();
          }
        }}
      >
        {isEmbeddedPlayback && <div className="player-engine-status" role="status">
          {windowFullscreen.error ?? embeddedError ?? playbackError ?? ({ idle: "准备播放", loading: "正在读取视频", playing: "", paused: "已暂停", reading: "正在读取目标位置", buffering: "正在缓冲", failed: "播放失败", ended: "播放结束" }[embedded.state?.phase ?? "idle"])}
          <button onClick={() => embedded.reload(currentTime)}>重新加载</button>
        </div>}
        <div
          ref={progressRef}
          className="progress-wrap"
          onMouseMove={(event) => {
            if (isFullscreen) {
              setControlsVisible(true);
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setHoverTime(Math.max(0, Math.min(progressMax, ((event.clientX - rect.left) / rect.width) * progressMax)));
          }}
          onMouseLeave={() => {
            setHoverTime(null);
            if (isFullscreen) {
              scheduleControlsHide();
            }
          }}
        >
          {hoverTime !== null && !floatingPreview && (
            <div className="progress-preview" style={{ left: `${(hoverTime / progressMax) * 100}%` }}>
              {showHoverPreviewImage && (
                <PreviewImage
                  src={hoverPreviewUrl}
                  eager priority={2} delayMs={180}
                  style={{ "--preview-aspect-ratio": previewAspectRatio } as React.CSSProperties}
                  onError={() => {
                    setFailedPreviewUrls((current) => new Set(current).add(hoverPreviewUrl));
                  }}
                />
              )}
              <span>{formatClock(hoverTime)}</span>
            </div>
          )}
          <input
            aria-label="播放进度"
            type="range"
            min="0"
            max={progressMax}
            step="0.1"
            value={Math.min(currentTime, progressMax)}
            disabled={isExternalPlayback}
            onChange={(event) => seekTo(Number(event.target.value))}
            style={{ "--progress": `${(currentTime / progressMax) * 100}%` } as React.CSSProperties}
          />
        </div>
        <div className="player-control-row">
          <div className="control-group left">
            <button aria-label="上一部" title="上一部" disabled={!hasPrevious} onClick={onPrevious}>
              <ChevronLeft size={22} />
            </button>
            <button aria-label={`快退 ${seekStepSeconds} 秒`} title={`快退 ${seekStepSeconds} 秒`} disabled={isExternalPlayback} onClick={() => seekBy(-seekStepSeconds)}>
              <RotateCcw size={20} />
            </button>
            <button className="primary-play" aria-label={isExternalPlayback ? "用 mpv 播放" : playing ? "暂停" : "播放"} onClick={() => void togglePlayback()}>
              {playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
            </button>
            <button aria-label={`快进 ${seekStepSeconds} 秒`} title={`快进 ${seekStepSeconds} 秒`} disabled={isExternalPlayback} onClick={() => seekBy(seekStepSeconds)}>
              <RotateCw size={20} />
            </button>
            <button aria-label="下一部" title="下一部" disabled={!hasNext} onClick={onNext}>
              <ChevronRight size={22} />
            </button>
          </div>
          <div className="time-readout">
            {formatClock(currentTime)} <span>/</span> {formatClock(duration)}
          </div>
          <div className="control-group right">
            <button aria-label={muted ? "取消静音" : "静音"} disabled={isExternalPlayback} onClick={toggleMute}>
              {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input aria-label="音量" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} disabled={isExternalPlayback} onChange={(event) => updateVolume(Number(event.target.value))} />
            <button
              className={playlistOpen ? "is-active" : undefined}
              aria-label="播放列表"
              title="播放列表"
              aria-expanded={playlistOpen}
              onClick={togglePlaylist}
            >
              <ListVideo size={20} />
            </button>
            <button aria-label={fullscreenToggleLabel} title={fullscreenToggleLabel} onClick={() => void toggleFullscreen()}>
              <Expand size={19} />
            </button>
          </div>
        </div>
      </footer>

      {detailsOpen && <VideoDetailsDialog video={video} onClose={() => setDetailsOpen(false)} />}

      {deleteConfirmOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="player-delete-title">
            <h3 id="player-delete-title">永久删除这个视频？</h3>
            <p className="delete-filename">{video.filename}</p>
            <p>文件将从磁盘中永久删除，无法恢复。删除成功后会自动播放下一条视频。</p>
            {deleteError && <small className="dialog-error">{deleteError}</small>}
            <div className="dialog-actions">
              <button onClick={() => setDeleteConfirmOpen(false)} disabled={deletePending}>取消</button>
              <button className="danger" autoFocus onClick={() => void confirmDelete()} disabled={deletePending}>{deletePending ? "正在删除..." : "确认永久删除"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function blocksPlayerShortcut(target: HTMLElement, event: KeyboardEvent, shortcuts: ShortcutSettings): boolean {
  if (target.isContentEditable || target.matches("textarea, select")) return true;
  if (!target.matches("input")) return false;
  // Keep range keyboard navigation, but let explicit rotation shortcuts work
  // after seeking/changing volume. A range is not a text-entry field.
  return !target.matches("input[type='range']") ||
    !(matchesShortcut(event, shortcuts.playerRotateLeft) || matchesShortcut(event, shortcuts.playerRotateRight));
}

function formatClock(seconds: number): string {
  return formatDuration(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000);
}

function formatPlaylistDuration(video: VideoRecord, decodedDurationMs: number | null): string {
  const durationMs = decodedDurationMs ?? video.durationMs;
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
    return formatDuration(durationMs);
  }
  if (video.metadataStatus === "pending") return "分析中";
  return "--:--";
}

function quantizePreviewTimeMs(timeMs: number, durationMs: number): number {
  const frameStepMs = 5000;
  const maxTimeMs = Math.max(0, Math.trunc(durationMs));
  const safeTimeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
  return Math.max(0, Math.min(maxTimeMs, Math.round(safeTimeMs / frameStepMs) * frameStepMs));
}

function getAspectRatioValue(width: number | null, height: number | null): string {
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }

  return "16 / 9";
}

function sameDirectory(left: string | null, right: string): boolean {
  if (left === null) return false;
  return normalizeDirectory(left) === normalizeDirectory(right);
}

function normalizeDirectory(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function mergeUniqueVideos(current: VideoRecord[], incoming: VideoRecord[]): VideoRecord[] {
  const byId = new Map(current.map((video) => [video.id, video]));
  for (const video of incoming) byId.set(video.id, video);
  return [...byId.values()];
}

function getRotatedVideoStyle(
  rotationDegrees: number,
  stageSize: { width: number; height: number },
  videoWidth: number | null,
  videoHeight: number | null
): CSSProperties {
  const rotation = ((rotationDegrees % 360) + 360) % 360;
  // Rotating 90/270 degrees can make the element's untransformed box taller
  // than the stage. Grid's safe centering then falls back to start alignment,
  // shifting the rotated frame downward. Absolute centering keeps the visual
  // bounding box centered regardless of the pre-transform dimensions.
  const base: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`
  };
  if ((rotation !== 90 && rotation !== 270) || !videoWidth || !videoHeight || !stageSize.width || !stageSize.height) return base;

  const rotatedAspect = videoHeight / videoWidth;
  const stageAspect = stageSize.width / stageSize.height;
  const rotatedWidth = rotatedAspect > stageAspect ? stageSize.width : stageSize.height * rotatedAspect;
  const rotatedHeight = rotatedWidth / rotatedAspect;
  return { ...base, width: `${rotatedHeight}px`, height: `${rotatedWidth}px` };
}
