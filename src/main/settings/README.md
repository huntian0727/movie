# 设置模块

CloudDrive 的普通 `settings.json` 仅保存 endpoint、timeout 和挂载映射。`AppSettings.cloudDrive` 是公开读取契约，另有由主进程计算的 `configured`；`AppSettingsUpdate` 仅为写入提供可选 `apiToken`。Renderer/Player 的读取响应在 IPC 与 sandboxed preload 两处按公开字段重建，不返回凭据。留空保存保留 Token，成功替换后输入框清空。

`src/main/clouddrive/credentialStore.ts` 将 Token 经 Electron `safeStorage` 加密后，原子写入 `app.getPath("userData")/clouddrive-credentials.bin`；Windows 使用 DPAPI，不提供明文回退，Linux `basic_text` 被拒绝。启动迁移先保存并校验密文，再移除旧 `cloudDrive.apiToken`，保留其余原配置。失败保留旧配置并以固定消息中止启动，供恢复系统安全存储/文件权限后重试；不会带着 plaintext 继续使用 CloudDrive。

项目快照包含密文并校验其 SHA-256，恢复旧快照时可再次迁移 legacy Token。历史快照中已有的明文不会被本轮自动删除；Windows 密文需要原 Windows 用户/系统的 DPAPI 密钥，不能视为跨机器可移植凭据。安全能力参考 [Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)。

`shared/cloudDriveEndpoint.ts` 为 UI、IPC、settings 保存、环境变量读取和 gRPC 构造共用规则：HTTP 仅允许字面 hostname 为 `localhost`、`127.0.0.0/8` 或 `::1`；其他地址要求 HTTPS，保留 TLS 证书验证。URL 不接受账号、路径、查询参数或片段。

`settingsStore.ts` 用 electron-store 持久化默认递归、启动同步、跳转秒数、封面截帧位置、播放偏好、CloudDrive API 配置和快捷键，并提供默认值。封面截帧位置可选 0/3/5/10/15 秒，短视频的实际截帧位置由媒体模块回退到中间位置。快捷键定义、格式化、匹配和旧设置归一化集中在 `src/shared/shortcuts.ts`；视频库与播放器分别要求绑定唯一。IPC 使用 Zod 再次约束完整结构、合法按键和同作用域冲突，设置页负责捕获交互。

新增设置需同步 shared `AppSettings`、默认值、IPC schema/preload、UI 和测试；必须考虑旧用户缺字段时的默认合并。新增快捷键还必须同步 `ShortcutActionId`、`DEFAULT_SHORTCUTS`、设置页元数据和实际消费者，并避免把 Escape/Enter/Tab 等基础交互键变成可配置动作。设置成功会发布 `settings:changed`，使已打开播放器重新读取配置。覆盖见 `settingsStore.test.ts`、`ipcContracts.test.ts`、renderer 设置/视频库/播放器测试。
