---
date: 2026-08-16
branch: ai/fix-codec-playback-enrichment
type: fix
status: completed
---

# 修复 Codec-aware 播放准备与路由

## Context

上一轮 codec-aware routing 仍把完整 FFprobe 放在播放器打开关键路径，并用 `video_codec IS NULL` 混合表示未探测、成功但无 codec 和探测失败；WebM 未限制高 bit-depth，metadata pending 的普通 MP4 也可能过早转向外部播放器。

## Changes

- schema v9 新增 `codec_probe_status = unprobed | ready | failed`；v8 已有 codec 的记录迁移为 ready，其余保持 unprobed，不读取媒体或重置 metadata 队列。
- MetadataQueue、同步扫描、懒探测、人工 metadata 重试和文件版本变化成套维护 probe 状态；成功但 codec 为空也写 ready，失败后普通播放不重复 FFprobe。
- 播放器准备最多等待 2 秒，超时后继续创建会话/窗口；后台 probe 自行捕获异常、更新数据库并释放 in-flight 状态。
- `auto` 对 metadata pending 的 MP4/M4V/MOV/WebM 临时 native-first；ready 但 probe 未完成/失败仍保守走 mpv；WebM native 白名单要求 `yuv420p`，VP9 10-bit 转 mpv。
- 更新真实 codec 验证脚本，显式传入 metadata/probe 状态，新增 VP9 10-bit 样本并校验预期路由。
- bundled mpv：未包含。embedded mpv：未包含。

## Verification

- 固定 Node 22.23.1 下定向 7 个测试文件、121 项：PASS。
- `npm run lint`：PASS。
- `npm run build`：PASS。
- `npm run test:node`：PASS，45 个文件、435 项。
- `npm run test:release-gate`：PASS；37 项 Windows 文件安全、31 项迁移、21 项性能门禁及完整 Node 测试全部通过。
- 环境：Node 22.23.1、npm 10.9.8、Node ABI 127。全局 PATH 的 Node 24/npm 11 不用于正式 native 测试。
- Electron smoke：PASS，Electron 33.4.11 / ABI 130，main process ready。
- unpacked artifact：PASS，3,954 个 asar 条目，无禁入开发产物；这是 unsigned test artifact，不是正式签名发布包。
- packaged smoke：PASS；数据库、扫描夹具、协议、Renderer/preload、安全边界和 FFmpeg/FFprobe 均通过。
- 桌面快捷方式实启：PASS；`Video Manager (Dev).lnk` 指向本轮 `release/win-unpacked/Local Video Manager.exe`，已从快捷方式启动并确认真实资料库、侧栏、搜索和分页界面。
- 真实生成编码样本：PASS；H.264 High/yuv420p/AAC MP4 → native，HEVC Main/yuv420p MP4 → mpv，VP9 profile 0/yuv420p/Opus WebM → native，VP9 profile 2/yuv420p10le/Opus WebM → mpv。
- 真实网络/离线样本：NOT RUN；自动化已用永不完成的 probe + fake timer 验证 2 秒后播放器窗口继续创建。

## Risks and follow-up

- `codec_probe_status = failed` 默认不在普通播放时重试；现有“重新分析元数据”仅对完整 metadata failed 记录生效。文件 size/mtime 变化后会自动恢复 unprobed。
- 真实 SMB/离线盘的 2 秒体感、probe failed 后第二次点击、mpv 缺失 fallback 仍需带用户媒体的桌面手测；本轮没有向真实资料库导入测试样本。
- bundled mpv、embedded mpv、NSIS 安装/升级、签名和干净 Windows VM 均不在本轮范围。
