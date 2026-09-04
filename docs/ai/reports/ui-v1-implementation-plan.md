# 映匣 UI 增量优化 V1 技术实现方案

## 方案目标

本方案为 Asset Center 和 Playback Diagnostic 提供最小侵入式实现路径。第一版只增加只读页面、只读统计和规则说明，不改变视频列表、扫描器、播放器路由、文件管理或数据库结构。

技术原则：

- 继续使用 LibraryShell 内部视图状态，不引入 React Router。
- 继续使用现有 React 本地状态和 Domain Event，不引入新的状态管理库。
- 继续使用现有 CSS 和 Lucide，不增加 UI 依赖。
- 资产统计必须在 SQLite 侧聚合，禁止把全量视频传给 renderer。
- 播放诊断 V1 只读取现有 VideoRecord，不自动运行 ffprobe。
- 不新增数据库迁移。

## 1. Asset Center 实现方案

### 1.1 页面位置

当前应用没有路由库。LibraryShell 通过 view 状态切换所有视频、收藏、待删除、最近播放、文件夹、扫描异常和重复项。

推荐把 Asset Center 作为新的 LibraryShell 顶级视图：

- 视图值：assetCenter。
- 菜单位置：左侧主导航第一项，位于“所有视频”之前。
- 默认页面：V1 暂时仍为 all，不改变用户已有启动习惯。
- 页面内容：在 LibraryShell 的特殊页面分支中渲染，不进入 LibraryPageQuery。

Asset Center 不是视频列表过滤条件。只扩展 LibraryView，不扩展 LibraryPageQuery.view，避免修改现有视频分页 SQL。

### 1.2 组件

#### 新增组件

组件名称：AssetCenterPage

文件路径：src/renderer/components/AssetCenterPage.tsx

依赖组件：

- formatters.ts 中的 formatBytes 和日期格式化能力。
- 现有 Lucide 图标。
- 现有 Pagination，若当前分页组件无法独立复用，可先在页面内使用同样的按钮结构。
- 新增只读 AssetCenterSummary 和 AssetCenterSourcePage 类型。
- FolderScanStatus，用于展示当前内存扫描任务。

V1 内部小组件先保留在同一文件：

- AssetMetricStrip。
- ScanStatusPanel。
- HealthActionList。
- SourceLibraryTable。

只有页面文件明显过大或测试困难时再拆目录，第一版不提前创建组件树。

#### 修改组件

组件名称：LibraryShell

文件路径：src/renderer/components/LibraryShell.tsx

修改内容：

- 左侧增加“资产中心”按钮。
- 增加 assetCenter 视图分支。
- 视频分页 effect、批量工具栏和视频翻页快捷键排除 assetCenter。
- 向 AssetCenterPage 传入只读加载函数、scanStatuses、refreshSequence 和现有页面跳转回调。
- AssetCenterPage 自己渲染顶部区域，assetCenter 视图不渲染现有视频 Toolbar，防止刷新按钮误触发 scanAllFolders。

现有 Toolbar 的 onRefresh 实际连接 App.refresh，而 App.refresh 会启动全资料库扫描。资产中心的“刷新数据”只能重新读取统计，因此不得直接复用这一回调。

组件名称：App

文件路径：src/renderer/App.tsx

修改内容：

- 将 api.getAssetCenterSummary 和 api.listAssetCenterSources 作为回调传给 LibraryShell。
- 继续使用现有 libraryRefreshSequence 作为资产数据失效信号。
- 不把资产中心数据放入 App 全局状态，页面不可见时不加载。

### 1.3 数据来源

#### 视频数量

来源：

- SQLite videos 表。

现有接口：

- getLibraryNavigation()。

现有数据库字段：

- videos.is_missing。

现状：

- VideoRepository.getLibraryNavigation() 已返回 totalVideos。
- 口径为 is_missing = 0。

方案：

- 顶部总数可以直接复用 navigation.totalVideos。
- 为保证资产中心总览是同一时间点的快照，新 AssetCenterSummary 也返回 totalVideoCount。
- 不修改 getLibraryNavigation()，避免它继续扩大且继续携带完整 directoryPaths。

#### 容量统计

来源：

- SQLite videos.size_bytes。

