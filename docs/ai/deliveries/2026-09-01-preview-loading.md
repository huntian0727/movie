---
date: 2026-09-01
branch: ai/preview-loading-delivery
type: fix
status: completed
---

# 0.1.8 当前页面预览加载与桌面交付修复

## Context

用户反馈所有视频页大量封面不加载，手动重新生成无效。只读检查确认运行的是 release/win-unpacked 的 0.1.7，安装目录同为 0.1.7；两个包均不含 loadPreviewImage。旧包要求 metadataStatus=ready 才产生封面地址，且生成任务串行、没有进程超时。真实资料库中 75,798 条 pending 和 11 条 failed 元数据记录受该条件阻挡。重置 IPC 日志显示操作完成，但重置封面不会改变元数据状态。

## Changes

- 完成此前未交付的 PreviewImage / imageGenerationQueue：仅当前可见卡片入队，切页、滚出视口、隐藏页面撤销消费者；共享任务只在最后消费者离开时取消。生成并发上限 2，手动重试/时间轴优先于普通网格，播放列表低优先级。
- FFmpeg 支持取消，单次执行超时 30 秒；已有缓存直接读取，异常页只读取缓存。取消、缓存未命中不标记为生成失败。
- 所有视频、文件夹、收藏、待删除、最近播放的网格不再等待元数据完成才请求封面。播放器列表和悬停预览接入统一请求；悬停稳定 180ms 后请求。
- 修正 LibraryShell 丢弃重置 Promise 的问题；重置完成后显式重试，即使 URL 未变也可重试失败封面，显示排队/生成与失败反馈。
- 新增队列、取消、缓存、待分析封面、同地址重试和错误反馈回归测试。安装包 smoke 使用临时合成视频验证真实 FFmpeg、IPC、Blob 解码、缓存命中和重生成，而非只验证二进制存在。
- 保留并集成任务开始时已有的未提交工作（已由前序用户请求授权）：API 扫描批量入库与有界并发、候选时长读取、目录移除 SQL 优化、远端身份提示、优先保留规则与显示范围拆分、重复项空态入口。这些不是本次预览修复新引入的设计变更。
- 版本更新至 0.1.8。不迁移或删除用户数据库，不对用户视频执行清理。

## Verification

- 使用官方 Node 22.23.1 Windows x64 便携运行时（仅位于忽略的 .tmp/runtime），下载 SHA-256 与官方 SHASUMS256.txt 一致；自带 npm 10.9.8。未修改全局运行时、未跳过环境验证。
- `npm run verify:environment`: PASS。
- `npm run lint`（包含 typecheck）及单独 typecheck: PASS。
- `npm test`: PASS，53 个测试文件、542 项测试（Node ABI127）。原先新增的失败反馈测试检出 Promise 丢失问题，修复后全部通过。
- `npm run build`: PASS。
- `npm run prepare:electron` / `npm run test:electron-smoke`: PASS（Electron 33.4.11 / ABI130）。
- `npm run dist:win` / `npm run verify:artifact`: PASS，0.1.8 NSIS 包；首次打包时旧进程仍占用 DLL，正常退出旧程序后重跑通过。
- `npm run test:packaged-smoke`: PASS，包括 previewGeneratedBeforeMetadata、previewDecodedInRenderer、previewCacheHit、previewRegenerated 及退出后数据库重开。smoke 中的未授权窗口 IPC 拒绝是安全检查的预期输出。
- 安装 `release/Local-Video-Manager-0.1.8-x64-Setup.exe /S`: PASS，退出码 0。
- 从真实桌面 `Local Video Manager.lnk` 启动安装目录的 0.1.8：PASS；通过 computer-use 检查所有视频页排队状态、重生成入口及切换测试目录后实际封面显示。真实资料库只读复核：8 条 metadata=pending 记录已经 thumbnail=ready。
- 安装目录和 release/win-unpacked 的 app.asar SHA-256 一致：`0db0791a35d7c43cb73fb60d4d1a57d041bba9205aa68488b46bdbce7acc64a6`。本轮生成时间本地 2026-09-01 01:33，安装时间 01:33；源代码提交仅补交记录，不混用旧包。
- 正式快捷方式目标 `C:\Users\test\AppData\Local\Programs\Local Video Manager\Local Video Manager.exe`；Dev 快捷方式仍指向本轮重建的 `release/win-unpacked/Local Video Manager.exe`，两者均 0.1.8。
- 自动交付允许使用 `-SkipChecks`：本轮在同一工作区实际执行并记录了 lint/typecheck、完整 npm test、build、Electron smoke、packaged smoke；不再次切换 SQLite ABI 来重复相同门禁。没有独立 E2E 脚本。
- 无独立 `test:e2e` 脚本；本轮以 packaged smoke 承担真实打包运行验证。
- 真实 CloudDrive2 扫描/删除 E2E: NOT RUN。本轮不触发真实批量删除。

## Risks and follow-up

- 首次取帧仍需 FFmpeg 读取挂载视频的必要数据，不是网盘 API 原生缩略图；离线、损坏、网络超时仍可能失败，不能承诺每张封面必定成功。
- 30 秒是单次生成的超时，不包含排队时间。没有启动全库预生成；当前实现只请求实际视口内图片，不预取屏外图片。
- 重复组新增可展开缩略图仍属后续阶段，未在本轮实现。
- 安装包未签名，沿用项目测试发行配置。
- 便携开发运行时留在忽略的 .tmp/runtime；后续需继续使用项目锁定的 Node/npm 版本，避免原生模块 ABI 混用。
