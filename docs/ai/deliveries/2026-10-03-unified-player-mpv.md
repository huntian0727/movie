# 拉面影视：原播放器界面接入兼容解码

## Context

用户确认：保留原内置播放器完整界面及侧栏功能，只升级兼容解码能力，不以精简 MPV 界面代替原播放器。

开始时工作区干净，基准 `2b0cd7ddd285dcc04c6b931e185a8011c4674446` 与 GitHub main 一致。功能分支 `ai/unified-player-mpv`；本轮未覆盖其他人的修改。

开发前快照 `2026-10-03_05-25-18-658_unified-player-mpv`；已推送 checkpoint `checkpoint-20261003-132515-2b0cd7d-unified-player-mpv`。SQLite 一致性备份 0.87GB / 345479 记录 / quick_check 成功，源码 bundle 与设置备份成功。

本轮实际用户设置为 `embedded-first`，保持不变；没有修改 API 凭据或扫描设置，不沿用上一交付记录对本轮设置的假设。

## Changes

- 所有解码路线使用原 `PlayerPage`。自动兼容路线及浏览器解码失败接入内嵌 MPV，同界面保留进度；显式外部播放仍可选择。
- 原侧边列表、详情、收藏、待删除、删除确认及播放控制复用；独立引擎适配器处理状态、尺寸、可见性、重试和会话清理。
- 修正 Windows 原生画面焦点、组合快捷键和 EOF 续播；弹窗隐藏原生画面，侧栏/控制栏不被覆盖。
- 修正手动外部播放使用当前时间、失败后可重试，以及删除前释放文件句柄；释放失败不删除。
- 诊断及设置文案与实际路线一致。未修改扫描、数据库结构、文件管理服务、删除验证规则或 CloudDrive API。

新增：

- `src/shared/integratedPlayback.ts`
- `src/renderer/components/useEmbeddedEngine.ts`
- `tests/shared/integratedPlayback.test.ts`
- `tests/renderer/UnifiedPlayer.test.tsx`
- `docs/ai/reports/unified-player-mpv.md`
- 本交付记录

修改：

- `src/renderer/App.tsx`、`PlayerPage.tsx`、`PlaybackDiagnosticPage.tsx`、`SettingsPage.tsx`、`styles.css`
- `src/main/embeddedPlayer/embeddedPlayer.ts`、`preload.cts`、`packagedSmoke.ts`
- `src/shared/embeddedPlayback.ts`、`playbackDiagnosis.ts`、`videoTypes.ts`
- `native/embedded-mpv/NativeHost.cs`
- `tests/main/embeddedPlayerBridge.test.ts`
- `scripts/test-embedded-player.mjs`

删除文件：无。旧精简播放组件保留但不再路由。未提交媒体、数据库、设置、凭据、截图、运行日志、运行库或构建产物。

## Verification

本轮使用 Node 22.23.1 / npm 10.9.8 / Electron 33.4.11，分别验证 Node ABI 127 与 Electron ABI 130，不混用系统 Node 24。

最终代码质量门禁全部通过：`test:release-gate` 包含 lint、typecheck、build、Windows 文件 37、数据库迁移 32、性能 25；全量 Vitest 92 文件 / 797 测试。`prepare:electron` 和 `test:electron-smoke` 通过，Electron ABI 130 的原生数据库与主进程启动正常。以上检查在最后一次业务代码修改后完整执行；交付脚本使用 `-SkipChecks` 仅避免重复执行这轮已通过的等价门禁。独立 test:e2e 脚本不存在，不适用。

实际 preload 的 player-role 测试覆盖：受限输入事件、组合键、卸载精确解绑、ID-only 调用、非可信页面无桥接。打包 smoke 检查真实 player API 存在且权限精简，不以完整 mock 代替实包。

生产服务短时集成测试在隔离临时资料库/中性夹具上通过 5 种组合：H264/AAC MP4、HEVC/AAC MP4、HEVC/DTS MKV、VP9/Opus MKV、双音轨/字幕。验证暂停、连续 seek 合并、旋转、音量、全屏、进度保存、迟到 stop 隔离、音轨切换和字幕关闭；本轮增加可见性开关、接近 EOF 后结束状态保持测试，17:17 实际报告 pass=true、failures=[]。未触及用户媒体删除或整库扫描。

预提交桌面包 `package:dir` / `verify:artifact` / `test:packaged-smoke` 已通过；从用户实际快捷方式启动并观察原播放界面：

- 视频画面持续更新，原工具栏和侧栏保持；不是精简试用页面。
- 原进度条 seek、画面点击暂停、空格恢复、右箭头快进、旋转、F 全屏和 Escape 返回窗口实际生效。
- 6 项原目录播放列表加载、封面显示、同窗口选片成功；29 秒短片结束后自动续播下一部，画面和文件名更新。
- 原详情弹窗清晰显示，原生画面不穿透覆盖；播放器关闭正常，重开可恢复播放进度。
- 实机发现的焦点与 keep-open EOF 问题已修正，并补充回归；临时焦点诊断输出已移除。

业务代码提交 `06ee8f6` 已同步功能分支及 GitHub main；旧 main 备份标签 `backup-main-20261003-172957-2b0cd7d`。

提交后最终 `package:dir`、`verify:artifact`、`test:packaged-smoke` 全部成功。快捷方式 `C:/Users/test/Desktop/拉面影视.lnk` 的真实目标为本仓库 `release/win-unpacked/拉面影视.exe`，参数为空；代码提交时间 17:29:49，重新打包的 app.asar 时间 17:30:52，晚于该提交。

从上述实际快捷方式重新启动，使用中性测试目录再次实机验证：原界面持续播放、点击暂停、Ctrl+Right 旋转 90 度且时间保持 00:24、Right 单次快进至 00:29、F 全屏与 Escape 返回窗口、原侧栏 6 项列表及封面完整加载均成功。验收后关闭测试播放器，不删除任何视频。本记录补充提交后会再生成同代码桌面包并启动核对。本轮为便携桌面包更新，不声称生成/安装新的 NSIS 安装器。

真实听音、长时播放、真实 CloudDrive E2E、HTML 与 MPV 混合队列的全屏切换：NOT RUN。删除回调仅 mock 回归，不实际删除用户视频；收藏/待删除接口复用和回归测试，不对用户数据执行验收性标记。

## Risks and follow-up

本机现有 libmpv 运行库已使用，桌面包只带 NativeHost，不含解码 DLL；其他机器需配置运行库。公开分发仍需许可证审查。无法保证所有编码、损坏文件或网络挂载都能播放。

原生子窗口限制使内嵌全屏保留控制区，侧栏停靠而非覆盖。网络播放速度仍受挂载和远端读取影响。本轮不做长期播放测试，按用户要求留到正常使用中。

回滚优先从开发前 checkpoint/快照恢复或创建新的 revert 修复提交，禁止强制倒退 GitHub main；数据恢复必须独立确认范围，不能仅靠源码回滚覆盖当前资料库。