现有接口：

- getLibraryNavigation() 只有 pendingDeleteBytes，没有有效视频总容量。

现有数据库字段：

- videos.size_bytes。
- videos.is_missing。
- videos.is_pending_delete。

需要新增：

- AssetCenterSummary.totalSizeBytes。
- SQL 口径：COALESCE(SUM(size_bytes), 0)，且 is_missing = 0。

不得从 listVideoPage() 拉取数据后在 renderer 累加。

#### 扫描状态

来源：

- ScanManager 内存状态。
- source_folders.last_scanned_at。

现有接口：

- listFolderScanStatuses() 返回 FolderScanStatus[]。
- listFolders() 返回 SourceFolder.lastScannedAt 和 scanError。

现状：

- App 已每 1 秒或 4 秒轮询 listFolderScanStatuses()，LibraryShell 已持有 scanStatuses。
- listFolders() 会返回全部来源，不应为资产中心再次调用。

方案：

- 当前扫描任务直接复用传入的 scanStatuses，不新增 IPC。
- 最近扫描时间由 AssetCenterSummary.latestScannedAt 返回，SQL 使用已启用来源的 MAX(last_scanned_at)。
- V1 不增加 scan_tasks 历史列表接口，不显示最近任务的完整 counters。

#### 异常统计

来源：

- scan_failures。
- videos.is_missing。
- videos.metadata_status。
- videos.codec_probe_status 和已有媒体字段。

现有接口：

- getLibraryNavigation().scanFailureCount。
- ScanFailuresPage 的分页接口。

现有数据库字段：

- scan_failures.status。
- videos.is_missing。
- videos.metadata_status。
- videos.codec_probe_status。
- videos.extension、video_codec、video_profile、pixel_format、audio_codec。

需要新增到 AssetCenterSummary：

- scanFailureCount。
- missingVideoCount。
- metadataIssueCount。
- playbackRiskCount。
- duplicateCandidateGroupCount。

定义：

- metadataIssueCount：有效视频中 metadata_status 为 pending 或 failed。
- playbackRiskCount：仅根据缓存字段进行规则风险汇总，包括信息不足和当前自动规则会倾向 MPV 的视频。界面必须说明这是规则统计。
- duplicateCandidateGroupCount：使用与 DuplicateGroupsPage 相同的 size + 整秒 duration 候选口径。

实现注意：

- duplicateCandidateGroupCount 应复用 VideoRepository 内部已有重复组计数查询或提取同一私有 helper，不能通过 listDuplicateGroups() 加载第一页和目录选项。
- playbackRiskCount 不得加载所有 VideoRecord 后逐个调用 choosePlaybackRoute。
- V1 可使用一段只读 SQL CASE 做汇总，并新增一致性测试覆盖 H.264/AAC、WebM/VP9、HEVC/DTS、元数据缺失等代表样本。
- 如果 SQL 规则维护成本不可接受，V1 可先把该字段定义为“待诊断数量”，只统计 metadata 或 codec probe 不完整项。不能返回一个语义不清的伪精确值。

#### 资料库状态

来源：

- source_folders。
- 每个 source_folder_id 下的 videos 聚合。
- scan_failures 聚合。

现有接口：

- listFolders()。
- listSourceFoldersWithStats()。

现有数据库字段：

- source_folders.id、path、enabled、last_scanned_at、scan_error。
- source_folders.provider_type、provider_name、provider_read_only。
- videos.source_folder_id、size_bytes、is_missing、metadata_status。
- scan_failures.source_folder_id、status。

现状：

- listFolders() 返回全部来源，并且 listSourceFoldersWithStats() 会聚合全部视频。
- 当前资料库数量较大，不能把这个接口直接用于资产中心列表。
- 数据库能够识别 CloudDrive；UNC 路径可以识别部分 NAS；普通映射盘无法只根据路径可靠判断介质类型。

需要新增：

- listAssetCenterSources(query)。
- 服务端分页、过滤和排序。
- 每行只返回 AssetCenterSourceRow，不返回目录树或视频明细。

来源状态口径：

- disabled：enabled = 0。
- error：scan_error 非空或存在未解决 scan failure。
- unknown：从未成功扫描，即 last_scanned_at 为空。
- healthy：已启用、至少成功扫描一次且没有当前错误。

