# Backlog: CloudDrive2 性能优化后续批次

> 本文件登记批次 2/3/4 的待办，等上一批在主干稳定后再依次创建 task packet。目标网盘为 115；CloudDrive2 报告的有效上限 `maxDownloadThreads=2`、`maxQueriesPerSecond≈5` 必须作为默认值，并允许运行时按 GetConfig 返回动态收紧。

## 批次 1 · 已完成 · ffprobe 收紧 + CloseFileReader + HTTP/2 keepalive

- 交付记录：`docs/ai/deliveries/2026-08-21-clouddrive-perf-batch1.md`
- 状态：代码完成，typecheck/build/聚焦测试通过。待实际 115 网盘 QA 验证 + git commit/push。

## 批次 2 · 已完成 · PrefetchFileRanges 播放加速

- 范围：在 grpcClient 中新增 `prefetchFileRanges`/`cancelFilePrefetch` RPC 方法；新增 `CloudDrivePrefetchManager` 类管理播放/seek/下一集/缩略图预取生命周期；接入 `mediaProtocol`（seek 时预取目标位置附近 8 MiB）和 `playerWindow`（播放开始 HIGH 优先级预取文件头、切集 NORMAL 优先级预取下一集头部 4 MiB）。
- 优先级：播放 = HIGH（replaceExisting=true），下一集 = NORMAL，缩略图 = LOW。
- TTL：60 秒，每个文件最多保留 4 个活跃 hint。
- 新增文件：`src/main/clouddrive/prefetchManager.ts`
- 新增测试：`tests/main/cloudDrivePrefetchManager.test.ts`（11 tests）
- 新增 grpcClient 测试：PrefetchFileRanges/CancelFilePrefetch 请求编码验证（3 tests）

## 批次 3 · 已完成 · 限流 + 字段补全 + QPS 控制

- 范围：
  - 新增 `CloudDriveRateLimiter`（令牌桶算法），115 默认 QPS=4（保守低于报告的 5），通过 `LOCAL_VIDEO_MANAGER_CLOUDDRIVE_QPS` 环境变量覆盖。
  - grpcClient 支持可选 `rateLimiter` 参数，所有 serverStream RPC 在发送前 `acquire()`。
  - `decodeCloudDriveFile` 补齐字段：accessTime(8)、thumbnailUrl(10)、previewUrl(11)、isForbidden(36)、canDirectAccessThumbnailURL(62)、hasDetailProperties(64)、dirCacheTimeToLiveSecs(68)、readOnly(80)。
  - rateLimiter 生命周期跟随 sharedClient，在配置变化时 close 并重建。
- 新增文件：`src/main/clouddrive/rateLimiter.ts`
- 新增测试：`tests/main/cloudDriveRateLimiter.test.ts`（7 tests）
- 新增 grpcClient 测试：扩展字段解码验证、rateLimiter 集成测试

## 批次 4 · FULL · 待用户决定是否启动（架构岔路 B）

- `SetFolderDiskCache`：在用户同意后，给挂网盘的视频源目录自动下发 INCLUDE 视频扩展名规则；UI 提供开关、容量显示与清除入口；先查 `diskCacheDisabled` 兜底。
- `GetDownloadUrlPath` 直链管道：主进程代播字节流，不交给 renderer，不破坏 Desktop-only。
- `PushMessage(FILE_SYSTEM_CHANGE / CLOUD_API_CHANGE)` 长连增量失效，配合 `SetDirCacheTimeSecs` 减少 forceRefresh。
- 必须补真实 115 + 至少一种 SMB/NAS 实机证据、磁盘满/ACL/跨卷恢复、干净 Windows VM 安装验证；属于交接文档列出的 P1 证据缺口。
- 用户当前明确："先不做优化，待定"，不得主动开工。

## 批次 3 未包含的后续项

以下属于批次3范围内但尚未实现，可在实际网盘验证后按需补充：
- 并行目录遍历（当前仍是深度优先串行）——实际收益取决于115的HTTP/2多路复用表现，先验证限流效果。
- `queuePendingMetadata` 有界队列（建议 2000）——当前队列已存在但无上限，大规模库可能有内存压力。
- 从 `GetConfig`/`CloudAPIConfig` 动态读取 `maxQueriesPerSecondLimit` 和 `maxDownloadThreadsLimit`——当前使用默认值+环境变量覆盖，后续可在 GetMountPoints 后解析。
- HTTP/2 多路复用压测与大目录（≥10 万条目）基线。

## 全局约束（所有批次都适用）

- 不引入需要原生 rebuild 的 gRPC 库，保持纯 JS 手写 HTTP/2 + protobuf，避免 Node/Electron ABI 冲突。
- token、直链、挂载配置只在主进程；renderer 不持有。
- 扫描异常/取消/超时不得用部分结果清库。
- 每个批次独立分支 `ai/clouddrive-perf-batchN`，交付记录写入 `docs/ai/deliveries/`。
