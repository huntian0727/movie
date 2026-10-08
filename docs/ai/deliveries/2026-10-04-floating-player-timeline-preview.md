# 进度条浮动预览：不再挤压播放画面

## Context

用户指出上一版悬停时为预览让出高度、导致播放画面缩小。此次撤销该让位处理，保留普通 12px / 全屏 18px 的三倍厚度进度条。

分支：`ai/floating-player-timeline-preview`。开发基线 `fa70ae34e71092ce7efada217330d04c89f51dae`，开始时工作区干净，与 GitHub main 一致。

开发前备份：`2026-10-03_18-02-27-418_floating-player-timeline-preview`（UTC 命名）。Checkpoint：`checkpoint-20261004-020223-fa70ae3-floating-player-timeline-preview` 已推送。SQLite 一致性备份约 0.87GB / 345479 视频，quick_check OK；源码 bundle、设置和 manifest 已备份。

## Changes

- 新增 `src/main/playerTimelinePreview.ts`：单个可复用的 owned、non-activating、click-through 浮动预览窗口，不更改播放窗口或原生视频表面的 bounds。Windows 软件渲染配置下采用 layered composition；真实桌面首轮发现普通窗口只有边框能显示，修正后截图和时间均可见。
- 新增 `src/shared/playerTimelinePreview.ts`：严格类型和输入校验。仅接收当前视频 ID、时间、CSS 坐标；预览 URL 由主进程依据当前数据库记录构建，不接受任意 URL。处理屏幕边界、缩放、竖屏图片高度和加载期间离开竞态。
- 新增 `src/renderer/components/PlayerTimelinePreviewWindow.tsx`：独立小型预览 UI，复用 PreviewImage 的缓存、队列、取消和 Blob URL 生命周期。
- 修改 `src/main/playerWindow.ts`、`ipc.ts`、`preload.cts`、`security.ts`、`src/shared/videoTypes.ts`：增加 `player:timeline-preview`。只有当前 player 可调用定位；preview renderer 只暴露三个现有图片队列 API 和内容订阅，不暴露文件管理、数据库、设置或播放 API。Preload 缓存首次事件，避免 React 尚未挂载时丢失内容。
- 修改 `src/renderer/components/PlayerPage.tsx`、`styles.css`、`main.tsx`、`api/client.ts`：移除 previewClearance、测高、因 hover 触发的原生布局更新；内嵌模式使用浮动窗口，HTML 播放保留上方 DOM 预览。120ms 防抖；离开、切视频、弹窗、失焦、最小化、移动/缩放、全屏切换及关闭时隐藏/清理。
- 新增测试：`tests/main/playerTimelinePreview.test.ts`、`tests/renderer/PlayerTimelinePreviewWindow.test.tsx`；更新 UnifiedPlayer、进度条样式、IPC、preload、权限和窗口授权测试。
- 新增 `scripts/run-timeline-preview-smoke.mjs`、`scripts/timeline-preview-smoke-main.cjs`：独立临时资料目录中的真实 Electron 渲染验证，覆盖初始事件、图片队列授权、可见性、父窗口焦点和释放。Windows 复现命令：build → prepare:electron → `node scripts/run-timeline-preview-smoke.mjs`。
- 新增本交付记录。删除文件：无。不修改扫描、数据库结构、文件管理、MPV 解码和播放器控制核心。

## Verification

- 最终代码 `npm run test:release-gate`：PASS，类型检查/构建、Windows 文件 37 项、迁移 32 项、性能 26 项；完整 Vitest 96 文件 / 816 项 PASS。
- `prepare:electron`、`test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。
- 真实 timeline renderer smoke：PASS，模式 timeline-preview、00:45、图片元素、通过授权的图片队列请求、父窗口保持焦点、hide/close 正常；与正式程序一样关闭 Chromium 硬件加速。
- 桌面验证包 `package:dir`：PASS；artifact 检查和 packaged smoke 曾通过，最终提交后仍重新执行产物检查和 packaged smoke。
- 从实际桌面 `拉面影视.lnk` 启动，使用独立合成媒体资料库：HEVC+DTS 内嵌播放、普通/全屏预览图片与时间、播放列表同时显示、左边界限制、鼠标离开隐藏、播放继续均实测 PASS。普通画面边界 x=120..989 / y=99..588，全屏无侧栏 x=89..1447 / y=70..834；悬停前后相同。没有播放真实私有媒体或删除源文件。
- 首轮遗留权限数组断言失败已修正；最终完整门禁全部通过。Node 原生依赖尝试源码重建因缺少 VS C++ 工具失败，改用已有预构建 ABI 后完整门禁通过；没有安装编译器或更改系统配置。
- 提交后的最终打包、快捷方式目标、Commit/app.asar 时间核对和启动复验为收尾项；最终结果见任务回复，不提前声明完成。

## Risks and follow-up

浮动窗口需要 Windows compositor 支持，本机普通/全屏均已实测；其他 GPU、混合 DPI/多屏拖动尚未真实验证（负坐标和边界有单元测试）。每个播放器只复用一个小窗口，未建立第二套图片生成器；未缓存截图仍可能需要原有队列生成等待，不能承诺即时生成。长时间播放及真实 CloudDrive 网络媒体不在本次专项验证范围。无独立 E2E npm 脚本，采用现有 packaged smoke、新增 Electron smoke 和真实桌面检查。

快捷方式目标：`%USERPROFILE%/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。回滚通过 checkpoint/数据快照与本次 main 更新前的 backup-main 标签，以新提交恢复，不强制回退 main。