“在线”表示最近扫描状态，不是实时网络探测。资产中心打开和刷新都不能访问文件系统或 CloudDrive。

来源类型口径：

- provider_type = clouddrive：CloudDrive。
- UNC 路径：NAS。
- 其他路径：localOrMounted。

V1 不增加数据库字段。映射盘的精确识别留到独立只读驱动器检测任务。

### 1.4 现有接口复用

| 数据 | 复用接口 | 说明 |
| --- | --- | --- |
| 当前活动扫描 | listFolderScanStatuses() | App 已轮询，直接传给页面 |
| 视频总数量 | getLibraryNavigation() | 可用于导航和首屏旧值 |
| 扫描异常导航数 | getLibraryNavigation() | 页面最终以 summary 同一快照值为准 |
| 异常详情 | listScanFailureReviewPage() | 只在跳转 ScanFailuresPage 后使用 |
| 重复详情 | listDuplicateGroups() | 只在跳转 DuplicateGroupsPage 后使用 |
| 文件夹视图 | 现有 LibraryShell folder 视图 | 点击资料库行后复用 |

### 1.5 新增 IPC/API

只新增两个只读接口。

#### getAssetCenterSummary

用途：

- 返回固定大小的顶部指标和健康统计。

建议返回字段：

    interface AssetCenterSummary {
      generatedAt: string;
      totalVideoCount: number;
      totalSizeBytes: number;
      sourceCount: number;
      sourceHealthyCount: number;
      sourceProblemCount: number;
      sourceUnknownCount: number;
      latestScannedAt: string | null;
      scanFailureCount: number;
      missingVideoCount: number;
      metadataIssueCount: number;
      playbackRiskCount: number | null;
      duplicateCandidateGroupCount: number;
    }

playbackRiskCount 允许为 null。null 表示当前版本没有可靠口径，UI 显示“暂无统计”，不能显示 0。

建议 IPC：

- channel：asset-center:summary。
- API：getAssetCenterSummary(): Promise<AssetCenterSummary>。
- 权限：仅主资料库窗口。
- 输入：无。

#### listAssetCenterSources

用途：

- 返回资料库的服务端分页列表。

最小查询字段：

    interface AssetCenterSourceQuery {
      page: number;
      pageSize: 30 | 50 | 100;
      search: string;
      type: "all" | "localOrMounted" | "nas" | "clouddrive";
      status: "all" | "healthy" | "problem" | "unknown" | "disabled";
      sort: "path" | "videoCount" | "sizeBytes" | "lastScannedAt" | "issueCount";
      direction: "asc" | "desc";
    }

建议每行字段：

    interface AssetCenterSourceRow {
      id: string;
      path: string;
      providerName: string | null;
      sourceType: "localOrMounted" | "nas" | "clouddrive";
      enabled: boolean;
      status: "healthy" | "problem" | "unknown" | "disabled";
      videoCount: number;
      sizeBytes: number;
      missingVideoCount: number;
      metadataIssueCount: number;
      scanFailureCount: number;
      lastScannedAt: string | null;
      scanError: string | null;
    }

建议 IPC：

- channel：asset-center:sources。
- API：listAssetCenterSources(query): Promise<AssetCenterSourcePage>。
- 权限：仅主资料库窗口。
- 输入：strict Zod schema，限制 search 长度、page 和 pageSize。

第一版不新增：

- 图表 breakdown API。
- 扫描历史 API。
- 实时在线检测 API。
- 资产缓存表。
- 导出接口。

### 1.6 Repository 实现

文件：src/main/db/videoRepository.ts。

建议新增：

- getAssetCenterSummary(): AssetCenterSummary。
- listAssetCenterSources(query): AssetCenterSourcePage。

实现要求：

- 使用现有 better-sqlite3 同步查询。
- summary 由少量聚合 SQL 返回固定行数。
- source page 只映射当前页，不能先 listSourceFoldersWithStats() 再 slice。
- 优先使用现有 idx_videos_source_folder_id、idx_videos_metadata_status、idx_videos_size_bytes 等索引。
- 不为 V1 预先增加迁移或新索引。先用真实 32 万视频数据执行 EXPLAIN QUERY PLAN 和计时测试。
- 如果单次 summary 超过 100ms，先拆分最慢统计并按页面可见性懒加载，不立即修改数据库结构。

