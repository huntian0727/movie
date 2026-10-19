# 异常中心：区分需要处理的问题与后台元数据任务（2026-10-19）

## Context
用户发现约 30 万条 CloudDrive 元数据暂缓任务被导航汇总为“异常”，混入需要处理的扫描失败、缺失和分析失败，无法判断该做什么。真实 SQLite 只读核验：现有 363528 部视频记录，304080 待分析/暂缓、832 分析失败、2008 扫描异常、1954 文件缺失；大部分待分析为保护网盘而暂缓的正常任务。

## Ownership / safety
- Owner: ChatGPT；branch `ai/separate-health-issues-background-tasks`；base HEAD `e9e6d659abe3a099f310d028d0b32aafd1728245`。
- 仅在家用电脑 MP2T8QB5 操作，保留协作单写入者约束；初始 Git 工作区干净。
- 开发前完整备份：`2026-10-19_09-41-22-656_separate-issues-from-metadata-tasks`，Git checkpoint：`checkpoint-20261019-174118-e9e6d65-separate-issues-from-metadata-tasks` 已推送；数据库 0.91 GB、363528 视频、SQLite quick_check: ok。
- 清理旧备份前通过清单校验，保留最近 3 份完整开发备份；未修改真实资料库、未批量重新分析、未删除文件。

## Changes
- src/main/db/videoRepository.ts：导航 `health_issue_count` 原逻辑将 metadata_status=pending/failed 都当异常；改为仅 failed，仍通过 UNION 对扫描失败、缺失和视频错误去重。额外返回 `failedMetadataVideos`，保留 `pendingMetadataVideos` 独立计数。
- src/shared/videoTypes.ts：增加可选 `failedMetadataVideos` 导航统计字段，明确状态语义。
- src/renderer/components/LibraryShell.tsx：侧栏拆成“需要处理”与“后台任务”；分类导航分别展示问题总览、扫描失败、文件缺失、分析失败，并将后台元数据任务视觉分隔；打开分析失败默认过滤 failed，打开后台任务默认过滤 deferred；资产中心转入任务页也默认 deferred。
- src/renderer/components/MetadataIssuesPage.tsx：支持 `initialStatus`；根据失败/后台模式展示不同说明，避免将数十万正常暂缓状态与真正失败混在一个醒目计数区；手动选择全部状态仍保留。
- src/renderer/components/HealthOverviewPage.tsx：后台区标为“正常后台任务（无需逐条处理）”，进入暂缓任务列表；不影响已存在的异常原因指引。
- src/renderer/styles.css：后台任务标签视觉分组，导航窄窗口允许横向滚动。
- 增加数据库、UI 分类测试；更新 CHANGELOG.md 和 docs/USER_GUIDE.md。

## Verification
- 核心分离专项回归：4 个测试文件 / 98 项测试 PASS，含 pending 不计入异常、failed 计入异常、状态入口默认过滤及侧栏统计隔离。
- `npm run lint`：PASS；`npm run test:node`：143 文件 / 1326 项 PASS；`npm run build`：PASS（存在原有 Vite >500kB chunk 体积建议）；`npm run test:electron-smoke`：PASS，包括 Electron 44.7.0、SQLite/DPAPI、sandbox preload 和数据目录迁移。
- 本机真实数据以 `better-sqlite3` readonly + query_only 查询新代码的 `getLibraryNavigation()`：待核查去重问题 **4041**、正常元数据 pending **304080**、分析失败 **832**、扫描异常 **2008**；约 0.97 秒。没有修改真实资料库。
- 新建仅在 Windows %TEMP% 的隔离测试库：10000 条 CloudDrive 待分析且未自动排队、4 条分析失败、1 条缺失；正常任务计 10000，问题去重计 5。
- 从专门 staging 包运行真实 Windows Electron + CDP，实际点击“需要处理”和“后台元数据任务”，验证总览 KPI 为 5、后台 10000；分析失败列表自动选 failed 且显示 4，后台自动选 deferred 且显示 10000；截图与结果保存于忽略的 .tmp，`separate-e2e-result.json` 显示 PASSED=true。未执行重试、扫描或文件清理。
- 正式日常开发版快捷方式的打包及提交 SHA 对齐：待最终交付验证。

## Risks and follow-up
- 不将 pending 状态默认为应修复的错误；CloudDrive 大批量元数据分析可能造成网络和 API 成本，不自动触发。
- 分类数量可能因相同文件兼有扫描错误/缺失而重叠；侧栏去重统计不等于三项分类简单求和。
- 真实 CloudDrive 清理与永久删除 E2E 不在本次执行范围；不公开发布 GitHub Release。
- 仅在完整回归、独立 GUI 验收及日常开发版打包核验完成后标记 delivered。

## Collaboration / Handoff history
- 2026-10-19 started; 当前进度 ready_for_delivery。修改与对应测试已完成，隔离真实 Electron UI E2E 已 PASS；完成 Git 推送和桌面正式开发包后补充部署标识。
