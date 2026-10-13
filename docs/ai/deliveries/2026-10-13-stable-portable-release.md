# 正式绿色版发布

## Context

维护者明确授权当前预览版 Windows 沙盒完成正式版测试与发布；替代此前稳定系统要求，已有 beta 发布和测试保留。开发前快照 2026-10-13_05-37-28-629_stable-portable-release；维护清理已验证最新三份快照与数据库后执行。

## Changes

版本 0.1.15；现有正式审批批准仅 unsigned-public-release/source pair 的绿色 ZIP，绑定版本、依赖、源码审批和实际沙盒证据；NSIS/签名/旧身份升级不获本次批准。正式私有草稿支持精确配对源码后云端上传，最终发布需独立成品复核。公开 beta 审批作为历史版本保留。

## Verification

本轮本机实际运行 lint、typecheck、test（140 files / 1,292 tests 全通过）、build、Electron smoke、media candidate contract 和 native-source Python 检查全部成功。当前正式审批与真实固定源码/运行库的本机预检通过。E2E 脚本不存在，不适用。云端精确 commit 构建和最终成品沙盒验证在发布前另外核对，完成后更新结果。

## Risks and follow-up

系统真实为 Insider Preview；标准用户、NSIS、签名升级、4K/HDR、长时压力未覆盖。日常旧桌面程序未替换，本次交付为 GitHub 正式绿色版。
