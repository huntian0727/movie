# v1.6 — 候选组清理按钮

- 日期：2026-10-22
- 电脑：家里电脑 MP2T8QB5
- 开发分支：`ai/per-group-queued-cleanup-button`
- 开发基线：`92cf198`
- 界面版本：`v1.6`（技术包版本仍为 `0.1.16`）
- GitHub：本次不推送、不公开发布。

## 功能

- 每个候选组标题栏右侧增加「清理本组」按钮。
- 确认窗口展示计划保留文件、其他待清理文件清单、预计释放空间。
- 提交为一个现有 FIFO 后台任务；单任务上限 500 个待清理文件。
- 只有任务受理且数量匹配后才关闭确认窗口并暂时隐藏本组；队列拒绝时保留候选组和确认窗口。
- 提交前核对候选组成员没有变化、计划保留文件仍存在且组内没有文件处于待删除状态。
- 复用现有排队可见性逻辑：组内所有非保留文件被队列确认后，本组立即暂时隐藏；任务结束后根据真实结果刷新，失败项重新显示。
- 不修改全局优先保留目录设置，不在 UI 中直接删除文件；后台结果未知时不自动重试。

## 验证

- 针对性测试：`npx vitest run tests/renderer/DuplicateGroupCleanupButton.test.tsx tests/renderer/DuplicateGroupsPage.test.tsx tests/renderer/queuedDuplicateVisibility.test.ts` — 3 个测试文件、66 项通过。
- 类型检查：`npm run typecheck` — 通过。
- 真实网盘删除：未执行。
- 桌面构建：`npm run package:development` 通过，输出目录已隔离到 `release/daily-v1.6/win-unpacked`。
- 包内版本标记：`displayVersion=1.6`，构建源码提交 `171d36b2fdde5d7bea3b04ad6d9f81995af2d0c1`，技术版本 `0.1.16`；已确认打包后的 renderer 资源包含「清理本组」按钮。
- 打包启动冒烟：`node scripts/run-packaged-smoke.mjs --executable release/daily-v1.6/win-unpacked/拉面影视.exe` 退出码 0；隔离临时数据目录中的 `packaged`、`databaseQuickCheck`、`structuredLogCreated`、`databaseReopenedAfterExit` 和各查询 worker 检查均通过。该测试使用独立临时用户数据和 1 条模拟视频，不代表执行过真实删除。
- 桌面快捷方式和开始菜单快捷方式都已更新并核验，目标为 `C:\\Users\\test\\Documents\\视频管理\\movie\\release\\daily-v1.6\\win-unpacked\\拉面影视.exe`。更新前快捷方式备份在 `.tmp/daily-v16-shortcuts-backup/`。
- 部署时仍有 4 个 v1.5 进程运行；未强制关闭，以免中断潜在的真实后台清理。由于应用使用单实例锁，未在旧进程仍运行时尝试普通启动 v1.6（否则会激活旧窗口）。请在旧版任务结束后正常退出，再从桌面快捷方式启动 v1.6。
- `CHANGELOG.md` 已在工作区添加 v1.6 记录，但由于该文件本来就包含之前遗留的无关修改，未将整个文件纳入本功能提交；原有修改均保留。

## 备份与保留

- 使用同一基线上的既有本地检查点：`2026-10-21_17-59-57-660_duplicate-directory-scope-view`。
- Git 检查点标签：`checkpoint-20261022-015955-92cf198-duplicate-directory-scope-view`。
- 数据库快照核验：SQLite quick_check=ok，363039 条视频。
- 开发开始时已有的 5 项无关工作区修改均保留，不纳入本功能提交。
