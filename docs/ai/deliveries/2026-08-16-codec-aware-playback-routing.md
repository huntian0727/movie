---
date: 2026-08-16
branch: ai/codec-aware-playback-routing
type: feat
status: completed
---

# Codec-aware Playback Routing

## Context

旧 `auto` 路由只识别扩展名，MP4 内的 HEVC 等组合会先错误进入 Chromium native；同时历史大库不能通过启动全库 FFprobe 来补数据。

## Changes

- schema v8 追加四个 nullable codec 字段，升级保持全部历史记录和 metadata 状态。
- 扩展原单次 FFprobe 解析、MetadataQueue 和 repository 持久链；文件大小或 mtime 变化时使 codec 失效。
- 增加首次播放懒补全与并发去重；失败不阻塞播放器并使用保守路由。
- `auto` 改为容器+codec 白名单，显式偏好与既有 fallback 保持不变。
- 新增迁移、解析、仓储、路由、懒补全测试与 ADR-005。

## Verification

- 定向 7 个测试文件、98 项：PASS。
- 固定 Node 22 全量 Vitest：45 个文件、427 项：PASS。
- Node/Web TypeScript：PASS。
- production build：PASS。
- Electron 33.4.11 native/main-process smoke：PASS。
- unpacked artifact（3,953 个 asar 条目）与 packaged smoke：PASS。
- 真实编码样本脚本：H.264 High/yuv420p/AAC MP4 → native；HEVC Main/yuv420p MP4 → mpv；VP9/Opus WebM → native，PASS。
- 桌面快捷方式目标、`app.asar` 时间戳和从快捷方式实启：PASS；新包使用真实用户库启动并完成 v8 打开。

## Risks and follow-up

- 历史网络盘视频首次播放仍承担一次 FFprobe 延迟；失败后保守走 mpv。
- codec 白名单需要真实设备与更多编码样本持续校准；未知组合不会冒险进入 native。
