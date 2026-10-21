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
- 桌面构建与快捷方式更新：待本次后续步骤完成后补记。

## 备份与保留

- 使用同一基线上的既有本地检查点：`2026-10-21_17-59-57-660_duplicate-directory-scope-view`。
- Git 检查点标签：`checkpoint-20261022-015955-92cf198-duplicate-directory-scope-view`。
- 数据库快照核验：SQLite quick_check=ok，363039 条视频。
- 开发开始时已有的 5 项无关工作区修改均保留，不纳入本功能提交。
