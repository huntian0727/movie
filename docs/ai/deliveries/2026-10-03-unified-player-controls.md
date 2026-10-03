# 统一播放器全屏与音轨字幕控件交付

## Context

用户确认继续修复统一播放器：维持原播放界面和侧边栏，不另起一套播放器。本轮分支 `ai/unified-player-controls`；基线 `d29c684ec1474ba20e906de7704503a416d0c9e7`，开始时与远端 main 一致且工作区干净。

开发前备份成功：`2026-10-03_14-27-32-935_unified-player-controls`；checkpoint `checkpoint-20261003-222729-d29c684-unified-player-controls` 已推送，含源码 bundle、设置及约 0.87 GB SQLite 一致性快照，345479 条视频，quick_check OK。

## Changes

新增文件：

- `src/renderer/components/usePlayerWindowFullscreen.ts`：统一窗口全屏状态；并发点击保护、旧回执失效、卸载清理、失败提示。
- `src/renderer/components/EmbeddedMediaControls.tsx`：展示真实解码音轨/字幕，选择音轨、关闭字幕、打开已有 SRT 文件选择入口。
- `tests/renderer/playerWindowFullscreen.test.tsx`：回执竞态和监听清理回归。
- 本交付记录及 `docs/ai/qa/2026-10-03-unified-player-controls.md`。

修改文件：

- `src/shared/embeddedPlayback.ts`：在已有 `player:embedded` IPC 增加严格类型化 `window-state` 请求，不新增通道。
- `src/main/embeddedPlayer/embeddedPlayer.ts`：对已授权播放器窗口独立处理全屏查询/操作，不依赖活动解码 session；其他窗口仍拒绝，旧 stop 仍隔离。
- `src/renderer/components/PlayerPage.tsx`：两种引擎复用窗口全屏；桥接不可用时保留 DOM fallback；新控件只在内嵌模式显示；编辑控件不触发播放快捷键。
- `src/renderer/styles.css`：保留底部控件区域，列表边界同步，避免被原生画面 HWND 遮挡。
- `tests/main/embeddedPlayer.test.ts`、`tests/renderer/UnifiedPlayer.test.tsx`：跨模式全屏、窗口请求无需读取视频、音轨字幕 UI、失败重试等覆盖。

删除文件：无。没有数据库迁移、扫描或文件管理修改。数据仅复用已有 EmbeddedState/tracks 与 audio-track/subtitle-track/subtitle-file 命令；全屏每秒最多一次窗口状态查询，不打开媒体、不 stat、不读取资料库。

## Verification

- 先测试复现再修复：旧实现新增回归 2 项 FAIL，修复后定向 39 项 PASS。
- `npm run test:release-gate` PASS：93 文件 / 803 项，以及类型、构建、Windows 文件、迁移、性能检查。
- Node SQLite smoke PASS；打包恢复 Electron ABI 130。
- `npm run package:dir`：首次因旧程序占用 DLL 失败，正常关闭后重试 PASS。
- `npm run test:electron-smoke` PASS；真实生产解码验证 9/9 PASS。
- 实际桌面快捷方式启动独立测试资料库：MPV→HTML 和 HTML→MPV 全屏按钮退出均 PASS；播放列表、新控件布局、第二音轨回执、字幕关闭、SRT 对话框取消、样本播放进度 PASS。
- F/Esc 实机注入未观察到预期响应，尚未定位，不能记为 PASS。详细证据和边界见 QA 报告。
- 完整质量门禁和 Electron smoke 已在本任务执行，自动交付脚本可使用 `-SkipChecks`，不是跳过失败检查。
- 提交后需重新生成最终桌面包、比对提交和 app.asar 时间、通过真实桌面快捷方式复验；最终实际结果在本次任务回复报告。

## Risks and follow-up

真实 CloudDrive 播放/弱网、人工听音、外挂 SRT 实机完整加载仍 NOT RUN；长时间播放按用户要求不测。F/Esc 实机输入异常需继续定位，按钮可用不代表所有键盘入口已通过。不能宣称所有视频保证可播或完整发布验收通过。

本机 libmpv 沿用已有运行时；本轮未打包分发 DLL，通用分发仍需审查许可和运行时供应。回滚优先使用开发前 snapshot/checkpoint 与自动交付的 backup-main 标签，通过新的正常提交恢复，不强制倒退 main，也不把真实资料库替换为测试资料库。
