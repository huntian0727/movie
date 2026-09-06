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
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 定向 Vitest：PASS，4 个文件、61 项测试。
- 32 万条异常记录分页性能门禁：PASS，实测首页 100 条查询 246.17 ms。
- 全量 Node release gate、打包和真实桌面快捷方式验证：待交付阶段完成。

## Risks and follow-up

- 重新分析为异步队列操作，“已加入队列”不等于已分析成功；页面会随领域事件和手动刷新更新状态。
- 历史失败若没有对应的活动 `scan_failure`，页面会明确显示“未记录错误摘要”，不会伪造原因。
