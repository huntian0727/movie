# UI 增量优化 V1 数据接口设计

## 设计范围

本文定义 `AssetCenterPage` 与 `PlaybackDiagnosticPage` 的建议只读 DTO 和 IPC 契约。所有接口均为后续开发建议，本次没有修改 `src/shared/videoTypes.ts`、preload、IPC、repository 或数据库。

设计遵循现有调用链：

```text
React page
  → window.videoManager (sandboxed preload)
  → typed IPC + Zod validation
  → repository / read-only service
  → SQLite 或显式按需 media probe
```

## 可直接复用的现有接口

| 现有接口 | 用途 | 限制 |
| --- | --- | --- |
| `getLibraryNavigation()` | 顶部视频数、待删除、元数据 pending、扫描异常 | 没有总容量、missing、failed、来源健康和最近扫描；含完整 `directoryPaths`，不适合作为资产中心主接口 |
| `listFolders()` | 来源基础信息及部分统计 | 大量来源时返回全集，不适合资产中心表格 |
| `listFolderScanStatuses()` | 当前内存扫描状态 | 不提供持久化的最近扫描历史 |
| `listPlayHistory()` | 最近播放记录 | 最多是每个视频一条最近位置，不是播放次数或失败记录 |
| `listVideoPage()` | 诊断页视频搜索 | 应使用小分页，不加载封面 |
| `listVideosByIds()` | 最近播放 ID 映射为视频 | 已限制最多 300 个 ID |
| `getSettings()` | 当前播放偏好 | 返回缓存状态等额外信息，但数据量固定 |
| `playExternalVideo()` / `openPlayer()` | 诊断页播放操作 | 必须继续复用，不能复制播放实现 |
| `revealVideoInFolder()` | 定位本地文件 | 必须以 `videoId` 调用 |

## Asset Center 类型

```ts
export type AssetHealthStatus = "healthy" | "attention" | "critical" | "unknown";

export interface AssetCenterOverview {
  generatedAt: string;
  revision: number;
  health: {
    status: AssetHealthStatus;
    primaryIssueCode: string | null;
    primaryIssueText: string | null;
  };
  library: {
    activeVideoCount: number;
    activeSizeBytes: number;
    missingVideoCount: number;
    favoriteVideoCount: number;
    pendingDeleteVideoCount: number;
    pendingDeleteBytes: number;
  };
  sources: {
    totalCount: number;
    enabledCount: number;
    localCount: number;
    cloudDriveCount: number;
    readOnlyCount: number;
    healthyCount: number;
    warningCount: number;
    errorCount: number;
    latestSuccessfulScanAt: string | null;
  };
  metadata: {
    readyCount: number;
    pendingCount: number;
    failedCount: number;
    codecReadyCount: number;
    codecUnprobedCount: number;
    codecFailedCount: number;
    thumbnailReadyCount: number;
    thumbnailPendingCount: number;
    thumbnailFailedCount: number;
  };
  scan: {
    queuedCount: number;
    runningCount: number;
    pausedCount: number;
    unresolvedFailureCount: number;
    lastTask: AssetScanTaskSummary | null;
  };
  playback: {
    trackedVideoCount: number;
    latestPlayedAt: string | null;
    failureStatisticsAvailable: false;
  };
}

export interface AssetScanTaskSummary {
  id: string;
  sourceFolderId: string | null;
  mode: ScanMode;
  status: string;
  startedAt: string;
  completedAt: string | null;
  counters: Partial<ScanCounters>;
  errorSummary: string | null;
}
```

`revision` 是进程内资料库修订号或等价失效标识，不要求新增数据库字段。它用于丢弃迟到响应和复用内存快照。

### 来源分页

```ts
export type AssetSourceHealthFilter = "all" | "healthy" | "warning" | "error" | "disabled";
export type AssetSourceHealthStatus = "healthy" | "warning" | "error" | "disabled";
export type AssetSourceSortField = "path" | "videoCount" | "sizeBytes" | "lastScannedAt" | "failureCount";

export interface AssetSourcePageQuery {
  search: string;
  health: AssetSourceHealthFilter;
  providerType?: MediaSourceType;
  sortField: AssetSourceSortField;
  sortDirection: SortDirection;
  page: number;
  pageSize: 30 | 50 | 100;
}

export interface AssetSourceSummary {
  id: string;
  path: string;
  enabled: boolean;
  providerType: MediaSourceType;
  providerName: string | null;
  providerReadOnly: boolean;
  videoCount: number;
  sizeBytes: number;
  missingVideoCount: number;
  pendingMetadataCount: number;
  failedMetadataCount: number;
  unresolvedFailureCount: number;
  lastScannedAt: string | null;
  scanError: string | null;
  health: AssetSourceHealthStatus;
}

export interface AssetSourcePage {
  items: AssetSourceSummary[];
  page: number;
  pageSize: 30 | 50 | 100;
  totalPages: number;
  totalCount: number;
}
```

### 容量分布