### 1.7 刷新策略

- AssetCenterPage 进入时请求 summary 和来源第一页。
- 手动刷新只重复这两个请求，不调用 App.refresh。
- libraryRefreshSequence 变化且页面可见时，在 300-500ms 内合并刷新。
- scanStatuses 直接响应 App 现有轮询，不触发 summary 每秒刷新。
- 扫描从 active 变为完成时，现有 App.reload 会产生 refreshSequence，再刷新 summary。
- 同一请求在途时不重复启动；迟到结果由请求序号丢弃。

## 2. Playback Diagnostic 实现方案

### 2.1 页面入口

推荐 V1 同时提供：

1. VideoDetailsDialog 中的“播放诊断”按钮。
2. LibraryShell 左侧的独立“播放诊断”页面。

入口优先级：

- 详情入口是主要入口，因为已经持有准确的 VideoRecord，不需要额外查找。
- 独立页面用于主动搜索视频和连续检查。
- PlayerPage 入口暂不纳入 V1。播放器运行在独立 BrowserWindow，新增跨窗口导航会扩大变更范围。后续可单独实现。

### 2.2 页面位置

视图值：playbackDiagnostic。

菜单位置：最近播放之后，扫描异常之前。

React 组件：

组件名称：PlaybackDiagnosticPage。

文件路径：src/renderer/components/PlaybackDiagnosticPage.tsx。

依赖：

- VideoRecord。
- PlaybackPreference 和 PlaybackRoute。
- choosePlaybackRoute。
- listVideoPage，用于独立入口的分页搜索。
- listVideosByIds，用于刷新当前选择。
- onOpen、onRevealInFolder、onRetryMetadata 等现有回调。
- formatters.ts。

LibraryShell 为该页面保存 diagnosticVideoId 或选中的 VideoRecord。页面切换不影响播放器会话。

### 2.3 VideoDetailsDialog 接入

文件：src/renderer/components/VideoDetailsDialog.tsx。

增加可选属性：

    onOpenDiagnostic?(video: VideoRecord): void;

主资料库窗口传入该回调。点击后：

1. 关闭详情弹窗。
2. 保存当前 videoId。
3. 将 view 设置为 playbackDiagnostic。

PlayerPage 当前也复用 VideoDetailsDialog。由于属性是可选的，PlayerPage V1 不传入，不改变播放器行为。

### 2.4 独立页面搜索

复用 listVideoPage()：

- view: all。
- search: 用户输入。
- pageSize: 30。
- 不请求封面。
- 不增加播放风险筛选。

UI 设计稿中的“风险视频筛选”延后。现有 LibraryPageQuery 没有该条件，为 V1 增加会扩大视频列表查询语义和索引范围。

最近播放可以复用 App 已有 recentVideoIds，或通过现有 listPlayHistory() + listVideosByIds() 读取最多 10 条。优先由 LibraryShell 复用已有 recentVideoIds。

### 2.5 已有数据来源

#### 文件信息

| 字段 | VideoRecord 字段 | 数据库字段 | 代码位置 |
| --- | --- | --- | --- |
| 文件名 | filename | videos.filename | src/shared/videoTypes.ts、src/main/db/videoRepository.ts |
| 路径 | path | videos.path | 同上 |
| 所在目录 | directory | videos.directory | 同上 |
| 大小 | sizeBytes | videos.size_bytes | 同上 |
| 修改时间 | modifiedAt | videos.modified_at | 同上 |
| 扩展名 | extension | videos.extension | 同上 |
| 缺失状态 | isMissing | videos.is_missing | 同上 |
| 远端身份 | providerFileId、providerPath | videos.provider_file_id、provider_path | 同上 |

#### 视频信息

| 字段 | VideoRecord 字段 | 数据库字段 |
| --- | --- | --- |
| 格式 | format | videos.format |
| 时长 | durationMs | videos.duration_ms |
| 分辨率 | width、height | videos.width、videos.height |
| 视频编码 | videoCodec | videos.video_codec |
| Profile | videoProfile | videos.video_profile |
| Pixel Format | pixelFormat | videos.pixel_format |
| 元数据状态 | metadataStatus | videos.metadata_status |
| 编码探测状态 | codecProbeStatus | videos.codec_probe_status |
| 时长来源 | durationSource | videos.duration_source |

