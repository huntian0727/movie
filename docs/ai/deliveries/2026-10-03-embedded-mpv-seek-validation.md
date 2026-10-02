# 内嵌 MPV 定向 seek 验证交付

## Context

用户批准继续最小验证后的定向测试；本轮只扩展隔离实验，未批准将原型替换正式播放器。开发前本地工作区干净，`ai/embedded-mpv-spike` 的 HEAD 与 GitHub main 一致：`edb45510d8e28a40157b98d35c45cebb4ba058b6`。新分支 `ai/embedded-mpv-seek-validation`。

开发前备份成功：数据快照 `2026-10-02_16-47-53-794_embedded-mpv-seek-validation`；Git checkpoint `checkpoint-20261003-004750-edb4551-embedded-mpv-seek-validation` 已推送。快照包含代码 bundle、SQLite 一致性副本、设置及 manifest；数据库约 0.87GB、345479 视频，quick_check OK。

## Changes

修改文件：

- `scripts/spikes/embedded-mpv/NativeHost.cs`：固定白名单硬解/软解对照，seek/restart 计数及输出模块观测。
- `scripts/spikes/embedded-mpv/probe-main.mjs`：定向矩阵、可信样本名过滤、严格 seek 完成判据、renderer 心跳、手动初始暂停。
- `scripts/spikes/embedded-mpv/preload.cjs`、`probe-ui.js`：实验心跳测量。
- `scripts/spikes/embedded-mpv/README.md`：运行参数、判据、边界说明。

新增文件：

- `scripts/spikes/embedded-mpv/diagnostic-matrix.mjs`：有界八场景、最多三轮重复、宿主逐例释放、失败报告。
- `tests/main/embeddedMpvDiagnosticMatrix.test.mjs`：四项回归，覆盖时间位置更新不等于 seek 完成、实际推进、参数边界及失败清理。
- `docs/ai/reports/2026-10-03-embedded-mpv-seek-validation.md`：真实媒体、UI、性能证据及建议。
- 本交付记录。

删除文件：无。没有修改任何正式 `src/` 业务代码、schema、扫描、文件管理或播放器调用；没有发布 DLL、生成视频、私有路径清单、数据库或运行报告。沿用既有隔离目录和已验证哈希的运行时。

## Verification

真实执行：

1. 使用 Windows 现成 .NET Framework x64 C# 编译器重新编译实验宿主，成功。
2. 固定 Electron 33.4.11，Node spawnSync 等待退出，子进程移除 ELECTRON_RUN_AS_NODE；同一 4K 挂载盘 HEVC/AAC 样本八场景 PASS，重叠/串行交替三轮六场景 PASS，退出码均 0。
3. 加强后的自动检查四个合成格式 PASS；宿主异常隔离、重新启动及正常退出 PASS。中文/空格路径包含在合成测试中。
4. computer-use 实际中性视频窗口验证：全屏、继续、退出按钮 PASS，画面可见；Space / Esc **FAIL**，没有收到键盘动作，保留问题未修复。实验窗口及宿主均清理，既有正式拉面影视窗口仍保留。
5. 定向 Vitest：2 文件、6 测试 PASS。
6. 完整 `npm run test:release-gate`：PASS。包含 lint/typecheck、build、Windows 文件 37 测试、迁移 32 测试、性能子集 25 测试、全部 83 文件 / 755 测试。
7. `npm run prepare:electron`、`npm run test:electron-smoke`：PASS。最终原生模块恢复 Electron ABI 130，启动 app.whenReady 正常。

环境说明：首次门禁启动时 PowerShell 嵌套命令展开 PATH 导致错误使用全局 Node 24，迁移测试因 ABI 127/137 不匹配而失败；不计为成功。改用子进程显式指定 Node 22.23.1 / npm 10.9.8 及 PATH 后整套门禁重跑通过（退出码 0）。没有修改项目固定版本或依赖清单。

整轮真实云盘重复测试 main/renderer 100ms 心跳最大额外延迟约 14.84/16.50ms；这是隔离原型指标，不能当作正式应用全部页面验收。恢复最长 12.956 秒；严格 seek 最长 14.203 秒。一次有实际推进但最终缓存暂停，不能称为持续流畅。

E2E 脚本：项目没有 test:e2e/e2e，不适用。实际声音、长片持续音画、HDR/字幕/音轨矩阵：NOT RUN。打包、安装器、正式快捷方式新包验收：NOT RUN，实验没有接入正式应用。**桌面版本尚未交付**；原有安装包与快捷方式未变更。

代码质量检查在同一工作区完成后，按 AGENTS 使用 `finish-and-push.ps1 -SkipChecks` 避免重复执行与 Node/Electron ABI 再切换；Git 正常推送功能分支及 main，自动备份更新前 main。最终提交号、远端核对与 backup-main 标签以脚本 RESULT 和最终回复为准，不预填未生成 hash。

## Risks and follow-up

- 上轮 4K 失败没有在本轮复现，负面证据仍有效；14 个短片场景不足以保证修复。seek 的位置属性更新可比实际重启早数秒，本轮改进测试判据，不是正式播放修复。
- 串行控制前置等待使恢复阶段通常更短，不等于总耗时下降；未清缓存、未测带宽，不推断唯一网络/硬解根因。
- 原生窗口键盘路由尚未通过，建议下轮只在隔离原型验证焦点转发、连续 seek 合并、明确的读取/就绪状态；不得自动进入正式原生播放集成。
- 同文件本地对照需要单独批准完整本地复制。本轮未执行复制、缓存清空、背景转码或原文件修改。
- 声音实测、持续 4K、字幕/多音轨、HDR、DLL 许可证再分发及安装器仍需后续确认。
- 回滚本轮实验代码可从 checkpoint 建修复分支或 revert 本交付提交，不强制倒退 main；正式数据未因实验变化，无需直接恢复数据库快照。
