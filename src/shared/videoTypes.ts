export const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".wmv", ".m4v", ".ts"] as const;

export const SORT_FIELDS = ["filename", "sizeBytes", "durationMs", "modifiedAt"] as const;
export const DUPLICATE_PAGE_SIZES = [10, 20, 50, 100, 200, 300, 500] as const;

export type SortField = (typeof SORT_FIELDS)[number];
export type DuplicatePageSize = (typeof DUPLICATE_PAGE_SIZES)[number];
export type SortDirection = "asc" | "desc";
export type LibraryView = "all" | "favorites" | "pendingDelete" | "folder" | "recent" | "scanFailures" | "duplicates";
export type ViewMode = "grid" | "table";
export type MetadataStatus = "pending" | "ready" | "failed" | "deferred";
export type CodecProbeStatus = "unprobed" | "ready" | "failed";
export type CacheStatus = "pending" | "ready" | "failed";
export type FingerprintStatus = "pending" | "ready" | "failed";
export type PlaybackPreference = "auto" | "native-first" | "mpv-first";
export type PlaybackRoute = "native" | "mpv";

export interface SourceFolder {
  id: string;
  path: string;
  recursive: boolean;
  enabled: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scanError: string | null;
}

export interface SourceFolderRemovalResult {
  removedVideoCount: number;
  retainedVideoCount: number;
  reassignedVideoCount: number;
}

export interface SourceFolderRemovalPreview {
  removedVideoCount: number;
  retainedVideoCount: number;
}

export type ScanMode = "current-folder" | "retry-failures" | "scan-all";
export type FolderScanState = "queued" | "scanning" | "paused" | "completed" | "completed-with-errors" | "offline" | "error" | "cancelled";
export type ScanFailureStatus = "unresolved" | "retrying" | "resolved";
export type ScanFailureObjectType = "file" | "directory";

export interface DirectorySnapshot {
  sourceFolderId: string;
  directoryPath: string;
  normalizedPath: string;
  parentDirectoryPath: string | null;
  normalizedParentPath: string | null;
  directoryMtime: string;
  directVideoCount: number;
  directChildCount: number;
  directEntryDigest: string;
  lastSuccessfulScanAt: string | null;
  isComplete: boolean;
  hasUnresolvedFailure: boolean;
  updatedAt: string;
}

export interface ScanFailure {
  id: string;
  sourceFolderId: string;
  scanTaskId: string;
  objectType: ScanFailureObjectType;
  objectPath: string;
  normalizedPath: string;
  failureStage: string;
  errorCode: string | null;
  errorSummary: string;
  firstFailedAt: string;
  lastFailedAt: string;
  retryCount: number;
  status: ScanFailureStatus;
  resolvedAt: string | null;
}

export interface ScanFailureSummary {
  sourceFolderId: string;
  failedFileCount: number;
  failedDirectoryCount: number;
  totalUnresolved: number;
  latestError: string | null;
  latestFailedAt: string | null;
  totalRetryCount: number;
}

export type ScanFailureReviewKind = "all" | "video" | "unindexed-file" | "directory";
export type ScanFailureReviewPageSize = 30 | 50 | 100;
export type ScanFailureErrorType = "network" | "permission" | "missing" | "corrupt" | "busy" | "io-error" | "unknown";

export interface ScanFailureReviewItem {
  failure: ScanFailure;
  kind: Exclude<ScanFailureReviewKind, "all">;
  video: VideoRecord | null;
}

export interface ScanFailureReviewQuery {
  sourceFolderId?: string;
  kind: ScanFailureReviewKind;
  page: number;
  pageSize: ScanFailureReviewPageSize;
  errorTypes?: string[];
}

export interface ScanFailureReviewPage {
  items: ScanFailureReviewItem[];
  page: number;
  pageSize: ScanFailureReviewPageSize;
  totalPages: number;
  totalCount: number;
  counts: {
    all: number;
    video: number;
    unindexedFile: number;
    directory: number;
  };
  errorTypeCounts: Record<string, number>;
}

export type ScanFailureCleanupAction = "mark-pending-delete" | "permanent-delete";

