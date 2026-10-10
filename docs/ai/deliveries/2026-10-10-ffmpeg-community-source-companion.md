---
date: 2026-10-10
branch: ai/ffmpeg-community-source-zip
type: feat
status: source-companion-built-private
---

# 个人开源版 FFmpeg 源码交付附件候选

## Context

用户要求继续以最低必要合规推进个人免费开源版，不再重复企业级审计。上一轮已完成简明指南和对应源码原始资料归档，但还缺一份**用户可直接取得的单一源码压缩包**。本次只操作家用 B5（MP2T8QB5），办公电脑 D200707 完全不参与。变更前创建本地 checkpoint `checkpoint-20261010-112212-41f83f7-ffmpeg-community-source-zip`，真实个人 SQLite quick_check=ok。

## Changes

- 新增 `scripts/prepare-ffmpeg-source-companion.ps1`：使用确切固定 SHA256 的私有源审核 ZIP 作为输入，将其中 FFmpeg 8.1.2 主源码、固定 Windows 编译脚本、四份 MSYS2 对应源码包与第三方声明整理为扁平的源码 ZIP。
- 额外放入与 Lite 锁文件 SHA 相同的 LGPLv2.1 许可证正文、从真实二进制核验的 FFmpeg 构建参数与七个原生组件清单。移除原私有包的内部审核状态旧 README 和旧发布说明，用面向最终用户、但不声称批准发布的新 README 代替。
- 输出 `SHA256SUMS.txt`（ZIP 内每个文件）、`SHA256SUMS-SOURCE.txt`（外部完整 ZIP 文件）和 `SOURCE-BUNDLE-VERIFICATION.json`。脚本会对源输入、提取后的每个文件及输出 ZIP 每个条目重新按真实字节核算 SHA256。
- 默认不覆写任何已存在目的地；没有下载、GitHub Release 上传/标签创建、修改许可批准记录、重打包安装器、破坏性清理或接触用户视频。
- `docs/OPEN_SOURCE_RELEASE_SIMPLE.md` 与 `docs/legal/FFMPEG_SOURCE_NOTICE.md` 记录精确离线产物、大小、SHA 和待发布状态。

## Verification

- 真实输入 ZIP：`D:\CodexReleaseAudit\ffmpeg-lite-20261009\FFmpeg-Lite-8.1.2-corresponding-sources-REVIEW-v2.zip`，固定 239488121 字节，SHA `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`。
- 真实输出 ZIP：`D:\CodexReleaseAudit\ffmpeg-lite-20261009\community-release-companion-20261010\FFmpeg-Lite-8.1.2-Windows-x64-SOURCES-CANDIDATE.zip`，239498523 字节，SHA `a996afcfd3f2601d0ef324f635d2c63adbb3abfb441c1d5aa0c87652db3258b4`。
- 15/15 ZIP 条目逐一重解压并计算 SHA 与源文件匹配，校验记录 `status=INTEGRITY_PASS_NOT_PUBLICLY_APPROVED`；对 ZIP 内的小型文本/JSON 文件检查本机用户路径、临时路径、个人 D 盘审核路径和凭据样式，0 命中。
- 使用已存在目标位置模拟再次运行，正确 fail-closed，不覆盖源码候选。
- `build/release-approval.json.approved=false`、媒体锁 `distributable=false` 继续保持原状。未用 `unsigned-test-build` 安装器冒充社区版。

## Risks and follow-up

- 本项证明**源码附件本身已整理、可复制并未被篡改**，不是静态 FFmpeg 的全部 LGPL 授权证明：正式分发前仍需确认 CLI 内部静态链接的源码/必要重链接条款适用性、对应许可证和用户可获取渠道。
- 产物只在 B5 的私人磁盘上，GitHub **没有公开提供**；真正的公众发行需对应最终社区版二进制、全部相应材料与 SHA 在同一次 Release 可见。
- 未运行稳定版 Win11 干净环境真实安装/播放/卸载测试；未合并 main、修改权属授权、创建 tag 或公开上传任何 EXE。
