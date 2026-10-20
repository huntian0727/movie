---
date: 2026-10-21
branch: ai/duplicate-cleanup-ux-restore
type: UX-restoration
status: local-qa
---

# 重复项清理恢复首次发行前的简洁操作

## 背景与历史对比

用户反馈：第一次正式打包发行之前，重复文件可直接手动选择文件和确认删除；公开发布安全改造后强制进入“创建后台任务 → 等待核对 → 查看任务 → 输入 DELETE 二次确认”，使用成本明显上升。Git 历史中原 `70e33f4` 的单文件删除弹窗，以及 `47a171a` 的双阶段切换可印证这一交互回归。最近 `a10f207` 仅恢复垃圾桶按钮，未恢复原来快捷使用方式。

## 本地修改

- `src/renderer/components/DuplicateGroupsPage.tsx`：单文件垃圾桶点击后出现简洁确认弹窗，显示文件名/路径/预计大小。确认后才调用自动的重复组、保留对象、精确大小和整秒时长、文件状态与版本预检查；状态发生变化则中止，确认通过才经已有安全受管文件删除接口执行。
- 同一页提供“清理当前页”，只处理当前页各组计划保留者以外的文件；对文件数和预计空间一次确认，自动预检查，按每批 100 个传给已存在的安全视频批量删除入口；结果展示成功数量、失败原因和已释放空间。
- 单文件手动删除不再依赖 CloudDrive API 远端身份；本地和挂载来源由受管来源路径及文件最终状态检查决定是否允许删除。故挂载路径不支持的删除依然会安全失败。
- `src/renderer/components/LibraryShell.tsx`：将已经受控的 `onDelete` 与 `onBatchDelete` 和 `onPreviewDuplicateResolve` 接到重复文件模块；**没有开放 `duplicateFastDelete` 旧快速 API**。
- 用户仍可显式使用“验证当前页”两阶段后台核对；不再强制它成为手动清理的必经步骤。
- `tests/renderer/DuplicateGroupsPage.test.tsx`：增加快捷单项、计划保留者切换、取消确认、状态变化不删除、当前页范围、101 项拆批、缺少 API 身份的受管文件仍可操作等回归测试。
- 更新 `CHANGELOG`、`USER_GUIDE`、`QUICK_START`、`features`、模块 README、决策索引、`ADR-007` 和 AI 状态文档。

## 安全和限制

- 判重只依据精确大小与四舍五入到整秒的时长；**不是内容相同的数学证明**。用户需明确选定保留项并在弹窗确认要删除的文件。
- 删除前主进程读取可信 SQLite 记录、检查组归属和保留计划；最终受管删除校验来源目录、普通文件身份、大小及修改时间，隔离后再次检查，对非普通文件/链接/重解析/版本变化拒绝删除；重命名和恢复不得覆盖现有文件。未改变任何磁盘安全核心方法。
- 当前页预检查与实际删除之间其他人仍可能改动来源文件；每项实际删除时仍由原有安全入口复核文件版本/身份。
- **未进行真实 CloudDrive 网盘媒体永久删除测试**。新交互能显示和调用入口，不代表全部网盘/挂载点都支持原有安全文件删除语义。
- 未推送 GitHub，未创建 Release、未更新公开发行说明或生产安装包。

## 工作区安全

- 原开发基线 HEAD：`d7218c9`，从 `ai/size-duration-duplicate-review` 派生分支 `ai/duplicate-cleanup-ux-restore`。
- 数据快照：`2026-10-20_19-49-21-843_duplicate-cleanup-ux-restore`。
- 对应本地 Git checkpoint：`checkpoint-20261021-034918-d7218c9-duplicate-cleanup-ux-restore`（local-only，未推送）。
- SQLite 备份 quick_check=ok，0.92 GB，363528 条视频记录；快照执行时使用 `-AllowDirty -LocalOnly`，源代码归属仍是已有分支及其提交，不覆盖未提交修改。

## 验证

- 首轮聚焦测试与 TypeScript 检查曾通过，文案变更导致的一项测试断言已同步修正。
- `npm run test:node` 实际完整跑毕，144 个测试文件中 142 通过、2 个发行证据相关失败；共 1338 项中 1335 通过、3 项失败。失败均为既有发行审批证据固定版本/依赖哈希与当前版本不一致：`tests/scripts/releaseEngineering.test.mjs` 1 项、`tests/scripts/sourceReleasePipeline.test.mjs` 2 项。未修改任何发行批准材料以伪造通过。
- `tests/renderer/DuplicateGroupsPage.test.tsx` 全部 46 项通过；`tests/main/duplicateCleanupJobs.test.ts` 全部 32 项通过（均包含在全套 1335 个通过项中）。
- `npm run typecheck`：PASS；`npm run lint`：PASS（当前 lint 脚本实际执行 typecheck）。
- 最终本地 Windows 日常桌面打包及快捷方式启动验收待补记实际结果。
- 真实 CloudDrive API / 挂载删除：NOT RUN（未经用户授权，不动其实际影片）。