```ts
export type AssetBreakdownDimension = "providerType" | "extension" | "videoCodec";

export interface AssetBreakdownQuery {
  dimension: AssetBreakdownDimension;
  limit: 5 | 8 | 12;
}

export interface AssetBreakdownItem {
  key: string;
  label: string;
  videoCount: number;
  sizeBytes: number;
}

export interface AssetBreakdown {
  generatedAt: string;
  dimension: AssetBreakdownDimension;
  items: AssetBreakdownItem[];
  other: { videoCount: number; sizeBytes: number } | null;
}
```

## Playback Diagnostic 类型

```ts
export type PlaybackAssessmentStatus =
  | "native-recommended"
  | "mpv-recommended"
  | "insufficient-metadata"
  | "missing"
  | "unreadable";

export type DiagnosticConfidence = "high" | "medium" | "low" | "unknown";
export type DiagnosticDataOrigin = "library-cache" | "on-demand-probe";

export interface PlaybackDiagnosticRequest {
  videoId: string;
}

export interface PlaybackDiagnosticSnapshot {
  generatedAt: string;
  videoId: string;
  fileVersion: {
    sizeBytes: number;
    modifiedAt: string;
  };
  file: {
    filename: string;
    path: string;
    directory: string;
    extension: string;
    sizeBytes: number;
    modifiedAt: string;
    isMissing: boolean;
    sourceFolderId: string;
    providerType: MediaSourceType;
    providerName: string | null;
    hasRemoteIdentity: boolean;
  };
  video: {
    format: string | null;
    durationMs: number | null;
    durationSource: DurationSource;
    width: number | null;
    height: number | null;
    codec: string | null;
    profile: string | null;
    pixelFormat: string | null;
    metadataStatus: MetadataStatus;
    codecProbeStatus: CodecProbeStatus;
  };
  audio: {
    primaryCodec: string | null;
    streamDetailsAvailable: boolean;
  };
  assessment: PlaybackAssessment;
  availability: {
    hdr: "available" | "not-collected";
    audioDetails: "available" | "not-collected";
    subtitles: "available" | "not-collected";
    hardwareDecode: "not-tested";
    playbackFailures: "not-recorded";
  };
  origin: DiagnosticDataOrigin;
}

export interface PlaybackAssessment {
  status: PlaybackAssessmentStatus;
  recommendedRoute: PlaybackRoute | null;
  preference: PlaybackPreference;
  confidence: DiagnosticConfidence;
  reasonCode: string;
  reasonText: string;
  evidence: Array<{
    key: string;
    label: string;
    value: string;
    effect: "supports" | "opposes" | "neutral" | "unknown";
  }>;
  recommendations: Array<{
    code: string;
    priority: "primary" | "secondary" | "info";
    text: string;
    action: "play-current" | "play-mpv" | "probe-details" | "retry-metadata" | "open-scan-failure" | null;
  }>;
}
```

主进程生成 `assessment`，renderer 只负责展示。这样播放器、诊断页和未来测试共用一套解释结果；现有 `choosePlaybackRoute` 仍是最终路由依据，V1 不改变其行为。

## 按需深度检测类型

```ts
export type PlaybackProbeJobStatus = "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "stale";

export interface PlaybackProbeSubmitRequest {
  videoId: string;
  scope: "media-streams";
}

export interface PlaybackProbeAccepted {
  jobId: string;
  videoId: string;
  status: "queued" | "running";
}

export interface PlaybackProbeJob {
  id: string;
  videoId: string;
  status: PlaybackProbeJobStatus;
  phase: "waiting" | "opening" | "probing" | "mapping" | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  result: PlaybackProbeResult | null;
}

export interface PlaybackProbeResult {
  origin: "on-demand-probe";
  probedAt: string;
  fileVersion: { sizeBytes: number; modifiedAt: string };
  container: { format: string | null; durationMs: number | null; bitRate: number | null };
  videoStreams: PlaybackVideoStream[];
  audioStreams: PlaybackAudioStream[];
  subtitleStreams: PlaybackSubtitleStream[];
}
```

Stream DTO 只保留 UI 使用的字段，并设置硬上限，例如每类最多 32 条、标签键值最多 32 组、单个字符串最多 512 字符。详细 ffprobe 映射字段在实现任务中单独冻结，避免现在过早绑定 ffprobe 原始结构。

## 建议 API

```ts
export interface VideoManagerApi {
  // Asset Center: database-only, read-only
  getAssetCenterOverview(): Promise<AssetCenterOverview>;
  listAssetCenterSources(query: AssetSourcePageQuery): Promise<AssetSourcePage>;
  getAssetCenterBreakdown(query: AssetBreakdownQuery): Promise<AssetBreakdown>;

  // Playback Diagnostic: first call is database-only
  getPlaybackDiagnostic(request: PlaybackDiagnosticRequest): Promise<PlaybackDiagnosticSnapshot>;
  submitPlaybackProbe(request: PlaybackProbeSubmitRequest): Promise<PlaybackProbeAccepted>;
  getPlaybackProbe(jobId: string): Promise<PlaybackProbeJob>;
  cancelPlaybackProbe(jobId: string): Promise<PlaybackProbeJob>;
}
```

