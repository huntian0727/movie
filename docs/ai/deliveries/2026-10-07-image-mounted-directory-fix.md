---
date: 2026-10-07
branch: ai/image-mounted-directory-fix
type: fix
status: completed
---

# 挂载盘图片读取与子目录显示修复

## Context

用户报告 F:\sha1 下图片目录报 UNKNOWN realpath，且子目录未显示。

开发前快照：2026-10-07_10-26-13-547_image-mounted-directory-fix；checkpoint-20261007-182609-222ede4-image-mounted-directory-fix 已推送；SQLite quick_check ok，345479 条视频。

## Changes

- 已真实复现：fs/promises.realpath 在挂载盘报 UNKNOWN，而 fs.realpath 回调、opendir、lstat 可正常读取。切换异步兼容 resolver，目录与文件均保留真实路径越界校验，避免阻塞主进程或直接跳过授权边界。
- 将浅层实际子目录合并到原有子目录卡片/目录列表，去重并保留已索引视频统计；支持只有图片、未索引视频的文件夹。进入新的目录时重新展开卡片；刷新/扫描后重新读图片列表。
- 单层实际子目录保持最多 200 个，达到上限时明确提示。图片可见加载、分页、短期会话和按需原图行为不变。
- 不修改源文件，不增加数据库迁移，不改 CloudDrive RPC、视频扫描或文件操作。

## Verification

- 针对性检查：4 文件 / 11 项 PASS，包括原生 realpath UNKNOWN 模拟、Unicode/空格、目录 junction 越界、缩略图/原图读取、子目录合并/去重/视频数量和导航后展开。
- 完整 `test:release-gate` PASS，Node 22.23.1/npm 10.9.8；119 文件 / 1014 项。包含 lint/typecheck、build、Windows 文件、迁移和性能检查；日志 `.tmp/image-release-gate.log`。没有独立 E2E 脚本。
- 实际 F:\sha1 验证 PASS：原生 realpath 仍可复现 UNKNOWN，新服务成功读父目录的 JIETU/P 子目录；父目录自身无图片，P 有 1022 张。原图流 136235 字节与原文件一致，抽测缩略图 22354 字节，仅按需生成 1 个缓存，重复读取复用缓存。Node 22 再测父/子列名约 597ms，根目录列名约 41ms；根目录实际子目录超过 200 个，有明确截断标记。证据 `.tmp/image-mounted-real-check.json`，不提交用户媒体。
- 本地 D:\四姑娘山 回归 PASS：107 张 JPG、列名约 14.4ms，3 个缩略图复用缓存，原图 10384977 字节与文件一致。
- `package:dir`、`test:electron-smoke`、`verify:artifact` PASS；Electron 33.4.11 / SQLite ABI 130；asar 4109 条，无开发产物。
- 从实际桌面快捷方式 `%USERPROFILE%\Desktop\拉面影视.lnk` 启动目标 `%USERPROFILE%\Documents\视频管理\movie\release\win-unpacked\拉面影视.exe`，使用 computer-use 验证：父目录显示 2 张卡片、139 条视频保持；进入 P 显示 1022 张/9 页、首屏缩略图、大图/下一张/Esc/焦点恢复正常；面包屑返回父目录再进入 JIETU 显示 10 张（6 JPG + 4 GIF），缩略图全部正常。没有 UNKNOWN 报错。
- 交付脚本提交后再次生成桌面包，并核对提交/asar 时间和实际快捷方式目标。

## Risks and follow-up

- 云盘首次查看仍可能下载当前原图，实际速度取决于挂载服务和网络；没有预先读取全部图片内容。
- 子目录没有建立图片索引，显示的视频数量来自既有视频索引。
