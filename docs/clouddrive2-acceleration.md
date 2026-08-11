# CloudDrive2 挂载目录扫描加速

Phase 1 保留现有本地路径数据模型。普通本地磁盘、NAS 和 SMB 仍使用 `opendir`、目录 `stat` 与文件 `stat`；当资料库目录位于 CloudDrive2 挂载点内时，Main Process 使用 `GetMountPoints` 完成挂载路径映射，并通过服务器流式 `GetSubFiles` 读取每个目录。

SQLite 仍保存 `X:\Movies\movie.mkv` 一类 Windows 路径。CloudDrive2 返回的 `size` 和 `writeTime` 会直接进入当前逐目录快照扫描器，因此云端视频发现不再逐文件调用 `fs.stat()`，现有播放、收藏、历史、缓存和文件操作链路不需要数据库迁移。

## 配置

只在 Electron Main Process 启动环境中提供最小权限 API Token：

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

Token、JWT 和授权 Header 不写入数据库、Renderer 或日志。配置错误会停止该次扫描；未配置 Token、初次自动探测不可用或目录不属于 CloudDrive2 挂载点时，扫描器保持原有本地路径。

## 完整性与失败行为

每个 CloudDrive2 目录只有在 `GetSubFiles` 流正常结束、HTTP 状态和 `grpc-status` 都成功后才交给快照和 missing 对账。流中途失败、超时、取消、半帧、重复或不安全条目均不会把部分结果当作完整目录。

已经识别为 CloudDrive2 的扫描不会在列举中途切回本地挂载层。根目录失败会报告 `offline`；子目录失败会记录为未解决扫描异常并把对应快照标为不完整，其他完整目录仍可继续处理。用户取消会关闭活动 HTTP/2 请求并沿用现有协作式取消状态。

## 当前边界

- 当前阶段只替换挂载目录的发现和属性读取；FFprobe、FFmpeg、播放和文件操作仍使用挂载路径。
- 每次只在内存中保留一个目录的完整条目，确保对账安全；整个目录树不会一次性加载。
- 实际运行服务器对应的 `clouddrive.proto` 和实测行为优先于本文档。
- 真实 CloudDrive2 版本、Token 权限、WinFSP 挂载和大目录性能仍需在目标环境做 E2E 验证。