export interface ScanFailureCleanupItemResult {
  failureId: string;
  status: "marked" | "deleted" | "skipped" | "failed" | "retried";
  message: string;
}

export interface ScanFailureCleanupResult {
  action: ScanFailureCleanupAction | "retry";
  successCount: number;
  skippedCount: number;
  failureCount: number;
  reclaimedBytes: number;
  items: ScanFailureCleanupItemResult[];
}

export interface ScanFailureBatchActionResult {
  action: "retry" | "delete";
  totalCount: number;
  successCount: number;
  skippedCount: number;
  failureCount: number;
  reclaimedBytes: number;
  items: Array<{ failureId: string; status: "retried" | "deleted" | "skipped" | "failed"; message: string }>;
}

export interface ScanCounters {
  totalFolders: number;
  currentFolderIndex: number;
  completedFolders: number;
  failedFolders: number;
  checkedDirectories: number;
  changedDirectories: number;
  skippedDirectories: number;
  processedVideos: number;
  skippedVideos: number;
  addedVideos: number;
  updatedVideos: number;
  missingVideos: number;
  fileFailures: number;
  directoryFailures: number;
  pendingFailures: number;
  retriedFailures: number;
  resolvedFailures: number;
}

export interface FolderScanStatus {
  folderId: string;
  mode: ScanMode;
  state: FolderScanState;
  phase: "discovering" | "comparing-snapshots" | "processing" | "retrying-failures" | null;
  totalFiles: number;
  processedFiles: number;
  currentPath: string | null;
  message: string | null;
  counters: ScanCounters;
  updatedAt: string;
}

export interface VideoRecord {
  id: string;
  sourceFolderId: string;
  path: string;
  directory: string;
  filename: string;
  basename: string;
  extension: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  videoCodec: string | null;
  videoProfile: string | null;
  pixelFormat: string | null;
  audioCodec: string | null;
  codecProbeStatus: CodecProbeStatus;
  modifiedAt: string;
  importedAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isPendingDelete: boolean;
  isMissing: boolean;
  metadataStatus: MetadataStatus;
  thumbnailStatus: CacheStatus;
  timelinePreviewStatus: CacheStatus;
  coverCachePath: string | null;
  contentFingerprint: string | null;
  fingerprintStatus: FingerprintStatus;
  fingerprintUpdatedAt: string | null;
  fingerprintError: string | null;
}

export interface DuplicateCandidate {
  video: VideoRecord;
  isRecommendedToKeep: boolean;
  keepReason: string | null;
}

export type DuplicateIdentityStatus = "candidate" | "size_duration_match" | "file_versions_current" | "changed" | "failed" | "offline";

export interface DuplicateGroup {
  groupKey: string;
  identityStatus: Extract<DuplicateIdentityStatus, "size_duration_match">;
  items: DuplicateCandidate[];
  recommendedKeepVideoId: string;
  reclaimableBytes: number;
}

export interface DuplicateGroupPageQuery {
  page: number;
  pageSize: DuplicatePageSize;
  sortDirection: SortDirection;
  preferredDirectoryPath?: string;
}

export interface DuplicateDirectoryOption {
  path: string;
  groupCount: number;
  estimatedReclaimableBytes: number;
}

export interface DuplicateGroupPage {
  groups: DuplicateGroup[];
  page: number;
  pageSize: DuplicatePageSize;
  totalPages: number;
  totalGroups: number;
  totalCandidateGroups: number;
  totalCandidateFiles: number;
  totalReclaimableBytes: number;
  directoryOptions: DuplicateDirectoryOption[];
}

export interface DuplicateGroupResolution {
  groupKey: string;
  keepVideoId: string;
  deleteVideoIds: string[];
}

export interface DuplicateResolvePlan {
  groups: DuplicateGroupResolution[];
}

export interface DuplicateResolvePreview {
  verificationStatus: Extract<DuplicateIdentityStatus, "file_versions_current">;
  groupCount: number;
  keepCount: number;
  deleteCount: number;
  reclaimableBytes: number;
}

export type DuplicateResolveChangeType =
  | "missing"
  | "size-changed"
  | "mtime-changed"
  | "size-and-mtime-changed"
  | "unreadable";

