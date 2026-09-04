# 扫描系统架构

## 入口与装配

- UI 入口：`LibraryShell` 侧栏的“扫描当前文件夹”、顶部刷新全库、扫描异常重试。
- IPC：`folder:scan`、`folder:scan-all`、`folder-scan-failures:retry`、`scan-failure-review:*`。
- 调度：`src/main/media/scanManager.ts#ScanManager`。
- 扫描核心：`src/main/media/libraryScanner.ts`。
- 本地发现：`src/main/media/fileDiscovery.ts`。
- CloudDrive 枚举：`src/main/clouddrive/mountedScanner.ts`。
- 元数据：`src/main/media/metadataQueue.ts` -> `metadataService.ts`。
- 数据仓储：`src/main/db/videoRepository.ts`。
- 启动同步：`src/main/index.ts`，受 `settings.startupSync` 控制。

## 整体流程

```text
用户/启动请求
  -> ScanManager 全局串行排队，同源去重，支持 pause/resume/cancel
  -> scanSourceFolder
     -> 识别 local 或 CloudDrive API 源
     -> 逐目录读取直属 entry
     -> 生成 directory snapshot identity
     -> 比较旧 snapshot
     -> 新增/变化视频写 videos，未变视频跳过重型元数据
     -> 仅对完整可读的直属目录执行 missing reconcile
     -> 写 directory_snapshots / scan_failures / scan_tasks / source folder state
  -> MetadataQueue 后台解析需要的视频
  -> 按文件版本条件更新 videos
  -> DomainEventBus 通知 renderer 刷新
```

## 1. 文件发现

### Local / SMB / NAS

- `fileDiscovery.ts` 使用 `opendir({ bufferSize: 128 })` 流式枚举，递归由 source folder 的 `recursive` 决定。
- 只接受 `VIDEO_EXTENSIONS`，忽略 `.crdownload/.part/.tmp`。
- 每次“读取下一个目录项”都有 30 秒无响应超时，而非给整个大目录设总时限。
- 根目录失败会把 source 视为 offline/error；子目录失败被记录后继续其他分支。

### CloudDrive API

- `GetMountPoints` 建立本地 mount point 与 remote sourceDir 映射。
- `GetSubFiles` 返回 entry、file ID、大小和 write time；`scanIdentity` 参与目录 digest。
- 目录 listing 有 24 小时缓存，用户主动 current-folder scan 会 force refresh。
- 子目录预取由 limiter 限制，默认最大 16 个目录请求。
- 明确标记为 CloudDrive 的源在 API 不可用时不回退到挂载盘遍历，也不执行 missing 对账。

## 2. 变化检测

- 表：`directory_snapshots`。
- 每目录身份包含：`directory_mtime`、直属视频数、直属子目录数、按 entry 名称/远程 scanIdentity 生成的 SHA-256 digest。该 digest 是目录摘要，不是读取视频内容。
- snapshot 完整、没有未解决错误且所有身份一致时可跳过重处理。
- 当前 local/SMB 的手动 current-folder scan 即使 snapshot 一致，仍会对直属视频读取轻量 size + mtime 做 reconcile，以发现同路径原地替换。
- 文件级变化判断依据为 `path + size + modifiedAt`；仅变化或新增视频重置元数据。

## 3. 媒体解析

- 扫描器先将新/变化记录写成 `metadata_status = pending`，快速完成文件索引。
- `MetadataQueue` 按 video ID 去重，显式重试提到队首，启动时分批恢复 pending。
- 默认 class concurrency 为 1，但生产装配 `src/main/index.ts` 明确传入 3，因此当前实际同时最多 3 个元数据任务。
- 本地视频通常使用一次完整 ffprobe 解析时长、容器、分辨率与 codec。
- CloudDrive API 视频先保留索引；只有进入同大小候选时才使用轻量 duration probe，降低网络读取。
- 更新必须同时匹配 id/path/size/modifiedAt，防止慢 ffprobe 覆盖已变化文件。

## 4. 数据更新与状态

- `videos`：文件索引、元数据、missing、provider identity 与缓存状态。
- `directory_snapshots`：目录级增量比较。
- `scan_failures`：按 file/directory、stage、error code 持久化未解决问题和重试次数。
- `scan_tasks`：记录 mode、status、开始/结束时间、counter JSON 和 error summary。
- `source_folders`：`last_scanned_at` 和 `scan_error`。
- `ScanManager.statuses`：仅内存的实时 queued/scanning/paused/completed 进度，通过 `folder-scan-status:list` 轮询。
- 完成或变更后通过 `DomainEventBus` 发布 `video:updated`、`source-folder:updated`、`library:rescanned`。

## Missing 安全语义

- 只有当直属目录完整可枚举时才对该目录做 missing reconcile。
- 子目录 ENOENT 还需重新枚举父目录确认不存在，才标记整个子树 missing。
- 网络错误、权限错误、超时、取消、CloudDrive API 不可用均不是“文件已删除”的证明。
- missing 是软标记，不直接删除视频数据库记录。

## 为资产中心可复用的数据

- 实时扫描：`listFolderScanStatuses()`。
- 每源最近扫描：`SourceFolder.lastScannedAt/scanError`。
- 异常数：`LibraryNavigationSnapshot.scanFailureCount` 和 `getScanFailureSummary`。
- 历史扫描：`scan_tasks` 已存在，但当前没有 repository 列表方法或 IPC；若资产中心需要“最近 N 次扫描”，只需增加只读查询契约，不需要 schema 迁移。

## 不建议修改

- 不重写 Directory Snapshot 或 ScanManager 串行调度。
- 不把资产统计塞入每次扫描循环，而应使用独立 SQL 聚合。
- 不为诊断中心开启全库详细 ffprobe，不改 CloudDrive 只在大小碰撞时读时长的带宽策略。
- 不让 UI 通过轮询全量视频来计算资产卡片。
