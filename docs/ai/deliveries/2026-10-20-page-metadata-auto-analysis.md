---
date: 2026-10-20
branch: ai/page-metadata-auto-analysis
type: feat
status: partial
---

# 本页自动分析（维护者本地开发版）

## Context

维护者要求在视频浏览增加手动开启的本页自动分析，翻页后旧页未处理的自动请求取消，新页继续分析，严禁未经授权推送 GitHub。大量 CloudDrive 文件保持原来的全库暂缓策略。

## Changes

- 新增 `src/renderer/components/PageMetadataAutoAnalysis.tsx`：默认关闭；开启后对当前页未缺失、非 0B、pending 文件一次只提交一项 `loadPreviewMetadata`；页切换 300ms 防抖、跳过已就绪/失败/缺失；独立 `requestId` 取消，不触碰其他消费者拥有的后台任务；页面失焦、停留在非浏览视图或关闭开关时撤销专属请求；显示本页数量和反馈。
- `LibraryShell.tsx`：将控件置于视频浏览工具栏下方，使用当前分页/搜索/目录/排序组合构造页面作用域，不因为切换列表/网格就丢失状态。
- `tests/renderer/PageMetadataAutoAnalysis.test.tsx`：测试默认关闭、单任务顺序执行、无效文件跳过、翻页取消、加载时不提前请求以及失败不无限循环。
- `CHANGELOG.md`、`docs/USER_GUIDE.md`、`src/renderer/README.md`：说明尚未公开的新入口、CloudDrive 轻量时长限制与本地行为。
- 未改动数据库 schema、源视频、原有的全库自动分析筛选和共享媒体预算。

## Verification

- 开发前快照：`2026-10-19_17-09-41-603_page-metadata-auto-analysis`，Git checkpoint `checkpoint-20261020-010938-68c85b8-page-metadata-auto-analysis`，仅本地；SQLite quick_check `ok`，363528 条视频。
- `npm exec -- vitest run tests/renderer/PageMetadataAutoAnalysis.test.tsx tests/renderer/LibraryShell.test.tsx`：PASS，2 files / 72 tests。
- `npm run typecheck`：PASS。
- `npm run package:development`：构建、原生依赖验证 PASS；第一次生成目录因运行中的旧程序占用 `EBUSY` 失败；正常关闭主窗口（不强制杀进程）后，仅重试 `node scripts/package-development.mjs`：PASS。
- 日常本地包：`release/win-unpacked/拉面影视.exe`。快捷方式 `C:\Users\test\Desktop\拉面影视.lnk` 真实目标一致；`app.asar` 2026-10-20 01:16:05、EXE 01:16:06（北京时间）生成。
- 从桌面快捷方式启动进程：PASS，2026-10-20 01:16:43，进程可见。
- GUI 交互点击、真实 CloudDrive2 / 115 对象按页分析：NOT RUN（远程工具未进行桌面控件操作），维护者仍须实机操作验收。
- GitHub Push / Tags / Release：NOT RUN（遵守维护者暂停发布要求）。

## Risks and follow-up

- 已开始的读取即使失去本页请求所有权也可能有界完成，具体写库依托现有 MetadataQueue；全局扫描、播放器以及其他请求共享媒体预算，排队耗时可能超出单页预期。
- CloudDrive 轻量时长就绪后分辨率仍可能未知；本功能不自动触发详细编码补齐。
- UI 展示页级计数，而不是单个视频的真实 FFprobe 进度；后续可根据维护者实际使用情况增加每项队列状态。
- 页面元数据刷新触发的列表重新加载可能使本页请求短暂暂停/重新调度，需使用真实远端源验证实际流畅度。

## Documentation and release impact

- CHANGELOG [Unreleased] 和在线使用指南的开发版差异已增加；公开发布文档、安装包、GitHub Release 未改变。
- 本地开发版成功重新打包并从真实桌面快捷方式启动，但 GUI 功能尚需实机手动验收，不代表公开版已包含。