数据采集位置：

- src/main/media/metadataService.ts 运行 ffprobe 并映射首个视频流。
- src/main/media/metadataQueue.ts 管理扫描后的元数据任务。
- src/main/media/playbackMetadataEnricher.ts 在需要时补充编码字段。
- src/main/db/videoRepository.ts 保存和读取字段。

Playback Diagnostic V1 只展示已经保存的数据，不直接调用上述媒体服务。

#### 音频信息

| 字段 | VideoRecord 字段 | 数据库字段 | 当前限制 |
| --- | --- | --- | --- |
| 首音轨编码 | audioCodec | videos.audio_codec | 只保存第一个音频流编码 |

当前没有：

- 声道。
- 采样率。
- 音频码率。
- 多音轨列表。
- 字幕列表。
- HDR 色彩字段。

V1 显示“尚未采集”，不新增数据库字段，不运行深度探测。

#### 播放设置与入口

| 数据或动作 | 现有来源 |
| --- | --- |
| 用户偏好 | AppSettings.playbackPreference |
| 当前路由 | choosePlaybackRoute(video, preference) |
| 内置播放 | openPlayer(videoId, queueIds) |
| MPV 播放 | playExternalVideo(videoId) |
| 定位文件 | revealVideoInFolder(videoId) |
| 补充元数据 | retryMetadata(videoId) |

代码位置：

- src/shared/playbackRouting.ts。
- src/renderer/App.tsx。
- src/main/playerWindow.ts。
- src/main/ipc.ts。

### 2.6 是否需要新增 IPC

Playback Diagnostic V1 不新增 IPC。

原因：

- 详情入口已经持有完整 VideoRecord。
- 独立页面可以通过 listVideoPage() 搜索。
- 当前视频更新可用 listVideosByIds([videoId])。
- 播放偏好已经在 App 中加载。
- 播放和定位动作已有类型化 API。

不新增 getPlaybackDiagnostic()，避免第一版多一层重复 DTO 和 handler。只有后续加入按需深度检测、来源详情或持久化播放失败时再评审新接口。

### 2.7 播放建议逻辑

第一版只做规则说明，不改变 choosePlaybackRoute，不自动切换播放器。

建议新增一个纯展示 helper：

文件：src/shared/playbackDiagnosis.ts。

职责：

- 接收 VideoRecord、PlaybackPreference 和 choosePlaybackRoute 的结果。
- 返回 status、reasonCode、reasonText 和 evidence。
- 不决定实际播放路由。
- 不调用文件系统、ffprobe 或播放器。

示例规则：

| 条件 | 展示结论 | 说明 |
| --- | --- | --- |
| isMissing = true | 文件当前不可用 | 禁用播放建议，进入扫描异常 |
| metadataStatus 或 codecProbeStatus 不完整 | 信息不足 | 允许补充元数据或尝试 MPV |
| preference = mpv-first | 当前设置优先 MPV | 说明来源是用户设置 |
| route = native | 建议按当前策略使用内置播放器 | 展示满足的容器和编码字段 |
| route = mpv 且 HEVC + DTS | 建议外部播放器 | 说明 HEVC 和 DTS 不匹配当前 Native 规则 |
| route = mpv 且其他组合 | 建议 MPV | 列出不匹配或未知字段 |

硬性边界：

- helper 必须先调用或接收 choosePlaybackRoute 的结果，不能成为第二套路由函数。
- 页面只能写“规则分析结果”“建议”，不能写“保证可以播放”。
- 点击“按当前策略播放”继续调用 openPlayer。
- 点击“使用 MPV”继续调用 playExternalVideo。
- 不自动修改 AppSettings.playbackPreference。
- 不在诊断完成后自动启动播放器。

### 2.8 Domain Event 与刷新

