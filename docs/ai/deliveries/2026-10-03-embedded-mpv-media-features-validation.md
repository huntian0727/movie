# 内嵌 MPV 短时媒体功能验证交付

## Context

用户要求跳过耗时的长时间播放，继续其他短时验证。开发基准 `17c451c`，工作区干净且与远程 main 一致；独立分支 `ai/embedded-mpv-media-features-validation`。不改变正式播放/扫描/文件管理/数据库/安装包。

开发前备份已成功：快照 `2026-10-03_03-46-45-100_embedded-mpv-media-features-validation`，已推送 tag `checkpoint-20261003-114641-17c451c-embedded-mpv-media-features-validation`。原始媒体和运行报告仅在隔离临时目录。

## Changes

修改 `scripts/spikes/embedded-mpv/NativeHost.cs`、`probe-main.mjs`、`README.md`：仅可选媒体验证模式增加受限音轨/字幕测试命令、匿名状态采样和可信 CLI 场景路由；默认模式仍不开启额外媒体命令/采样，无新增 renderer 任意 MPV 命令入口。

新增：

- `scripts/spikes/embedded-mpv/prepare-media-features.mjs`：生成仓库外中性短片与 SRT。
- `scripts/spikes/embedded-mpv/media-feature-validation.mjs`：四个短时实际 libmpv 场景、回环卡流服务、三个字幕视觉模式。
- `scripts/spikes/embedded-mpv/media-oracles.mjs`：严格轨道/恢复/片段边界判据。
- `tests/main/embeddedMpvMediaFeatures.test.mjs`：3 项回归测试。
- `docs/ai/reports/2026-10-03-embedded-mpv-media-features-validation.md` 及本交付记录。

删除文件：无。未修改 `src/`、正式资源或数据库结构，未提交 DLL/生成媒体/缓存/凭据。

## Verification

- C# 隔离宿主编译：PASS。
- 四个真实场景重复两轮：8/8 PASS。音轨禁用与切换、SRT 切换/隐藏/关闭/恢复、卡流恢复、卡流退出正常；恢复 622/674ms（含 0.6s 进度观察），卡流退出 241/236ms，均自然退出。
- 电脑操作技能实际查看三个窗口：中英文内嵌/外挂字幕正确可见，关闭后不再显示；点击退出并确认宿主结束。视觉结果独立于 JSON 属性结果。
- 默认四格式控制回归：4/4 PASS，未开启媒体功能参数；最终所有测试报告记录的宿主 PID 均已退出。
- 固定 Node 22.23.1 / npm 10.9.8，本轮 `npm run test:release-gate` PASS：lint/typecheck、build、Windows 文件 37 项、迁移 32 项、性能子集 25 项、全量 86 文件/771 项全部通过（子集属于全量，不重复累计）。
- Node ABI127 原生 smoke PASS；随后 `prepare:electron` 和 `test:electron-smoke` PASS，已恢复 Electron ABI130，主进程 app.whenReady 正常。`test:e2e`/`e2e` 脚本不存在，独立 E2E 不适用。
- `git diff --check` PASS，变化仅限上述实验源码/测试/文档，远程 main 提交前仍为 `17c451c`。由于本轮同一工作区已完整执行等价检查，交付脚本使用 `-SkipChecks` 避免重复质量门禁（不是绕过失败）。

## Risks and follow-up

长时间播放/长期内存/4K 持续性能按用户要求 NOT RUN。实际听感/音画同步、HDR/完整字幕音轨矩阵、真实云盘中途断网、无限卡流截止、多 DPI/物理键盘和 DLL 发布合规未验证。不把短时回环卡流或 WASAPI 属性报告为所有真实媒体通过。

本轮只增强实验验证工具。建议下一步审查许可证与正式接入/回退方案，未经确认不自动进入正式播放器改造。桌面版本尚未交付，无新安装包或快捷方式更新。

提交前需完成质量门禁，随后使用现有自动交付脚本正常推送功能分支和 main，并创建旧 main 备份 tag；禁止强制推送。
