---
date: 2026-10-21
branch: ai/duplicate-background-fault-qa
type: test
status: completed
---

# v1.2 重复文件后台清理：隔离 CloudDrive 故障联动 QA

## Context

用户要求按稳定性验收计划继续。v1.2 的排队即隐藏与清理后退出单页目录已经完成，不重复开发。此前队列单测和远端删除单测分别覆盖断连、失败、重启，但尚缺二者在同一隔离数据库与远端模拟器上的连续跨批联动回归。只做本机测试，不触碰真实资料库视频，不推送 GitHub 或公开发布。

## Changes

- 在 `tests/main/reviewedDuplicateDelete.test.ts` 新增两条跨层集成测试，直接串起 `ReviewedDuplicateBackgroundQueue.submit`、`deleteReviewedDuplicatePlan`、真实临时 SQLite 以及模拟 CloudDrive 的远端文件状态与删除回执。
- 案例 1：35 个目标跨越 30+5 两个后台批次，第 5 个目标获得明确拒绝且强制刷新确认仍存在；验证后台 `partial`、34 成功/1 失败/0 未知/0 未提交、失败文件保留在数据库、保留文件不变、失败记录持久化，以及重启不自动重试。
- 案例 2：35 个目标跨越两个后台批次，第 31 个远端请求模拟已提交后断连；验证同波次完成计数、后台 `blocked`、32 成功/1 未知/2 未提交、未知和未提交文件仍保留索引、保留文件不变、持久状态正确，以及重启不自动补发剩余删除。
- 所有文件和 SQLite 数据只在系统临时目录生成；CloudDrive `refresh/delete/binding` 使用受控 mock，**未调用真实 CloudDrive/115 API**。
- 没有修改生产代码、主进程删除策略、设置、数据库 schema、界面文案、显示版本或 Electron 桌面包。

## Verification

- 开发前备份：`2026-10-21_07-51-24-244_duplicate-background-fault-qa`；Git checkpoint `checkpoint-20261021-155122-1f526c4-duplicate-background-fault-qa`，**仅本地**；SQLite quick_check=ok，363216 条视频，快照约 0.92 GB。
- `npm run typecheck`：PASS。
- `npx vitest run tests/main/reviewedDuplicateDelete.test.ts tests/main/reviewedDuplicateBackground.test.ts tests/renderer/queuedDuplicateVisibility.test.ts --reporter=verbose`：PASS，3 文件 25/25。
- `npx vitest run tests/main/reviewedDuplicateDelete.test.ts tests/main/reviewedDuplicateBackground.test.ts tests/main/duplicateResolveSafety.test.ts tests/main/duplicateCleanupJobs.test.ts tests/main/libraryScanner.network.test.ts tests/renderer/queuedDuplicateVisibility.test.ts --reporter=dot`：PASS，6 文件 77/77。
- 先前基线的全量 Vitest（本日 15:39 左右）：149 文件、1386/1389 PASS；另外 3 项发行批准证据失配 FAIL（批准版本 0.1.15 与技术版 0.1.16，及 lockfile SHA 不符）。这 3 项未被修改、绕过或标记为通过。本轮仅新增测试，**未在此次改动后重新跑全量套件**。
- 真正的 115 API、真实网络断连/重连、远端持久化行为：NOT RUN。
- 因无程序代码/用户可见行为变化，Electron 重打包及桌面点击验收：NOT RUN / 不适用。

## Risks and follow-up

- mock 测试可证明应用的计数/状态和本地恢复逻辑，但不能证明 CloudDrive2/115 真实服务端的重复请求、目录刷新、回收站及网络错误语义完全一致。
- 下一阶段宜在维护者**明确批准可销毁的远端测试文件**后，先创建独立 CloudDrive/115 测试目录及哨兵文件，用 2–3 个小样本执行单次清理与意外断连演练；未知回执只能人工核对，不自动重发，也不使用真实影视目录。
- 仅本地 Git 提交，不创建新的桌面版本；日常程序仍为 v1.2，下一次用户可见功能更新才递增 v1.3。

## Documentation and release impact

本次只是测试强化，无用户操作变化，`CHANGELOG.md` 与 `docs/USER_GUIDE.md` 无须改动；原 v1.2 功能实现与既有日常桌面包继续有效。没有 GitHub Push、tag Push、候选 Release 或公开发版。
