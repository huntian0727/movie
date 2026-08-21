# Task Packet

- Task ID: TASK-CLOUD-001
- Title: CloudDrive2 网盘访问加速 · 批次 1（ffprobe 收紧 + CloseFileReader + HTTP/2 keepalive）
- Workflow: STANDARD
- Risk Areas: CLOUDDRIVE, CONCURRENCY, FILESYSTEM
- QA Required: YES
- UI Required: NO
- Web Advisor Required: NO
- Workflow Reason: 改动主进程网盘路径的字节读取行为和 gRPC 传输层，会影响网盘扫描与探测，但不涉及永久删除、迁移、播放架构或 UI 改版。
- Owner: Local PM
- User Goal: 网盘（首批目标：115 网盘，CloudDrive2 报告的上限为 maxDownloadThreads=2、maxQueriesPerSecond≈5）扫描与入库更快，拖动/播放不因自身探测挤占下载线程。
- Scope:
  1. 主进程识别"视频来源为 CloudDrive 挂载映射"的视频，在调用 FFprobe 时使用收紧参数：`-probesize 500k -analyzeduration 1M -fpsprobesize 20`；先 `-show_format`，必要时再 `-show_streams`；失败回退默认参数做二次尝试。
  2. 接入 CloudDrive2 gRPC `CloseFileReader`：在对网盘视频的 FFprobe 完成/失败/取消后，主动关闭对应远程路径的服务端 EntryReader，跳过默认 2 秒保留窗口。一次性缩略图/元数据读取同样适用。
  3. `grpcClient.ts` 的 HTTP/2 session 开启 keepalive：`keepAlive=true, keepAliveInterval=30_000, keepAliveTimeout=10_000`；为 `GetMountPoints` 设 5s、`GetSubFiles` 设首包 10s、后续包 idle 20s 的分层超时；支持通过现有 `LOCAL_VIDEO_MANAGER_CLOUDDRIVE_*` 环境变量覆盖。
- Out of Scope:
  - PrefetchFileRanges/CancelFilePrefetch（批次 2）
  - 受控并发目录遍历、限流器、队列背压（批次 3）
  - SetFolderDiskCache 自动规则、GetDownloadUrlPath 直链、PushMessage 增量（批次 4，FULL，待启动）
  - 任何播放字节通路改造、UI 改版、数据库 migration
- Acceptance:
  - 网盘视频的 FFprobe 冷字节读取量相较当前显著下降（用同一 115 网盘样本目录对比前后扫描耗时与 ffprobe 读取字节数）。
  - ffprobe 完成/失败/取消后，主进程对该远程路径调用过 CloseFileReader；hint 失败不阻断扫描。
  - HTTP/2 session 空闲 ≥ 60s 后首个 GetSubFiles 不再命中 20s 超时重建。
  - 网盘扫描异常、取消、超时时，旧视频索引保持不变，不被标记 missing（P0 不变量）。
  - 非网盘来源视频的扫描/探测行为保持不变。
- Automated Tests:
  - FFprobe 参数构造与回退路径的单元测试（网盘 vs 本地、失败回退、取消）。
  - CloseFileReader 在成功/失败/取消路径上的调用测试；gRPC 错误吞掉并记日志。
  - grpcClient keepalive 配置与分层超时的契约测试；首包超时与 idle 超时分别可复现。
  - 现有 479 测试全绿；新增网盘相关 focused tests。
- Status: DEV_PASS
- Next Actor: QA 在真实 115 网盘环境验证 FFprobe 字节读取量、CloseFileReader 调用、keepalive 效果。Git commit/push 待网络恢复。
- Delivery: docs/ai/deliveries/2026-08-21-clouddrive-perf-batch1.md