- LibraryShell 继续接收 App 的 refreshSequence。
- 当前选中视频存在时，refreshSequence 变化后调用 listVideosByIds([videoId])。
- 返回空数组表示记录已移除，页面进入 not-found。
- 返回 isMissing = true 时保留缓存字段，但禁用播放按钮。
- settings:changed 已由 App 更新 settings；将 playbackPreference 传给页面后重新计算展示 helper。
- 页面没有选中视频时，不因视频事件自动加载任何记录。

## 3. 修改文件清单

以下是后续开发预计修改的业务文件，本次文档任务没有修改它们。

| 文件 | 最小修改 |
| --- | --- |
| src/shared/videoTypes.ts | 增加两个视图值、Asset Center DTO、2 个 IPC channel 和 2 个 API 方法 |
| src/main/db/videoRepository.ts | 增加 summary 聚合与来源分页两个只读方法 |
| src/main/ipc.ts | 注册 2 个只读 handler 和来源 query Zod 校验 |
| src/main/preload.cts | 暴露 2 个只读方法 |
| src/main/security.ts | 允许主资料库窗口调用 2 个新 channel |
| src/renderer/App.tsx | 将新 API 和 playbackPreference 传给 LibraryShell |
| src/renderer/components/LibraryShell.tsx | 增加菜单、视图分支、刷新排除和详情到诊断跳转 |
| src/renderer/components/VideoDetailsDialog.tsx | 增加可选“播放诊断”回调和按钮 |
| src/renderer/styles.css | 增加两个页面的局部样式，复用现有 token |

不需要修改：

- src/main/media/libraryScanner.ts。
- src/main/media/scanManager.ts。
- src/main/media/metadataQueue.ts。
- src/main/media/mpvController.ts。
- src/main/playerWindow.ts。
- src/shared/playbackRouting.ts。
- 数据库 migrations。

## 4. 新增文件清单

| 文件 | 作用 |
| --- | --- |
| src/renderer/components/AssetCenterPage.tsx | 资产中心页面及 V1 私有小组件 |
| src/renderer/components/PlaybackDiagnosticPage.tsx | 播放诊断页面及视频选择 |
| src/shared/playbackDiagnosis.ts | 只读规则说明 helper，不控制路由 |
| tests/renderer/AssetCenterPage.test.tsx | 加载、跳转、分页、错误和无文件 I/O 契约 |
| tests/renderer/PlaybackDiagnosticPage.test.tsx | 字段、规则文案、未知和缺失状态 |
| tests/main/assetCenterRepository.test.ts | 统计口径、分页和性能计数 |
| tests/main/playbackDiagnosis.test.ts | 代表编码组合与 choosePlaybackRoute 结果一致性 |

不建议第一版建立 asset-center 或 playback-diagnostic 子目录。页面稳定并出现三个以上可复用组件后再拆分。

## 5. 数据依赖

### Asset Center

- videos：数量、容量、missing、metadata、codec 和重复候选。
- source_folders：来源数量、类型、最近扫描和错误。
- scan_failures：未解决异常。
- ScanManager.listStatuses()：当前任务。
- DomainEvent + libraryRefreshSequence：失效通知。

不依赖：

- 文件系统 stat。
- 目录遍历。
- CloudDrive API。
- ffprobe。
- 封面或时间轴缓存。

### Playback Diagnostic

- VideoRecord。
- AppSettings.playbackPreference。
- choosePlaybackRoute。
- listVideoPage 和 listVideosByIds。
- 现有播放、定位和 metadata retry API。

不依赖：

- 新数据库表。
- 原始 ffprobe JSON。
- GPU 或驱动检测。
- 播放失败历史。

## 6. 测试方案

### Repository

- 0 条视频时所有 SUM 返回 0。
- missing 视频不进入有效数量和容量。
- metadata pending/failed 口径正确。
- 重复候选组数与 DuplicateGroupsPage 同口径。
- 来源状态 healthy/problem/unknown/disabled 正确。
- 搜索、类型、状态、排序和分页总数正确。
- 32 万视频数据规模下不构造 VideoRecord[]。
- 使用 EXPLAIN QUERY PLAN 记录查询计划，不在无证据时加索引。

### IPC 与安全

- query 使用 strict schema。
- page、pageSize、search 和枚举非法值被拒绝。
- 新 channel 只允许主资料库窗口。
- preload 暴露方法与 VideoManagerApi 类型一致。

