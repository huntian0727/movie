---
date: 2026-09-04
task: 映匣 UI 增量优化 V1 - 技术实现方案设计
status: completed
---

# 映匣 UI 增量优化 V1 技术方案交付

## Context

基于 docs/ai/ui-design/ 下的资产中心、播放诊断和 ASCII 原型，输出两个新增页面的最小侵入式技术实现方案。本阶段只允许文档修改。

## Changes

- 新增 docs/ai/reports/ui-v1-implementation-plan.md。
- 确定 Asset Center 挂载在 LibraryShell 顶级视图，V1 不改变默认页面。
- 确定 Asset Center 只新增 summary 和来源分页两个只读 IPC。
- 明确当前扫描任务、现有导航、异常详情、重复详情和文件夹视图的复用方式。
- 确定 Playback Diagnostic 同时提供独立页面和 VideoDetailsDialog 入口。
- 确定 Playback Diagnostic V1 不新增 IPC、不运行深度探测、不修改播放路由。
- 列出后续实现需要修改和新增的文件、测试范围、风险与无迁移回滚方案。

## Verification

- 对照 LibraryShell 的 view 状态、视频分页 effect、批量工具栏、Toolbar 和特殊页面分支确认挂载方式。
- 对照 App.refresh 确认现有刷新会触发 scanAllFolders，资产刷新必须使用独立只读回调。
- 对照 VideoRecord、SourceFolder、LibraryNavigationSnapshot、FolderScanStatus 和 VideoManagerApi 确认数据可复用性。
- 对照 VideoRepository、IPC、preload 和 security 确认两个新只读接口的最小接入面。
- 对照 metadataService、playbackMetadataEnricher 和 choosePlaybackRoute 确认诊断 V1 无需媒体读取。
- 已执行 Markdown 必需章节、UTF-8 编码和 Git 文件范围检查。
- 未运行应用测试和打包：本次只新增技术设计文档。

## No-code statement

本次没有修改 src、tests、数据库 migration、配置或依赖。没有创建 React 组件、IPC handler、repository 方法或播放规则实现。

## Risks and follow-up

- 资产聚合使用同步 SQLite，后续实现必须在真实 32 万视频资料库上测量，超过预算时优先拆分懒加载。
- 资产刷新不得复用会启动 scanAllFolders 的 App.refresh。
- 播放说明 helper 不得复制或替代 choosePlaybackRoute。
- 映射盘类型无法从现有路径完全准确识别，V1 使用“本地 / 挂载盘”。
- 下一步建议先独立实现 Asset Center 的 DTO、只读 repository 查询、IPC 和性能测试，再开发页面。
