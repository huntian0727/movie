# 设置模块

`settingsStore.ts` 用 electron-store 持久化默认递归、启动同步、跳转秒数、封面截帧位置和播放偏好，并提供默认值。封面截帧位置可选 0/3/5/10/15 秒，短视频的实际截帧位置由媒体模块回退到中间位置。IPC 使用 Zod 再次约束范围，设置页负责交互。

新增设置需同步 shared `AppSettings`、默认值、IPC schema/preload、UI 和测试；必须考虑旧用户缺字段时的默认合并。覆盖见 `settingsStore.test.ts`、`ipcContracts.test.ts`、renderer 设置测试。
