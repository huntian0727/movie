---
date: 2026-10-21
branch: ai/size-duration-duplicate-review
type: regression-fix
status: locally-verified
---

# 恢复重复文件的单文件手动删除入口

## Root cause

Commit `47a171a` 将重复文件清理从旧的 `onAutoDelete` 快速路径切换为 `onSubmitCleanup` 的两阶段安全流程。组内垃圾桶按钮仍然以 `onAutoDelete` 是否存在作为渲染条件，而 `LibraryShell` 已移除该旧回调，因此按钮整项不再渲染。这是安全流程迁移时遗漏的 UI 接线回归，不是产品决定取消单文件删除。

## Fix

- `src/renderer/components/DuplicateGroupsPage.tsx`：组内垃圾桶按钮改为依赖 `onSubmitCleanup`，并提交仅包含所点击文件的一项清理计划。
- 选择当前计划保留文件时，自动选择组内另一份作为计划保留文件；被点击的文件仍是唯一删除候选。
- 单文件操作会创建新的大小/时长核对任务并打开后台任务面板。核对阶段不删除；核对完成后仍需用户检查结果并输入大写 `DELETE` 二次确认。
- 按钮增加提示，说明这只是创建核对任务。文件缺少可验证的 CloudDrive 远端身份时仍保持禁用。
- 更新 `tests/renderer/DuplicateGroupsPage.test.tsx`、用户指南、快速开始、功能说明、ADR、CHANGELOG 和当前项目状态文档。
- 没有恢复旧的直接/自动永久删除通道，没有更改 CloudDrive 权限，也没有对真实视频执行删除。

## Verification

- `tests/renderer/DuplicateGroupsPage.test.tsx` + `tests/main/duplicateCleanupJobs.test.ts`：73/73 PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS（项目 lint 脚本调用 typecheck）。
- `npm run package:development`：PASS；Windows x64 本地开发版打包、NativeHost 构建、Electron ABI 和 SQLite smoke 均通过。
- 桌面快捷方式 `拉面影视.lnk` 指向新版 `release/win-unpacked/拉面影视.exe`；真实启动后观察到 4 个应用进程。构建标记为 commit `a10f20772347f98369b207db0adcab1b0be1e8fe`，`workspaceDirty=false`。
- 更新前程序已备份至 `.tmp/daily-rollback-single-file-delete-20261021-021354/`。
- 已知全项目 Node 回归的 3 个历史发行证据失败仍未解决：审批材料记录的版本 0.1.15 与 package 0.1.16 不一致，以及 package-lock 哈希固定值不一致。此次 73 项聚焦测试全通过。

## Release boundary

本次仅更新家里电脑上的本地开发版。没有推送 GitHub、创建 Release 或公开分发安装包。真实 CloudDrive 文件的永久删除未执行；GUI 中手动点击实际视频删除按钮仍应由用户在测试资料上验收。
