# Main 进程模块

Electron 的可信执行层：启动/关闭、窗口、数据库、IPC、文件与媒体能力。`index.ts` 是装配根，`ipc.ts` 是 renderer 信任边界，`playerWindow.ts` 管理独立播放器，`preload.cts` 仅暴露 `VideoManagerApi`。

交互链为 renderer → preload → IPC/Zod → repository/service。修改 IPC 时必须同步 `src/shared/videoTypes.ts`、preload、handler、renderer 与 `tests/main/ipcContracts.test.ts`。不得打开 `nodeIntegration` 或把任意路径操作暴露给 renderer。

需求定位：启动失败查 `index.ts`、preload 输出和 `scripts/start-desktop.mjs`；新增跨进程操作查 shared/preload/`ipc.ts`；播放窗口会话、300 条队列边界和领域事件广播查 `playerWindow.ts`，事件发布点查 `ipc.ts`/`index.ts`；启动同步查 `index.ts`/media scanner。播放器 URL 不得重新承载 video id 或完整队列；新增跨窗口状态必须遵守“业务成功后发布”和单调 sequence 快照协议。测试分散于 `tests/main`，Electron 真实双窗口生命周期仍需手测。

日志与诊断查 `logging/`：主进程写操作由 IPC 包装器生成 operation ID 和计数摘要，扫描/FFprobe/缓存/安全及进程异常在各自错误边界记录。任何新增日志上下文都必须确认写盘前脱敏；播放器角色不得获得诊断导出 IPC。
