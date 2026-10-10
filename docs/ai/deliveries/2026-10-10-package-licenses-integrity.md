---
date: 2026-10-10
branch: ai/verify-packaged-third-party-notices
type: fix
status: tested-qa-only
---

# 第三方许可材料的实际 Windows 安装资源一致性保护

## Context

针对个人免费开源版的发布收口，已先通过家用 B5 将 `THIRD_PARTY_LICENSES.md` 真正装入 Electron 的 `resources/legal`。本次增加**打包后实际文件对照**，防止复制丢失、被篡改或不同发行候选使用错误的许可证材料。所有工作在家用 MP2T8QB5；办公 D200707 未使用。

事前本地 checkpoint `checkpoint-20261010-141951-efd1bb1-verify-packaged-third-party-notices`，家用个人 SQLite 数据库 345892 个视频，`quick_check=ok`。

## Changes

- 增加 `scripts/verify-packaged-notices.mjs`，明确七对源码文件 → `win-unpacked/resources/legal` 的映射，均以 `lstat` 验证为非空普通文件，使用 SHA256 比较真实源文件与实际安装目录的内容，不接受被替换成符号链接。
- `scripts/verify-packaged-artifact.mjs` 在现有 FFmpeg/DLL SHA、PE x64 架构、Electron 资源版本、开发环境泄漏防护旁新增 `verifyPackagedNotices` 验证。签名或私有 QA 身份都不能绕过这项检查。
- 新增三项 Node 单元测试：七个文件一致、修改一字节就拒绝、空文件拒绝；并接入既有 `npm run test:media-candidate-contract`，让本地测试与 CI 默认运行。
- `docs/RELEASE_CHECKLIST.md` 增加此项具体技术验证，不冒充 LGPL 专业合规结论。

## Verification

- `node --test tests/scripts/verifyPackagedNotices.node-test.mjs`：3/3 PASS，主动构造篡改和空文件均拒绝。
- `npm run test:media-candidate-contract`：59/59 PASS。
- `MOVIE_MEDIA_VARIANT=lite-candidate npm run verify:artifact` 对家用 B5 已实际打包的 `release/unsigned-test-build/win-unpacked` 进行实物检查：`Packaged artifact content OK: 3461 asar entries, 7 exact licensing notices, no forbidden development artifacts.`
- `build/release-approval.json` 保留 `ownersConfirmed=true`、`approved=false`、`manualQaApproved=false`；Lite 候选锁定记录保留 `distributable=false`。
- `git diff --check` 通过。整个改动没有访问公司的系统、真实视频、私人 SQLite 或发布 GitHub Release。

## Risks and follow-up

- 内容 SHA 一致不等于 FFmpeg 静态 LGPL 重链接义务已经实际履行，也不覆盖 OpenH264 编解码专利的问题。正式发行前仍需要与最终二进制相对应的真实可下载源码和适用许可履约。
- 只有 `unsigned-test-build` QA 身份已经通过此项实物测试，社区身份安装包未解除门禁；公开前还要完成独立稳定 Windows 11 实际安装、播放、卸载、数据保留检查。
