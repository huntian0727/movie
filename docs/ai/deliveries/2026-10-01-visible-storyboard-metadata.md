---
date: 2026-10-01
branch: ai/visible-storyboard-metadata
type: fix
status: desktop-delivered
---

# 列表截图待分析衔接修复

## Context

用户截图中的五个 CloudDrive 视频均为 metadata pending、duration null，且每种精确大小在有效资料库里只有一份。既有后台策略只分析 CloudDrive 同大小候选，因此仅等待时长不会生成截图。用户确认只对当前可见视频优先分析并自动加载截图，不整库扫描。

基线 `7b6d557`，工作区干净，与最后已核对的 origin/main 一致；本轮 fetch 因连接重置失败，未覆盖任何本地/远端修改。开发前快照 `2026-10-01_15-30-25-815_visible-storyboard-metadata`，检查点 `checkpoint-20261001-233005-7b6d557-visible-storyboard-metadata`；SQLite quick_check ok、345479 条记录。检查点远端推送受网络影响失败，本地与数据备份成功。

## Changes

- `VideoStoryboard.tsx` 增加可见性时长入口：进入视口稳定 250ms 后请求，排队/分析中/失败明确显示，失败提供“重试时长分析”。隐藏窗口、离屏、卸载均释放请求。旧文件版本的结果不得覆盖当前截图。
- `MetadataQueue.requestVisible` 复用现有队列、并发上限及版本更新保护，不新增另一套扫描系统；重复请求合并，同视频多个消费者离开后才撤销仅预览拥有的待执行任务。扫描器和手动重试的后台任务不受取消影响。
- 已开始的任务不强行终止，沿用现有 FFprobe 超时收尾；CloudDrive 优先读 duration，成功直接写入原字段，时长/图片均复用已有缓存。
- 新增 `src/main/media/previewMetadataIpc.ts`，主窗口限定、严格校验、64 请求上限、同 Renderer 所有权、导航/关闭取消。三个 IPC/API 契约见 `src/main/media/README.md`，状态查询不触发文件读取。
- 修改 `src/main/ipc.ts`、`src/main/media/metadataQueue.ts`、`src/main/preload.cts`、`src/shared/videoTypes.ts`、`src/renderer/components/VideoStoryboard.tsx`、`src/renderer/styles.css`、媒体 README 与对应测试。
- 新增 `tests/main/previewMetadataIpc.test.ts`。删除文件：无。未修改数据库结构、扫描器、文件管理、播放器策略和播放流程。

## Verification

- `npm run test:release-gate`：PASS，79 个文件、731 项测试；类型检查、构建、Windows 文件操作、迁移和性能门禁通过。
- 新增测试覆盖：CloudDrive 独有大小视频可见解析、优先队列、后台任务所有权、多消费者取消、活动分析离屏收尾和结果复用、failed/0B/缺失保护、关闭队列、IPC 校验/上限/所有权/导航关闭，以及 Renderer 可见请求、取消、状态、显式重试与旧版本隔离。
- 首轮定向测试仅一个旧用例失败：增加时长占位 observer 后，原测试仍操作已卸载 observer。修正为当前截图 observer，全量复测通过。
- `npm run prepare:electron`、`npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。
- `npm run verify:artifact`、`npm run test:packaged-smoke`、`npm run test:installer-smoke`：PASS。安装包以隔离目录测试，随后恢复并核对同名桌面快捷方式。
- Windows 包与 NSIS 安装器成功生成：功能 Commit `80672a7` 时间 2026-10-01 23:46:36，`release/win-unpacked/resources/app.asar` 时间 23:47:31，`release/拉面影视-0.1.15-x64-Setup.exe` 时间 23:47:53。
- 从 `%USERPROFILE%/Desktop/拉面影视.lnk` 实际启动，新快捷方式目标为 `%USERPROFILE%/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。
- 真实 CloudDrive 目录验证：用户截图首条问题视频自动从 pending/null 变为 ready、时长 12840ms，6 张均匀截图全部实际加载；原来另外四条未进入视口的视频仍保持 pending/null，未全库读取。目录里其他可见 pending 视频同样补出时长并生成截图。使用真实挂载盘读取，无整库扫描或文件删除。
- 备份 Verify：PASS，schema 13、SQLite quick_check ok、345479 条记录。
- 失败重试、文件版本变化隔离、多人请求取消与活动任务收尾通过自动化验证；未人为中断真实 CloudDrive 服务进行故障注入。

## Risks and follow-up

- 时长解析和截图仍需读取视频片段。CloudDrive 挂载盘或源服务慢/离线时可能达到既有 30 秒时长解析/60 秒完整解析超时；不保证瞬间出图，也不判定等待就是损坏。
- 离屏只撤销尚未执行的预览专属任务；已经开始的有界任务和原后台任务继续收尾。
- 无有效时长、缺失文件与 0B 不会强行生成截图；failed 需要明确重试，不自动无限消耗带宽。
- 桌面版本已交付。GitHub 最新状态本轮初始不可读取，最终交付通过脚本尝试安全同步，禁止强制推送；以脚本结果确认最终远程状态。
