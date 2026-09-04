---
date: 2026-09-04
branch: ai/playback-diagnostic-v1
type: feat
status: completed
---

# 映匣 Playback Diagnostic V1 交付记录

## Context

本次在不修改播放器、扫描、文件管理核心逻辑和数据库结构的前提下，新增播放诊断页面。页面只解释现有播放路由与资料库缓存字段，用于回答“当前会采用什么播放策略，以及可能需要留意什么”，不承诺实际播放或硬件解码结果。

## 分支

`ai/playback-diagnostic-v1`

## Commit

待项目经理完成提交后填写最终哈希。

## Changes

- 在侧栏“最近播放”之后增加无计数的 Lucide 图标入口“播放诊断”，默认启动页面仍为“所有视频”。
- 新增独立 `PlaybackDiagnosticPage`。未选择视频时仅加载最多 10 条已有最近播放记录；只有输入搜索词后，才以 225 ms 防抖、每页 30 条执行现有服务端分页查询，不加载封面。
- 主资料库的 `VideoDetailsDialog` 增加可选“播放诊断”入口。播放器页面不传入该回调，原播放器详情行为保持不变。
- 选中视频后只通过现有 `listVideosByIds([id])` 刷新数据库快照。刷新失败保留旧快照并局部提示，迟到响应会被丢弃。
- 新增纯共享 `playbackDiagnosis` 解释器。真实 route 始终来自未修改的 `choosePlaybackRoute(video, preference)`；解释器只说明该结果，不承担第二套路由决策。
- 支持 auto、native-first、mpv-first 三种偏好，以及 pending、failed、unprobed、MP4 H264 AAC、HEVC DTS、WebM 和未记录音频字段等状态。
- 未完成采集或读取失败时统一显示风险未知，音频字段明确区分尚未采集、读取失败和已采集但未记录。
- 文件缺失时停用播放和元数据重试，并提供扫描异常与更换视频入口；数据库记录已移除时显示明确空状态。
- 诊断页进入 `isStandaloneView` 集中隔离，不触发普通视频分页、批量工具栏、翻页快捷键、通用 Toolbar 或扫描刷新。
- 页面使用现有深色紧凑样式与 Lucide 图标，不增加依赖，不修改全局详情弹窗样式。

## 新增文件

- `src/shared/playbackDiagnosis.ts`
- `src/renderer/components/PlaybackDiagnosticPage.tsx`
- `tests/shared/playbackDiagnosis.test.ts`
- `tests/renderer/PlaybackDiagnosticPage.test.tsx`
- `docs/ai/deliveries/2026-09-04-playback-diagnostic-v1.md`

## 修改文件

- `src/shared/videoTypes.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/VideoDetailsDialog.tsx`
- `src/renderer/styles.css`
- `tests/renderer/LibraryShell.test.tsx`
- `tests/renderer/PlayerPage.test.tsx`

## 删除文件

无。

## 数据来源

- 文件名、路径、大小、修改时间：现有 `VideoRecord` 缓存字段。
- 格式、视频编码、分辨率、Profile、Pixel Format、音频编码和媒体状态：现有 `VideoRecord` 媒体字段。
- 来源名称、类型和根路径：现有 `SourceFolder` 数据。
- 当前播放 route：现有 `choosePlaybackRoute(video, playbackPreference)`。
- 最近播放：现有 `recentVideoIds`，通过 `listVideosByIds` 读取最多 10 条记录。
- 搜索：现有 `listVideoPage`，固定 `view: all`、`pageSize: 30` 服务端分页。

## Verification

- Electron 33.4.11 Node 模式完整 Vitest：PASS，61 个测试文件、596 项测试。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- `npm run build`：PASS，Vite 成功生成生产 Renderer。
- Electron 主进程 smoke：PASS。
- 人工验证：尚未在真实 Windows 主窗口执行。

## 未验证事项

- 尚未验证真实资料库中长路径、窄窗口和多页搜索的视觉表现。
- 本阶段未打包，安装包与桌面快捷方式留待最终交付阶段验证。
- 播放建议是缓存字段规则分析，未执行真实媒体播放和硬件能力探测。

## Risks and follow-up

- 旧资料库若缺少 codec/profile/pixel format，诊断置信度会降低；页面只在用户明确点击“补充元数据”后调用现有重试能力。
- 数据库中的文件缺失标记与真实远端状态可能存在时间差，诊断页不会为了实时确认而访问文件系统或 CloudDrive。
- 不同设备的系统解码器和驱动能力不同，因此诊断结果只能作为风险提示，不能保证播放成功或失败。
