# CloudDrive2 挂载目录扫描加速

Phase 1 保留现有本地路径数据模型。普通本地磁盘、NAS 和 SMB 仍使用 `opendir`、目录 `stat` 与文件 `stat`；当资料库目录位于 CloudDrive2 挂载点内时，Main Process 使用 `GetMountPoints` 完成挂载路径映射，并通过服务器流式 `GetSubFiles` 读取每个目录。

SQLite 仍保存 `X:\Movies\movie.mkv` 一类 Windows 路径。CloudDrive2 返回的 `size` 和 `writeTime` 会直接进入当前逐目录快照扫描器，因此云端视频发现不再逐文件调用 `fs.stat()`，现有播放、收藏、历史、缓存和文件操作链路不需要数据库迁移。

## 配置

正式桌面版在“设置 → CloudDrive API”中保存 API 地址、Token 和超时，并可立即执行连接测试。保存后扫描、扫描异常复查、旧资料库绑定和 API 删除会共用该配置，无需通过命令行启动应用。

开发环境仍兼容环境变量：

```powershell
$env:LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TOKEN = "<api-token>"
$env:LOCAL_VIDEO_MANAGER_CLOUDDRIVE_ENDPOINT = "http://127.0.0.1:19798"
$env:LOCAL_VIDEO_MANAGER_CLOUDDRIVE_TIMEOUT_MS = "20000"
npm run dev:electron
```

`ENDPOINT` 和无响应超时可省略，默认值分别为 `http://127.0.0.1:19798` 和 20 秒。无响应超时会在收到 HTTP/2 数据或 trailers 时重新计时，因此持续返回的大目录不会被固定总时限截断。

如果 Token 没有读取挂载点的权限，可手动提供映射：

```powershell
$env:LOCAL_VIDEO_MANAGER_CLOUDDRIVE_MOUNT_MAP = '[{"mountPoint":"X:\\","sourceDir":"/115"}]'
```

Token 保存在当前 Windows 用户的应用设置文件中，不写入视频数据库或诊断日志。设置页使用密码输入框展示 Token。连接、配置或挂载映射错误会明确阻止旧资料库绑定和 API 删除，不再以“成功 0 项”静默返回；普通本地目录扫描仍保持原有路径。

## 完整性与失败行为

每个 CloudDrive2 目录只有在 `GetSubFiles` 流正常结束、HTTP 状态和 `grpc-status` 都成功后才交给快照和 missing 对账。流中途失败、超时、取消、半帧、重复或不安全条目均不会把部分结果当作完整目录。

已经识别为 CloudDrive2 的扫描不会在列举中途切回本地挂载层。根目录失败会报告 `offline`；子目录失败会记录为未解决扫描异常并把对应快照标为不完整，其他完整目录仍可继续处理。用户取消会关闭活动 HTTP/2 请求并沿用现有协作式取消状态。

## 旧资料库快速绑定

从挂载盘扫描得到的旧重复候选没有 CloudDrive 远端文件 ID。快速绑定只按候选所在目录调用 `GetSubFiles`，用文件名与缓存大小回填远端身份，不读取视频内容。

- 任务按 64 个目录分批，成功结果每批立即写入 SQLite；取消、关闭或失败后再次运行时，只查询尚未绑定的候选。
- 并发从 16 开始，根据每批响应时间和错误自动在 8–32 之间调整；出现目录失败时立即降并发，快速稳定时逐步升并发。
- 目录列举允许复用当前应用进程的 24 小时缓存，不为重复绑定强制刷新相同远端目录。
- Renderer 每 500ms 查询一次内存状态，展示已处理目录、速度、并发、已匹配数量和预计剩余时间；取消会终止活动 HTTP/2 流，但已完成批次仍然保留。

## 当前边界

- 当前阶段只替换挂载目录的发现和属性读取；FFprobe、FFmpeg、播放和文件操作仍使用挂载路径。
- 每次只在内存中保留一个目录的完整条目，确保对账安全；整个目录树不会一次性加载。
- 实际运行服务器对应的 `clouddrive.proto` 和实测行为优先于本文档。
- 真实 CloudDrive2 版本、Token 权限、WinFSP 挂载和大目录性能仍需在目标环境做 E2E 验证。
