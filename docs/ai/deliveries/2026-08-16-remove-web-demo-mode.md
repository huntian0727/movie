---
date: 2026-08-16
branch: ai/remove-web-demo-mode
type: refactor
status: completed
---

# 取消独立 Web/demo 运行模式

## Context

项目的真实能力依赖 Electron preload/IPC，但 `App.tsx` 在普通浏览器中用 demo 视频、目录和假成功操作模拟另一套产品行为，增加维护成本并可能掩盖桌面 API 注入故障。

## Changes

- 删除 demo 视频、demo 目录、`createDemoVideo` 和业务层所有 API 缺失 fallback。
- 将入口拆为 runtime guard 与必须注入 `DesktopVideoManagerApi` 的真实应用；缺少 preload 时只显示 unsupported-runtime。
- 将 `npm run dev` 收敛为含义明确的 `dev:renderer`；Electron 启动器仍直接启动 Vite。
- 新增 Desktop-only runtime 测试，更新 scaffold、安全边界和项目维护文档。
- 新增 ADR-004，明确 React/Vite 是 Electron Renderer 技术栈而不是 Web 产品。

## Verification

- Node/Web TypeScript：PASS。
- 定向 runtime/scaffold/security/IPC：4 个文件、17 项测试 PASS。
- `npm run test:release-gate`：PARTIAL；lint、build、37 项 Windows 文件安全、23 项迁移、19 项性能/缓存/播放器测试 PASS，最后嵌套环境检查错误读取全局 npm 11.9.0（要求 10.9.8）后主动停止。
- 固定 Node 22 直接运行全量 Vitest：44 个文件、412 项测试 PASS。
- Electron 33.4.11 native/main-process smoke：PASS。
- `scripts/start-desktop.mjs` 实际启动：PASS；主窗口加载真实资料库和 preload API，未进入 unsupported-runtime。
- unpacked 打包与 artifact 检查：PASS，3951 个 asar 条目，无开发产物。
- packaged smoke：PASS；SQLite quick check、fixture 扫描、协议、Renderer mount、preload、安全边界与 FFmpeg/FFprobe 均通过。
- 桌面快捷方式：PASS；`C:\Users\test\Desktop\Video Manager (Dev).lnk` 指向本轮 `release\win-unpacked\Local Video Manager.exe`，并已从快捷方式启动确认真实资料库。

## Risks and follow-up

- 普通浏览器只用于验证保护页，不再支持业务 UI 交互。
- NSIS 安装包、上一正式版本升级、签名和干净 Windows VM：需要发布阶段验证，本轮未执行。
