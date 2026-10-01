---
date: 2026-10-01
branch: ai/video-list-storyboard
type: feat
status: partial
---

# 视频浏览列表截图故事板

## Context

用户确认在视频浏览列表视图中，每个视频下展示 6 张按时长均匀分布的截图，展开后按长度展示完整截图，点击截图从对应时间播放。

开发前快照：`2026-10-01_14-14-06-571_video-list-storyboard`。代码检查点：`checkpoint-20261001-221345-e8a721c-video-list-storyboard`。上一轮已完成的播放诊断修正已独立提交为 `e8a721c`，未覆盖或丢弃其他修改。初始 GitHub fetch 和检查点推送遇到连接重置，远端状态暂不可验证。

## Changes

- 新增 `src/shared/storyboard.ts`：中心分段采样，列表 6 张；展开按 <=1 分钟/5 分钟/20 分钟/60 分钟/150 分钟/更长选择 6/8/12/16/20/24 张。
- 新增 `src/renderer/components/VideoStoryboard.tsx`：截图条、时间标签、展开/收起、只重试失败截图、点击时间播放。
- `VideoTable.tsx` 为每条视频增加截图行，并复用渐进挂载，每批 12 条。网格视图和视频数据表的展示未改变。
- 使用既有 `PreviewImage`、时间轴截图 IPC、FFmpeg、缓存和全局两并发队列；图片进入可见区域后才发起请求，离屏/卸载取消任务，CloudDrive 远端身份截图使用较低优先级。未知时长只显示说明。
- 缓存地址由路径、大小和修改时间决定，数据库更新时间与缓存状态变化不会触发图片闪烁。
- 最小扩展既有播放 IPC/session：可选 `startPositionMs`（非负安全整数）和会话 `startRequestId`。每次截图点击获得独立请求标识；普通缓存回读不重新跳转，切换下一视频清空起始位置。内置播放等待媒体元数据加载后定位；MPV 使用 `--start` 参数。原参数调用保持兼容。
- 未新增数据库表/字段，未修改扫描器、文件删除和播放器路由选择。
- 新增采样及可见区域/重试测试，补充播放会话、内置定位和 MPV 参数测试。
- 修改文件：`src/main/ipc.ts`、`src/main/preload.cts`、`src/main/playerWindow.ts`、`src/main/media/mpvController.ts`、`src/shared/videoTypes.ts`、`src/renderer/App.tsx`、`src/renderer/components/LibraryShell.tsx`、`PlayerPage.tsx`、`VideoTable.tsx`、`src/renderer/styles.css` 及对应测试。删除文件：无。

## Verification

- `npm run test:release-gate`：PASS，78 个测试文件、717 项测试；包含类型检查、构建、Windows 文件操作、迁移、性能和完整 Node 测试。
- `npm run prepare:electron`、`npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。
- 测试覆盖：中心分段及边界、未知时长、稳定文件版本缓存、可见性加载和取消、展开/收起、失败隔离重试、CloudDrive 请求优先级、同视频重复截图点击、新媒体加载定位、后续快照不重复定位、切换视频清空起始位置、MPV 起始参数。
- 首轮新测试修正：测试媒体实际时长为 1 秒，改为 500ms 断言；在卸载组件后再还原 URL mock，避免测试清理异常。
- 测试环境使用本地隔离 Node 22.23.1 / npm 10.9.8，并分别匹配 Node 与 Electron SQLite ABI；未更改用户资料库。临时旧 npm 目录文件缺失，通过 npm 包缓存准备了新的临时工具环境。
- 桌面重新打包与人工验证：待完成，尚未宣称桌面版本已交付。

## Risks and follow-up

- 首次截图需要读取并解码视频片段，CloudDrive/NAS 的定位与网络速度仍会影响生成速度；缓存命中不重新读取视频。当前继续使用已有总并发上限 2，远端截图低优先级；并非读取零字节的视频操作。
- 只有取得有效时长的视频才能均匀采样；时长缺失需先完成原元数据任务。
- 展开使用更密的均匀采样位置，首次可能生成另一组帧，均纳入现有时间轴缓存配额。
- MPV 不可用时沿用系统默认播放器回退，系统默认播放器接口无法保证传递指定起始时间。
- 发布推送、桌面包和真实 UI 检查结果将在验证后补充。
