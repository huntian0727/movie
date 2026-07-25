# Shared 契约模块

`videoTypes.ts` 是主/预加载/渲染共享的领域类型、扩展名、排序白名单、IPC channel 和 `VideoManagerApi`；`playbackRouting.ts` 用扩展名与偏好选择 native/mpv。

这是跨层变更起点而非实现层。新增字段/方法后必须追踪 DB、repository、preload、IPC Zod、renderer fixtures/UI 和测试。不要把 Node/Electron 类型引入此目录。覆盖见 `videoTypes.test.ts`、`playerRouting.test.ts`、`ipcContracts.test.ts`。

播放器会话上限由 `MAX_PLAYER_QUEUE_ITEMS` 统一定义；`DomainEvent`、`PlayerSessionSnapshot` 与 `WindowSyncSnapshot` 是多窗口一致性的正式协议，不能在任一进程复制出另一套非类型化结构。新增事件时必须明确成功发布点、受影响窗口和快照恢复语义，并保持 sequence 单调递增。

`DiagnosticsPreview`/`DiagnosticsExportResult` 只描述 renderer 可见白名单，不承载原始日志或数据库内容；诊断 IPC 必须保持 main-only，不能加入播放器允许列表。
