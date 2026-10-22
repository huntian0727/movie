---
date: YYYY-MM-DD
branch: ai/example-task
type: feat|fix|docs|chore
status: completed|partial|blocked
---

# 交付标题

## Context

为什么进行本次修改，用户问题或维护目标是什么。

## Changes

- 实际修改的行为、代码和文档。
- 重要设计选择及其原因。

## Verification

- `命令`：PASS / FAIL / NOT RUN，并说明真实结果。
- 人工验证：结果或“需要验证”。

## Risks and follow-up

- 尚存风险、兼容性影响、下一步建议。

## Documentation and release impact

- 用户可感知变化：对应 `CHANGELOG.md` Unreleased 条目与教程章节；内部维护无需修改教程时写明原因。
- 实际桌面交付身份/入口与公开下载状态：开发版、候选版或已发布版本，不能混写。
- 发版任务：版本教程、README/快速开始、发行说明和 Release 链接同步情况；非发版任务记“不适用”。

## 版本差异记录（开发期间持续维护）

- 预计进入版本：vX.Y / 尚未确定
- 对比基线：上一个正式 Release/tag（尚未确定时写明待确定）
- 所属类别：安全类 / 性能类 / 功能增加类 / 纯内部维护
- 改动与解决的问题：
- 用户实际能感知的变化：
- 验证状态：PASS / FAIL / NOT RUN（分别注明本机、CI、桌面/人工验收）
- 未验证项与已知限制：
- 是否已同步 CHANGELOG.md 的 [Unreleased]：是 / 否
