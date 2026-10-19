---
date: 2026-10-19
branch: ai/exception-center-workflow
type: feat
status: partial
---

# 异常中心：持久化处理历史

## Context

完成三步异常中心改造的后续部分。现有批量任务只保存在内存中，应用关闭后无法追溯；程序异常退出时也没有可靠的中断标记。本次补齐本地数据库历史、失败摘要与重启后的中断识别。

## Changes

- 新增数据库迁移 v16：`scan_failure_batch_jobs` 保存批量任务类型、处理范围、状态、计数、时间与失败摘要。
- 批量任务提交、取消、逐项进度与完成状态会写入本地数据库；异常汇总最多保留 5 条去重原因。
- 应用启动时将遗留的 queued/running/cancelling 任务标记为 `interrupted`，明确未完成项不会自动重试。
- 新增 IPC / preload 查询接口，异常页显示最近 50 条处理历史。
- 单项清理失效记录改为先确认；确认损坏的视频永久删除继续要求二次确认。
- 更新 `CHANGELOG.md` 和 `docs/USER_GUIDE.md`。

## Verification

- `npm run typecheck`：PASS。
- `npx vitest run tests/main/scanFailureBatchService.test.ts tests/main/databaseMigrations.test.ts tests/renderer/ScanFailuresPage.test.tsx`：PASS，62 项测试通过。
- `git diff --check`：PASS。
- `npm run build`：PASS；Vite 对超过 500 KB 的 JS chunk 有既有体积提示。
- `npm run test:renderer-security-smoke`：PASS，Renderer / IPC 安全 smoke 通过。
- 桌面开发包与桌面快捷方式验收：NOT RUN，后续提交后执行。
- 完整全量测试 / Electron smoke：NOT RUN。

## Risks and follow-up

- 本次新增迁移会把用户资料库 schema 从 v15 升至 v16；开发前已创建可验证的数据库与设置快照。
- 中断任务不会自动恢复或重复执行，用户应先查看历史与异常明细，再决定是否重新提交。
- 批量历史保留在本地数据库；当前界面显示最近 50 条。
- 需完成桌面开发版重新打包、从真实桌面快捷方式启动并验证异常中心与处理历史后，才能标记完整交付。

## Documentation and release impact

- 用户可感知变化：已记录于 `CHANGELOG.md` 的 `[Unreleased]`，教程已更新 `docs/USER_GUIDE.md` 第 8 节。
- 当前属于维护者日常开发版工作，不发布 GitHub Release；公开 0.1.15 包尚不包含此功能。
- 开发前快照：`2026-10-18_17-45-02-043_exception-center-followup`；SQLite `quick_check=ok`，schema v15，363,528 条视频、11 个来源、2,008 条扫描异常记录。
- Git checkpoint：`checkpoint-20261019-0140-b9c6ca0-exception-center-followup`，已推送到 origin。

## Final verification update (2026-10-19)

- `npx vitest run --reporter=dot`: **PASS, 142 test files, 1321/1321 tests** after fixing new IPC contract and synthetic repository mocks. The earlier run failed only because the newly added batch-history repository method was absent from the security and deletion test doubles; these test doubles are now updated. Real production repository retains the required method.
- `npm run build`: **PASS** (Vite reports existing >500 KB JavaScript chunk advisory).
- `npm run test:renderer-security-smoke`: **PASS**.
- `npm run test:electron-smoke`: **PASS** after restoring the pinned Electron 44.7.0 binary and updating the isolated smoke-test repository fixture. Includes SQLite/DPAPI migration and sandboxed preload checks.
- `npm run package:development`: **PASS**; generated `release/win-unpacked` local-development desktop application, not a public Release.
- Desktop shortcut target verified to point to `release/win-unpacked/拉面影视.exe`; launching the actual shortcut created four application processes. Visual interaction with the anomaly and history tabs was **not directly verified** in this remote shell session, so no UI-click acceptance is claimed.
- Full suite showed non-fatal React `act(...)` test warnings and Vite chunk-size advisory; no failing tests in the final run.
- Application assets were built before final Git delivery commit. The desktop package must be regenerated or its build-flavor commit metadata compared after Git commit before claiming code/package commit alignment.
- Added `tests/main/ipcContracts.test.ts`, `tests/main/cloudDriveSecurity.test.ts`, `tests/main/publicReleaseDeletionAdversarial.test.ts` and `scripts/electron-smoke-main.cjs` fixture updates to cover the new batch-history contract without changing deletion restrictions.
