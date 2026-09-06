---
date: 2026-09-07
branch: ai/default-asset-center
type: feat
status: completed
---

# 启动默认进入资产中心

## Context

程序此前启动后默认进入“所有视频”。用户希望主窗口打开时直接进入资产中心，以便先查看资料库健康度与异常统计。

## Changes

- 完整桌面 API 同时提供资产中心汇总与来源分页能力时，将初始视图设为资产中心。
- 精简测试环境或不完整桥接缺少资产中心能力时仍回退到“所有视频”，避免显示无法加载的空页面。
- 更新资产中心回归测试，验证启动后入口高亮、资产中心内容可见，且不会提前请求视频分页。
- 更新打包冒烟流程，先验证默认资产中心，再导航到“所有视频”继续原有封面与媒体协议检查。

## Verification

- `npm run typecheck`：PASS。
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 全量 Vitest：PASS，67 个文件、632 项测试。
- Node 22.23.1 隔离 `npm run test:release-gate`：PASS，最终提交再次覆盖类型检查、构建、Windows 文件、迁移、性能和 632 项全量测试。
- `npm run dist:win` 与 `verify:artifact`：PASS；`app.asar` 共 3,975 个条目且不含禁止的开发文件。
- 解压版和安装器冒烟测试：PASS；两者均返回 `defaultAssetCenter: true`，随后可导航到“所有视频”并完成封面生成、缓存、重新生成和轮询稳定性检查。
- 桌面快捷方式目标和工作目录均指向本次 `release/win-unpacked`，已通过该快捷方式启动并确认实际进程路径一致。

## Risks and follow-up

- 本次只改变主窗口首次挂载的默认视图；用户进入其他页面后的导航行为不变。
