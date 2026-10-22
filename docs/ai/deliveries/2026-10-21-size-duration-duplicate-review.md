---
date: 2026-10-21
branch: ai/size-duration-duplicate-review
type: fix
status: partial
---

# 重复文件改回大小＋时长判定（本地）

## Context

用户确认重复判定既定规则：精确文件大小相同、视频时长按既有分组规则取整秒后相同即可归为重复候选，不应为每部网盘视频读取完整内容并计算 SHA-256。以前的“完整验证”使 CloudDrive 视频大量显示“无法验证（不删除）”，影响工作流。

接管时工作树已经存在 20 个被修改的受控文件与新的 ADR-006；本轮只延续当前分支和改动，没有重置、覆盖历史工作或触发任何真实删除。

## Changes

- `src/main/media/duplicateCleanupService.ts`：大小/时长与文件版本/身份的非内容核对，删除前保留文件系统、路径、大小/修改时间及身份重复核对、隔离、恢复、二次确认；不再以 SHA-256 作为候选确认条件。
- `src/main/db/duplicateCleanupRepository.ts`：保留原有数据库状态值但清空过时 SHA 字段，核对后存储文件身份，且在删除阶段要求有效的核对身份与授权。旧 workflowVersion=3 API 快速删除任务仍不可重新启用。
- `src/main/media/duplicateResolveSafety.ts`、`src/main/files/scanFailureActions.ts`：修正展示和保护文案，取消不必要的完整哈希口径。
- `src/renderer/components/DuplicateCleanupButton.tsx`、`DuplicateCleanupTasksPanel.tsx`、`DuplicateGroupsPage.tsx`：说明“按大小/时长核对”，区分候选与逐字节相同，永久删除保留人工确认。
- 相关 main/renderer 自动化测试与 `docs/decisions/ADR-006-size-duration-duplicate-review.md`，以及 ChangeLog、用户教程和现状文档同步。
- 修复 `tests/renderer/DuplicateGroupsPage.test.tsx` 对核对提示的严格字符串断言，允许提示插入说明语。
- 未修改真实视频、资料库记录或 CloudDrive 授权。所有生产删除 API 在此次验证中均不被调用。

## Verification

- `npm run typecheck`：PASS。
- 针对重复清理六个测试文件：132/132 PASS。首轮有 1 个中文提示断言不匹配，修复后复跑全通过。
- `npm run lint`：PASS（项目 lint 对应 TypeScript 类型检查）。
- `npm run test:node`：142/144 个文件通过，1329/1332 项通过；3 项 FAIL，均为既有发行审批证据和项目版本不一致：发行批准文件记录 0.1.15，但项目版本 0.1.16；public beta 测试仍断言 0.1.15；正式 release 审批的 package-lock 校验哈希不一致。本次不更新批准材料、不改变发行边界。
- `npm run package:development`：PASS。构建、NativeHost、Electron ABI 及原生 SQLite smoke、Windows x64 本地桌面打包通过。
- 更新前本地旧程序备份：`.tmp/daily-rollback-size-duration-20261021-014932/`，确认保留原 `resources/app.asar`。
- 日常桌面包 `release/win-unpacked/拉面影视.exe`：构建时间 2026-10-21 01:50:38，`app.asar` 01:50:37，构建标记 commit `664c1cd`、`workspaceDirty=false`，与本次交付代码一致。
- 用户桌面快捷方式 `拉面影视.lnk` 的真实目标与新 exe 一致；通过该快捷方式成功启动，观察到 4 个程序进程。
- 没有对用户真实重复视频执行人工永久删除端到端测试：NOT RUN；GUI 实际“重新核对”点击仍需用户验收。
- 真正对网盘视频执行实际删除：NOT RUN（未授权进行真实数据破坏性测试）。

## Risks and follow-up

- 按整秒时长归一化和精确大小相同，不等于内容逐字节一致；程序必须让用户核对所保留的文件，不得默认自动删除。
- 以前因无法完成 SHA 而失败的历史任务可能需要“重新核对大小与时长”或新建清理任务；旧的 workflowVersion=3 快速删除任务仍安全失效。
- CloudDrive 挂载异常、文件元数据变更与虚拟文件身份不稳定仍可能被安全保护拒绝，不应绕过。
- 桌面包已重新生成并通过真实桌面快捷方式启动；仅对启动和包完整性完成验证，不代表网盘重复删除实机验收通过。GitHub Push/Release 未获授权，保持暂停。

## Documentation and release impact

- 用户教程及 CHANGELOG [Unreleased] 保留“未公开发布”口径；ADR-006 作为业务判定约定。
- 仅在家里电脑 MP2T8QB5 更新日常开发版。公共 Release、安装包及在线说明未授权发布。
