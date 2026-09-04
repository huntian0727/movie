---
date: 2026-09-04
task: 映匣 UI 增量优化 V1 - 页面与接口设计
status: completed
---

# 映匣 UI 页面与数据接口设计交付

## Context

基于 `docs/ai/reports/ui-enhancement-v1-analysis.md`，对未来 `AssetCenterPage` 和 `PlaybackDiagnosticPage` 进行文档级设计。本阶段禁止修改现有业务代码。

## Changes

- 新增 `docs/ai/reports/asset-center-page-design.md`。
- 新增 `docs/ai/reports/playback-diagnostic-page-design.md`。
- 新增 `docs/ai/reports/ui-enhancement-v1-data-interfaces.md`。
- 明确页面组件树、状态模型、刷新策略、交互入口和性能预算。
- 明确只读聚合接口、分页来源接口、快速诊断接口和可取消深度检测 job 契约。
- 明确 V1 不需要数据库迁移，播放失败统计与详细媒体流持久化留待独立评审。

## Verification

- 对照现有 `VideoRecord`、`SourceFolder`、`LibraryNavigationSnapshot`、`FolderScanStatus`、`DomainEvent` 和 `VideoManagerApi` 检查设计可接入性。
- 对照现有 `LibraryShell`、`VideoDetailsDialog`、`PlayerPage`、`choosePlaybackRoute`、IPC/preload/security 和 repository 边界检查挂载位置。
- 交付前执行 Markdown/Git 差异检查。
- 未运行应用测试和打包：本次仅新增设计文档，不修改 `src/`、数据库、配置、依赖或测试。

## No-code statement

本次没有创建 UI 组件、共享类型、IPC handler、service、repository 方法或数据库迁移，也没有修改扫描、播放、文件管理和已有页面业务逻辑。

## Risks and follow-up

- 风险：资产汇总若错误复用全量视频或来源列表，会重新引入主进程和 renderer 卡顿；实现时必须执行服务端聚合、分页和响应大小测试。
- 风险：深度诊断会访问挂载盘或 CloudDrive；必须保持按需、后台、可取消和文件版本隔离。
- 后续：先冻结数据 DTO 和指标口径，再实现 Asset Center 的数据库聚合与分页。
- 后续：播放诊断先上线完全基于缓存的快速诊断，深度媒体探测作为独立增量。
