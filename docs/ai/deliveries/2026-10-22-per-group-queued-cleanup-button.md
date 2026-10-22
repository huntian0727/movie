---
date: 2026-10-22
branch: ai/per-group-queued-cleanup-button
type: feat
status: completed
---

# v1.6 — 候选组清理按钮

## Context

用户要求在每个重复文件候选组标题栏右侧增加「清理本组」按钮，将除计划保留文件之外的所有文件加入已有后台队列，并在受理后立即隐藏本组。此次维护者授权推送源码到 GitHub；由于 v0.1.16 公开发行审批仍未完成，本次不合并受门禁约束的候选 PR、不创建 tag 或公开 Release。

## Changes

- 每个候选组标题栏右侧增加「清理本组」按钮。
- 确认窗口展示计划保留文件、其他待清理文件清单、预计释放空间。
- 提交为一个现有 FIFO 后台任务；单任务上限 500 个待清理文件。
- 只有任务受理、数量匹配且每个目标 ID 都获得队列确认后才暂时隐藏本组；队列拒绝时保留候选组和确认窗口。
- 提交前核对候选组成员没有变化、计划保留文件仍存在且组内没有文件处于待删除状态。
- 复用现有排队可见性逻辑：组内所有非保留文件被队列确认后，本组立即暂时隐藏；任务结束后根据真实结果刷新，失败项重新显示。
- 不修改全局优先保留目录设置，不在 UI 中直接删除文件；后台结果未知时不自动重试。
- 修正过时的倍速测试：4× 已是受支持选项，测试改为验证 6× 被拒绝。

## Verification

- 针对性测试：npx vitest run tests/renderer/DuplicateGroupCleanupButton.test.tsx tests/renderer/DuplicateGroupsPage.test.tsx tests/renderer/queuedDuplicateVisibility.test.ts — 3 个测试文件、66 项通过。
- 倍速回归测试：npx vitest run tests/main/embeddedPauseConfirmation.test.ts — 15/15 通过。
- 类型检查：npm run typecheck — 通过。
- Electron 主进程 smoke：npm run test:electron-smoke — PASS；环境、原生 ABI、发行身份、CloudDrive 沙箱 preload、safeStorage、资料库迁移与 app.whenReady 检查通过。
- GitHub 源码已推送：分支 ai/per-group-queued-cleanup-button，首轮推送提交 797b852；同时以快进方式更新现有 Draft PR #29 的源分支 ai/native-runtime-candidate-integration。PR 保持 Draft，未更新 main、未创建 tag/Release。
- 远程 Windows CI 对 797b852 的首轮结果：Security audit、Electron smoke、Dependency review PASS；Node gate FAIL，失败原因是 lite-candidate 工具只暂存于 .tmp/native-media-lite-tools，而合成媒体测试要求 native-bin/media-tools/ffmpeg.exe；unsigned NSIS QA 因依赖失败被跳过。
- 本轮补充修复 .github/workflows/windows-ci.yml：哈希验证后显式复制 Lite QA 工具至 native-bin/media-tools；tests/scripts/sourceCommunityWorkflow.test.mjs 3/3 PASS。该补充尚未推送，需提交后快进更新 PR #29 并检查新 CI 终态。
- 完整发布质量门禁：MOVIE_MEDIA_VARIANT=lite-candidate npm run test:release-gate — PASS，退出码 0。第一次运行发现旧测试仍要求 4× 被拒绝；修正为拒绝 6× 后重跑整套门禁通过。
- 桌面构建：npm run package:development 通过，输出目录为 release/daily-v1.6/win-unpacked。
- 包内版本标记：displayVersion=1.6，构建源码提交 171d36b2fdde5d7bea3b04ad6d9f81995af2d0c1，技术版本 0.1.16；已确认打包后的 renderer 资源包含「清理本组」按钮。
- 打包启动冒烟：node scripts/run-packaged-smoke.mjs --executable release/daily-v1.6/win-unpacked/拉面影视.exe 退出码 0；隔离临时数据目录中的 packaged、databaseQuickCheck、structuredLogCreated、databaseReopenedAfterExit 和各查询 worker 检查均通过。该测试使用独立临时用户数据和 1 条模拟视频，不代表执行过真实删除。
- 桌面快捷方式和开始菜单快捷方式均已更新并核验，目标为 C:\Users\test\Documents\视频管理\movie\release\daily-v1.6\win-unpacked\拉面影视.exe。更新前快捷方式备份在 .tmp/daily-v16-shortcuts-backup/。
- 部署时仍有 4 个 v1.5 进程运行；未强制关闭，以免中断潜在的真实后台清理。由于应用使用单实例锁，未在旧进程仍运行时尝试普通启动 v1.6。新版尚未通过实际桌面快捷方式完成启动核对。
- 真实网盘删除：未执行。

## Risks and follow-up

- GitHub Actions 尚需在推送后的最终提交上重新跑完；本机门禁通过不能替代远端 CI 结果。
- v0.1.16 的正式公开发行仍受原生运行库/许可审批与人工验收约束；本次只推送源码，不创建公开 Release。
- 旧版 4 个进程应在后台任务结束后由用户正常退出，再从桌面快捷方式启动 v1.6。

## Documentation and release impact

- CHANGELOG.md 保留 v1.5 倍速和 v1.6 候选组清理的 Unreleased 条目，并记录 Windows CI QA 依赖修复。
- docs/USER_GUIDE.md 已补充「清理本组」操作与安全行为，仍标记为尚未公开发布。
- 本次界面版本 v1.6；技术包版本 0.1.16。未创建公开版本 tag/Release。
- 开发前检查点：checkpoint-20261022-015955-92cf198-duplicate-directory-scope-view；数据库快照核验 SQLite quick_check=ok，363039 条视频。
