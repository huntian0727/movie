---
date: 2026-10-01
branch: ai/visible-storyboard-metadata
type: fix
status: partial
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
- 桌面包/安装包与真实用户目录验证：待完成，不宣称已交付。

## Risks and follow-up

- 时长解析和截图仍需读取视频片段。CloudDrive 挂载盘或源服务慢/离线时可能达到既有 30 秒时长解析/60 秒完整解析超时；不保证瞬间出图，也不判定等待就是损坏。
- 离屏只撤销尚未执行的预览专属任务；已经开始的有界任务和原后台任务继续收尾。
- 无有效时长、缺失文件与 0B 不会强行生成截图；failed 需要明确重试，不自动无限消耗带宽。
- GitHub 最新状态本轮初始不可读取，最终交付通过脚本尝试安全同步，禁止强制推送。