建议 IPC channel：

- `asset-center:overview`
- `asset-center:sources`
- `asset-center:breakdown`
- `playback-diagnostic:get`
- `playback-probe:submit`
- `playback-probe:get`
- `playback-probe:cancel`

## 输入验证和权限

- 所有 query 使用 `.strict()` Zod schema。
- `page >= 1`，`pageSize` 只能取联合值，`search` 限制长度并 trim。
- `videoId`、`jobId` 必须为非空且有最大长度；不接受 renderer 传入文件路径。
- 所有新通道加入 `src/main/preload.cts` 的静态映射、`VideoManagerApi` 类型和 `src/main/security.ts` 的允许列表。
- 资产中心通道仅允许主资料库窗口调用。
- 快速诊断允许主窗口和播放器窗口调用；深度探测是否允许播放器窗口发起应在实现前明确，推荐先只允许主窗口。

## Repository 与 Service 边界

### Repository

建议在 `VideoRepository` 增加只读方法：

- `getAssetCenterOverviewRows()`
- `listAssetSourceSummaries(query)`
- `getAssetBreakdown(query)`
- `getLatestScanTaskSummary()`
- `getPlaybackDiagnosticBase(videoId)`

Repository 只负责 SQL、行映射和数据库口径，不负责 UI 文案、播放建议或 ffprobe。

### Service

- `AssetCenterService`：合并数据库聚合与 `ScanManager` 当前内存状态，计算 health，维护短时内存快照。
- `PlaybackDiagnosticService`：读取单个视频和来源、调用现有播放路由规则并生成解释；管理按需 probe job。
- 两个 service 都不得修改扫描器、文件或视频记录。

## 数据库策略

V1 不需要数据库迁移：

- 资产指标由现有 `videos`、`source_folders`、`scan_failures`、`scan_tasks`、`play_history` 聚合。
- 快速播放诊断由现有 `videos` 和 `source_folders` 提供。
- 深度探测结果先保存在有界内存缓存，键为 `videoId + sizeBytes + modifiedAt`。

只有以下后续需求才需要独立评审数据库字段：

- 跨重启保留完整流信息或 HDR/字幕信息。
- 统计真实播放启动失败、解码失败和回退结果。
- 保存设备/GPU/驱动能力测试历史。

这些数据应使用新表并绑定文件版本，不建议继续扩宽 `videos` 主表。

## 查询和缓存要求

- Overview 通过少量聚合 SQL 返回一行或固定行数；不得 `SELECT *` 后在 TypeScript 汇总。
- 来源列表服务端分页，count 与当前页分开执行；禁止复用返回全部来源的接口。
- breakdown 在 SQL 中聚合并 `LIMIT`，其余项在 SQL 或 service 层汇总。
- `AssetCenterService` 缓存最近成功快照，并由 Domain Event 只做失效标记；页面可见时再合并刷新。
- Playback 快速诊断按单个 `videoId` 查询；深度结果缓存必须进行文件版本比较。
- IPC 响应不能包含 SQLite 行对象、任意异常栈、环境变量、CloudDrive token 或完整 ffprobe JSON。

## 错误模型

建议所有新接口使用可辨别错误码，并由 IPC 包装层转换为用户文案：

| 错误码 | 含义 | UI 行为 |
| --- | --- | --- |
| `VIDEO_NOT_FOUND` | 记录不存在或已移除 | 显示未找到并关闭操作按钮 |
| `VIDEO_MISSING` | 记录明确标记缺失 | 展示缓存诊断，禁用直接探测 |
| `SOURCE_UNAVAILABLE` | 来源当前不可访问 | 保留缓存结果，允许稍后重试 |
| `PROBE_TIMEOUT` | 深度检测超时 | 显示失败，不修改资料库状态 |
| `PROBE_CANCELLED` | 用户取消 | 回到快速诊断 |
| `FILE_VERSION_CHANGED` | 检测前后版本不一致 | 丢弃深度结果并标记 stale |
| `ASSET_SNAPSHOT_FAILED` | 聚合读取失败 | 保留最近成功快照并局部报错 |

## 实现顺序

1. 冻结本文 DTO、指标口径和 Zod schema。
2. 实现并测试 Asset Center repository 聚合和分页。
3. 接入 Asset Center IPC/preload，再实现页面组件。
4. 实现快速 Playback Diagnostic，只使用数据库缓存和现有路由规则。
5. 接入详情页、播放器和侧边栏入口。
6. 最后独立实现可取消的深度 probe job；它不应阻塞前四步上线。

## 接口验收重点

- 资产中心首屏没有 O(N) DTO 传输或挂载盘 I/O。
- 诊断快速接口没有视频文件读取。
- 所有“未知”都有显式状态，不以 `null` 隐含“没有”。
- 相同文件版本才能复用深度检测结果。
- IPC 权限、Zod 输入、响应大小和任务取消均有测试。
