---
date: 2026-08-21
branch: ai/clouddrive-perf-batch1
type: feat
status: partial
---

# CloudDrive2 网盘访问加速 · 批次 2 + 3

## Context

在批次 1（ffprobe 收紧 + CloseFileReader + HTTP/2 keepalive）基础上，继续推进 CloudDrive2 性能优化：

- **批次 2**：通过 `PrefetchFileRanges` / `CancelFilePrefetch` RPC 在播放、拖动、切集、缩略图场景下预取云端字节，减少起播和 seek 等待。
- **批次 3**：引入令牌桶限流器防止 115 网盘 API 超频（QPS≈4），补齐 CloudDriveFile 完整字段解码，为后续并行遍历和 UI 消费只读标记做准备。

目标网盘 115：CloudDrive2 报告的上限为 `maxDownloadThreads=2`、`maxQueriesPerSecond≈5`。

## Changes — 批次 2：预取

### `src/main/clouddrive/grpcClient.ts`

- 新增 `ByteRange`、`HintPriority`、`PrefetchHint` 类型和 `HINT_PRIORITY` 常量（LOW=0, NORMAL=1, HIGH=2）。
- 新增 `prefetchFileRanges(remotePath, ranges, priority, options?, isCancelled?)` 方法：
  - 编码 `PrefetchFileRangesRequest`（path=1, repeated ByteRange=2, priority=3, hint_id=4, ttl_seconds=5, replace_existing=6）。
  - 解码返回的 `hint_id`、`accepted_range_count`、`rejected_range_count`。
- 新增 `cancelFilePrefetch(remotePath, hintIds?, isCancelled?)` 方法：
  - hintIds 为空/省略时取消该路径全部 hint。
- 新增 `RPC_TIMEOUTS.prefetchFileRanges` 和 `cancelFilePrefetch`（首包 5s / idle 5s，与 CloseFileReader 同级）。

### `src/main/clouddrive/prefetchManager.ts`（新文件）

`CloudDrivePrefetchManager` 类，提供四个场景化方法：

| 方法 | 触发时机 | 优先级 | 字节范围 |
|------|---------|--------|---------|
| `onPlaybackStart(filePath, previousFilePath?)` | 播放开始/切集 | HIGH（replaceExisting=true） | 文件开头 8 MiB |
| `onSeek(filePath, byteOffset, fileSize?)` | 用户拖动进度条 | HIGH（replaceExisting=true） | 目标位置起 8 MiB，自动 clamp 到文件尾 |
| `onNextEpisodeKnown(nextFilePath)` | 打开播放列表/上一集播放中 | NORMAL | 下一集开头 4 MiB |
| `onThumbnailBatch(filePath, ranges)` | 批量缩略图/时间轴帧 | LOW | 调用方指定 |

特性：
- 通过 `isCloudDrivePath()` 过滤，本地文件直接跳过。
- 每个文件最多保留 4 个活跃 hint（Map<filePath, ActiveHint[]>），避免洪水。
- TTL 60 秒。
- `cancelAll(filePath)` / `cancelAllFiles()` 用于切集和应用退出。
- 所有方法 fire-and-forget，永不抛出异常。

### `src/main/media/mediaProtocol.ts`

- 新增可选参数 `onVideoByteRange?: VideoPrefetchHook`。
- 在处理 `local-video://media/<id>` Range 请求时，解析 Range 头并调用 hook，传入 `(filePath, startByte, fileSize)`。
- 全屏/无 Range 请求时从 byte 0 预取。

### `src/main/playerWindow.ts`

- 新增可选构造参数 `onPrefetch?: PlaybackPrefetchHook`。
- `setSession()`（播放开始）和 `select()`（切集）后调用 `firePrefetch()`：
  - 当前文件路径 + 队列中下一集路径（通过 `repo.getVideo()` 解析）。
  - 以 reason 区分 "start" vs "select"。

### `src/main/index.ts`

- 实例化 `CloudDrivePrefetchManager`。
- 注入 PlayerWindowCoordinator：当前文件 `onPlaybackStart()`，下一集 `onNextEpisodeKnown()`，切集额外 `onSeek(0)`。
- 注入 registerMediaProtocol：Range 请求时调用 `cloudPrefetch.onSeek()`。
- `before-quit` 时调用 `cancelAllFiles()`。

## Changes — 批次 3：限流 + 字段补全

### `src/main/clouddrive/rateLimiter.ts`（新文件）

`CloudDriveRateLimiter` 令牌桶限流器：