### Renderer

- Asset Center 不触发 scanAllFolders。
- 页面不可见时不加载资产数据。
- 刷新时保留旧内容。
- 连续 refreshSequence 合并，不形成请求队列。
- 播放诊断不调用 ffprobe 或新媒体接口。
- HEVC + DTS 显示 MPV 建议但不自动播放。
- null、missing、failed 分别显示“尚未采集”“文件缺失”“读取失败”。
- VideoDetailsDialog 的新回调为可选，PlayerPage 现有测试不受影响。

## 7. 风险点

### P1：资产聚合阻塞主进程

better-sqlite3 是同步调用。复杂 GROUP BY 可能短暂阻塞 Electron 主进程。

控制方式：

- 两个有界查询，不读取全量行。
- 先测真实数据。
- summary 超过 100ms 时拆出 duplicate 或 playback risk 为懒加载。
- 不首先引入 worker、缓存表或第二套数据库。

### P1：LibraryShell 特殊页面误触发视频查询或全盘扫描

新增视图如果遗漏排除条件，可能把 assetCenter 传入 LibraryPageQuery，或让资产刷新调用 App.refresh。

控制方式：

- 集中定义 isVideoBrowseView 或 isStandaloneView，避免在多个 effect 中手写不完整判断。
- 为新页面进入、刷新和批量工具栏不可见增加测试。
- AssetCenterPage 使用自己的“刷新数据”回调。

### P1：播放说明与实际路由不一致

如果新 helper 复制 choosePlaybackRoute 条件，后续规则变化会导致文案错误。

控制方式：

- 实际 route 永远来自 choosePlaybackRoute。
- helper 只解释已经产生的 route。
- 代表样本同时断言 route 和 reason。
- 不修改 playbackRouting.ts。

### P2：资料库来源类型不准确

映射盘无法只根据路径可靠区分本地磁盘与 NAS。

控制方式：

- V1 使用 localOrMounted。
- UI 标明口径。
- 不通过页面刷新访问驱动器或网络。

### P2：播放风险统计语义过度承诺

缓存字段只能提供规则风险，不能反映真实硬件能力和历史播放结果。

控制方式：

- playbackRiskCount 可以为 null。
- UI 明确标注“规则统计”。
- 如果不能与路由规则保持一致，先显示待诊断数量。

### P2：现有 folders 全量加载

App 当前启动时仍调用 listFolders()。新增来源分页不会自动解决现有侧边栏的全量来源问题。

控制方式：

- 本任务不扩大该问题。
- Asset Center 不重复调用 listFolders()。
- 侧边栏来源虚拟化或分页作为独立性能任务评审。

## 8. 回滚方案

V1 没有数据库迁移和数据写入，回滚不需要数据恢复。

推荐一个独立功能提交完成实现。回滚步骤：

1. 从 LibraryShell 删除 assetCenter 和 playbackDiagnostic 菜单及渲染分支。
2. 删除两个页面组件和 playbackDiagnosis helper。
3. 从 VideoDetailsDialog 删除可选入口。
4. 删除 Asset Center 的 2 个 API、IPC、preload 和 security channel。
5. 删除对应 CSS 和测试。
6. 重新运行 lint、typecheck、test、build 和 Electron smoke。

如果功能已经作为单一提交合入，可以直接 revert 该功能提交。因为没有 schema 变化，旧版本可以直接打开现有数据库。

## 9. 推荐开发顺序

1. 冻结 AssetCenterSummary、AssetCenterSourceQuery 和 AssetCenterSourcePage。
2. 实现 repository 只读查询和真实数据性能测试。
3. 接入 IPC、preload 和 security。
4. 实现 AssetCenterPage，再接入 LibraryShell。
5. 实现 playbackDiagnosis 纯函数及测试。
6. 实现 PlaybackDiagnosticPage 和 VideoDetailsDialog 入口。
7. 做 Domain Event、刷新和大数据量回归。
8. 完成 Windows Release Gate 和桌面打包。

第一开发任务建议只覆盖步骤 1-4。Playback Diagnostic 作为下一独立提交，降低一次变更同时影响导航、数据库查询和详情弹窗的风险。
