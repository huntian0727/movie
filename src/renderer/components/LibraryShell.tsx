import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, BookmarkX, ChevronDown, ChevronRight, Clock3, CopyMinus, Folder, FolderInput, FolderPlus, Heart, Library, ListChecks, LoaderCircle, Pause, Play, PlaySquare, RotateCw, Search, Settings, Trash2, X } from "lucide-react";
import type { BatchDeleteResult, BatchMovePreview, BatchMoveResult, DuplicateGroup, DuplicateGroupPage, DuplicateGroupPageQuery, DuplicatePageSize, DuplicateResolvePlan, DuplicateResolvePreview, DuplicateResolveResult, FolderScanStatus, LibraryNavigationSnapshot, LibraryPage, LibraryPageQuery, LibraryView, ScanFailure, ScanFailureSummary, ShortcutSettings, SortDirection, SortField, SourceFolder, SourceFolderRemovalPreview, VideoRecord, ViewMode } from "../../shared/videoTypes";
import { DEFAULT_SHORTCUTS, matchesShortcut } from "../../shared/shortcuts";
import { DuplicateGroupsPage } from "./DuplicateGroupsPage";
import { Toolbar } from "./Toolbar";
import { VideoDetailsDialog } from "./VideoDetailsDialog";
import { VideoGrid } from "./VideoGrid";
import { VideoTable } from "./VideoTable";
import { formatBytes } from "./formatters";

const PAGE_SIZE_OPTIONS = [30, 50, 100, 200, 300] as const;
const GRID_CARD_WIDTH_OPTIONS = [180, 220, 260, 320, 400] as const;
const GRID_CARD_WIDTH_STORAGE_KEY = "video-manager:grid-card-width";
const PAGE_SIZE_STORAGE_KEY = "video-manager:library-page-size";
const SIDEBAR_WIDTH_STORAGE_KEY = "video-manager:sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 460;
const EMPTY_FOLDERS: SourceFolder[] = [];
const EMPTY_DUPLICATE_GROUPS: DuplicateGroup[] = [];
const EMPTY_RECENT_VIDEO_IDS: string[] = [];
const EMPTY_SCAN_STATUSES: FolderScanStatus[] = [];

interface LibraryShellProps {
  videos: VideoRecord[];
  folders?: SourceFolder[];
  scanStatuses?: FolderScanStatus[];
  loading?: boolean;
  error?: string | null;
  refreshSequence?: number;
  shortcuts?: ShortcutSettings;
  onAddFolder?(): void | Promise<void>;
  onRemoveFolder?(folder: SourceFolder): void | Promise<void>;
  onPauseFolderScan?(folder: SourceFolder): void | Promise<unknown>;
  onResumeFolderScan?(folder: SourceFolder): void | Promise<unknown>;
  onRetryFolderScan?(folder: SourceFolder): void | Promise<unknown>;
  onRetryFolderFailures?(folder: SourceFolder): void | Promise<unknown>;
  onLoadScanFailureSummary?(folder: SourceFolder): Promise<ScanFailureSummary>;
  onLoadScanFailures?(folder: SourceFolder): Promise<ScanFailure[]>;
  onRefresh?(): void | Promise<void>;
  onOpen?(video: VideoRecord, queue: VideoRecord[]): void;
  onToggleFavorite?(video: VideoRecord): void | Promise<void>;
  onTogglePendingDelete?(video: VideoRecord): void | Promise<void>;
  onRename?(video: VideoRecord, baseName: string): void | Promise<void>;
  onDelete?(video: VideoRecord): void | Promise<void>;
  onRegenerateCover?(video: VideoRecord): void | Promise<void>;
  onRetryMetadata?(video: VideoRecord): void | Promise<void>;
  getCoverUrl?(video: VideoRecord): string | null;
  navigation?: LibraryNavigationSnapshot;
  onLoadVideoPage?(query: LibraryPageQuery): Promise<LibraryPage>;
  duplicateGroups?: DuplicateGroup[];
  onLoadDuplicateGroups?(query: DuplicateGroupPageQuery): Promise<DuplicateGroupPage>;
  recentVideoIds?: string[];
  onPreviewDuplicateResolve?(plan: DuplicateResolvePlan): Promise<DuplicateResolvePreview>;
  onResolveDuplicateGroups?(plan: DuplicateResolvePlan): Promise<DuplicateResolveResult>;
  onRevealInFolder?(video: VideoRecord): void | Promise<void>;
  onPreviewRemoveFolder?(folder: SourceFolder): Promise<SourceFolderRemovalPreview>;
  onOpenSettings?(): void;
  onBatchDelete?(videos: VideoRecord[]): Promise<BatchDeleteResult>;
  onDeleteAllPending?(): Promise<BatchDeleteResult>;
  onChooseMoveDestination?(): Promise<string | null>;
  onPreviewBatchMove?(videos: VideoRecord[], targetDirectory: string, addTargetToLibrary: boolean): Promise<BatchMovePreview>;
  onBatchMove?(videos: VideoRecord[], targetDirectory: string, addTargetToLibrary: boolean): Promise<BatchMoveResult>;
}

