# 修复重复清理完成后状态条常驻（待统一发版）

- 日期：2026-10-22（本地开发），原始代码基线 `4a83c96`，开发分支 `ai/fix-duplicate-background-banner`。
- 用户问题：重复文件后台清理已完成，但页面顶端进度导航条始终存在，且每个菜单都出现；用户另有待修复事项，**全部解决后再统一打包**。

## 复现与根因

`ReviewedDuplicateBackgroundQueue.get()` 为了远端删除审计和重启安全，会长期返回最后一次 `completed` 检查点。原先 `ReviewedBackgroundStatus` 对所有非空检查点都渲染进度条；`LibraryShell` 又无条件把组件放在跨菜单公共顶部，因此即使已经成功结束也会继续展示。

## 这次仅做界面修复

1. `src/renderer/components/ReviewedBackgroundStatus.tsx`：状态为 `completed` 时直接不渲染进度条。`running` 正常展示进度；`partial`、`blocked`、`interrupted` 仍可展开失败、未知结果，不会隐藏待核对的危险状态。
2. `src/renderer/components/LibraryShell.tsx`：清理进度条仅在「重复文件」页面渲染，其他菜单不再被它占用；主进程后台队列和全局状态轮询照常运行，完成后仍刷新资料库与重复列表。用任务 ID 重置不同任务的展开状态。
3. `tests/renderer/ReviewedBackgroundStatus.test.tsx` 与 `tests/renderer/LibraryShell.test.tsx`：增加成功完成自动消失、跨菜单仅在重复页显示、后台轮询切换完成态、部分失败与未知结果不丢失的回归。
4. `docs/USER_GUIDE.md`、`docs/user-guide/0.1.16.md`、`CHANGELOG.md`：同步说明新的显示规则；本次没有修改删除算法、数据库、真实视频或 CloudDrive/115 权限。

## 实际验证

- `npx vitest run tests/renderer/ReviewedBackgroundStatus.test.tsx tests/renderer/LibraryShell.test.tsx`：2 个文件、79 项测试 **PASS**。
- `npm run typecheck`：**PASS**。
- 本地 checkpoint：`2026-10-21_16-03-06-316_fix-completed-duplicate-cleanup-status`，0.92GB SQLite 快速检查 `ok`，363216 条视频；checkpoint 标签 `checkpoint-20261022-000302-4a83c96-fix-completed-duplicate-cleanup-status` **仅本地**，没有推送。
- 当前工作区起始时已有另一组未提交 CI/发行文档和测试改动，这些文件原有修改必须保留；此次修复不应把它们纳入无关提交。

## 交付边界

- 本条为用户提出的第 1 个待修复问题；其他问题尚未收集结束。
- **未重新打包**，未修改桌面快捷方式，也未启动新版桌面程序，因此当前用户正在使用的桌面包**尚不包含本修复**。
- 界面版本现仍为 `v1.2`；等其余修复完成并统一打包时一起执行版本递增，防止同一批修复多次涨版本。
- GitHub 正式发行、PR 合并及真实网盘视频删除测试均未进行。
