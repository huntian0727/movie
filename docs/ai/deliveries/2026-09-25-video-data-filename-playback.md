---
date: 2026-09-25
branch: ai/video-data-filename-playback
type: feat
status: completed
---

# 视频数据表文件名播放入口

## Context

视频数据表原本点击文件名打开详情。用户确认改为直接打开现有播放窗口，同时保留清晰的详情入口。开发前快照 `2026-09-24_17-08-08-107_video-data-filename-playback`，检查点标签 `checkpoint-20260925-010804-2566f67-video-data-filename-playback`。

## Changes

- 文件名带播放图标，单击调用现有播放器；播放队列只含被点击的视频，不把当前页或全部筛选结果加入队列。
- 操作列增加“详情”，保留原有“诊断”和“复制路径”。复选框、整行及其他操作不会触发播放。
- 播放窗口打开期间阻止重复提交，同时保持表格其他操作可用；失败时在页面显示错误。没有新增播放前网络检查、媒体探测、扫描或数据库改动。
- 增加页面交互和 LibraryShell 播放队列回归测试。

## Verification

- TypeScript 类型检查通过；定向渲染测试 61 项通过。
- 完整 `test:release-gate` 通过：75 个测试文件、694 项测试，涵盖 lint、类型检查、构建、迁移及性能门禁。
- `dist:win`、`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke` 均通过；生成 `release/win-unpacked` 和 `release/Local-Video-Manager-0.1.15-x64-Setup.exe`。
- 桌面快捷方式 `Video Manager (Dev).lnk` 指向本次 `win-unpacked` 程序；通过该快捷方式实际启动，视频数据表呈现文件名播放按钮及独立“详情”按钮。
- 自动化回归验证点击文件名调用现有播放器，且播放队列只包含被点击的视频。人工未继续点击播放：验收时检测到应用窗口有其他输入，为避免打断使用而停止操作。

## Risks and follow-up

- 网盘离线或文件失效时，现有播放流程仍可能失败；页面会显示打开窗口失败信息，实际解码失败继续由播放器呈现。
- 实际视频解码能力不属于本次改动；手工播放确认留待用户在本地文件上验证。
