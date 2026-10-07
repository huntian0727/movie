---
date: 2026-10-07
branch: ai/directory-image-viewer
type: feat
status: completed
---

# 目录图片查看

## Context

用户要求在现有视频资料库目录中最简单地查看图片，支持可见缩略图、大图、前后切换；不需要搜索、筛选、收藏、去重或相似图片识别。指定 D:\四姑娘山 为真实测试目录。

开发前快照：2026-10-07_09-56-55-973_image-viewer；Git checkpoint：checkpoint-20261007-175651-a25a2d5-image-viewer（已推送）；SQLite quick_check ok，345479 条视频。

## Changes

- 独立的 DirectoryImageService + 两个可信 main-only IPC，短期目录文件名会话最多 8 个、30 分钟空闲期限；当前目录浅层枚举，不写入视频库、不运行 FFprobe/指纹/递归扫描。每页 120 张，最多列出 20000 张，支持图片专用子文件夹入口。
- 会话 URL 不接受 renderer 任意文件路径。读取前再次验证来源仍存在，使用 realpath 阻止目录 junction 和文件链接逃逸；原图上限 256 MB，AbortSignal 传给原图流和缩略图队列。
- JPG/JPEG、PNG、WebP、GIF、BMP、AVIF。可见缩略图延迟 120ms 加载、离屏取消读取/释放 Blob；单线程 FFmpeg 生成最长边 480px JPG，复用缓存管理器配额、过期清理、全局两并发/远程单并发。
- 图片面板嵌入当前目录页，查看器支持前后按钮、左右键、Esc、焦点恢复与 Tab 循环。打开原图时暂停图库缩略图请求，只读取当前一张。
- 无数据库迁移；视频扫描、元数据、去重和播放路由保持原逻辑。

## Verification

- 新增图片服务 6 项 + renderer 3 项：PASS。覆盖不生成离屏图片、读取取消/Blob 释放、单原图切换、文件名会话分页、来源移除、路径越界与 junction。
- 相关已有 IPC/媒体协议/LibraryShell 测试 83 项：PASS。
- 全局 Node 24/npm 11 标准检查首次被环境门禁拒绝；改用已有隔离 Node 22.23.1/npm 10.9.8，重建 Node ABI 127 后执行正式检查。
- 完整 test:release-gate：PASS（Node 22.23.1/npm 10.9.8，117 文件 / 1012 项）；包括 lint/typecheck、build、Windows 文件、数据库迁移、性能检查。日志 `.tmp/image-release-gate.log`。无单独 E2E 脚本。
- `package:dir`：PASS，重新生成 `release/win-unpacked`，Electron 33.4.11/SQLite ABI 130；`test:electron-smoke` 与 `verify:artifact` 均 PASS。
- 从用户实际桌面快捷方式 `C:\Users\test\Desktop\拉面影视.lnk` 启动，目标 `C:\Users\test\Documents\视频管理\movie\release\win-unpacked\拉面影视.exe`：PASS。使用 computer-use 实际进入四姑娘山，观察 107 张图片、正确缩略图/原图、左右键切换、Esc 关闭及焦点恢复、滚动新增可见缩略图。
- 桌面首屏共生成 18 个图片缓存，460360 字节；进入/切换原图期间仍为 18 个，没有后台生成剩余图片。图片目录仍为 0 条视频索引，未将 JPG 当作视频入库。
- 测试目录读取：107 张 JPG，浅层列名 14.4ms；请求首两张和末张缩略图，生成各约 26–35KB、385–451ms，原图各约 10MB。缓存由 0 变 3，未请求的 104 张没有生成缓存。原图流实测返回 10384977 字节，与源文件大小一致。记录 `.tmp/image-real-check.json`（不提交用户文件名/图片）。

## Risks and follow-up

- GIF 缩略图只显示第一帧；大图由 Chromium 解码，可显示动画。HEIC/RAW 等不在本次范围。
- 原图解码仍与分辨率有关；只查看一张不能消除单张超高分辨率内存消耗。
- 云盘依赖挂载路径，打开/首次生成缩略图可能下载原图；未完成真实 CloudDrive/SMB 图片 E2E。
- 会话过期或来源移除会提示刷新；不维护图片持久索引。