export interface DuplicateResolveChangedItem {
  videoId: string;
  filename: string;
  path: string;
  changeType: DuplicateResolveChangeType;
  previousSizeBytes: number;
  currentSizeBytes?: number;
  previousModifiedAt: string;
  currentModifiedAt?: string;
  errorCode?: string;
  message: string;
}

export type DuplicateResolvePreviewResult =
  | { status: "ready"; preview: DuplicateResolvePreview }
  | { status: "stale"; changedItems: DuplicateResolveChangedItem[] };

export interface DuplicateMissingCheckResult {
  checkedFileCount: number;
  removedCount: number;
  changedCount: number;
}

export interface DuplicateResolveFailure {
  groupKey: string;
  videoId: string;
  path: string;
  message: string;
}

export interface DuplicateResolveResult {
  groupCount: number;
  keepCount: number;
  successCount: number;
  failureCount: number;
  reclaimedBytes: number;
  failures: DuplicateResolveFailure[];
}

export type DuplicateCleanupJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "interrupted";

export type DuplicateCleanupItemStatus =
  | "pending"
  | "verifying"
  | "deleting"
  | "deleted"
  | "failed"
  | "skipped"
  | "cancelled";

export type DuplicateCleanupPhase =
  | "verification"
  | "awaiting_confirmation"
  | "deletion"
  | "finished"
  | "legacy_blocked";

export type DuplicateVerificationStatus =
  | "unverified"
  | "pending"
  | "verifying"
  | "verified-identical"
  | "content-different"
  | "unverifiable"
  | "cancelled";

export interface DuplicateCleanupAccepted {
  jobId: string;
  requestId: string;
  status: DuplicateCleanupJobStatus;
  totalGroups: number;
  totalItems: number;
  plannedReclaimableBytes: number;
}

export interface DuplicateCleanupSubmitRequest {
  requestId: string;
  plan: DuplicateResolvePlan;
  sourceView?: string;
}

export interface DuplicateCleanupJob {
  id: string;
  requestId: string;
  status: DuplicateCleanupJobStatus;
  sourceView: string | null;
  totalGroups: number;
  totalItems: number;
  processedItems: number;
  successItems: number;
  failedItems: number;
  skippedItems: number;
  plannedReclaimableBytes: number;
  reclaimedBytes: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  errorSummary: string | null;
  workflowVersion: number;
  phase: DuplicateCleanupPhase;
  verificationRevision: string | null;
  verificationProcessedItems: number;
  identicalItems: number;
  differentItems: number;
  unverifiableItems: number;
  verificationCompletedAt: string | null;
  authorizedRevision: string | null;
  authorizedAt: string | null;
}

export interface DuplicateCleanupItem {
  id: string;
  jobId: string;
  groupKey: string;
  keepVideoId: string;
  deleteVideoId: string;
  filename: string;
  directory: string;
  expectedDeleteSizeBytes: number;
  plannedReclaimableBytes: number;
  status: DuplicateCleanupItemStatus;
  outcomeCode: string | null;
  message: string | null;
  updatedAt: string;
  verificationStatus: DuplicateVerificationStatus;
  verificationRevision: string | null;
  verifiedAt: string | null;
  verificationError: string | null;
  stagedDeletePath?: string | null;
}

export interface DuplicateCleanupConfirmRequest {
  jobId: string;
  verificationRevision: string;
  confirmation: "DELETE";
}

