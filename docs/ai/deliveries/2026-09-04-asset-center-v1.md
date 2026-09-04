# 映匣 Asset Center V1 交付记录

## QA 复测结论

- `docs/ai/qa/2026-09-04-asset-center-v1-qa-retest.md` 对性能修正 Commit `a1e126324ecfbbf084b556077afbf3ddd1cbabff` 的结论为 PASS。
- 真实 319,986 视频资料库通过编译后 Worker 读取期间，主事件循环最大采样间隔为 `21.58 ms`，数据库文件未变化。
- 32 万视频/100 来源自动门禁为 `1251.78 ms`，来源分页精确执行 1 条 SQL。
- 完整 Vitest 59 个文件/575 项、lint、typecheck、build 和 Electron smoke 全部通过。
- ASAR/安装包中的 Worker 启动仍属于最终桌面交付门禁。

## QA FAIL 后的性能修正

- 保留 `docs/ai/qa/2026-09-04-asset-center-v1-qa.md` 的 FAIL 结论，未改写 QA 报告；本节记录阻断项后的开发修正，等待 QA 复测。
- 将 Asset Center 重聚合移出 Electron 主线程：两个既有 IPC 现在调用独立 `worker_threads` 查询服务，Worker 使用 `better-sqlite3` 的 `readonly + fileMustExist + PRAGMA query_only=ON` 连接。
- Repository 和 Worker 共用 `assetCenterQueries.ts` 中的唯一查询实现，避免两条路径的数据口径分叉。
- 来源分页改为单条窗口查询，同时返回总数、总页数、纠正后的页码和当前页；不再对同一个聚合 CTE 分别执行 COUNT 与分页查询。
- 查询服务使用单 Worker 串行执行只读请求，以请求 ID 配对响应；Worker 错误或退出会拒绝全部未完成请求，下次请求按需重建；应用退出时主动终止 Worker。
- 未新增或修改数据库表、索引、迁移；未访问媒体文件、CloudDrive、ffprobe 或预览图。

### 性能复测

- 真实只读资料库（319,986 个有效视频、7 个来源，预热后 3 次）：summary `499.77–511.80 ms`，sources `261.54–297.67 ms`。查询仍有聚合成本，但全部在 Worker 中执行，不阻塞 Electron 主线程；sources 相比 QA 的 `523.58–600.77 ms` 约减少一半。
- 合成资料库（320,000 个视频、100 个来源）：sources 单次 `1105.07 ms`，且由计数断言确认只准备并执行 1 条 SQL；QA 修正前为 `2117.77–2394.98 ms`。
- 实际编译后的 Worker 已在 Electron 33.4.11 / ABI 130 下完成只读 smoke，返回 0 个视频、1 个来源。
- `npm run lint`、`npm run typecheck`、`npm run build` 均通过；Asset Center 针对性回归 7 个文件/70 项通过；Electron Node ABI 环境完整 Vitest 59 个文件/575 项全部通过。

### 新增文件

- `src/main/assetCenter/assetCenterQueries.ts`
- `src/main/assetCenter/assetCenterQueryService.ts`
- `src/main/assetCenter/assetCenterReadonlyDatabase.ts`
- `src/main/assetCenter/assetCenterWorker.ts`
- `src/main/assetCenter/assetCenterWorkerProtocol.ts`
- `tests/main/assetCenterQueryService.test.ts`
- `tests/gates/assetCenterPerformance.test.ts`

### 剩余风险

- 本轮未打包，Worker 在 asar 安装包中的启动仍需最终桌面端打包 smoke 验证。
- summary 本身仍需约 0.5 秒读取 32 万条缓存记录；已移出主线程，不再造成前端卡顿，但首次数据显示仍会保留加载态。

## Context

本次在不修改扫描、播放、文件管理核心逻辑及数据库结构的前提下，新增独立资产中心页面和只读数据通路。

## Changes

### 分支

`ai/asset-center-v1`

### Commit

随 `ai/asset-center-v1` 本次功能提交交付，最终哈希以 Git 和项目经理交付结果为准。

### 修改摘要

