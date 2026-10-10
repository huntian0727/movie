---
date: 2026-10-10
branch: ai/ffmpeg-cli-lgpl-path
type: docs
status: scoped-technical-findings
---

# FFmpeg Lite 静态命令行工具：一次性最简核验

## Context

用户坚持个人业余非商业 MIT 开源分享；避免把企业级律师签字、反复重复检查作为必要程序。仅操作家用 B5，办公 D200707 不参与。操作前项目 checkpoint：`checkpoint-20261010-113954-bad5653-verify-ffmpeg-cli-lgpl-path`，家用 SQLite `quick_check=ok`，不改媒体、数据库或安装。

## Changes

仅在 [普通用户最简发布指南](../../OPEN_SOURCE_RELEASE_SIMPLE.md) 中补充 LGPL v2.1 静态链接 §6(a) 的可行路线，不更改 FFmpeg/播放器逻辑、原生二进制、任何发行门禁或安装器，不另外扩大许可证文档体系。

## Verification

对本地 [源码候选附件](../../legal/FFMPEG_SOURCE_NOTICE.md) 中的真实 `ffmpeg-8.1.2.tar.xz` 使用 `tar -tJf`、`tar -xOJf`，实际核实存在：

- `fftools/ffmpeg.c`：源文件版权头明确 LGPL v2.1 or later；
- `fftools/ffprobe.c`：版权头同样明确 LGPL v2.1 or later；
- `libavcodec/avcodec.h`、`configure`、`Makefile`、`COPYING.LGPLv2.1`、`LICENSE.md`；
- 精确发行方构建脚本 `ffmpeg-lgpl-builds-8bd22e.../scripts/build-windows.sh`，包含 `--disable-gpl`、`--disable-nonfree`、`--disable-version3`、`--enable-static`、`--disable-shared`；未发现该脚本内独立的 `patch` / `git apply` 行；
- 实际构建选项与 [FFmpeg 构建取证](../../legal/FFMPEG_BUILD_INFO.md) 匹配；宿主 Electron 应用通过独立命令行进程调用 FFmpeg，而非直接链接内部 `libav*`。

上游 FFmpeg [许可指南](https://ffmpeg.org/legal.html) 明确推荐动态链接作为简单路线，但**不是唯一合规路线**；[LGPL 2.1 §6(a)](https://opensource.org/license/lgpl-2-1) 存在提供完整源码及可修改重链接材料的路线。由于 FFmpeg CLI 本身有完整公开源码，现有路线比静态链接闭源 GUI 到 FFmpeg 库的情形简单。不能将此事实误写为司法上已确立全面合规、所有第三方库授权已解决，或实际 MSYS2 重新构建测试已通过。

## Risks and follow-up

- 当前没有在独立 MSYS2 环境完整重编译 FFmpeg/FFprobe，也尚未向用户公开源码 ZIP；需要针对精确二进制确认源码和必要重链接材料在适用 LGPL 条款下确实够用。若源文件缺失或无法满足条款，再切换更易合规构建。**不需要现在重构为 DLL**。
- GitHub CI 的前四项通过；当次打包项检查时仍在运行。CLI 技术核验不替代稳定 Windows 11 的真实安装、扫描、播放、卸载。
- `build/release-approval.json.approved=false` 和 `scripts/native-media-lite.lock.json.distributable=false` 保持不变；PR 仍为草稿，不合并主分支，不发布测试安装器。