export interface DuplicateCleanupJobPage {
  items: DuplicateCleanupJob[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  activeCount: number;
}

export interface DuplicateCleanupItemPage {
  items: DuplicateCleanupItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface BatchOperationFailure { videoId: string; path: string; message: string; code?: string; }
export interface BatchDeleteResult { successCount: number; failureCount: number; reclaimedBytes: number; failures: BatchOperationFailure[]; }
export interface BatchMovePreview { targetDirectory: string; totalCount: number; directCount: number; renameCount: number; skipCount: number; targetWillBeAdded: boolean; failures: BatchOperationFailure[]; }
export interface BatchMoveItemResult { videoId: string; sourcePath: string; finalPath: string; plan: "direct" | "rename" | "skip"; status: "moved" | "skipped"; }
export interface BatchMoveResult extends BatchMovePreview { successCount: number; failureCount: number; itemResults: BatchMoveItemResult[]; failures: BatchOperationFailure[]; }

export interface TimelinePreview {
  id: string;
  videoId: string;
  timeMs: number;
  cachePath: string;
  createdAt: string;
}

export interface PlayHistoryEntry {
  videoId: string;
  playedAt: string;
  positionMs: number;
}

export interface LibraryQuery {
  view: LibraryView;
  folderId?: string;
  search: string;
  sortField: SortField;
  sortDirection: SortDirection;
  includeMissing: boolean;
}

export type LibraryPageSize = 30 | 50 | 100 | 200 | 300;

export interface LibraryPageQuery {
  view: "all" | "favorites" | "pendingDelete" | "folder" | "recent";
  directoryPath?: string;
  folderScope?: "recursive" | "exact";
  search: string;
  sortField: SortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: LibraryPageSize;
}

export interface LibraryPage {
  videos: VideoRecord[];
  page: number;
  pageSize: LibraryPageSize;
  totalPages: number;
  totalCount: number;
}

export interface LibraryNavigationSnapshot {
  totalVideos: number;
  favoriteVideos: number;
  pendingDeleteVideos: number;
  pendingDeleteBytes: number;
  pendingMetadataVideos: number;
  scanFailureCount: number;
  directoryPaths: string[];
}

export interface AppSettings {
  defaultRecursiveScan: boolean;
  startupSync: boolean;
  autoPlayOnOpen: boolean;
  seekStepSeconds: number;
  coverFrameTimeSeconds: 0 | 3 | 5 | 10 | 15;
  playbackPreference: PlaybackPreference;
  shortcuts: ShortcutSettings;
}

export type ShortcutActionId =
  | "libraryPreviousPage"
  | "libraryNextPage"
  | "playerTogglePlayback"
  | "playerSeekBackward"
  | "playerSeekForward"
  | "playerVolumeUp"
  | "playerVolumeDown"
  | "playerRotateLeft"
  | "playerRotateRight"
  | "playerDelete";

export interface ShortcutSettings {
  libraryPreviousPage: string;
  libraryNextPage: string;
  playerTogglePlayback: string;
  playerSeekBackward: string;
  playerSeekForward: string;
  playerVolumeUp: string;
  playerVolumeDown: string;
  playerRotateLeft: string;
  playerRotateRight: string;
  playerDelete: string;
}

export interface SettingsSnapshot {
  settings: AppSettings;
  cacheLocation: string;
  cacheStatus: MediaCacheStatus;
}

export interface MediaCacheStatus {
  totalBytes: number;
  coverBytes: number;
  timelineBytes: number;
  itemCount: number;
  maxBytes: number;
  automaticCleanup: true;
  lastMaintenanceAt: string | null;
  lastCleanup: {
    reason: "startup" | "automatic" | "manual";
    removedCount: number;
    reclaimedBytes: number;
    failureCount: number;
  } | null;
}

export interface MediaCacheCleanupResult {
  removedCount: number;
  reclaimedBytes: number;
  failures: Array<{ cachePath: string; message: string }>;
  status: MediaCacheStatus;
}

export interface DiagnosticsPreview {
  generatedAt: string;
  includeFullPaths: boolean;
  contents: string[];
  environment: {
    appVersion: string;
    platform: string;
    arch: string;
    osRelease: string;
    nodeVersion: string;
    electronVersion: string;
    nodeModuleVersion: string;
    schemaVersion: number;
    packaged: boolean;
  };
  checks: Array<{
    id: string;
    status: "ok" | "warning" | "error";
    detail: string;
  }>;
  logEntryCount: number;
  paths?: {
    userData: string;
    database: string;
    cache: string;
    logs: string;
  };
  exclusions: string[];
}

export interface DiagnosticsExportResult {
  exported: boolean;
  filePath?: string;
}

export const MAX_PLAYER_QUEUE_ITEMS = 300;

export type DomainEvent =
  | { sequence: number; type: "video:updated"; videoIds: string[] }
  | { sequence: number; type: "video:removed"; videoIds: string[] }
  | { sequence: number; type: "favorite:changed"; videoIds: string[] }
  | { sequence: number; type: "playback:changed"; videoIds: string[] }
  | { sequence: number; type: "settings:changed"; videoIds: string[] }
  | { sequence: number; type: "source-folder:updated"; videoIds: string[] }
  | { sequence: number; type: "library:rescanned"; videoIds: string[] }
  | { sequence: number; type: "duplicate-cleanup:changed"; videoIds: string[]; jobId: string };

export type DomainEventInput =
  | { type: "video:updated"; videoIds: string[] }
  | { type: "video:removed"; videoIds: string[] }
  | { type: "favorite:changed"; videoIds: string[] }
  | { type: "playback:changed"; videoIds: string[] }
  | { type: "settings:changed"; videoIds: string[] }
  | { type: "source-folder:updated"; videoIds: string[] }
  | { type: "library:rescanned"; videoIds: string[] }
  | { type: "duplicate-cleanup:changed"; videoIds: string[]; jobId: string };

export interface PlayerSessionSnapshot {
  sequence: number;
  selectedVideoId: string;
  queueIds: string[];
  videos: VideoRecord[];
}

export interface WindowSyncSnapshot {
  sequence: number;
  playerSession: PlayerSessionSnapshot | null;
}

export const IPC_CHANNELS = {
  libraryList: "library:list",
  libraryPage: "library:page",
  libraryNavigation: "library:navigation",
  libraryMissingList: "library:missing-list",
  videoListByIds: "video:list-by-ids",
  folderList: "folder:list",
  folderAdd: "folder:add",
  folderScan: "folder:scan",
  folderScanAll: "folder:scan-all",
  folderScanFailuresRetry: "folder-scan-failures:retry",
  folderScanFailureSummary: "folder-scan-failures:summary",
  folderScanFailureList: "folder-scan-failures:list",
  scanFailureReviewPage: "scan-failure-review:page",
  scanFailureReviewRetry: "scan-failure-review:retry",
  scanFailureReviewDelete: "scan-failure-review:delete",
  scanFailureReviewCleanup: "scan-failure-review:cleanup",
  scanFailureReviewOpen: "scan-failure-review:open",
  scanFailureReviewBatchRetry: "scan-failure-review:batch-retry",
  scanFailureReviewBatchDelete: "scan-failure-review:batch-delete",
  folderRemove: "folder:remove",
  folderRemovePreview: "folder:remove-preview",
  folderScanStatusList: "folder-scan-status:list",
  folderScanPause: "folder-scan:pause",
  folderScanResume: "folder-scan:resume",
  duplicateList: "duplicate:list",
  duplicatePreviewResolve: "duplicate:preview-resolve",
  duplicateFastDelete: "duplicate:fast-delete",
  duplicateCheckMissing: "duplicate:check-missing",
  duplicateCleanupSubmit: "duplicate-cleanup:submit",
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
} as const;

export interface VideoManagerApi {
  listVideos(query: LibraryQuery): Promise<VideoRecord[]>;
  listVideoPage(query: LibraryPageQuery): Promise<LibraryPage>;
  getLibraryNavigation(): Promise<LibraryNavigationSnapshot>;
  listMissingVideos(): Promise<VideoRecord[]>;
  listVideosByIds(videoIds: string[]): Promise<VideoRecord[]>;
  listDuplicateGroups(query: DuplicateGroupPageQuery): Promise<DuplicateGroupPage>;
  previewDuplicateResolve(plan: DuplicateResolvePlan): Promise<DuplicateResolvePreviewResult>;
  fastDeleteDuplicateCandidates(plan: DuplicateResolvePlan): Promise<DuplicateResolveResult>;
  checkDuplicateMissing(plan: DuplicateResolvePlan): Promise<DuplicateMissingCheckResult>;
  submitDuplicateCleanup(request: DuplicateCleanupSubmitRequest): Promise<DuplicateCleanupAccepted>;
  confirmDuplicateCleanup(request: DuplicateCleanupConfirmRequest): Promise<DuplicateCleanupJob>;
  listDuplicateCleanupJobs(page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupJobPage>;
  getDuplicateCleanupJob(jobId: string): Promise<DuplicateCleanupJob>;
  listDuplicateCleanupItems(jobId: string, page: number, pageSize: 20 | 50 | 100): Promise<DuplicateCleanupItemPage>;
  cancelDuplicateCleanup(jobId: string): Promise<DuplicateCleanupJob>;
  resumeDuplicateCleanup(jobId: string): Promise<DuplicateCleanupJob>;
  retryDuplicateCleanup(jobId: string): Promise<DuplicateCleanupJob>;
  clearDuplicateCleanup(jobId: string): Promise<boolean>;
  openDuplicateCleanupItem(itemId: string): Promise<boolean>;
  listFolders(): Promise<SourceFolder[]>;
  addFolder(): Promise<SourceFolder | null>;
  scanFolder(folderId: string): Promise<boolean>;
  scanAllFolders(): Promise<boolean>;
  retryScanFailures(folderId: string): Promise<boolean>;
  getScanFailureSummary(folderId: string): Promise<ScanFailureSummary>;
  listScanFailures(folderId: string): Promise<ScanFailure[]>;
  listScanFailureReviewPage(query: ScanFailureReviewQuery): Promise<ScanFailureReviewPage>;
  retryScanFailure(failureId: string): Promise<boolean>;
  deleteScanFailureFile(failureId: string): Promise<boolean>;
  cleanupScanFailures(failureIds: string[], action: ScanFailureCleanupAction): Promise<ScanFailureCleanupResult>;
  openScanFailureLocation(failureId: string): Promise<boolean>;
  batchRetryScanFailures(failureIds: string[]): Promise<ScanFailureBatchActionResult>;
  batchDeleteScanFailures(failureIds: string[]): Promise<ScanFailureBatchActionResult>;
  removeFolder(folderId: string): Promise<SourceFolderRemovalResult>;
  previewRemoveFolder(folderId: string): Promise<SourceFolderRemovalPreview>;
  listFolderScanStatuses(): Promise<FolderScanStatus[]>;
  pauseFolderScan(folderId: string): Promise<boolean>;
  resumeFolderScan(folderId: string): Promise<boolean>;
  revealVideoInFolder(videoId: string): Promise<boolean>;
  setFavorite(videoId: string, favorite: boolean): Promise<boolean>;
  setPendingDelete(videoId: string, pendingDelete: boolean): Promise<boolean>;
  deletePendingVideos(): Promise<BatchDeleteResult>;
  renameVideo(videoId: string, baseName: string): Promise<VideoRecord>;
  deleteVideo(videoId: string): Promise<boolean>;
  deleteVideos(videoIds: string[]): Promise<BatchDeleteResult>;
  chooseMoveDestination(): Promise<string | null>;
  previewMoveVideos(videoIds: string[], targetDirectory: string, addTargetToLibrary: boolean): Promise<BatchMovePreview>;
  moveVideos(videoIds: string[], targetDirectory: string, addTargetToLibrary: boolean): Promise<BatchMoveResult>;
  forgetVideo(videoId: string): Promise<boolean>;
  regenerateCover(videoId: string): Promise<VideoRecord>;
  retryMetadata(videoId: string): Promise<VideoRecord>;
  openPlayer(videoId: string, queueIds: string[]): Promise<boolean>;
  playExternalVideo(videoId: string): Promise<boolean>;
  listPlayHistory(): Promise<PlayHistoryEntry[]>;
  recordPlayback(videoId: string, positionMs?: number): Promise<boolean>;
  getWindowSyncSnapshot(): Promise<WindowSyncSnapshot>;
  setPlayerSession(videoId: string, queueIds: string[]): Promise<PlayerSessionSnapshot>;
  selectPlayerVideo(videoId: string): Promise<PlayerSessionSnapshot>;
  subscribeDomainEvents(listener: (event: DomainEvent) => void): () => void;
  previewDiagnostics(includeFullPaths: boolean): Promise<DiagnosticsPreview>;
  exportDiagnostics(includeFullPaths: boolean): Promise<DiagnosticsExportResult>;
  getSettings(): Promise<SettingsSnapshot>;
  setSettings(settings: AppSettings): Promise<AppSettings>;
  clearCache(): Promise<MediaCacheCleanupResult>;
}

export function isVideoExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
