# 映匣 UI V1 最终发布交付

## Context

资产中心、播放诊断中心和 UI 细节优化已经按“开发、QA、下一阶段”的顺序完成。本次收尾补齐真实打包环境中的 worker 验证，生成 Windows 产物，并把桌面使用入口更新到最新构建。

## Changes

- 扩展 packaged smoke 上下文，直接调用资产中心只读聚合 worker。
- 扩展 packaged smoke 上下文，直接调用播放诊断只读搜索 worker，并覆盖文件路径搜索。
- 增加静态回归测试，防止未来发布门禁意外移除两个 worker 检查。
- 新增最终发布 QA 报告，记录测试、性能、安装和桌面启动结果。
- 未修改扫描核心、播放核心、文件管理核心、数据库结构或已有页面业务流程。
- Windows 安装包和 `win-unpacked` 为生成产物，不提交到 Git。

## Verification

- Node.js 22.23.1 / npm 10.9.8 `npm run test:release-gate`：通过，64 个测试文件、619 个测试。
- `npm run package:dir`：通过。
- `npm run verify:artifact`：通过，3974 个 ASAR 条目，无禁入开发文件。
- `npm run test:packaged-smoke`：通过，`assetCenterWorkerQuery` 与 `playbackDiagnosticWorkerQuery` 均为 `true`。
- `npm run dist:win`：通过，生成 `Local-Video-Manager-0.1.15-x64-Setup.exe`。
- `npm run release:metadata`：通过。
- `npm run test:installer-smoke`：通过，包含安装、覆盖安装、卸载和用户数据保留。
- 桌面快捷方式目标已核对为 `C:\Users\test\Documents\视频管理\movie\release\win-unpacked\Local Video Manager.exe`。
- 最新桌面程序启动成功，版本 0.1.15 启动日志完成，窗口最大化。

## Risks and follow-up

- 当前是未签名测试构建，正式对外发布前仍需代码签名和全新 Windows 设备验收。
- 当前桌面控制环境未提供 Electron 可访问性树，最终人工视觉交互建议由用户在真实资料库中补充体验确认。
- 两个新页面只做读取、分析与展示，后续增强仍应沿用独立页面和只读 worker 的最小侵入策略。
