# 映匣 Asset Center V1 交付记录

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
- `vitest run`（Electron Node ABI 环境）：57 个测试文件、570 项测试全部通过。
- `npm run build`：通过，Vite 成功生成生产 Renderer。
- Electron native smoke：通过，ABI 130、Electron 33.4.11。
- Electron main-process smoke：通过，`app.whenReady` 正常完成。
- `git diff --check`：通过。

## Risks and follow-up

### 未验证事项

- 尚未使用用户真实的约 32 万条视频资料库进行 SQL 实测计时和 `EXPLAIN QUERY PLAN` 记录。
- 尚未在真实 Windows 主窗口进行人工视觉、键盘焦点和不同窗口宽度检查。
- 本阶段尚未执行安装包打包、桌面快捷方式启动及安装验证；这些项目留给 Asset Center QA 和最终交付阶段。

### 剩余风险

- 重复候选组统计是汇总中成本最高的查询，真实资料库若明显超过性能目标，应优先拆成页面可见后的延迟加载，不能因此新增扫描或文件读取。
- 普通盘符无法只靠数据库可靠区分本地磁盘与映射盘，因此 V1 明确显示“本地 / 挂载盘”，不会猜测为 NAS。
- 可访问性是最近一次明确检查的历史结论，不是实时网络监控；页面已经持续显示这一口径。
- 当前运行机默认 Node/npm 版本不符合项目锁定版本，数据库测试改用现有 Electron ABI 执行；QA 应在项目规定的 Node 22.23.1 / npm 10.9.8 环境补跑完整 Node 测试。
