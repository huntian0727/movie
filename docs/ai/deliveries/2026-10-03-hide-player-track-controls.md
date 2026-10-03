# 移除播放页底部音轨字幕控件

## Context

用户反馈播放页右下角的音轨、字幕区域碍事并影响布局，要求先去掉。基线 `40b9a72c20d67e24f56fa96eca4d068ad4073a97`；任务开始工作区干净且与 GitHub main 一致。开发分支 `ai/hide-player-track-controls`。

开发前备份：`2026-10-03_15-36-10-750_hide-player-track-controls`；checkpoint `checkpoint-20261003-233607-40b9a72-hide-player-track-controls` 已推送；数据库快照约 0.87 GB / 345479 条视频，quick_check OK。

## Changes

- 修改 `src/renderer/components/PlayerPage.tsx`：移除底部音轨、字幕下拉框和加载 SRT 按钮。
- 修改 `src/renderer/styles.css`：内嵌播放器底部预留高度从 162px 恢复为 126px，播放列表底边同步，删除该控件行专用样式。
- 修改 `tests/renderer/UnifiedPlayer.test.tsx`：验证加载、就绪、全屏、切换原播放器时均无上述控件，也不发送音轨/字幕修改命令。
- 删除不再使用的 `src/renderer/components/EmbeddedMediaControls.tsx`；可通过历史提交恢复。
- 新增本交付记录。主进程、共享 IPC、原生解码器、数据库、扫描、全屏修复均未修改；底层音轨字幕支持保持不变。

## Verification

- `npm run test:release-gate`：PASS，包含类型检查、构建、Windows 文件 37 项、迁移 32 项、性能 25 项、完整测试 93 文件 / 803 项。
- `npm run prepare:electron`：PASS，恢复 Electron 33.4.11 / ABI 130；`npm run test:electron-smoke`：PASS。
- `git diff --check`：PASS。
- 提交后重新生成桌面包并通过实际桌面快捷方式检查窗口、全屏、侧边栏和被移除的控件；该收尾结果见本任务最终回复，未提前记为 PASS。
- 使用合成媒体与独立测试资料库进行界面检查，不播放真实私有视频，不删除文件。

## Risks and follow-up

本轮只撤下界面入口，不关闭视频默认声音或默认字幕，不增加隐藏菜单或新的替代入口。旧版全屏快捷键实机观察问题、真实 CloudDrive 与人工听音验收仍不属于本轮修复；不能宣称已全部解决。若桌面包更新或快捷方式实机验证受阻，必须明确说明“桌面版本尚未交付”。回滚使用本轮 snapshot/checkpoint 或更新 main 前的 backup-main 标签，以新的正常提交恢复，不强制倒退 main。
