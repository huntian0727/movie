---
date: 2026-10-21
branch: ai/duplicate-cleanup-resilience
type: robustness-and-ux
status: local-development-qa
---

# 重复文件：安全实测、页面收敛、批量进度及已确认失败重试

## 任务背景与用户约束

用户已确认旧版单文件一次确认与当前页批量清理体验，并要求后续继续完成：隔离删除测试、清理页主次入口、批量进度/断网结果/失败重试。重复识别遵守既定业务规则：精确文件大小和四舍五入到整秒的视频时长；不读取整个视频内容计算哈希。删除前仍需重新核对文件状态与安全路径，且所有永久删除均经过显式人工确认。只允许更新家里电脑 MP2T8QB5 的本地开发版；不得使用办公电脑，不得未经用户授权推送 GitHub 或发布公开版本，不得拿真实影片做无人值守永久删除测试。

## 工作区与备份

- 派生基线：`ai/duplicate-cleanup-ux-restore` 分支 HEAD `f1d2380`；当前独立分支 `ai/duplicate-cleanup-resilience`。
- 前置备份已完成：snapshot `2026-10-21_00-38-08-904_duplicate-cleanup-resilience`，位于 `%USERPROFILE%\Documents\映匣备份\`；0.92 GB SQLite 一致性备份、363528 条视频记录、quick_check=ok。Git 本地 checkpoint `checkpoint-20261021-083807-f1d2380-duplicate-cleanup-resilience`；未上传任何 tag。
- 未重置、覆盖、删除此前的本地开发改动；当前修改仅针对相关页面/样式、测试和文档。

## 实际修改

1. `tests/main/publicReleaseDeletionAdversarial.test.ts`：在 Windows 本机系统隔离临时目录中对主进程真实批量删除 IPC 执行部分成功案例：一份受管文件正常删除、一份索引后的内容/版本变化、一份源文件不存在。结果仅确认成功 1 项、失败 2 项；失败记录仍保留，受管文件变化不会被误删。不接触真实媒体库，测试结束自动清理临时夹。
2. `src/renderer/components/DuplicateGroupsPage.tsx`：收敛页面入口。单文件行末垃圾桶、当前页批量清理为主要操作。检查缺失、CloudDrive 旧库快速身份绑定、后台任务、可选“验证当前页”等置于默认折叠的“高级核对与维护工具”，而不是同时与主要清理按钮平铺竞争。
3. 当前页删除单次预检、100 条一批的 IPC 执行流程，新增进度/确认数量/成功/失败；当批次返回明确失败 ID 时，只允许用户显式打开“仅重新核对失败项”二次确认，对那些 ID 重新预检，再调用现有受管文件安全删除。不会自动重复提交。
4. 对 IPC 通信整体拒绝/网盘掉线，不能假定该批文件都失败：保留已经确认的前序成功及失败数量，标识当前批次结果**未知**，后续批次不继续提交。提示必须刷新与人工核对，不能把未知 ID 自动加入重试选择。
5. `src/renderer/styles.css` 添加低视觉干扰的高级工具折叠区、清理进度 UI 样式。
6. `tests/renderer/DuplicateGroupsPage.test.tsx` 增加单批进度、批次中断未知结果、明确失败后新确认+新预检重试、主次按钮折叠、恢复原有单项和批量保护等回归测试。没有修改旧 `duplicateFastDelete` 受限 IPC 或文件安全永久删除核心方法。
7. `CHANGELOG.md`、`docs/USER_GUIDE.md`、`src/renderer/components/README.md`、`docs/ai/CURRENT_STATE.md` 同步本地未发布差异。

## 已完成验证

- 聚焦测试 `tests/main/publicReleaseDeletionAdversarial.test.ts` + `tests/renderer/DuplicateGroupsPage.test.tsx` + `tests/renderer/duplicateSafetyStyles.test.ts`：61/61 PASS（3 文件）。
- `npm run typecheck`：PASS。
- `npm run test:node`：完整执行完成。144 个测试文件中 142 通过、2 个发行证据文件失败；总计 **1340/1343 项通过，3 项失败**。失败均是先前已存在的发布批准证据冻结版本与当前项目不匹配：审批记录的 0.1.15 与当前 package 0.1.16 不一致，`package-lock.json` 的当前 SHA-256 与 `build/release-approval.json` 冻结哈希不一致。具体为 `tests/scripts/releaseEngineering.test.mjs` 1 项、`tests/scripts/sourceReleasePipeline.test.mjs` 2 项；没有更改或伪造发布批准材料。其余与清理有关的回归均通过。
- `npm run lint`：PASS（当前 lint 实际执行 TypeScript 类型检查）；`npm run package:development`：PASS，Vite 客户端构建、原生 NativeHost、Electron 44 ABI149、SQLite native smoke 和 Windows x64 本地打包均成功。
- 本轮桌面交付：得到用户先前明确授权后关闭日常程序原 4 个运行进程；在 `.tmp/daily-rollback-duplicate-resilience-20261021-085512/` 备份之前的 exe、`resources/app.asar` 和构建标记。已使用 `release/win-unpacked/拉面影视.exe` 生成新包，实测桌面 `拉面影视.lnk` 快捷方式的目标与该 exe 一致，并从实际快捷方式启动，5 秒后进程数为 4。
- 首轮桌面构建时间 `2026-10-21 08:55:40`，`app.asar` `08:55:39`，构建标记 `6f3dc27ed7183810be7015fced771f3631bc640d`、`workspaceDirty=false` 且与首轮打包时 HEAD 一致。此次更新交付文档会形成后一笔仅文档提交；此后需重新打包以保持构建标记与最终 HEAD 一致。真实 GUI 删除点击和网盘删除未代替用户验收。
- 真实 CloudDrive2 挂载文件永久删除：NOT RUN（仅允许隔离临时资料，无授权删除真实影片）。

## 仍需关注的边界

- 文件大小+整秒时长相同不保证媒体内容字节相同；用户必须核对保留对象。此行为是用户指定的判重口径。
- Windows CloudDrive 虚拟挂载与重解析路径支持因实际文件系统而异，若操作被安全检查拒绝不能绕过，需要在专门授权的测试目录验证。
- 仅由后端明确返回的失败文件可重试；对整个请求中断造成的“结果未知”不自动重试、不当成 0 成功/0 失败。
- 全项目此前存在 3 项历史发行审批版本与依赖锁文件的固定证据校验失败（项目 0.1.16 对审批 0.1.15），本轮仍需如实核对；用户未批准更改发行材料。
- GitHub Push/Release：严格暂停；用户手动批准后才考虑正式发版。
