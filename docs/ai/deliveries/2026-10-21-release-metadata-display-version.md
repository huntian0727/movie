---
date: 2026-10-21
branch: ai/release-metadata-display-version
type: fix
status: completed
---

# 发行元数据生成与隔离安装 Smoke

## Context

上一轮发现旧 `release/unsigned-test-build` 的 build metadata 和 build flavor 来自不同候选提交，导致 installer smoke 在安装前安全退出。为完成无需用户配合的安装验收，本轮在隔离 Git worktree 重新构建当前源码对应的私有 QA 安装包，并修复了元数据生成器漏掉 UI displayVersion 的问题。

## Changes

- `scripts/write-release-metadata.mjs` 在重建预期 BuildFlavor 时，现读取 `src/shared/displayVersion.json` 并填入 `expectedFlavor.displayVersion`。此前 Electron 打包阶段已经将此字段写入外部与内嵌 `build-flavor.json`，但元数据生成器未补入预期对象，严格比较必然失败。
- 当前代码提交：`ad6e853a671b78028504fd99b12a736badbb7c86`（`fix: include display version in release metadata identity`）。
- 开发前 checkpoint：`checkpoint-20261021-174629-b0f1296-release-metadata-display-version`（local-only）。
- 数据快照：`2026-10-21_09-46-30-766_release-metadata-display-version`；SQLite quick_check=ok，schema v16，363216 视频。
- 为隔离 Electron 原生 ABI，使用 detached worktree：`C:\Users\test\AppData\Local\Temp\movie-qa-unsigned-test-b0f12963`。在该 worktree 安装锁定依赖，并复制经过既有 SHA pin 校验的私有 source-candidate 运行时；未复用主工作区的 Electron native ABI。
- 构建身份是 `unsigned-test-build`，appId `com.local.video.manager.unsignedtest`，UI 标记 v1.2，媒体/播放器均为明确未获发行批准的 `source-candidate`。此包仅供本地 QA，不是公开候选或发行授权。

## Verification

- `node --check scripts/write-release-metadata.mjs`：PASS。
- `npm run typecheck`：PASS。
- `npm run test:media-candidate-contract`：PASS，67/67。
- 隔离 worktree `npm run install:locked`：PASS；Node ABI 127、Electron 44.7.0 / ABI 149 smoke PASS。
- 隔离 worktree `npm run dist:win`：PASS；Vite 构建、确定性 NativeHost 构建、Electron 原生验证及 NSIS unsigned test installer 均完成。NativeHost SHA-256：`215a49e9b9dee51ce758b7a9e1408db2e3a0704670ca349c0e314416554171d7`。
- 隔离 worktree `npm run release:metadata`：PASS，成功写入版本/Commit/installer hash 元数据。
- 隔离 worktree `npm run verify:artifact`：PASS，验证 3469 个 asar 条目、17 个精确授权/许可声明文件及无禁用开发产物。
- 隔离 worktree `npm run test:installer-smoke`：PASS，退出码 0。依次验证拒绝非空无关安装目标、在一次性目录安装、带合成用户文件执行修复、明确拒绝误删数据、卸载；包内 smoke create/verify 两阶段通过。合成 SQLite 与视频哨兵在安装内外均保留，正式 app 注册信息和桌面快捷方式未变化。
- Smoke 日志中针对不受信任页面触发的 `ERR_UNTRUSTED_IPC_SENDER` 为预期安全拒绝，对应断言通过，不是安装失败。
- 此候选由 Commit `ad6e853` 构建并通过测试；后续如只增加交接文档提交，QA 构建身份仍准确记录该代码 Commit。没有复制或覆盖主工作区的旧 `release/unsigned-test-build`，旧候选仍保留供追溯。

## Remaining blockers (do not auto-approve)

- 完整 `npm run test:node` 最近一次为 1388/1391，3 个失败仍是历史审批版本 0.1.15 与当前 package.json 0.1.16、package-lock SHA 不匹配。此 QA 修复没有修改审批记录，也没有把这 3 项改成通过。
- FFmpeg/mpv/第三方二进制正式分发合规审批、对应私有 REVIEW ZIP、稳定 Windows 11 标准用户人工覆盖、当前版本的所有者重新审批仍需维护者/所有者最后确认。
- 真实字幕源匹配/下载、用户实际播放切换体验、真实 CloudDrive/115 删除/断连仍未验收；真实删除按用户要求继续暂缓。

## Documentation and release impact

- 只改内部元数据工具，无桌面用户可见行为变化；界面版本仍 v1.2，未重新生成或替换日常快捷方式指向的 `release/win-unpacked\拉面影视.exe`。
- 私有 QA installer 只存在于上述临时 worktree；无 GitHub Push、tag、Release 或公开发布。
