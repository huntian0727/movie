---
date: 2026-10-11
branch: ai/sandbox-audio-confirmation
type: docs
status: partial
---

# 沙盒原生声音人工确认

## Context

用户对上轮两份独立试听问题分别回复：`QA-H265-AAC.mp4` 为“能听到”，`QA-MKV-H264-AAC.mkv` 为“能听到”。本轮补录实际用户反馈，关闭测试样片的声音确认项；不修改播放器代码、不重新打包、不据此放行正式发布。

基准 `dd433a5`，工作区干净，与 origin/main 一致。开发前快照 `2026-10-11_05-26-59-152_sandbox-audio-confirmation`，checkpoint `checkpoint-20261011-132655-dd433a5-sandbox-audio-confirmation`。真实资料库 345892 条，quick_check 正常；按授权核验三份开发和三份迁移备份后清理一份旧开发快照，错误 0。

## Changes

- 更新 [机器验收证据](../../QA/2026-10-11-sandbox-portable-evidence.json)：H.265/MKV 的 audio 改为 PASS_USER_CONFIRMED，记录两份分别反馈和同包补播范围。
- 同步两份沙盒交付记录、稳定版验收方案补充说明和 Release 草稿，去除已解决的“原生声音未确认”项。
- 保留第一次验收收据、数据库和源视频哈希，明确程序重解压后仅补播声音，没有再次进行移除程序测试。

## Verification

- H.264 / H.265 / MKV 三份合成测试片：均有活动画面，分别获得用户声音确认。H.264 走 Chromium，另两份走内嵌原生播放器；不推广到其他样片或真实媒体。
- 测试 ZIP 仍对应代码 `19465ef7500fb53c325a5079126497e1fe34cd57`，SHA-256 `e52289cc4a50380d335c71601883ec78d556f726a228e08f38ad17c04a509228`。
- 证据整理器重新核对实际 ZIP、189 文件校验收据、三份数据快照结果、九次源视频哈希及两条用户反馈，正式审批仍 false。
- 补证独立校验 PASS：三种格式均为 PASS_USER_CONFIRMED，原始七组证据内容未变，发行审批文件字节未变，16 个本地文档链接存在。
- 本轮 `npm run lint` / `npm run typecheck` / `npm run build`：PASS；`npm test`：134 个文件、1204 项全部 PASS；`npm run test:electron-smoke`：PASS，包含原生 SQLite、三身份/DPAPI/换目录重开、preload 和主进程。构建体积提示及 PNG 色彩配置警告未导致失败，本轮不改资源图像。
- `git diff --check`、自动交付安全检查 ValidateOnly：PASS；独立 E2E 脚本不存在。没有再次操作沙盒 GUI 或安装程序。

## Risks and follow-up

- 三份样片声音确认已完成；稳定版 Windows 11 / 普通用户身份、真实媒体兼容性和正式公众包身份仍未完成验收。
- libmpv 完整依赖源码/通知/构建材料和宿主组合审核，以及 FFmpeg Lite 最终公开交付材料仍缺，见 [具体材料清单](../../legal/MPV-SOURCE-GAPS.md)。
- `approved=false`、`manualQaApproved=false` 和第三方二进制源码审批保持原值；未发布 GitHub Release。
- 此次只补验收记录，原绿色测试包和快捷方式未更新；正式桌面版本尚未交付。
- 本轮完整等价检查通过并记录后，自动交付可使用 `-SkipChecks`，普通推送分支和 main，保留 main 备份标签。
