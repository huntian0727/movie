---
date: 2026-09-01
branch: ai/preview-flicker-fix
type: fix
status: completed
---

# 0.1.9 封面循环刷新修复

## Context

0.1.8 可以生成图片，但在仍有 pending 元数据的页面上反复闪烁。代码链路：封面 URL 包含通用 updatedAt；每次命中缓存也执行 markThumbnailReady 并修改 updated_at；LibraryShell 每 1.5 秒更新含 pending 元数据的页面；新 URL 让 PreviewImage 丢弃 Blob、显示占位图并重新读取，形成循环。

## Changes

- 将封面 URL 的版本依据改为视频 ID、文件大小、文件修改时间和实际取帧时间。数据库状态、收藏、缓存读取、一般元数据更新不再使图片失效。
- 前后台共用短视频取帧计算；时长补全只有真正改变取帧位置时才刷新图片。
- 封面已 ready 且缓存路径未改变时不再写入视频记录。时间轴缓存已 ready 且路径未改变时也不更新父记录或缓存条目。
- 保留 0.1.8 的显式重生成机制：用户重试仍可强制重新加载，不依赖 updatedAt。
- 加入稳定封面地址、重复缓存读取零写入、后台刷新/可见性变化时复用原 Blob 的回归测试。
- 打包 smoke 展示隔离临时资料库中的合成视频，并用 MutationObserver 观察真实页面连续 5 秒（覆盖多个 1.5 秒轮询周期），要求图片节点、src 均不变。
- 版本更新至 0.1.9；本轮不修改扫描、重复删除、用户数据库结构或用户媒体文件。

## Verification

- 本轮使用项目锁定的便携 Node 22.23.1 / npm 10.9.8，未绕过环境检查。
- `npm run lint`（含 typecheck）: PASS。
- `npm test`: PASS，54 个文件、546 项测试，Node ABI127。
- `git diff --check`: PASS。
- `npm run dist:win`: PASS，当前分支重建 release/win-unpacked 与 0.1.9 NSIS 安装包，包含 build/typecheck 和原生 Electron 检查。
- `npm run test:electron-smoke` / `npm run verify:artifact`: PASS。
- `npm run test:packaged-smoke`: PASS，`previewStableAcrossPagePolling=true`；真实页面观察 5 秒，图片节点和 src 均未替换。此前首次生成、缓存读取和显式重新生成检查仍通过。安全 smoke 的未授权 IPC 拒绝日志为预期结果。
- 静默安装 0.1.9: PASS（退出码 0）。通过 computer-use 从正式桌面快捷方式启动的窗口验证所有视频页和测试目录封面显示。
- 测试目录停留后再次截图，封面持续显示、未回退到排队占位；验证结束后已返回所有视频页。
- 桌面正式入口目标为 `C:\Users\test\AppData\Local\Programs\Local Video Manager\Local Video Manager.exe`。Dev 入口为当前重建的 `release/win-unpacked/Local Video Manager.exe`。两个包版本均 0.1.9，app.asar SHA-256 均为 `aa1fee4cdfd978d5359ccddac5b42c17f079b5556019b1f84aa9c5334e0e770b`。
- app.asar 本轮生成时间为本地 2026-09-01 01:51:56；最后提交仅补充交付记录，程序文件属于当前分支本轮构建。
- 自动交付使用 `-SkipChecks` 的依据：同一工作区本轮完整执行了上列 lint/typecheck、npm test、build、Electron smoke 与 packaged smoke，避免重复切换原生 SQLite 的 Node/Electron ABI；未跳过失败门禁。
- 应用代码提交为 `8f7a460`。首次自动交付在 fetch origin main 时遇到 Connection reset，尚未推送；后续只读远程检查恢复正常，补录此结果后重新运行自动交付脚本。最终同步与备份标签以脚本输出为准。
- 无独立 test:e2e 脚本；真实打包运行回归由 packaged smoke 覆盖。

## Risks and follow-up

- 更新后台数据仍会触发 React 更新，但不再无故替换封面地址、回退占位图或重复读取同一缓存。
- 新文件版本、短视频有效取帧位置变化、取帧设置变化、显式重试仍应刷新图片。
- 同一视频记录仅重命名/移动且大小与修改时间未变时保留已解码的封面；重新挂载组件后服务端仍按当前路径读取缓存。
- 网盘离线、视频损坏等原有生成失败仍需正常反馈，不保证所有文件都能生成封面。
- Windows 包沿用未签名测试发行配置。真实 CloudDrive2 扫描/删除 E2E: NOT RUN。
