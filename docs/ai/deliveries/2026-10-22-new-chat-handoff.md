# 拉面影视（视频管理项目）新会话交接 — 2026-10-22

## 重要：以本文件为最新交接，不要直接相信旧 CURRENT-HANDOFF 的 v1.2 状态

用户希望新 ChatGPT 接手开发，继续使用家里电脑 MP2T8QB5 的 `WebCodex Home`，少问多做；个人项目绝对不使用公司电脑。当前不要重新设计发版/审计流程，也不要因历史测试重新走大量质量门禁。日常 Windows 桌面更新与 GitHub 公开发版是两件不同的事。

### 1. 实时核对过的工作区

- 本地源码：`C:\Users\test\Documents\视频管理\movie`
- **本地分支：** `ai/fix-duplicate-background-banner`
- **本地 HEAD：** `7224249dc3f9abf673aa6f197bfb2a718464928f`（`docs: verify daily v1.4 shortcut deployment without stopping v1.3`）
- **远程该分支未推送**：`git ls-remote --heads origin ai/fix-duplicate-background-banner` 无结果。不要因为本地已提交就声称 GitHub 已包含 v1.4。
- **有 5 个与本功能无关的旧未提交文件，必须原样保留，禁止 reset/clean/盲目 git add .：**
  - `.github/workflows/windows-ci.yml`
  - `CHANGELOG.md`
  - `docs/ai/CURRENT-HANDOFF.md`
  - `tests/scripts/sourceCommunityWorkflow.test.mjs`
  - `docs/ai/deliveries/2026-10-21-windows-ci-expired-btbn-qa-pin.md`（untracked）
- **当前源代码显示版本：** `src/shared/displayVersion.json` = `1.4`；技术包 `package.json` 为 `0.1.16`。

### 2. 桌面实际使用状态 — 非常重要

- 家里电脑桌面快捷方式：`C:\Users\test\Desktop\拉面影视.lnk`，已核对真实 TargetPath：`C:\Users\test\Documents\视频管理\movie\release\daily-v1.4\win-unpacked\拉面影视.exe`。
- **快捷方式的新目标已完成 v1.4 部署**；该目录 `resources/build-flavor.json` 的 `displayVersion=1.4`，`commit=638c405146169bf3b2373800702944cce1e593f4`；EXE SHA256 `EFDDD91747198B0152EEE265E80815DB5ECD24C1715B9B55685C32F30A9AEE7A`。
- **但是截至最新核对，旧 v1.3 仍在运行：4 个 `拉面影视.exe` 进程的路径全部是旧的 `release\win-unpacked`。** 不要主动强制结束旧实例或中断可能正在执行的真实清理任务。等用户正常结束后台清理、退出整个旧程序，再双击原桌面快捷方式，才会启动 v1.4。不能把改动快捷方式误称为旧运行窗口已升级。
- 旧 `release/win-unpacked` 仍完整保留，`resources/build-flavor.json` 为 v1.3；v1.2 回滚版：`release/win-unpacked-backup-v1.2-before-v1.3-20261022`。
- 新包已在隔离环境执行 packaged smoke PASS，日常真实视频数据库和文件未覆盖。

### 3. 已完成的最近三项功能

**A. 重复文件后台清理状态条不消失 / 每个菜单都存在**
- 本地提交 `36d7929`：`ReviewedBackgroundStatus` 对成功 `completed` 不显示永久进度条；只有「重复文件」页显示相关状态；`partial/blocked/interrupted` 异常仍可展开核对。`LibraryShell` 继续后台轮询状态，不依赖页面是否打开。
- 已有 79 项相关回归 PASS，TypeScript 检查 PASS。

**B. 播放器倍速**
- 本地提交 `5a928a5`：浏览器 HTML5 `<video>` 和内嵌 MPV 增加速度 `0.5× / 0.75× / 1× / 1.25× / 1.5× / 1.75× / 2×`，默认 1×，当前播放器窗口切视频保留选择。C# `NativeHost.cs`、IPC schema、遥测 snapshot 均已修改；外部独立播放器需要在其自身窗口调整。
- 95 个目标测试通过，NativeHost C# 已成功隔离编译；没有证明真实人工听音/主观画质已验收。

**C. 多任务重复清理后台队列 — 最新需求已完成代码、打包 v1.4**
- 提交 `c855922a939603100ad7c17ec4371b7863e77da7`；版本提交 `638c405146169bf3b2373800702944cce1e593f4`；部署核验文档提交 `7224249...`。
- 解决“第一个删除任务在后台执行时无法提交第二个任务”：**允许继续提交新的已确认任务，但保持远端删除单工作线程、顺序 FIFO 执行，绝不并发发送高风险删除请求**。
- 单任务 1–500 文件；最多 20 个等待任务；同一待删视频不得重复排队；保留文件与后续删除目标冲突会拒绝入队；每批 30 文件执行并持久化检查点。
- `reviewed-duplicate-background.json` v2 原子检查点，支持迁移旧版 v1；历史最多 25 条。重启时未确定结果不自动重试，尚未运行的任务需要重新确认；某批远端结果未知/异常，后续等待队列不继续冒险删除。
- UI 在重复文件页显示当前任务与等待 N 项、支持查看任务概要；已经入队的目标暂时从重复列表隐藏；别的菜单不被进度条占用，全部正常完成后自动隐藏。
- 测试：主进程 stub/隔离测试 26 PASS，renderer/queue 相关 108 PASS，重复页/队列可见性 63 PASS，TypeScript PASS。**未执行真实网盘删除测试**。
- 详细 `docs/ai/deliveries/2026-10-22-multiple-reviewed-delete-queues.md`。

