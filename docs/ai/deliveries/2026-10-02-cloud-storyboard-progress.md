---
date: 2026-10-02
branch: ai/cloud-storyboard-progress
type: fix
status: verification-in-progress
---

# 云盘截图条进度与有界抽帧优化

## Context

- 基线 `c271542f49f8a27700666c0fc1f44d75db236769`，开始时工作区干净，fetch 后与 origin/main 一致。
- 快照 `2026-10-01_18-59-54-948_cloud-storyboard-progress`，检查点 `checkpoint-20261002-025951-c271542-cloud-storyboard-progress` 已推送；SQLite 一致性备份 345479 条视频，0.87 GB，quick_check ok。
- 诊断确认截图中三条视频缓存分别只有 2/6、1/6、0/6；并非只缺一次页面刷新。FFmpeg 经挂载路径读取视频，API 不直接提供截图；同一运行中存在其他高码率视频的 30 秒抽帧超时，但不能据此断言三条视频均因该错误失败。诊断采样时无 FFmpeg 进程，持续带宽不能全部归因于截图任务。

## Changes

- 每帧区分排队、生成、离屏暂停、失败和成功；每条视频显示实际已加载 N/M、各状态数量，已有成功 blob 不因轮询重建。
- 默认六张均匀采样保持不变。可见首张优先于补图；全局生成最多两个任务，其中云盘最多一个。队列不抢占当前任务，同路径共享生成与最后消费者撤销规则保持。
- 云盘时间轴只解码关键帧，关闭精确 seek 并排除音频/字幕/数据输出，保持 30 秒单次预算和失败显式重试。本地时间轴和封面参数不变。Renderer 明示画面可能偏移，播放仍使用原采样时间。
- Main 根据已有远端身份确定 remote；Renderer 不能提交 remote/任意 FFmpeg 参数。
- `preview-image:state` / `getPreviewImageState(requestId)`：同窗口 UUID 请求只读内存状态，无源文件读取、SQLite 查询或全库枚举；加载结束/离屏后停止每秒查询。沿用可信 IPC、256 请求上限和导航/关闭撤销。
- 当前帧登记后，核对当前文件身份的六个默认缓存路径，完整后才把既有 timeline status 标为 ready；不新增数据库字段或迁移。ready 是默认采样缓存登记状态，不是所有展开帧完成或视频可播放证明。
- 不修改扫描逻辑、播放器核心、删除/移动逻辑、资料库结构；不增加整库抽帧、完整 SHA 或无界自动重试。

新增文件：`src/main/media/previewImageIpc.ts`、`tests/main/previewImageIpc.test.ts`、本交付记录。

修改文件：`src/main/media/{imageGenerationQueue,cacheService,mediaProtocol}.ts`、媒体 README、`src/main/db/videoRepository.ts`、`src/main/{ipc,preload,security}`、`src/shared/videoTypes.ts`、`src/renderer/components/{PreviewImage,VideoStoryboard}.tsx`、`src/renderer/styles.css` 与对应队列/缓存/服务/接口/资料库/Renderer 测试。

删除文件：无。

## Verification

- 定向测试：7 文件、95 项通过；新增 IPC 两项在后续全量运行通过。覆盖云盘单并发、首张优先、本地任务保留槽位、跨窗口请求隔离、参数拒绝/上限/关闭释放、缓存命中、当前身份六张完整性、失败重试和图片解码失败。
- 实际打包所用 FFmpeg：在隔离临时目录生成 12 秒 H.264、10 秒 GOP 测试视频，在 5 秒采样点使用新参数成功输出 8063 字节 JPEG。仅证明真实二进制参数兼容与输出成功，不是云盘带宽基准。
- 扩展真实二进制测试发现 11 秒末尾采样会因负帧时间而无图；增加输出 `setpts=PTS-STARTPTS` 后 1/3/5/7/9/11 秒六点均成功。新增自动化真实 FFmpeg 长 GOP 六张抽帧测试，确保末尾帧非空；以下门禁结果将更新为此修正版。
- 最终修正版 `npm run test:release-gate`：PASS，81 文件、749 项全量测试，lint/typecheck、build、Windows 文件操作、迁移、性能检查均通过。此次测试进程设置 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`。初次暴露的新 IPC 校验问题已修复；默认高并发执行中既有 LibraryShell 渐进渲染测试曾触发 1 秒等待超时，单独运行 58 项通过（目标用例 650ms），最终两 forks 完整门禁目标用例 614ms。未更改业务、断言或等待预算。真实 FFmpeg 测试固定为 Node 环境，避免 jsdom AbortSignal 与 Node subprocess 不兼容；最终六点实际抽帧测试 430ms。
- Electron、打包、安装器烟测及桌面快捷方式验收：待执行，完成后补充真实结果。

## Risks and follow-up

- 快速关键帧可能早于/晚于采样点，稀疏关键帧视频画面偏移更大；显示的是采样时间，不伪装成精确帧时间。
- 抽帧仍需读取视频部分数据，某些容器索引、超高码率/长 GOP 或云盘服务延迟仍可超时；本次不保证全部格式成功，也没有将 30 秒提高或添加自动重读。
- CloudDrive 自身预读、第三方播放器和其他后台读取不受本应用截图队列控制；不承诺系统总带宽绝对归零。
- 不执行真实文件删除，不中断 NAS/CloudDrive 服务，不用整库扫描作验收。
- 回滚使用新 revert 提交；源码/数据恢复使用本轮快照，不强推 main 或丢弃其他工作。

## Desktop delivery

待打包和真实快捷方式验收；目前不能宣称桌面版本已交付。
