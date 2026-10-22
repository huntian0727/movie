---
date: 2026-10-22
branch: ai/release-notes-classification-policy
type: docs
status: completed
---

# 建立发版差异说明与三类优化记录规范

## Context

用户明确规定：今后每次发布版本，都必须写清楚相较于上一个版本优化了哪些内容；开发过程中就应持续记录，并按安全类、性能类、功能增加类分类。

## Changes

- 在 AGENTS.md 增加长期强制规则，要求每次发版以上一个正式 Release/tag 为比较基线。
- 在 docs/DEVELOPMENT_AND_RELEASE.md 规定开发时持续记录、最终版本差异核对和发行说明必备内容。
- 在 docs/ai/deliveries/TEMPLATE.md 增加每项开发任务的分类与验证记录字段。
- 新增 docs/releases/TEMPLATE.md，供 docs/releases/<版本>.md 与 GitHub Release 正文复用。
- 在 docs/ai/CURRENT-HANDOFF.md 记录该用户约定，方便后续 AI 程序员接手。
- 所属类别：纯内部维护（开发规范和发布文档模板，不属于产品功能更新）。
- 本次只修改开发文档；未更改应用功能、版本号、桌面包或 CHANGELOG 中的用户功能条目。

## Verification

- 文档与模板结构检查：PASS（6 个必需文件存在；三类栏目齐全；上一个正式版本比较基线已明确）。
- 开发前备份：snapshot 2026-10-22_00-46-06-591_release-notes-classification-policy；checkpoint tag checkpoint-20261022-084600-15a8280-release-notes-classification-policy；SQLite quick_check=ok（363,039 条视频）。备份脚本已将 checkpoint tag 推送到 origin；本次没有推送源码或发布版本。
- git diff --check：PASS（无空白错误）。
- 代码测试：不适用，本次仅文档规则修改。
- GitHub 源码推送与公开 Release：未执行；按当前项目约束保持本地修改。

## Risks and follow-up

- 新规则需要后续开发任务持续执行；今后每完成一项用户可见改动，就同步更新 [Unreleased] 和对应交付记录。
- 下一次正式发版时，需按 docs/releases/TEMPLATE.md 生成实际版本说明，并核对上一个正式 Release/tag 到最终候选 Commit 的差异。

## Documentation and release impact

- 已更新项目开发规范和交付模板，不改变当前对外发布状态。
- 本次为内部流程文档，不增加 CHANGELOG 的用户功能条目，无需修改用户教程。
- 本地分支：ai/release-notes-classification-policy；未提交、未推送。