- 构造参数 `queriesPerSecond` 和 `burstSize`（默认 1）。
- QPS ≤ 0 表示不限流（acquire 立即返回）。
- `acquire()` 异步等待一个令牌；FIFO 队列保证公平。
- `run(fn)` 获取令牌后执行函数。
- 内部 `setInterval` 在有待处理请求时运行，无等待者时自动停止（`unref()` 不阻止进程退出）。
- `close()` 释放定时器并 resolve 所有等待者。
- 默认常量：`DEFAULT_115_QPS_LIMIT = 4`、`DEFAULT_CLOUD_DIR_CONCURRENCY = 2`。

### `src/main/clouddrive/grpcClient.ts`

- `CloudDriveGrpcClientOptions` 新增可选 `rateLimiter: { acquire(): Promise<void> }`。
- `serverStream()` 在发送前 `await rateLimiter.acquire()`，取消后再次检查 `isCancelled`。
- `CloudDriveFileEntry` 接口扩展字段：
  - `accessTime: string | null`（field 8）
  - `thumbnailUrl: string`（field 10）
  - `previewUrl: string`（field 11）
  - `isForbidden: boolean`（field 36）
  - `canDirectAccessThumbnailURL: boolean`（field 62）
  - `hasDetailProperties: boolean`（field 64）
  - `dirCacheTimeToLiveSecs: number`（field 68）
  - `readOnly: boolean`（field 80）
- `decodeCloudDriveFile()` 完整解析上述字段，未知字段仍 `skip()` 保持前向兼容。

### `src/main/clouddrive/mountedScanner.ts`

- 新增导入 `CloudDriveRateLimiter`。
- `CloudDriveEnvironmentConfig` 新增 `qpsLimit` 字段。
- `readEnvironmentConfig()` 读取 `LOCAL_VIDEO_MANAGER_CLOUDDRIVE_QPS` 环境变量，默认 4。
- `getSharedClient()` 在 client key 中包含 qpsLimit；配置变化时 `sharedRateLimiter?.close()` 后重建。
- 新增 `tryPrefetchFileRanges()` 和 `tryCancelFilePrefetch()` 高级辅助函数：本地路径→远程路径解析后调用 gRPC，永不抛出。
- 新增内部 `resolveRemotePath()` 和 `getMountPointsForHint()` 复用挂载点映射逻辑。

### `src/main/clouddrive/protobuf.ts`

- 新增编码辅助函数：`encodeUInt32Field`、`encodeUInt64Field`、`encodeMessageField`、`encodeBytesField`，用于构造预取请求消息。

## Verification

| 检查项 | 结果 |
|--------|------|
| TypeScript 类型检查（node + web） | **PASS** |
| 完整构建（tsc node + tsc web + vite build） | **PASS**（dist-renderer 292KB JS + 49KB CSS，1.49s） |
| CloudDrive gRPC client 测试 | **14/14 PASS**（含 3 个预取测试 + 1 个限流集成 + 1 个扩展字段） |
| PrefetchManager 测试 | **11/11 PASS** |
| RateLimiter 测试 | **7/7 PASS** |
| 所有受影响现有测试（8 个文件） | **63/63 PASS** |
| 批次 1 聚焦测试 | **41/41 PASS**（回归无破坏） |
| Windows files release gate | **37/37 PASS** |
| Migrations release gate | **32/32 PASS** |

### 未完成 / 待 QA

1. **实际 115 网盘验证**：所有 gRPC 调用均通过 mock HTTP/2 服务器测试，未在真实 CloudDrive2+115 环境验证预取效果和限流器行为。
2. **Git commit/push**：当前分支无 commit 历史（git remote refs 损坏 + 网络 SSL 问题），需在网络恢复后提交。
3. **批次 3 后续项**（未在本批次实现）：
   - 并行目录遍历（当前仍串行深度优先）
   - 有界元数据队列
   - 从 GetConfig 动态读取 QPS/线程上限
   - 大目录（≥10万条目）压测基线

## Risks and Follow-up

- 预取 hint 是 advisory 语义，CloudDrive2 可能根据缓存状态和线程负载拒绝或忽略部分范围。`rejected_range_count` 已在返回值中解码但当前未记录日志，后续可加入诊断。
- 限流器是单进程本地的，不与其他 CloudDrive2 客户端协调。如果用户同时在使用 CloudDrive2 官方客户端或其他工具，实际 QPS 可能叠加。
- `onSeek` 预取在每次 Range 请求时触发，Chromium 的 `<video>` 元素可能在拖动过程中发起多个 Range 请求。`replaceExisting: true` 确保同一时间只有一个 seek hint 存活，但 hint 注册的 RPC 本身也计入 QPS 限流。如果拖动频率很高（每秒多次），限流器会自然排队。