export function LibraryShell({
  videos,
  folders = EMPTY_FOLDERS,
  scanStatuses = EMPTY_SCAN_STATUSES,
  loading = false,
  error = null,
  refreshSequence = 0,
  shortcuts = DEFAULT_SHORTCUTS,
  onAddFolder,
  onRemoveFolder,
  onPauseFolderScan,
  onResumeFolderScan,
  onRetryFolderScan,
  onRetryFolderFailures,
  onLoadScanFailureSummary,
  onLoadScanFailures,
  onRefresh,
  onOpen,
  onToggleFavorite,
  onTogglePendingDelete,
  onRename,
  onDelete,
  onRegenerateCover,
  onRetryMetadata,
  getCoverUrl,
  navigation,
  onLoadVideoPage,
  duplicateGroups = EMPTY_DUPLICATE_GROUPS,
  onLoadDuplicateGroups,
  recentVideoIds = EMPTY_RECENT_VIDEO_IDS,
  onPreviewDuplicateResolve,
  onResolveDuplicateGroups,
  onRevealInFolder,
  onPreviewRemoveFolder,
  onOpenSettings
  , onBatchDelete, onDeleteAllPending, onChooseMoveDestination, onPreviewBatchMove, onBatchMove
}: LibraryShellProps) {
  const [view, setView] = useState<LibraryView>("all");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [folderScope, setFolderScope] = useState<"recursive" | "exact">("recursive");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("filename");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [renameTarget, setRenameTarget] = useState<VideoRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoRecord | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<VideoRecord | null>(null);
  const [removeFolderTarget, setRemoveFolderTarget] = useState<SourceFolder | null>(null);
  const [folderIssueTarget, setFolderIssueTarget] = useState<{
    folder: SourceFolder;
    message: string;
    state: "offline" | "error" | "previous";
    summary: ScanFailureSummary | null;
    failures: ScanFailure[];
    loading: boolean;
    loadError: string | null;
  } | null>(null);
  const [nextBaseName, setNextBaseName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(readStoredPageSize);
  const [page, setPage] = useState(1);
  const [gridCardWidth, setGridCardWidth] = useState<(typeof GRID_CARD_WIDTH_OPTIONS)[number]>(readStoredGridCardWidth);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<string[]>([]);
  const [folderQuery, setFolderQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [duplicatePageNumber, setDuplicatePageNumber] = useState(1);
  const [duplicatePageSize, setDuplicatePageSize] = useState<DuplicatePageSize>(20);
  const [duplicateSortDirection, setDuplicateSortDirection] = useState<SortDirection>("desc");
  const [duplicatePreferredDirectoryPath, setDuplicatePreferredDirectoryPath] = useState("");
  const [duplicatePreferredDirectoryScope, setDuplicatePreferredDirectoryScope] = useState<"recursive" | "exact">("recursive");
  const [duplicatePage, setDuplicatePage] = useState<DuplicateGroupPage>(() => createStaticDuplicatePage(duplicateGroups));
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateLoadError, setDuplicateLoadError] = useState<string | null>(null);
  const [duplicateRefreshVersion, setDuplicateRefreshVersion] = useState(0);
  const [videoPage, setVideoPage] = useState<LibraryPage>({ videos: [], page: 1, pageSize: 100, totalPages: 1, totalCount: 0 });
  const [videoPageLoading, setVideoPageLoading] = useState(false);
  const [videoPageError, setVideoPageError] = useState<string | null>(null);
  const [videoPageRefreshVersion, setVideoPageRefreshVersion] = useState(0);
  const [removeFolderImpact, setRemoveFolderImpact] = useState<SourceFolderRemovalPreview | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(() => new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [pendingDeleteClearOpen, setPendingDeleteClearOpen] = useState(false);
  const [batchMovePreview, setBatchMovePreview] = useState<BatchMovePreview | null>(null);
  const [batchResult, setBatchResult] = useState<BatchDeleteResult | BatchMoveResult | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const folderSearchRef = useRef<HTMLInputElement>(null);
  const folderNavRef = useRef<HTMLElement>(null);
  const sidebarResizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const directoryPaths = useMemo(() => navigation?.directoryPaths ?? videos.map((video) => video.directory), [navigation?.directoryPaths, videos]);
  const directoryEntries = useMemo(() => buildDirectoryEntries(folders, directoryPaths), [directoryPaths, folders]);
  const scanStatusByFolder = useMemo(() => new Map(scanStatuses.map((status) => [status.folderId, status])), [scanStatuses]);
  const directoryEntryByPath = useMemo(
    () => new Map(directoryEntries.map((entry) => [normalizeDirectoryPath(entry.path), entry])),
    [directoryEntries]
  );
  const visibleDirectoryEntries = useMemo(
    () => directoryEntries.filter((entry) => isDirectoryEntryVisible(entry, expandedFolderPaths, directoryEntryByPath)),
    [directoryEntries, directoryEntryByPath, expandedFolderPaths]
  );
  const displayedDirectoryEntries = useMemo(() => {
    const query = folderQuery.trim().toLocaleLowerCase();
    if (!query) return visibleDirectoryEntries;
    return directoryEntries.filter((entry) => entry.path.toLocaleLowerCase().includes(query));
  }, [directoryEntries, folderQuery, visibleDirectoryEntries]);

  const visibleVideos = useMemo(() => {
    if (onLoadVideoPage) return videoPage.videos;
    if (view === "recent") {
      const byId = new Map(videos.map((video) => [video.id, video]));
      return recentVideoIds
        .map((id) => byId.get(id))
        .filter((video): video is VideoRecord => Boolean(video))
        .filter((video) => video.filename.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    }

    const result = videos.filter((video) => {
      if (view === "favorites" && !video.isFavorite) return false;
      if (view === "pendingDelete" && !video.isPendingDelete) return false;
      if (view === "folder" && selectedFolderPath) {
        const directoryMatches = folderScope === "exact"
          ? normalizeDirectoryPath(video.directory) === normalizeDirectoryPath(selectedFolderPath)
          : isPathWithin(video.directory, selectedFolderPath);
        if (!directoryMatches) return false;
      }
      return video.filename.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    });
    return result.sort((left, right) => compareVideos(left, right, sortField) * (sortDirection === "asc" ? 1 : -1));
  }, [folderScope, onLoadVideoPage, recentVideoIds, search, selectedFolderPath, sortDirection, sortField, videoPage.videos, videos, view]);
  const favoriteCount = useMemo(() => navigation?.favoriteVideos ?? videos.reduce((count, video) => count + (video.isFavorite ? 1 : 0), 0), [navigation?.favoriteVideos, videos]);
  const pendingDeleteCount = navigation?.pendingDeleteVideos ?? videos.reduce((count, video) => count + (video.isPendingDelete ? 1 : 0), 0);
  const pendingDeleteBytes = navigation?.pendingDeleteBytes ?? videos.reduce((total, video) => total + (video.isPendingDelete ? video.sizeBytes : 0), 0);

  useEffect(() => {
    setPage(1);
  }, [folderScope, pageSize, search, selectedFolderPath, sortDirection, sortField, view]);

  useEffect(() => {
    if (!onLoadVideoPage || view === "duplicates") return;
    let disposed = false;
    setVideoPageLoading(true);
    setVideoPageError(null);
    void onLoadVideoPage({
      view,
      directoryPath: view === "folder" ? selectedFolderPath ?? undefined : undefined,
      folderScope: view === "folder" ? folderScope : undefined,
      search,
      sortField,
      sortDirection,
      page,
      pageSize
    }).then((result) => {
      if (disposed) return;
      setVideoPage(result);
      if (result.page !== page) setPage(result.page);
    }).catch((cause) => {
      if (!disposed) setVideoPageError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!disposed) setVideoPageLoading(false);
    });
    return () => { disposed = true; };
  }, [folderScope, onLoadVideoPage, page, pageSize, refreshSequence, search, selectedFolderPath, sortDirection, sortField, videoPageRefreshVersion, view]);

  useEffect(() => {
    if (!onLoadVideoPage || !videoPage.videos.some((video) => video.metadataStatus === "pending")) return;
    const timer = window.setInterval(() => setVideoPageRefreshVersion((current) => current + 1), 1500);
    return () => window.clearInterval(timer);
  }, [onLoadVideoPage, videoPage.videos]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRID_CARD_WIDTH_STORAGE_KEY, String(gridCardWidth));
    } catch {
      // Renderer storage can be unavailable in hardened or test environments.
    }
  }, [gridCardWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
    } catch {
      // Renderer storage can be unavailable in hardened or test environments.
    }
  }, [pageSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Renderer storage can be unavailable in hardened or test environments.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onPointerMove = (event: PointerEvent) => {
      const start = sidebarResizeStartRef.current;
      if (!start) return;
      setSidebarWidth(clampSidebarWidth(start.width + event.clientX - start.pointerX));
    };
    const stopResizing = () => {
      sidebarResizeStartRef.current = null;
      setIsResizingSidebar(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const focusFolderSearch = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.code !== "KeyF") return;
      if (renameTarget || deleteTarget || detailsTarget || removeFolderTarget || folderIssueTarget) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog']")) return;
      event.preventDefault();
      folderSearchRef.current?.focus();
    };
    window.addEventListener("keydown", focusFolderSearch);
    return () => window.removeEventListener("keydown", focusFolderSearch);
  }, [deleteTarget, detailsTarget, folderIssueTarget, removeFolderTarget, renameTarget]);

  useEffect(() => {
    const existingPaths = new Set(directoryEntries.map((entry) => normalizeDirectoryPath(entry.path)));
    setExpandedFolderPaths((current) => {
      const next = current.filter((path) => existingPaths.has(path));
      return areStringArraysEqual(current, next) ? current : next;
    });
  }, [directoryEntries]);

  useEffect(() => {
    if (selectedFolderPath && !directoryEntryByPath.has(normalizeDirectoryPath(selectedFolderPath))) {
      setView("all");
      setSelectedFolderPath(null);
      setFolderScope("recursive");
    }
  }, [directoryEntryByPath, selectedFolderPath]);

  useEffect(() => {
    if (onLoadDuplicateGroups || view === "duplicates") return;
    setDuplicatePage(createStaticDuplicatePage(duplicateGroups));
  }, [duplicateGroups, onLoadDuplicateGroups, view]);

  useEffect(() => {
    if (view !== "duplicates") return;
    if (!onLoadDuplicateGroups) {
      setDuplicatePage(createStaticDuplicatePage(duplicateGroups));
      return;
    }

    let disposed = false;
    setDuplicateLoading(true);
    setDuplicateLoadError(null);
    const query: DuplicateGroupPageQuery = {
      page: duplicatePageNumber,
      pageSize: duplicatePageSize,
      sortDirection: duplicateSortDirection
    };
    if (duplicatePreferredDirectoryPath) {
      query.preferredDirectoryPath = duplicatePreferredDirectoryPath;
      query.preferredDirectoryScope = duplicatePreferredDirectoryScope;
    }
    void onLoadDuplicateGroups(query).then((result) => {
      if (disposed) return;
      setDuplicatePage(result);
      if (result.page !== duplicatePageNumber) setDuplicatePageNumber(result.page);
    }).catch((cause) => {
      if (!disposed) setDuplicateLoadError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!disposed) setDuplicateLoading(false);
    });

    return () => { disposed = true; };
  }, [duplicateGroups, duplicatePageNumber, duplicatePageSize, duplicatePreferredDirectoryPath, duplicatePreferredDirectoryScope, duplicateRefreshVersion, duplicateSortDirection, onLoadDuplicateGroups, refreshSequence, view]);

  const title = view === "favorites" ? "收藏" : view === "pendingDelete" ? "待删除" : view === "recent" ? "最近播放" : view === "folder" ? `${folderScope === "exact" ? "同目录 · " : ""}${folderName(selectedFolderPath ?? "文件夹")}` : view === "duplicates" ? "重复项" : "所有视频";
  const toolbarCount = view === "duplicates" ? duplicatePage.totalGroups : onLoadVideoPage ? videoPage.totalCount : visibleVideos.length;
  const totalPages = onLoadVideoPage ? videoPage.totalPages : Math.max(1, Math.ceil(visibleVideos.length / pageSize));
  const currentPage = onLoadVideoPage ? videoPage.page : Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const renderedVideos = useMemo(
    () => onLoadVideoPage ? visibleVideos : visibleVideos.slice(pageStart, pageStart + pageSize),
    [onLoadVideoPage, pageSize, pageStart, visibleVideos]
  );
  useEffect(() => {
    const visibleIds = new Set(renderedVideos.map((video) => video.id));
    setSelectedVideoIds((current) => {
      const next = new Set([...current].filter((videoId) => visibleIds.has(videoId)));
      return next.size === current.size && [...next].every((videoId) => current.has(videoId)) ? current : next;
    });
  }, [renderedVideos]);
  const gridCardSizeIndex = GRID_CARD_WIDTH_OPTIONS.indexOf(gridCardWidth);

  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [currentPage, pageSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view === "duplicates" || event.defaultPrevented) return;
      if (renameTarget || deleteTarget || detailsTarget || removeFolderTarget || folderIssueTarget) return;
      const previousPage = matchesShortcut(event, shortcuts.libraryPreviousPage);
      const nextPageShortcut = matchesShortcut(event, shortcuts.libraryNextPage);
      if (!previousPage && !nextPageShortcut) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='alertdialog']")) return;

      const nextPage = previousPage
        ? Math.max(1, currentPage - 1)
        : Math.min(totalPages, currentPage + 1);
      if (nextPage === currentPage) return;
      event.preventDefault();
      setPage(nextPage);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPage, deleteTarget, detailsTarget, folderIssueTarget, removeFolderTarget, renameTarget, shortcuts, totalPages, view]);
  const openVideo = (video: VideoRecord, queue = renderedVideos) => onOpen?.(video, queue);
  const toggleFavorite = (video: VideoRecord) => void runAction(() => onToggleFavorite?.(video)).then((changed) => {
    if (changed && onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
  });
  const togglePendingDelete = (video: VideoRecord) => void runAction(() => onTogglePendingDelete?.(video)).then((changed) => {
    if (changed && onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
  });
  const renameVideo = (video: VideoRecord) => {
    setActionError(null);
    setRenameTarget(video);
    setNextBaseName(video.basename);
  };
  const deleteVideo = (video: VideoRecord) => {
    setActionError(null);
    setDeleteTarget(video);
  };
  const regenerateCover = (video: VideoRecord) => void runAction(() => onRegenerateCover?.(video)).then((changed) => {
    if (changed && onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
  });
  const retryMetadata = (video: VideoRecord) => void runAction(() => onRetryMetadata?.(video)).then((changed) => {
    if (changed && onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
  });
  const viewVideoDetails = (video: VideoRecord) => {
    setDetailsTarget(video);
  };
  const selectDirectory = (directoryPath: string, scope: "recursive" | "exact" = "recursive") => {
    const normalizedPath = normalizeDirectoryPath(directoryPath);
    const pathsToExpand: string[] = [];
    let parentPath = directoryEntryByPath.get(normalizedPath)?.parentPath ?? null;
    while (parentPath) {
      pathsToExpand.push(parentPath);
      parentPath = directoryEntryByPath.get(parentPath)?.parentPath ?? null;
    }
    setExpandedFolderPaths((current) => [...new Set([...current, ...pathsToExpand])]);
    setSearch("");
    setFolderScope(scope);
    setSelectedFolderPath(directoryPath);
    setView("folder");
  };
  const showVideoDirectory = (video: VideoRecord) => selectDirectory(video.directory, "exact");
  const openFolderIssueDialog = async (
    folder: SourceFolder,
    warning: { message: string; state: "offline" | "error" | "previous" }
  ) => {
    setFolderIssueTarget({ folder, ...warning, summary: null, failures: [], loading: true, loadError: null });
    try {
      const [summary, failures] = await Promise.all([
        onLoadScanFailureSummary?.(folder) ?? Promise.resolve({
          sourceFolderId: folder.id,
          failedFileCount: 0,
          failedDirectoryCount: 0,
          totalUnresolved: 0,
          latestError: warning.message,
          latestFailedAt: null,
          totalRetryCount: 0
        }),
        onLoadScanFailures?.(folder) ?? Promise.resolve([])
      ]);
      setFolderIssueTarget((current) => current?.folder.id === folder.id
        ? { ...current, summary, failures, loading: false }
        : current);
    } catch (cause) {
      setFolderIssueTarget((current) => current?.folder.id === folder.id
        ? { ...current, loading: false, loadError: cause instanceof Error ? cause.message : String(cause) }
        : current);
    }
  };
  const openRemoveFolderDialog = async (folder: SourceFolder) => {
    setActionError(null);
    setRemoveFolderTarget(folder);
    setRemoveFolderImpact(null);
    try {
      setRemoveFolderImpact(onPreviewRemoveFolder
        ? await onPreviewRemoveFolder(folder)
        : calculateFolderRemovalImpact(folder, folders, videos));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  async function runAction(action: () => void | Promise<void>): Promise<boolean> {
    setActionPending(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setActionPending(false);
    }
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget || !nextBaseName.trim() || nextBaseName === renameTarget.basename) return;
    if (await runAction(() => onRename?.(renameTarget, nextBaseName))) {
      setRenameTarget(null);
      if (onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (await runAction(() => onDelete?.(deleteTarget))) {
      setDeleteTarget(null);
      if (onLoadVideoPage) setVideoPageRefreshVersion((current) => current + 1);
    }
  };

  const confirmRemoveFolder = async () => {
    if (!removeFolderTarget) return;
    if (await runAction(() => onRemoveFolder?.(removeFolderTarget))) {
      setRemoveFolderTarget(null);
      setRemoveFolderImpact(null);
    }
  };
  const selectedVideos = renderedVideos.filter((video) => selectedVideoIds.has(video.id));
  const toggleSelectedVideo = (video: VideoRecord) => setSelectedVideoIds((current) => {
    const next = new Set(current);
    if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
    return next;
  });
  const selectCurrentPage = () => setSelectedVideoIds(new Set(renderedVideos.map((video) => video.id)));
  const exitSelection = () => { setSelectionMode(false); setSelectedVideoIds(new Set()); };
  const previewMoveSelected = async () => {
    const targetDirectory = await onChooseMoveDestination?.();
    if (!targetDirectory || selectedVideos.length === 0 || !onPreviewBatchMove) return;
    setActionPending(true);
    try { setBatchMovePreview(await onPreviewBatchMove(selectedVideos, targetDirectory, true)); } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); } finally { setActionPending(false); }
  };
  const confirmBatchDelete = async () => {
    if (!onBatchDelete) return;
    setActionPending(true);
    try { setBatchResult(await onBatchDelete(selectedVideos)); setBatchDeleteOpen(false); exitSelection(); setVideoPageRefreshVersion((current) => current + 1); } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); } finally { setActionPending(false); }
  };
  const confirmDeleteAllPending = async () => {
    if (!onDeleteAllPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      setBatchResult(await onDeleteAllPending());
      setPendingDeleteClearOpen(false);
      setVideoPageRefreshVersion((current) => current + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionPending(false);
    }
  };
  const confirmBatchMove = async () => {
    if (!batchMovePreview || !onBatchMove) return;
    setActionPending(true);
    try { setBatchResult(await onBatchMove(selectedVideos, batchMovePreview.targetDirectory, true)); setBatchMovePreview(null); exitSelection(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); } finally { setActionPending(false); }
  };
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    sidebarResizeStartRef.current = { pointerX: event.clientX, width: sidebarWidth };
    setIsResizingSidebar(true);
    event.preventDefault();
  };
  const handleFolderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    entry: DirectoryEntry,
    isExpanded: boolean,
    toggleExpanded: () => void
  ) => {
    const folderButtons = [...(folderNavRef.current?.querySelectorAll<HTMLButtonElement>(".folder-entry") ?? [])];
    const currentIndex = folderButtons.indexOf(event.currentTarget);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const offset = event.key === "ArrowDown" ? 1 : -1;
      folderButtons[Math.max(0, Math.min(folderButtons.length - 1, currentIndex + offset))]?.focus();
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight" && entry.hasChildren && !isExpanded) {
      toggleExpanded();
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") {
      if (entry.hasChildren && isExpanded) {
        toggleExpanded();
      } else if (entry.parentPath) {
        folderButtons.find((button) => normalizeDirectoryPath(button.dataset.folderPath ?? "") === entry.parentPath)?.focus();
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      selectDirectory(entry.path);
      event.preventDefault();
    }
  };

  return (
    <main
      className={`app-shell${isResizingSidebar ? " is-resizing-sidebar" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><PlaySquare size={22} /></span>
          <div><strong>映匣</strong><small>本地视频库</small></div>
        </div>
        <nav className="primary-nav" aria-label="视频库导航">
          <button aria-label="查看所有视频" className={view === "all" ? "active" : undefined} onClick={() => { setView("all"); setSelectedFolderPath(null); setFolderScope("recursive"); }}>
            <Library size={18} /><span>所有视频</span><em>{navigation?.totalVideos ?? videos.length}</em>
          </button>
          <button aria-label="查看收藏视频" className={view === "favorites" ? "active" : undefined} onClick={() => { setView("favorites"); setSelectedFolderPath(null); }}>
            <Heart size={18} /><span>收藏</span><em>{favoriteCount}</em>
          </button>
          <button aria-label="查看待删除视频" className={view === "pendingDelete" ? "active" : undefined} onClick={() => { setView("pendingDelete"); setSelectedFolderPath(null); }}>
            <BookmarkX size={18} /><span>待删除</span><em>{pendingDeleteCount}</em>
          </button>
          <button aria-label="查看最近播放" className={view === "recent" ? "active" : undefined} onClick={() => { setView("recent"); setSelectedFolderPath(null); }}>
            <Clock3 size={18} /><span>最近播放</span><em>{recentVideoIds.length}</em>
          </button>
          <button aria-label="查看重复项" className={view === "duplicates" ? "active" : undefined} onClick={() => { setView("duplicates"); setSelectedFolderPath(null); setDuplicatePageNumber(1); }}>
            <CopyMinus size={18} /><span>重复项</span><em>{duplicatePage.totalGroups}</em>
          </button>
        </nav>
        <div className="sidebar-heading">
          <span>文件夹 <small>{directoryEntries.length}</small></span>
          <button aria-label="添加文件夹" title="添加文件夹" onClick={() => void onAddFolder?.()}><FolderPlus size={17} /></button>
        </div>
        <label className="folder-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={folderSearchRef}
            aria-label="搜索文件夹名称或路径"
            placeholder="搜索文件夹名称或路径"
            value={folderQuery}
            onChange={(event) => setFolderQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setFolderQuery("");
                event.currentTarget.blur();
              }
            }}
          />
          {folderQuery && (
            <button type="button" aria-label="清除文件夹搜索" title="清除搜索" onClick={() => {
              setFolderQuery("");
              folderSearchRef.current?.focus();
            }}>
              <X size={14} />
            </button>
          )}
        </label>
        <nav ref={folderNavRef} className={`folder-nav${folderQuery.trim() ? " search-results" : ""}`} aria-label="视频文件夹">
          {displayedDirectoryEntries.map((entry) => {
            const normalizedPath = normalizeDirectoryPath(entry.path);
            const isExpanded = expandedFolderPaths.includes(normalizedPath);
            const isSelected = view === "folder" && normalizeDirectoryPath(selectedFolderPath ?? "") === normalizedPath;
            const scanStatus = entry.sourceFolder ? scanStatusByFolder.get(entry.sourceFolder.id) : undefined;
            const warning = getFolderWarning(entry, scanStatus);
            const isScanning = scanStatus?.state === "queued" || scanStatus?.state === "scanning";
            const toggleExpanded = () => {
              setExpandedFolderPaths((current) =>
                current.includes(normalizedPath)
                  ? current.filter((path) => path !== normalizedPath)
                  : [...current, normalizedPath]
              );
            };

            return (
              <div
                key={entry.path}
                className={`folder-nav-row${isSelected ? " active" : ""}${entry.sourceFolder ? " source-folder" : ""}${warning ? " has-warning" : ""}${isScanning ? " is-scanning" : ""}`}
                style={{ "--folder-depth": folderQuery.trim() ? 0 : entry.depth } as CSSProperties}
              >
                {entry.hasChildren ? (
                  <button
                    type="button"
                    className="folder-toggle"
                    aria-label={`${isExpanded ? "折叠" : "展开"} ${folderName(entry.path)}`}
                    aria-expanded={isExpanded}
                    title={isExpanded ? "折叠子目录" : "展开子目录"}
                    onClick={toggleExpanded}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="folder-toggle-spacer" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className={`folder-entry${isSelected ? " active" : ""}`}
                  data-folder-path={entry.path}
                  aria-label={folderName(entry.path)}
                  title={entry.path}
                  onClick={() => selectDirectory(entry.path)}
                  onKeyDown={(event) => handleFolderKeyDown(event, entry, isExpanded, toggleExpanded)}
                >
                  <Folder size={18} />
                  <span className="folder-entry-label">
                    <span className="folder-entry-name">{folderName(entry.path)}</span>
                    <small title={scanStatus?.currentPath ?? scanStatus?.message ?? entry.path}>
                      {folderEntryMeta(entry, scanStatus, Boolean(folderQuery.trim()))}
                    </small>
                  </span>
                  {isScanning && <LoaderCircle className="folder-scan-spinner" size={15} aria-label={`正在扫描 ${folderName(entry.path)}`} />}
                </button>
                {warning && entry.sourceFolder && (
                  <button
                    type="button"
                    className="folder-warning-button"
                    aria-label={`查看 ${folderName(entry.path)} 扫描异常`}
                    title={warning.message}
                    onClick={() => void openFolderIssueDialog(entry.sourceFolder!, warning)}
                  >
                    <AlertTriangle size={16} />
                  </button>
                )}
                {entry.sourceFolder && (
                  <span className="folder-source-actions">
                    {(scanStatus?.state === "queued" || scanStatus?.state === "scanning") && onPauseFolderScan && <button type="button" aria-label={`暂停扫描 ${folderName(entry.path)}`} title="暂停扫描" onClick={() => void onPauseFolderScan(entry.sourceFolder!)}><Pause size={13} /></button>}
                    {scanStatus?.state === "paused" && onResumeFolderScan && <button type="button" aria-label={`继续扫描 ${folderName(entry.path)}`} title="继续扫描" onClick={() => void onResumeFolderScan(entry.sourceFolder!)}><Play size={13} /></button>}
                    {(!scanStatus || scanStatus.state === "completed" || scanStatus.state === "completed-with-errors" || scanStatus.state === "offline" || scanStatus.state === "error") && onRetryFolderScan && <button type="button" aria-label={`扫描当前文件夹 ${folderName(entry.path)}`} title="扫描当前文件夹" onClick={() => void onRetryFolderScan(entry.sourceFolder!)}><RotateCw size={13} /></button>}
                    {onRemoveFolder && (!scanStatus || scanStatus.state === "completed" || scanStatus.state === "completed-with-errors" || scanStatus.state === "offline" || scanStatus.state === "error") && <button type="button" className="folder-remove" aria-label={`移除源目录 ${folderName(entry.path)}`} title="从资料库移除源目录（不会删除磁盘文件）" onClick={() => void openRemoveFolderDialog(entry.sourceFolder!)}><Trash2 size={14} /></button>}
                  </span>
                )}
              </div>
            );
          })}
          {directoryEntries.length === 0 && <p className="folder-empty">还没有添加文件夹</p>}
          {directoryEntries.length > 0 && displayedDirectoryEntries.length === 0 && <p className="folder-empty">没有匹配的已入库目录</p>}
        </nav>
        <div className="sidebar-footer">
          <button onClick={onOpenSettings}><Settings size={17} /><span>设置</span></button>
          <div className="storage-note"><span>本地资料库</span><small>文件保留在原位置</small></div>
        </div>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          title="拖动调整宽度，双击恢复默认宽度"
          onPointerDown={startSidebarResize}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            setSidebarWidth((current) => clampSidebarWidth(current + (event.key === "ArrowRight" ? 10 : -10)));
            event.preventDefault();
          }}
        />
      </aside>

      <section className="content" ref={contentRef}>
        <Toolbar
          title={title}
          count={toolbarCount}
          countLabel={view === "duplicates" ? "组重复" : "部视频"}
          search={search}
          sortField={sortField}
          sortDirection={sortDirection}
          viewMode={viewMode}
          gridCardSizeIndex={gridCardSizeIndex}
          gridCardSizeMaxIndex={GRID_CARD_WIDTH_OPTIONS.length - 1}
          loading={loading}
          showBrowseControls={view !== "duplicates"}
          onBack={view === "folder" ? () => { setView("all"); setSelectedFolderPath(null); setFolderScope("recursive"); } : undefined}
          onSearch={setSearch}
          onSortField={setSortField}
          onToggleDirection={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
          onViewMode={setViewMode}
          onGridCardSizeIndex={(index) => {
            const nextWidth = GRID_CARD_WIDTH_OPTIONS[Math.max(0, Math.min(GRID_CARD_WIDTH_OPTIONS.length - 1, index))];
            if (nextWidth) setGridCardWidth(nextWidth);
          }}
          onRefresh={() => void onRefresh?.()}
        />

        {view !== "duplicates" && (
          <div className="batch-toolbar">
            {!selectionMode ? <>
              <button type="button" onClick={() => setSelectionMode(true)}><ListChecks size={16} /> 多选</button>
              {view === "pendingDelete" && <button type="button" className="danger" disabled={pendingDeleteCount === 0 || actionPending} onClick={() => setPendingDeleteClearOpen(true)}><Trash2 size={16} /> 全部永久删除</button>}
            </> : <>
              <strong>已选 {selectedVideoIds.size} 个</strong>
              <button type="button" onClick={selectCurrentPage}>全选当前页</button>
              <button type="button" disabled={selectedVideos.length === 0} onClick={() => void previewMoveSelected()}><FolderInput size={16} /> 移动到…</button>
              <button type="button" className="danger" disabled={selectedVideos.length === 0} onClick={() => setBatchDeleteOpen(true)}><Trash2 size={16} /> 永久删除</button>
              <button type="button" onClick={exitSelection}>取消</button>
            </>}
          </div>
        )}

        {(error || actionError || duplicateLoadError || videoPageError) && <div className="error-banner" role="alert">{error ?? actionError ?? duplicateLoadError ?? videoPageError}</div>}
        {view === "duplicates" ? (
          <DuplicateGroupsPage
            groups={duplicatePage.groups}
            loading={loading || duplicateLoading}
            page={duplicatePage.page}
            pageSize={duplicatePage.pageSize}
            totalPages={duplicatePage.totalPages}
            totalGroups={duplicatePage.totalGroups}
            totalCandidateGroups={duplicatePage.totalCandidateGroups}
            totalCandidateFiles={duplicatePage.totalCandidateFiles}
            totalReclaimableBytes={duplicatePage.totalReclaimableBytes}
            sizeSortDirection={duplicateSortDirection}
            onPage={setDuplicatePageNumber}
            onPageSize={(pageSize) => { setDuplicatePageSize(pageSize); setDuplicatePageNumber(1); }}
            onSizeSortDirection={(direction) => { setDuplicateSortDirection(direction); setDuplicatePageNumber(1); }}
            directoryOptions={duplicatePage.directoryOptions}
            preferredDirectoryPath={duplicatePreferredDirectoryPath || undefined}
            preferredDirectoryScope={duplicatePreferredDirectoryScope}
            onPreferredDirectoryPathChange={(path) => { setDuplicatePreferredDirectoryPath(path); setDuplicatePageNumber(1); }}
            onPreferredDirectoryScopeChange={(scope) => { setDuplicatePreferredDirectoryScope(scope); setDuplicatePageNumber(1); }}
            onOpen={openVideo}
            onViewDetails={viewVideoDetails}
            onRevealInFolder={onRevealInFolder}
            onDelete={onDelete ? async (video) => {
              await onDelete(video);
              setDuplicateRefreshVersion((current) => current + 1);
            } : undefined}
            onPreviewResolve={async (plan) => {
              if (!onPreviewDuplicateResolve) {
                throw new Error("重复项预检查能力未连接");
              }
              return onPreviewDuplicateResolve(plan);
            }}
            onResolve={async (plan) => {
              if (!onResolveDuplicateGroups) {
                throw new Error("重复项清理能力未连接");
              }
              const result = await onResolveDuplicateGroups(plan);
              setDuplicateRefreshVersion((current) => current + 1);
              return result;
            }}
          />
        ) : (loading || videoPageLoading) && renderedVideos.length === 0 ? (
          <div className="loading-state"><span /><p>正在读取视频资料...</p></div>
        ) : visibleVideos.length === 0 ? (
          <div className="empty-state">
            <div><PlaySquare size={36} /></div>
            <h3>{search ? "没有匹配的视频" : "这里还没有视频"}</h3>
            <p>{search ? "试试其他文件名" : "添加一个本地文件夹，视频会自动出现在这里。"}</p>
            {!search && <button onClick={() => void onAddFolder?.()}><FolderPlus size={17} />添加文件夹</button>}
          </div>
        ) : viewMode === "grid" ? (
          <>
            <VideoGrid videos={renderedVideos} getCoverUrl={getCoverUrl} onOpen={openVideo} onViewDetails={viewVideoDetails} onToggleFavorite={toggleFavorite} onTogglePendingDelete={onTogglePendingDelete ? togglePendingDelete : undefined} onRename={renameVideo} onDelete={deleteVideo} onRegenerateCover={onRegenerateCover ? regenerateCover : undefined} onRetryMetadata={onRetryMetadata ? retryMetadata : undefined} onRevealInFolder={onRevealInFolder} onShowDirectory={showVideoDirectory} cardWidth={gridCardWidth} selectionMode={selectionMode} selectedIds={selectedVideoIds} onToggleSelection={toggleSelectedVideo} />
            <PaginationBar page={currentPage} totalPages={totalPages} pageSize={pageSize} totalCount={onLoadVideoPage ? videoPage.totalCount : visibleVideos.length} onPage={setPage} onPageSize={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }} />
          </>
        ) : (
          <>
            <VideoTable videos={renderedVideos} onOpen={openVideo} onViewDetails={viewVideoDetails} onToggleFavorite={toggleFavorite} onTogglePendingDelete={onTogglePendingDelete ? togglePendingDelete : undefined} onRename={renameVideo} onDelete={deleteVideo} selectionMode={selectionMode} selectedIds={selectedVideoIds} onToggleSelection={toggleSelectedVideo} />
            <PaginationBar page={currentPage} totalPages={totalPages} pageSize={pageSize} totalCount={onLoadVideoPage ? videoPage.totalCount : visibleVideos.length} onPage={setPage} onPageSize={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }} />
          </>
        )}
      </section>

      {detailsTarget && <VideoDetailsDialog video={detailsTarget} onClose={() => setDetailsTarget(null)} />}

      {folderIssueTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !actionPending) setFolderIssueTarget(null);
        }}>
          <section className="dialog folder-issue-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-issue-title">
            <span className="folder-issue-heading"><AlertTriangle size={18} /></span>
            <h3 id="folder-issue-title">
              {folderIssueTarget.state === "offline"
                ? "目录暂时离线"
                : folderIssueTarget.state === "error"
                  ? "目录扫描失败"
                  : "上次扫描存在异常"}
            </h3>
            <p className="delete-filename" title={folderIssueTarget.folder.path}>{folderIssueTarget.folder.path}</p>
            <p className="folder-issue-message">{folderIssueTarget.message}</p>
            {folderIssueTarget.loading && <p>正在读取异常明细……</p>}
            {folderIssueTarget.loadError && <small className="dialog-error">异常明细读取失败：{folderIssueTarget.loadError}</small>}
            {folderIssueTarget.summary && (
              <div className="folder-issue-summary">
                <span><strong>{folderIssueTarget.summary.failedFileCount}</strong>失败文件</span>
                <span><strong>{folderIssueTarget.summary.failedDirectoryCount}</strong>失败目录</span>
                <span><strong>{folderIssueTarget.summary.totalRetryCount}</strong>累计重试</span>
                <span><strong>{formatScanFailureTime(folderIssueTarget.summary.latestFailedAt)}</strong>最近失败</span>
              </div>
            )}
            {folderIssueTarget.failures.length > 0 && (
              <div className="folder-issue-list" aria-label="扫描异常明细">
                {folderIssueTarget.failures.map((failure) => (
                  <article key={failure.id}>
                    <div><b>{failure.objectType === "file" ? "文件" : "目录"}</b><span>{failure.failureStage}</span><em>重试 {failure.retryCount}</em></div>
                    <strong title={failure.objectPath}>{failure.objectPath}</strong>
                    <small>{failure.errorSummary}</small>
                  </article>
                ))}
              </div>
            )}
            <p>现有视频记录会继续保留，不会因为本次读取异常而从资料库中自动删除。</p>
            {actionError && <small className="dialog-error">{actionError}</small>}
            <div className="dialog-actions">
              <button onClick={() => setFolderIssueTarget(null)} disabled={actionPending}>关闭</button>
              {onRetryFolderFailures && (
                <button
                  className="primary"
                  aria-label="重试异常项"
                  disabled={actionPending || folderIssueTarget.loading || folderIssueTarget.summary?.totalUnresolved === 0}
                  onClick={() => void runAction(async () => { await onRetryFolderFailures(folderIssueTarget.folder); }).then((retried) => {
                    if (retried) setFolderIssueTarget(null);
                  })}
                >
                  <RotateCw size={14} />重试异常项
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {renameTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setRenameTarget(null); }}>
          <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={submitRename}>
            <h3 id="rename-title">重命名视频</h3>
            <p>扩展名 {renameTarget.extension} 会保持不变</p>
            <label>文件名<input autoFocus value={nextBaseName} onChange={(event) => setNextBaseName(event.target.value)} /></label>
            {actionError && <small className="dialog-error">{actionError}</small>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setRenameTarget(null)} disabled={actionPending}>取消</button>
              <button className="primary" type="submit" disabled={actionPending || !nextBaseName.trim()}>保存</button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setDeleteTarget(null); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <h3 id="delete-title">永久删除视频？</h3>
            <p className="delete-filename">{deleteTarget.filename}</p>
            <p>文件将从磁盘中永久删除，此操作无法撤销。</p>
            {actionError && <small className="dialog-error">{actionError}</small>}
            <div className="dialog-actions">
              <button onClick={() => setDeleteTarget(null)} disabled={actionPending}>取消</button>
              <button className="danger" onClick={() => void confirmDelete()} disabled={actionPending}>永久删除</button>
            </div>
          </section>
        </div>
      )}

      {batchDeleteOpen && (
        <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="batch-delete-title">
          <h3 id="batch-delete-title">确认永久删除选中视频</h3><p>将永久删除 {selectedVideos.length} 个视频，共 {formatBytes(selectedVideos.reduce((total, video) => total + video.sizeBytes, 0))}，此操作无法撤销。</p>
          <div className="dialog-actions"><button onClick={() => setBatchDeleteOpen(false)} disabled={actionPending}>取消</button><button className="danger" onClick={() => void confirmBatchDelete()} disabled={actionPending}>确认永久删除</button></div>
        </section></div>
      )}

      {pendingDeleteClearOpen && (
        <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="pending-delete-clear-title">
          <h3 id="pending-delete-clear-title">确认清空全部待删除视频？</h3>
          <p>将永久删除全部 {pendingDeleteCount} 个待删除视频，共 {formatBytes(pendingDeleteBytes)}。此操作无法撤销。</p>
          {actionError && <small className="dialog-error">{actionError}</small>}
          <div className="dialog-actions"><button onClick={() => setPendingDeleteClearOpen(false)} disabled={actionPending}>取消</button><button className="danger" onClick={() => void confirmDeleteAllPending()} disabled={actionPending}>确认永久删除</button></div>
        </section></div>
      )}

      {batchMovePreview && (
        <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="batch-move-title">
          <h3 id="batch-move-title">确认批量移动</h3><p>{batchMovePreview.totalCount} 个视频将移动到：{batchMovePreview.targetDirectory}</p>
          <p>直接移动 {batchMovePreview.directCount} 个；同名时安全改名 {batchMovePreview.renameCount} 个；已在目标目录跳过 {batchMovePreview.skipCount} 个。不会自动覆盖已有文件。</p>
          {batchMovePreview.targetWillBeAdded && <p>目标目录将同时加入资料库。</p>}
          {batchMovePreview.failures.length > 0 && <p className="dialog-error">有 {batchMovePreview.failures.length} 个文件无法移动，请取消后检查目标目录。</p>}
          <div className="dialog-actions"><button onClick={() => setBatchMovePreview(null)} disabled={actionPending}>取消</button><button className="primary" onClick={() => void confirmBatchMove()} disabled={actionPending || batchMovePreview.failures.length > 0}>确认移动</button></div>
        </section></div>
      )}

      {batchResult && (
        <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="batch-result-title">
          <h3 id="batch-result-title">批量操作结果</h3><p>成功 {batchResult.successCount} 个，失败 {batchResult.failureCount} 个。</p>
          {"reclaimedBytes" in batchResult && <p>实际释放 {formatBytes(batchResult.reclaimedBytes)}。</p>}
          {batchResult.failures.length > 0 && <div className="duplicate-failure-list">{batchResult.failures.map((failure) => <p key={failure.videoId}>{failure.path || failure.videoId}：{failure.message}</p>)}</div>}
          <div className="dialog-actions"><button className="primary" onClick={() => setBatchResult(null)}>知道了</button></div>
        </section></div>
      )}

      {removeFolderTarget && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionPending) setRemoveFolderTarget(null); }}>
          <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-folder-title">
            <h3 id="remove-folder-title">从资料库移除此文件夹？</h3>
            <p className="delete-filename">{removeFolderTarget.path}</p>
            {removeFolderImpact
              ? <p>本地视频文件不会被删除。当前资料库中，预计移除 {removeFolderImpact.removedVideoCount} 条视频记录，另有 {removeFolderImpact.retainedVideoCount} 条记录因仍属于其他已添加目录而保留。</p>
              : <p>正在计算此目录的影响范围……</p>}
            {actionError && <small className="dialog-error">{actionError}</small>}
            <div className="dialog-actions">
              <button onClick={() => setRemoveFolderTarget(null)} disabled={actionPending}>取消</button>
              <button className="danger" onClick={() => void confirmRemoveFolder()} disabled={actionPending || !removeFolderImpact}>从资料库移除</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

interface PaginationBarProps {
  page: number;
  totalPages: number;
  pageSize: (typeof PAGE_SIZE_OPTIONS)[number];
  totalCount: number;
  onPage(page: number): void;
  onPageSize(pageSize: (typeof PAGE_SIZE_OPTIONS)[number]): void;
}

function PaginationBar({ page, totalPages, pageSize, totalCount, onPage, onPageSize }: PaginationBarProps) {
  const [pageDraft, setPageDraft] = useState(String(page));

  useEffect(() => {
    setPageDraft(String(page));
  }, [page]);

  const commitPage = () => {
    const parsedPage = Number(pageDraft);
    if (!Number.isFinite(parsedPage)) {
      setPageDraft(String(page));
      return;
    }
    const nextPage = Math.max(1, Math.min(totalPages, Math.trunc(parsedPage)));
    setPageDraft(String(nextPage));
    onPage(nextPage);
  };

  return (
    <div className="pagination-bar" aria-label="分页">
      <span>共 {totalCount} 个视频</span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <label className="page-jump">
        <input
          aria-label="跳转页码"
          inputMode="numeric"
          value={pageDraft}
          onChange={(event) => setPageDraft(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commitPage}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitPage();
            }
          }}
        />
        <span>/ {totalPages}</span>
      </label>
      <button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>下一页</button>
      <label>
        每页
        <select aria-label="每页视频数量" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}>
          {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  );
}

function readStoredGridCardWidth(): (typeof GRID_CARD_WIDTH_OPTIONS)[number] {
  try {
    const value = Number(window.localStorage.getItem(GRID_CARD_WIDTH_STORAGE_KEY));
    if (GRID_CARD_WIDTH_OPTIONS.includes(value as (typeof GRID_CARD_WIDTH_OPTIONS)[number])) {
      return value as (typeof GRID_CARD_WIDTH_OPTIONS)[number];
    }
  } catch {
    // Fall through to the default when storage is unavailable.
  }
  return 260;
}

function readStoredPageSize(): (typeof PAGE_SIZE_OPTIONS)[number] {
  try {
    const value = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number])) {
      return value as (typeof PAGE_SIZE_OPTIONS)[number];
    }
  } catch {
    // Fall through to the default when storage is unavailable.
  }
  return 100;
}

function readStoredSidebarWidth(): number {
  try {
    const storedValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (storedValue === null) return DEFAULT_SIDEBAR_WIDTH;
    const value = Number(storedValue);
    if (Number.isFinite(value)) return clampSidebarWidth(value);
  } catch {
    // Fall through to the default when storage is unavailable.
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

function folderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).filter(Boolean).at(-1) ?? folderPath;
}

function folderEntryMeta(entry: DirectoryEntry, scanStatus: FolderScanStatus | undefined, isSearchResult: boolean): string {
  if (isSearchResult) return entry.path;
  if (scanStatus) return formatScanStatus(scanStatus);
  if (entry.sourceFolder) return "已添加目录";
  return entry.parentPath ?? entry.path;
}

function getFolderWarning(
  entry: DirectoryEntry,
  scanStatus: FolderScanStatus | undefined
): { message: string; state: "offline" | "error" | "previous" } | null {
  if (scanStatus?.state === "offline") {
    return { message: scanStatus.message?.trim() || "目录目前无法访问，可能是磁盘或网盘暂时离线。", state: "offline" };
  }
  if (scanStatus?.state === "error") {
    return { message: scanStatus.message?.trim() || entry.scanError?.trim() || "目录扫描失败，请检查目录访问状态后重试。", state: "error" };
  }
  if (scanStatus?.state === "completed-with-errors") {
    return { message: scanStatus.message?.trim() || entry.scanError?.trim() || "扫描完成，但仍有尚未解决的异常项。", state: "error" };
  }
  if (scanStatus) {
    // A queued, active, paused, or completed scan supersedes a stale error
    // persisted by an older scan. Do not show both progress and a warning.
    return null;
  }
  if (entry.scanError?.trim()) {
    return { message: entry.scanError.trim(), state: "previous" };
  }
  return null;
}

function formatScanStatus(status: FolderScanStatus): string {
  if (status.state === "queued") return "等待扫描";
  if (status.state === "paused") return `已暂停 ${status.processedFiles}/${status.totalFiles || "?"}`;
  if (status.state === "offline") return "暂时离线 · 可重试";
  if (status.state === "error") return "扫描失败 · 可重试";
  if (status.state === "completed-with-errors") return `扫描完成 · ${status.counters.pendingFailures} 项异常`;
  if (status.state === "completed") return `已完成 ${status.processedFiles}`;
  if (status.mode === "retry-failures") return `正在重试异常 ${status.processedFiles}/${status.totalFiles || "?"}`;
  if (status.phase === "discovering" && status.totalFiles === 0) return "正在读取目录";
  return `已发现 ${status.totalFiles} · 已处理 ${status.processedFiles}`;
}

function formatScanFailureTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function calculateFolderRemovalImpact(target: SourceFolder, folders: SourceFolder[], videos: VideoRecord[]): {
  removedVideoCount: number;
  retainedVideoCount: number;
} {
  const remainingFolders = folders.filter((folder) => folder.id !== target.id);
  let removedVideoCount = 0;
  let retainedVideoCount = 0;

  for (const video of videos) {
    if (!sourceFolderCoversVideo(target, video)) continue;
    if (remainingFolders.some((folder) => sourceFolderCoversVideo(folder, video))) retainedVideoCount += 1;
    else removedVideoCount += 1;
  }

  return { removedVideoCount, retainedVideoCount };
}

function sourceFolderCoversVideo(folder: SourceFolder, video: VideoRecord): boolean {
  return folder.recursive
    ? isPathWithin(video.path, folder.path)
    : normalizeDirectoryPath(video.directory) === normalizeDirectoryPath(folder.path);
}

interface DirectoryEntry {
  path: string;
  depth: number;
  parentPath: string | null;
  hasChildren: boolean;
  hasScanError: boolean;
  scanError: string | null;
  sourceFolder: SourceFolder | null;
}

function buildDirectoryEntries(folders: SourceFolder[], directoryPaths: string[]): DirectoryEntry[] {
  const rootByPath = new Map<string, SourceFolder>();
  const childrenByParent = new Map<string, Set<string>>();

  for (const folder of folders) {
    rootByPath.set(normalizeDirectoryPath(folder.path), folder);
    ensureDirectoryNode(childrenByParent, folder.path);
  }

  for (const directoryPath of directoryPaths) {
    const root = folders.find((folder) => isPathWithin(directoryPath, folder.path));
    if (!root) {
      continue;
    }

    for (const expandedPath of expandDirectoryPath(directoryPath, root.path)) {
      ensureDirectoryNode(childrenByParent, expandedPath);
    }
  }

  const entries: DirectoryEntry[] = [];
  const sortedRoots = getTopLevelRoots(folders);
  const visitedDirectories = new Set<string>();

  for (const folder of sortedRoots) {
    appendDirectoryEntries(folder.path, 0, null, childrenByParent, rootByPath, entries, visitedDirectories);
  }

  return entries;
}

function appendDirectoryEntries(
  directoryPath: string,
  depth: number,
  parentPath: string | null,
  childrenByParent: Map<string, Set<string>>,
  rootByPath: Map<string, SourceFolder>,
  entries: DirectoryEntry[],
  visitedDirectories: Set<string>
): void {
  const normalizedPath = normalizeDirectoryPath(directoryPath);
  if (visitedDirectories.has(normalizedPath)) {
    return;
  }
  visitedDirectories.add(normalizedPath);

  const rootFolder = rootByPath.get(normalizedPath);
  const children = [...(childrenByParent.get(normalizedPath) ?? [])].sort(compareDirectoryPaths);
  entries.push({
    path: directoryPath,
    depth,
    parentPath,
    hasChildren: children.length > 0,
    hasScanError: Boolean(rootFolder?.scanError),
    scanError: rootFolder?.scanError ?? null,
    sourceFolder: rootFolder ?? null
  });
  for (const childPath of children) {
    appendDirectoryEntries(childPath, depth + 1, normalizedPath, childrenByParent, rootByPath, entries, visitedDirectories);
  }
}

function getTopLevelRoots(folders: SourceFolder[]): SourceFolder[] {
  const dedupedRoots: SourceFolder[] = [];
  const seenPaths = new Set<string>();

  for (const folder of [...folders].sort((left, right) => compareDirectoryPaths(left.path, right.path))) {
    const normalizedPath = normalizeDirectoryPath(folder.path);
    if (seenPaths.has(normalizedPath)) {
      continue;
    }

    seenPaths.add(normalizedPath);
    dedupedRoots.push(folder);
  }

  return dedupedRoots.filter((folder) => {
    const normalizedPath = normalizeDirectoryPath(folder.path);
    return !dedupedRoots.some((otherFolder) => {
      const otherNormalizedPath = normalizeDirectoryPath(otherFolder.path);
      return otherNormalizedPath !== normalizedPath && isPathWithin(folder.path, otherFolder.path);
    });
  });
}

function ensureDirectoryNode(childrenByParent: Map<string, Set<string>>, directoryPath: string): void {
  const normalizedPath = normalizeDirectoryPath(directoryPath);
  if (!childrenByParent.has(normalizedPath)) {
    childrenByParent.set(normalizedPath, new Set());
  }

  const parentPath = getParentDirectory(directoryPath);
  if (!parentPath) {
    return;
  }

  const normalizedParentPath = normalizeDirectoryPath(parentPath);
  if (!childrenByParent.has(normalizedParentPath)) {
    childrenByParent.set(normalizedParentPath, new Set());
  }
  childrenByParent.get(normalizedParentPath)?.add(directoryPath);
}

function expandDirectoryPath(directoryPath: string, rootPath: string): string[] {
  const entries: string[] = [];
  let currentPath = directoryPath;

  while (isPathWithin(currentPath, rootPath)) {
    entries.push(currentPath);
    if (normalizeDirectoryPath(currentPath) === normalizeDirectoryPath(rootPath)) {
      break;
    }

    const parentPath = getParentDirectory(currentPath);
    if (!parentPath || normalizeDirectoryPath(parentPath) === normalizeDirectoryPath(currentPath)) {
      break;
    }
    currentPath = parentPath;
  }

  return entries.reverse();
}

function getParentDirectory(directoryPath: string): string | null {
  const normalizedSeparators = directoryPath.replace(/[\\/]+/g, "\\");
  const trimmed = normalizedSeparators.replace(/\\+$/, "");
  const match = /^([A-Za-z]:)$/.exec(trimmed);

  if (match) {
    return null;
  }

  const parentPath = trimmed.replace(/\\[^\\]+$/, "");
  return parentPath && parentPath !== trimmed ? parentPath : null;
}

function isPathWithin(candidatePath: string, parentPath: string): boolean {
  const candidate = normalizeDirectoryPath(candidatePath);
  const parent = normalizeDirectoryPath(parentPath);

  return candidate === parent || candidate.startsWith(`${parent}\\`);
}

function normalizeDirectoryPath(directoryPath: string): string {
  return directoryPath.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function compareDirectoryPaths(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true });
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDirectoryEntryVisible(
  entry: DirectoryEntry,
  expandedFolderPaths: string[],
  directoryEntryByPath: Map<string, DirectoryEntry>
): boolean {
  const expandedPathSet = new Set(expandedFolderPaths);
  let parentPath = entry.parentPath;

  while (parentPath) {
    if (!expandedPathSet.has(parentPath)) {
      return false;
    }
    parentPath = directoryEntryByPath.get(parentPath)?.parentPath ?? null;
  }

  return true;
}

function compareVideos(left: VideoRecord, right: VideoRecord, field: SortField): number {
  if (field === "filename") return left.filename.localeCompare(right.filename, "zh-CN", { numeric: true });
  if (field === "sizeBytes") return left.sizeBytes - right.sizeBytes;
  if (field === "durationMs") return (left.durationMs ?? -1) - (right.durationMs ?? -1);
  return left.modifiedAt.localeCompare(right.modifiedAt);
}

function createStaticDuplicatePage(groups: DuplicateGroup[]): DuplicateGroupPage {
  return {
    groups,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    totalGroups: groups.length,
    totalCandidateGroups: groups.length,
    totalCandidateFiles: groups.reduce((total, group) => total + group.items.length, 0),
    totalReclaimableBytes: groups.reduce((total, group) => total + group.reclaimableBytes, 0),
    directoryOptions: []
  };
}