### 4. 下一步执行顺序

1. 连接家里电脑（不是办公电脑），先 `git status --short --branch`、`git rev-parse HEAD`，读取本交接和三份 10/22 交付记录；不要把 GitHub PR 的旧 v1.2 状态混成当前本地 v1.4。
2. 用户正常结束旧 v1.3 进程后，核对通过原桌面快捷方式启动的实际进程 EXE 是否在 `release/daily-v1.4/win-unpacked`，窗口左上角是否 v1.4。不能在有运行中删除任务时强制重启，也不能擅自删除真实网盘文件。
3. 若用户继续反馈新问题：直接本地实现 + 针对性测试 + 确认构建成功；**每次更新常用桌面版**，一次功能迭代仅 `npm run version:minor` 一次（v1.4→v1.5），先在隔离目录运行 `MOVIE_SAFE_STAGE_LOCAL=1 npm run package:development`；保留旧目录作为回滚，如果旧应用仍运行，将新版本放独立 `release/daily-v1.5/win-unpacked` 并安全更新快捷方式，绝不强杀旧进程。详见 `docs/ai/DAILY-DESKTOP-UPDATE-POLICY.md`。
4. 正式 GitHub 公共发版**目前尚未授权本轮自动执行**；优先把常用桌面版稳定可用。避免为了普通修复每次跑上千项重复测试或企业级门禁。
5. 公开代码进展与日常桌面不同：仓库 `huntian0727/movie`，最新公共 Release v0.1.15；技术候选 v0.1.16。GitHub [Draft PR #29](https://github.com/huntian0727/movie/pull/29) 是较早的 `ai/native-runtime-candidate-integration`，仍 open/draft，不包含当前未推送 v1.4 的最新本地提交。新原生 MPV/FFmpeg 私有候选构建 run 39612312642 SUCCESS；组件来源/再分发审批与实际人工验收另行处理，不要伪造批准记录或把 private QA 包公开发布。

### 5. 代码与测试入口

- 多任务删除执行器：`src/main/media/reviewedDuplicateBackground.ts`（`ReviewedDuplicateBackgroundQueue`，`MAX_TOTAL=500`、`MAX_PENDING_JOBS=20`、`CHUNK_SIZE=30`）。
- 删除 IPC：`src/main/ipc.ts`，计划/队列模型：`src/shared/videoTypes.ts`。
- 重复页交互：`src/renderer/components/DuplicateGroupsPage.tsx`、`LibraryShell.tsx`、`ReviewedBackgroundStatus.tsx`、`queuedDuplicateVisibility.ts`。
- 主进程测试：`tests/main/reviewedDuplicateBackground.test.ts`、`reviewedDuplicateDelete.test.ts`。
- UI 测试：`tests/renderer/LibraryShell.test.tsx`、`ReviewedBackgroundStatus.test.tsx`、`DuplicateGroupsPage.test.tsx`、`queuedDuplicateVisibility.test.ts`。
- 播放器：`src/renderer/components/PlayerPage.tsx`、`src/main/embeddedPlayer/embeddedPlayer.ts`、`native/embedded-mpv/NativeHost.cs`、`src/shared/embeddedPlayback.ts`。
- 版本与本地打包：`src/shared/displayVersion.json`、`scripts/package-development.mjs`、`scripts/run-packaged-smoke.mjs`、`scripts/project-backup.ps1`。执行本地备份务必传 `-LocalOnly`，避免脚本误推 checkpoint tag。
- 10/22 交付文档：`docs/ai/deliveries/2026-10-22-duplicate-background-progress-auto-hide.md`、`2026-10-22-player-speed-controls.md`、`2026-10-22-multiple-reviewed-delete-queues.md`、`2026-10-22-v13-daily-desktop-update.md`。

### 6. 用户执行偏好与安全约束

- 少问多做，连续处理，阶段内部记录，最终一次性汇报；普通错误自主排查。切勿频繁问“继续吗”。
- **只在家里电脑做项目**；办公电脑不得用于个人视频管理开发。
- 日常桌面必须真更新，不得仅改代码、GitHub 或生成无人使用的测试包。
- 强调安全：真实视频、115、CloudDrive 的不可逆删除，必须依已确认计划与服务器实际回执执行；有任何远端结果未知，不自动重试、不跨任务盲目续删。
- 原真实 SQLite 视频资料（曾有 363,039 条）不得为开发或验收清空，隔离临时用户目录跑 smoke。
- 本轮用户目的只是继续修复与日常桌面更新，不要自动合并 main、发公开 Release，或将候选质量门禁和过度审计重新引入所有微小改动。
