# 视频播放架构

## 当前播放流程

```text
用户点击网格/表格/重复项/异常页的视频
  -> LibraryShell.openVideo / App.onOpen
  -> VideoManagerApi.openPlayer(videoId, queueIds)
  -> preload: video:open-player
  -> ipc.ts: Zod 校验 player session
  -> PlayerWindowCoordinator.open
     -> VideoRepository 反查 ID、排除 missing、规范化最多 300 条队列
     -> PlaybackMetadataEnricher 按需补 codec，最多等待 2 秒
     -> 创建/复用独立 player BrowserWindow
  -> player renderer 通过 WindowSyncSnapshot 获取 VideoRecord 和队列
  -> choosePlaybackRoute(video, playbackPreference)
     -> native: HTMLVideoElement + local-video://media/<videoId>
     -> mpv: video:play-external -> spawn mpv
```

## 播放入口

- 列表与卡片：`src/renderer/components/VideoGrid.tsx`、`VideoTable.tsx`。
- 重复项：`src/renderer/components/DuplicateGroupsPage.tsx`。
- 扫描异常：`src/renderer/components/ScanFailuresPage.tsx`。
- UI 编排：`src/renderer/components/LibraryShell.tsx#openVideo`。
- 跨进程调用：`src/renderer/App.tsx` 中 `api.openPlayer(video.id, queueIds)`。
- IPC channel：`video:open-player`，声明于 `src/shared/videoTypes.ts`，暴露于 `src/main/preload.cts`，处理于 `src/main/ipc.ts`。

## 播放组件和会话

- 视图：`src/renderer/components/PlayerPage.tsx`。
- 会话/窗口：`src/main/playerWindow.ts#PlayerWindowCoordinator`。
- 播放窗口使用同一 React bundle，但 preload 只暴露 `playerApi` 白名单。
- 会话仅保存 `selectedVideoId + queueIds`；每次快照都从 repository 重读记录并排除 `isMissing`。
- 队列上限为 `MAX_PLAYER_QUEUE_ITEMS = 300`。播放页还可以用 `listVideoPage` 每次 100 条加载当前目录列表。

## 路由决策

位置：`src/shared/playbackRouting.ts#choosePlaybackRoute`。

- `mpv-first`：始终走 mpv。
- `native-first`：MP4/M4V/MOV/WebM 先走 native，其他容器走 mpv。
- `auto`：
  - metadata 仍 pending 时，常见容器先 native。
  - metadata/probe 未 ready 或失败时，保守走 mpv。
  - MP4/MOV native 需 H.264 指定 profile + `yuv420p` + AAC/MP3/无音轨。
  - WebM native 需 VP8/VP9 + `yuv420p` + Opus/Vorbis/无音轨。

## Native 播放服务

- `PlayerPage` 创建 `<video src="local-video://media/<id>">`。
- `src/main/media/mediaProtocol.ts` 按 ID 从 `VideoRepository` 反查真实路径。
- 主进程通过 `fs.stat` + `createReadStream` 返回流，支持 HTTP Range、206 和 416；不把整个文件读入内存。
- MIME 按扩展名映射。实际解码能力仍由 Electron/Chromium 媒体栈决定。

## 外部播放与失败处理

1. native `<video>` 触发 `onError`时，`PlayerPage` 显示“正在尝试 mpv”并调用 `onPlayExternal`。
2. `video:play-external` 在主进程按 video ID 反查路径。
3. `src/main/media/mpvController.ts` 以 detached/hidden 方式启动 `mpv --force-window=yes --keep-open=no <path>`。
4. mpv 无法 spawn 时，`src/main/ipc.ts` 调用 Electron `shell.openPath`，交给 Windows 默认程序。
5. mpv 和系统默认程序都失败时，IPC reject，`PlayerPage.playbackError` 以 banner 显示错误。
6. codec 懒探测失败会写 `codec_probe_status = failed` 并记录脱敏日志，但不阻塞打开播放器。

## 历史与诊断能力现状

- `play_history` 保存每个视频最近的 `played_at` 和 `position_ms`。
- 打开/切换会话会记录播放历史；当前 `PlayerPage` 没有在 `timeupdate` 时持久化播放位置，因此 `position_ms` 通常为 0。
- native 播放失败只是 renderer 内存状态；mpv/system fallback 最终失败通过 IPC 错误返回。
- 没有“播放尝试/成功/失败/fallback 阶段”的持久化数据表或查询 API，因此现在无法稳定生成播放异常统计。

## 为播放诊断中心应保护的边界

- 不改 `choosePlaybackRoute`、`PlayerWindowCoordinator`、`mediaProtocol` 或 fallback 顺序。
- 诊断应是新的只读 service/IPC，输入 video ID，由主进程反查当前文件版本。
- 详细 ffprobe 必须按用户显式操作执行，支持取消/超时，不在页面打开或全库扫描时自动读取大量网盘媒体。
- 可直接复用 `choosePlaybackRoute` 生成“当前预测路由”，但必须标明它是规则推荐，不是真实解码成功证明。
