---
date: 2026-09-26
branch: ai/rename-lamian-video
type: change
status: completed
---

# 软件名称改为“拉面影视”

## Context

- 基准提交：`a70c8ee`。
- 开发前检查点：`checkpoint-20260926-182037-a70c8ee-rename-lamian-video`。
- 资料快照：`2026-09-26_10-20-40-897_rename-lamian-video`（SQLite quick_check: ok）。

## Changes

- 桌面产品名、主窗口标题、网页标题、侧栏品牌及少量面向用户的文案统一为“拉面影视”。
- 安装包与可执行文件改用“拉面影视”；桌面开发快捷方式默认名称使用英文转写 `Lamian Video (Dev)`（兼容 Windows PowerShell 5.1 的脚本编码），并同步更新打包与安装验收脚本。用户实际桌面快捷方式使用“拉面影视”。
- 保留原内部 `package.name`、`appId`、`%APPDATA%/local-video-manager` 用户数据路径与既有备份目录；启动时显式锁定旧用户数据路径，避免改名后产生空资料库。
- 备份恢复前的进程检查同时识别旧、新可执行文件名。
- 单元测试固定旧用户数据目录，防止以后只改产品名而令资料库迁址。

## Verification

- 最终 `test:release-gate` 通过：76 个测试文件、696 项测试；`test:electron-smoke`、`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke` 均通过。
- 新打包验收检查了 Electron 运行时名称、页面标题和侧栏品牌均为“拉面影视”。桌面快捷方式已改为 `拉面影视.lnk`，目标为本轮 `release/win-unpacked/拉面影视.exe`；从该快捷方式启动后核对进程路径、窗口标题、侧栏品牌，以及原资料库的 345,234 个视频与 10 个来源仍显示。首次窗口捕获失败，重新建立有效快捷方式并启动后已完成 UI 验证。
- 首次尝试隔离打包测试时，Electron 未按临时 `APPDATA` 环境变量切换路径，测试误连现有资料库并生成 1 个测试来源与 1 个样本视频。已核对精确 ID、路径、数量，清理该测试来源和样本文件；未回滚或覆盖资料库。打包测试已恢复使用显式独立 `userData` 路径。

## Risks and follow-up

- 这次只修改对外品牌，不迁移数据库、缓存、设置或历史备份位置。内部标识沿用旧名称是兼容性安排，不影响界面显示。
