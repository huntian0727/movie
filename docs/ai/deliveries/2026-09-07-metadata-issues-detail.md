---
date: 2026-09-07
branch: ai/metadata-issues-detail
type: feat
status: completed
---

# 元数据异常明细与重新分析

## Context

资产中心已统计“等待分析”和“分析失败”视频，但只显示合计数。用户无法确认哪些视频仍在排队、哪些已分析失败，也无法查看具体错误或安全重试。

## Changes

- 新增元数据异常 SQLite 分页查询，支持来源、`pending/failed` 状态、文件名/路径筛选，并返回两种状态的独立计数。
- 将当前页视频与活动 metadata 扫描异常关联，展示错误摘要、错误码、最后失败时间和重试次数。
- 新增“元数据异常”侧栏入口、资产中心全局入口和单个资料库快速入口。
- 新增单条与当前页批量优先重新分析。复用现有 metadata queue，操作只读取媒体信息并更新资料库，不删除或修改视频文件。
- 保持现有深色、紧凑表格语言，补全加载骨架、空状态、错误、部分重试失败反馈和键盘焦点。

## Verification

- `npm run typecheck`：PASS。
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 全量 Vitest：PASS，67 个文件、632 项测试。
- 32 万条异常记录分页性能门禁：PASS；工作区全量测试实测首页 100 条查询 279.89 ms，隔离发布门禁复测 235.72 ms，门槛 3,000 ms。
- Node 22.23.1 隔离 `npm run test:release-gate`：PASS，包含类型检查、构建、Windows 文件测试、迁移测试、性能门禁和 632 项全量测试。
- `npm run dist:win`、`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke`：PASS；`app.asar` 共 3,975 个条目且不含禁止的开发文件。
- 桌面快捷方式 `Video Manager (Dev).lnk` 目标与工作目录均指向本次 `release/win-unpacked`，已由该快捷方式启动并确认实际进程路径一致。
- 当前自动化环境未暴露原生 Electron 窗口给截图接口，无法完成像素级人工界面截图复核；渲染挂载、预加载桥接、媒体协议、预览生成和重新生成已由解压版与安装器冒烟测试覆盖。

## Risks and follow-up

- 重新分析为异步队列操作，“已加入队列”不等于已分析成功；页面会随领域事件和手动刷新更新状态。
- 历史失败若没有对应的活动 `scan_failure`，页面会明确显示“未记录错误摘要”，不会伪造原因。
