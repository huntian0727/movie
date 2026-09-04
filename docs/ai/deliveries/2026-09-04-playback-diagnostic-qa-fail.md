---
date: 2026-09-04
branch: ai/playback-diagnostic-v1
type: docs
status: partial
---

# Playback Diagnostic V1 QA 失败记录

## Context

阶段 4 对 Commit `1c5bd2cf65668b1f5887e0f683899449cec07288` 执行独立 QA。测试确认原播放链路和大部分新增功能正常，但发现两个必须在进入 UI 优化前修正的问题。

## Changes

- 新增 `docs/ai/qa/2026-09-04-playback-diagnostic-v1-qa.md`，记录完整测试证据。
- 确认界面声明支持路径搜索，但现有服务端查询只匹配文件名。
- 确认 319,986 条真实资料库中的搜索会同步阻塞 Electron 主进程约 295 至 325 毫秒。
- 本次只增加文档，没有修改业务代码、测试代码或用户数据。

## Verification

- lint、typecheck、build：PASS。
- Electron 33.4.11 Node 模式完整 Vitest：PASS，61 个测试文件、596 项测试。
- Electron 主进程 smoke：PASS。
- 阶段 4 QA 总结：FAIL，路径搜索正确性和主线程搜索性能为 P1。

## Risks and follow-up

- 在独立修正分支中实现支持文件名或路径的诊断专用服务端分页搜索。
- 将该搜索放入只读异步 worker，保留防抖和迟到响应丢弃。
- 增加仅路径命中、32 万条搜索性能和主事件循环响应门禁，然后重新执行阶段 4 QA。
