# Risk-Based Low-Token Agent Workflow

## Context

现有五角色体系对小任务也容易全量读取、全员参与并重复转述。本轮仅重构 Agent 基础设施，不修改 `src/`、schema、播放、删除、扫描、CloudDrive 或 UI 业务。

## Changes

- 新增 LITE/STANDARD/FULL 风险选择、升级/降级权限和按需上下文规则。
- 新增约 1160 字的 PM 缓存快照、短 JSON handoff 模板与验证器。
- 新增 workflow selector、定向 Vitest 摘要和机器状态生成脚本；Git 同步结果补充 clean/changed/new/deleted。
- 精简角色规则、Skills、task packet 和 current state；保留既有 Markdown handoff 作为历史证据。

## Verification

- 三项模拟依次返回 LITE/Developer、STANDARD/Developer+QA、FULL/Developer+QA 且 Web Advisor consider。
- PowerShell AST 全部通过；四个 movie Skills 通过 UTF-8 quick validation。
- 固定 Node 22.23.1/npm 10.9.8：定向 agent script tests 10/10；完整 Developer gate 47 files/479 tests PASS，typecheck/build/Node ABI 127 smoke PASS。

## Risks and follow-up

- 本轮无业务代码变化，未运行 Electron/桌面/SMB 门禁。
- 机器状态和 snapshot 都是缓存，使用前必须重新生成或回到高优先级事实源。
- 旧 Markdown handoff 尚未周期归档；应在后续 10–20 个任务或里程碑维护时统一迁入 `docs/ai/archive/`，避免本轮制造大规模文档 churn。
