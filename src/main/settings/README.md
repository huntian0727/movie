# 设置模块

`settingsStore.ts` 用 electron-store 持久化默认递归、启动同步、跳转秒数、封面截帧位置、播放偏好和快捷键，并提供默认值。封面截帧位置可选 0/3/5/10/15 秒，短视频的实际截帧位置由媒体模块回退到中间位置。快捷键定义、格式化、匹配和旧设置归一化集中在 `src/shared/shortcuts.ts`；视频库与播放器分别要求绑定唯一。IPC 使用 Zod 再次约束完整结构、合法按键和同作用域冲突，设置页负责捕获交互。

新增设置需同步 shared `AppSettings`、默认值、IPC schema/preload、UI 和测试；必须考虑旧用户缺字段时的默认合并。新增快捷键还必须同步 `ShortcutActionId`、`DEFAULT_SHORTCUTS`、设置页元数据和实际消费者，并避免把 Escape/Enter/Tab 等基础交互键变成可配置动作。设置成功会发布 `settings:changed`，使已打开播放器重新读取配置。覆盖见 `settingsStore.test.ts`、`ipcContracts.test.ts`、renderer 设置/视频库/播放器测试。
