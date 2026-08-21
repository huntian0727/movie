# ADR-003：Main 交付与旧版本存档

状态：Accepted（当前有效）

## Context

用户希望 GitHub `main` 始终包含最新合格代码，同时每次更新前保存可追溯的旧版本，方便异常回滚和多 AI 协作。

## Decision

开发在 `ai/<task>` 功能分支完成。自动交付脚本通过检查后提交并同步功能分支，为更新前的远程 main 创建 `backup-main-<时间>-<短哈希>` 注释标签，再使用普通快进 push 更新 main。禁止 force push。

每次交付还必须包含 `docs/ai/deliveries/` 记录，说明修改、验证和风险。

## Consequences

- 远程并发更新或 rebase 冲突会停止交付，需要人工解决，不能自动选择一方。
- 回滚使用 `git revert` 或从 backup 标签创建修复分支，不让 main 指针强制倒退。
- 标签是代码存档点，不是运行时数据备份；用户数据库和媒体不进入 Git。