- 在左侧主导航最前方增加 Lucide 图标入口“资产中心”，默认启动页面仍为“所有视频”。
- 新增独立 `AssetCenterPage`，提供核心统计、当前与最近扫描状态、健康提醒和资料库分页列表。
- 资产中心拥有独立的只读刷新动作，仅重新聚合 SQLite，不复用会触发 `scanAllFolders` 的通用刷新。
- 新增 `asset-center:summary` 与 `asset-center:sources` 两个主窗口只读 IPC，并通过严格 Zod schema 限制资料库分页查询。
- 新增 SQLite 固定行汇总和服务端分页查询；不访问文件系统、CloudDrive、ffprobe、预览图或视频内容。
- 可访问性与问题数量分开：只有最近一次明确的根目录扫描结果才会显示“最近可访问 / 最近离线 / 检查失败”；数据不足显示“未知”，停用来源显示“已停用”。单文件扫描异常不会把来源判定为离线。
- 最近完成扫描从现有 `scan_tasks.counters_json` 读取新增、更新、缺失和失败计数，不新增数据库字段或迁移。
- 将独立页面判断集中为 `isStandaloneView` / `isVideoBrowseView`，阻止资产中心触发视频分页、批量工具栏、视频翻页快捷键和通用扫描刷新。

### 新增文件

- `src/renderer/components/AssetCenterPage.tsx`
- `tests/main/assetCenterRepository.test.ts`
- `tests/renderer/AssetCenterPage.test.tsx`
- `docs/ai/deliveries/2026-09-04-asset-center-v1.md`

### 修改文件

- `src/shared/videoTypes.ts`
- `src/main/db/videoRepository.ts`
- `src/main/ipc.ts`
- `src/main/preload.cts`
- `src/renderer/App.tsx`
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/styles.css`
- `tests/main/ipcContracts.test.ts`
- `tests/main/security.test.ts`

### 删除文件

无。

### 数据来源

- 有效视频数量、总容量、缺失记录、元数据状态和播放风险规则：现有 `videos` 表缓存字段。
- 资料库数量、类型、最近扫描时间和历史错误摘要：现有 `source_folders` 表。
- 当前扫描状态：现有 `ScanManager` 内存状态，经 `listFolderScanStatuses()` 继续由 App 低频轮询并传入页面。
- 最近完成扫描结果与明确的来源可访问性：现有 `scan_tasks.status`、`completed_at` 和 `counters_json`。
- 扫描异常数量：现有 `scan_failures` 表未解决记录。
- 重复候选数量：与重复项页面一致的文件大小和整数秒时长候选口径，并排除当前清理任务保留项。

## Verification

### 测试结果

- `npm run typecheck`：通过。
- `vitest run`（Electron Node ABI 环境）：59 个测试文件、575 项测试全部通过。
- `npm run build`：通过，Vite 成功生成生产 Renderer。
- Electron native smoke：通过，ABI 130、Electron 33.4.11。
- Electron main-process smoke：通过，`app.whenReady` 正常完成。
- Asset Center 32 万视频/100 来源性能门禁：通过，来源分页只执行 1 条 SQL。
- 真实 319,986 个视频资料库只读性能复测：已完成，数据库大小与修改时间未变化。
- `git diff --check`：通过。

## Risks and follow-up

### 未验证事项

- 尚未在真实 Windows 主窗口进行人工视觉、键盘焦点和不同窗口宽度检查。
- 本阶段尚未执行安装包打包、桌面快捷方式启动及安装验证；这些项目留给 Asset Center QA 和最终交付阶段。

### 剩余风险

- 重复候选组统计是汇总中成本最高的查询，真实资料库若明显超过性能目标，应优先拆成页面可见后的延迟加载，不能因此新增扫描或文件读取。
- 普通盘符无法只靠数据库可靠区分本地磁盘与映射盘，因此 V1 明确显示“本地 / 挂载盘”，不会猜测为 NAS。
- 可访问性是最近一次明确检查的历史结论，不是实时网络监控；页面已经持续显示这一口径。
- 当前运行机默认 Node/npm 版本不符合项目锁定版本，数据库测试改用现有 Electron ABI 执行；QA 应在项目规定的 Node 22.23.1 / npm 10.9.8 环境补跑完整 Node 测试。
