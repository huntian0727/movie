---
date: 2026-08-16
branch: ai/project-memory-hub
type: docs
status: completed
---

# 建立多 AI 项目记忆入口

## Context

后续会有多个 AI 程序员共同维护项目，需要在 GitHub 内保存首次接手路径、当前状态、代码定位、风险和每轮更新记录，避免依赖原始聊天和重复消耗上下文。

## Changes

- 新增 `docs/ai/START_HERE.md` 作为新 AI 第一入口，并从根级维护文档链接。
- 新增当前状态、代码/需求定位图和风险不变量清单。
- 新增交付记录目录与模板。
- 自动交付脚本要求每次提交包含规范的交付记录，测试覆盖缺失记录的拦截。
- 修正架构文档中 schema 只写到 v6 的过期表述。

## Verification

- `finish-and-push.ps1 -ValidateOnly`：PASS，识别正确仓库、分支、质量脚本和本轮交付记录，未产生 Git 写操作。
- `tests/scripts/finishAndPush.test.ts`：PASS，3/3；覆盖正常功能分支交付、旧 main 标签存档、功能分支 upstream 保持、无强推以及缺少交付记录时拒绝。
- `npm run test:release-gate`：PARTIAL；lint、build、37 个 Windows 文件测试、23 个迁移测试、19 个性能/缓存/播放器测试通过，最后的嵌套环境检查因读到全局 npm 11.9.0（项目要求 10.9.8）主动停止。
- 固定 Node 22 直接运行全量 Vitest：PASS，43 个测试文件、410 个测试通过。
- Node native smoke：PASS，ABI 127；Electron smoke：PASS，Electron 33.4.11 / ABI 130；随后已 rebuild 回 Node ABI 127 并复验通过。
- production build：PASS（包含在 release gate 已通过阶段）。
- Electron 桌面人工验证：NOT RUN；本轮不改变桌面业务或界面。

## Risks and follow-up

- 当前状态文档仍需每次功能交付主动维护；脚本只能保证存在交付记录，不能自动证明内容正确。
- 历史设计文档保留且可能包含过时事实，新 AI 必须遵循入口文件中的可信度顺序。
