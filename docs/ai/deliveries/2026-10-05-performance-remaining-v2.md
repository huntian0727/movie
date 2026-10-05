---
date: 2026-10-05
branch: ai/performance-remaining-v2
type: refactor
status: completed
---

# 性能剩余项 V2：源码与压力验证

## Context

继续完成上一轮未实施的性能工作包。基线 `e32cc52`。开发前已完成完整备份，快照 `2026-10-04_19-32-27-426_performance-remaining-v2`，checkpoint `checkpoint-20261005-033223-e32cc52-performance-remaining-v2`。测试使用独立资料库，不删除用户视频。

## Changes

- API 大目录按处理时间/条数分批让出主线程，保留完整缺失对账和 Snapshot。
- 批量候选准备使用只读正式库 Worker，私有临时计划预生成行，主连接 SQL 批量复制；重验版本、保留幂等/占用/原子性，避免增加正式库 writer。
- 查询排队按窗口、调用用途和类型隔离，淘汰旧等待请求。
- schema 14 新增内部事务版本计数；播放历史、图片、任务进度不使无关目录/重复排序缓存失效。
- 视频计数和重复项排序缓存有上限，页内记录读取最新值。
- 启动全面缓存维护延后；截图和元数据共享读取预算；视频列表只挂载近可见行，保留焦点、选择与展开状态。
- 少量选中项导出/删除查询下推 SQL，API 目录缓存增加数量和容量上限。
- 新增：`queryRevisions.ts`、迁移 014、`cleanupPreparationStage.ts`、`duplicateCleanupPreparationWorker.ts`、`mediaReadBudget.ts`、`weightedExpiringCache.ts`、`VirtualVideoRows.tsx`、对应回归及 `scripts/verify-background-workers.mjs`。
- 修改：既有 Worker/查询服务、IPC/preload/共享类型、扫描批处理、清理 Repository/Service、缓存/媒体队列、目录和视频列表组件/样式及契约测试。
- 删除文件：无。播放核心、扫描架构、文件删除范围/规则未改变。

## Verification

- `npm run test:release-gate`：最后代码完整重跑 PASS；108 个文件、913 项全部通过，包含类型检查、生产构建、Windows 文件、迁移和性能基线。
- 最近定向回归：缓存计数与清理任务 34 项 PASS，包含计划版本拒绝、幂等、占用冲突、末尾插入失败完整回滚。
- 最终 `node scripts/verify-background-workers.mjs 32000`：PASS；准备 1,532ms，原子入库及主循环最大停顿 674ms（与全量回归同时运行）；之前空闲测量为 540ms。
- 最终 `node scripts/verify-background-workers.mjs 50000`：PASS；准备 2,088ms，入库及主循环最大停顿 985ms；读取真实视频 0、删除文件 0。保留原 1 秒门槛。
- 中间版本曾 1,451ms FAIL，未发布；定位和改进过程保留在报告。
- `git diff --check`：PASS。
- `npm run prepare:electron`、`npm run test:electron-smoke`：PASS，Electron 33.4.11、ABI 130；PNG 色彩配置警告不影响断言。
- 真实 CloudDrive E2E、正式库性能 p95、真实删除：NOT RUN。
- `npm run package:dir`、`npm run verify:artifact`、`npm run test:packaged-smoke`：PASS；产物 4,010 个 asar 条目，不含禁入开发数据，隔离库验证扫描、协议、预览、分页/导出/诊断 Worker 和重启读取。
- 桌面快捷方式人工验收：PASS。真实快捷方式 `桌面/拉面影视.lnk` 指向本仓库 `release/win-unpacked/拉面影视.exe`，已实际启动；资产中心、重复候选首屏及折叠排行、视频数据表搜索、扫描异常和元数据任务首屏、本地测试目录网格/列表切换及可见行多帧截图正常返回。
- 短时播放验收：PASS。本地测试目录视频双击打开内嵌播放器，实际解码画面可见，播完自动切换下一条，暂停状态及控制正常；未进行长时间播放或远端媒体验证。
- 视频数据表正式库显示 345,479 条记录；搜索、元数据任务统计和分页控件可用。人工验收不是正式库 p95 测量，不作为“完全无卡顿”证据。
- 提交由 `finish-and-push.ps1` 执行，先备份旧 main，再普通快进同步；同工作区本轮已完成完整等价门禁，允许使用 `-SkipChecks` 避免重复运行。在最终 Commit 后再次生成桌面包并核对快捷方式目标/产物时间，实际结果见交付输出。

## Risks and follow-up

本轮计划的性能工作包及超大任务受理阻断已修复。原子入库仍在主线程，实际短停顿 0.54–0.985 秒，不宣称完全零卡顿或无限数据量保证。未另开正式库 writer，避免把停顿转换为同步等待锁。网格/巨大单组全面虚拟化、共享图片订阅和异步日志是后续需要证据的可选测量方向，不包含在“已实现”清单。

首次启动新包按原迁移机制备份并升级内部计数至 schema 14；升级后若回滚须同时恢复对应数据快照，不可只替换旧程序。详细测量和边界见 `docs/ai/reports/2026-10-05-performance-remaining-v2.md`。
