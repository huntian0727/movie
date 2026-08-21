---
date: 2026-08-21
branch: ai/project-manager-handoff
type: assessment
status: draft
owner: Local PM
based_on:
  - CloudDrive2 gRPC API Guide v1.0.14
  - src/main/clouddrive/grpcClient.ts
  - src/main/clouddrive/mountedScanner.ts
  - src/main/media/libraryScanner.ts
  - docs/ai/deliveries/2026-08-21-project-manager-handoff.md
---

# CloudDrive2 网盘访问性能评估

## 0. 结论速览

- 映匣目前只完成 CloudDrive2 **Phase 1**：`GetMountPoints` + `GetSubFiles` 目录枚举；播放、FFprobe 探测、缩略图仍通过 CloudDrive2 在 Windows 上的 WinFSP 挂载点走本地文件系统。
- 指南中决定网盘访问速度的关键能力（预取、直链、磁盘缓存、性能上限、Push 增量）**一个都未接入**，存在明确优化空间。
- 立即收益最大的不是改枚举，而是**让网盘字节读取路径变聪明**：`CloseFileReader`、FFprobe 参数收紧、`PrefetchFileRanges`、按文件夹磁盘缓存。
- 任何优化不得冲击 P0 不变量：扫描异常不能误标 missing；Desktop-only；token/敏感配置留在主进程；只读云盘禁写；Node/Electron ABI 隔离。

## 1. 当前实现盘点

| 维度 | 现状 | 代码位置 |
| --- | --- | --- |
| 传输 | 手写 HTTP/2 + 手写 protobuf，单条长连接 session | `grpcClient.ts` |
| RPC 覆盖 | `GetMountPoints`、`GetSubFiles(server-stream)` | `grpcClient.ts` |
| 字节读取 | **未走 gRPC**；播放/ffprobe 走挂载点本地路径 | `libraryScanner.ts` |
| 并发 | 目录逐个 `await readDirectory`；未用 HTTP/2 多路复用 | `mountedScanner.ts`、`libraryScanner.ts` |
| 超时 | 全部 RPC 固定 20s idle timeout | `grpcClient.ts` |
| 限流 | 无；未读取 `maxQueriesPerSecondLimit` 等 | — |
| 缓存 | 未使用 `SetFolderDiskCache` / `SetDirCacheTimeSecs` | — |
| 预取 | 未使用 `PrefetchFileRanges` / `CancelFilePrefetch` | — |
| 释放 | 未调用 `CloseFileReader` | — |
| 直链 | 未使用 `GetDownloadUrlPath` | — |
| 增量 | 未订阅 `PushMessage(FILE_SYSTEM_CHANGE / CLOUD_API_CHANGE)` | — |
| 字段解码 | 丢弃 `fileBufferDiskCacheEnabled`、`canContentSearch`、`readOnly` 等 | `decodeCloudDriveFile` |
| Keepalive | `http2.connect` 未配置 keepAlive | `grpcClient.ts` |

## 2. P0 优化项（直接影响播放/拖拽/探测体验）

### P0-1 接入 `CloseFileReader`

- 指南 1.0.7：文件句柄关闭后服务端默认保留 `EntryReader`（下载缓冲 + 下载线程）2 秒。
- 映匣在网盘上对每个视频会跑一次 FFprobe（`queuePendingMetadata`），是最容易堆积并发下载线程的来源。
- 建议：FFprobe 完成/失败、缩略图生成结束、一次性元数据读取结束时，主进程对该远程路径调用 `CloseFileReader`，立即释放服务端线程。
- 收益：减少网盘端线程占用，避免"自己的扫描挤掉自己的播放"。
- 风险：低。该 RPC 是幂等的提示，不会中断正在进行的读取。

### P0-2 网盘视频的 FFprobe 参数收紧

- 当前 `libraryScanner` 走挂载点本地路径调 ffprobe，默认 `analyzeduration/probesize` 会读若干 MB，对网盘是最大的单点开销。
- 建议主进程针对"来源是 CloudDrive 挂载"的文件使用：
  - `-probesize 500k -analyzeduration 1M -fpsprobesize 20`；
  - 先 `-show_format`，再按需 `-show_streams`；
  - 探测失败回退默认参数二次尝试；
  - 配合 P0-3 提前预取头部 1–2 MB。
- 收益：每个视频在网盘上的冷字节读取量可下降一个数量级，大库扫描时间显著缩短。
- 风险：中。需要在真实多格式媒体上验证不会丢流/时长信息；属于 P1 已知证据缺口的范围。

### P0-3 接入 `PrefetchFileRanges` / `CancelFilePrefetch`

- 指南 1.0.7 面向"媒体播放器拖动、批量缩略图生成"。客户端提前通知服务器即将读取的字节范围，让其填充预读缓存，并通过优先级调度并发任务。
- 映匣接入点：
  - 播放器跳转/下一集 → `HINT_PRIORITY_HIGH`，预取接下来 10–30 秒；
  - 封面/时间轴批量生成 → `HINT_PRIORITY_LOW`，不抢主播放；
  - 切集/停止/退出 → `CancelFilePrefetch` 清掉旧 hint。
- 必须维护 `hint_id` 生命周期；TTL 到期或文件关闭时自动失效。
- 收益：拖动后起播延迟、下一集切换延迟显著下降。
- 风险：中。hint 必须能被取消，否则持续占服务端下载线程。

### P0-4 评估 `GetDownloadUrlPath` 直链下载

- 指南建议"使用 `GetDownloadUrlPath` 进行直接下载，而不是代理"。
- 适合场景：封面/时间轴生成、用户主动导出/下载到本地；不适合直接交给 Chromium（违反 Desktop-only 契约）。
- 建议路径：主进程拿到直链后自行 fetch，并喂给缓存/导出管道；`preview=true` 用于缩略图等低清场景。
- 收益：大文件顺序读绕开 CloudDrive2 进程代理，吞吐通常显著提高。
- 风险：中高。属于架构岔路，需要用户先决策（见第 6 节）。

## 3. P1 优化项（大目录扫描与长期体验）

### P1-1 按文件夹磁盘缓存 `SetFolderDiskCache`

- 1.0.0 引入，最"暴力"的网盘加速：CloudDrive2 把整段文件缓存到本地磁盘，二次访问接近本地读。
- 建议在识别到挂网盘的视频源目录后，下发规则：
  - `EXTENSION_FILTER_INCLUDE` + 常见视频扩展名；
  - `maxFileSize` 设上限（避免 40GB 原盘全量落地）；
  - 引导用户配置全局 `fileBufferDiskCacheMaxBytes`。
- 调用前必须读取 `CloudDriveSystemInfo.diskCacheDisabled`，SLOW_STORAGE/电视设备强制禁用时回落到 UI 提示。
- 风险：**不能默认替用户开**，会真实占磁盘；需 UI 开关、容量可见、可关闭。

### P1-2 读取并遵守云盘性能上限

- 指南暴露 `maxDownloadThreadsLimit`、`maxBufferPoolSizeMBLimit`、`maxQueriesPerSecondLimit`（如 115 网盘 2 线程 / 5 QPS）。
- 映匣目前完全没读，可能在低限网盘上自我限流不足触发封禁，也可能在高限网盘上没吃满。
- 建议：挂载发现时读一次配置；把 QPS 套到全局 list 限流器；把下载线程数作为预取/缩略图管道的并发上限。

### P1-3 解码完整 `CloudDriveFile` 字段

- 当前 `decodeCloudDriveFile` 丢弃字段 77（`fileBufferDiskCacheEnabled`）、79（`canContentSearch`）、80（`readOnly`）等。
- 影响：
  - 不知道文件是否已在 CloudDrive2 本地缓存（决定可大胆同步读 vs 必须预取）；
  - 不知道云盘是否只读（应在 UI 直接禁用删除/移动，避免无意义往返和误操作）；
  - 无法基于更丰富元数据做扫描决策。
- 建议扩展解码并在扫描/UI 层消费。

### P1-4 订阅 `PushMessage` 做增量失效

- 支持 `FILE_SYSTEM_CHANGE`（1.0.12 增 `CLOUD_API_CHANGE`）。
- 当前映匣依赖手动触发/启动增量比对，网盘 mtime 不准时易退化为全量 `GetSubFiles`。
- 建议长连一条 Push 流，把事件转成内部"使该目录缓存失效"信号，配合 P1-5 TTL 把 `forceRefresh=true` 次数降到最低。

### P1-5 显式管理目录缓存 TTL

- `SetDirCacheTimeSecs` / `GetDirCacheTimeSecs` / `InvalidateDirCache` / `PurgeDirCache`。
- 当前写死 `forceRefresh=false` 但未设 TTL，等于用服务端默认值。
- 建议：电影/剧集归档目录设长 TTL（6–24 小时），下载中转/正在入库目录设短 TTL（约 60 秒）。

### P1-6 HTTP/2 keepalive 与分层超时

- 现状：`http2.connect(origin)` 未开 keepAlive；所有 RPC 共用 20s idle timeout。
- 建议：
  - `keepAlive: true, keepAliveInterval: 30_000, keepAliveTimeout: 10_000`；
  - `GetMountPoints` 5s、`GetSubFiles` 首包 10s、后续包 idle 20s；
  - 允许通过环境变量覆盖。
- 收益：长空闲后第一次操作不再等 20s 超时重建。

## 4. P2 优化项（结构性 / Phase 2 排期）

- **P2-1 受控并发目录遍历**：同一 HTTP/2 session 上并发 2–4 个 `GetSubFiles`，受 `maxQueriesPerSecondLimit` 令牌桶约束；大目录扫描近似线性提速。必须保证取消/失败时不破坏旧索引（P0 不变量）。
- **P2-2 元数据队列加背压**：`queuePendingMetadata` 当前无界；改有界队列（例如 2000），避免几十万文件时的内存压力和对网盘的突发探测风暴。
- **P2-3 解码零拷贝**：`Buffer.from(chunk)` 在 chunk 已是 Buffer 时省拷贝；Protobuf 解码改按需取字段视图。先 profiling 再动。
- **P2-4 复制/上传相关开关**：`useMultithreadDownloaderForCopy`、`useTempFileForCrossCloudCopy` 在映匣做云到本地导出/跨云整理时再开，目前不做。

## 5. 明确不是瓶颈 / 不要误改

- SQLite（schema v10，只读查询，不影响网盘字节访问）。
- 封面/时间轴缓存（本地可重建，只在它触发网盘字节读取时受 P0 项影响）。
- 去重指纹（当前按大小+时长匹配，不读完整文件；不要为了"更准"重新引入全文件 SHA-256，会让网盘性能雪崩）。

## 6. 风险与边界

任何优化都不能破坏以下不变量（见 `KNOWN_RISKS.md`）：

1. 扫描异常（离线、超时、取消、RPC 失败）**不能**用不完整枚举结果把现有视频标记 missing。
2. Desktop-only：直链、预取 hint、token 只能在主进程；renderer 不得持有网盘 URL 或 token。
3. 凭据与配置边界：`SetFolderDiskCache`、`SetCloudAPIConfig` 等只在主进程；不把敏感配置透传 renderer。
4. 只读云盘（1.0.11+ `readOnly`）：UI 禁用删除/移动，避免"先请求再被拒"。
5. 不默认开磁盘缓存：`SetFolderDiskCache` 必须 UI 提示、可关；SLOW_STORAGE 兜底。
6. Node/Electron ABI 隔离：优先继续用纯 JS 手写 HTTP/2 + `@grpc/grpc-js`，不引入需要原生 rebuild 的 gRPC 库。

## 7. 建议落地节奏

| 批次 | Workflow | 范围 | 预估 | 收益 |
| --- | --- | --- | --- | --- |
| 批次 1 | STANDARD | P0-1 CloseFileReader + P0-2 ffprobe 收紧 + P1-6 keepalive/分层超时 | 1–2 天 | 网盘扫描立竿见影，风险低 |
| 批次 2 | STANDARD | P0-3 PrefetchFileRanges + hint 生命周期 + 播放器/缩略图接入 | 2–3 天 | 拖动/切集起播加速 |
| 批次 3 | STANDARD | P1-2 读 `*Limit` + P1-3 完整字段 + P2-1 受控并发 + P2-2 队列背压 | 2–3 天 | 大库扫描提速、抗封禁 |
| 批次 4 | FULL（需产品决策） | P0-4 直链管道 + P1-1 文件夹磁盘缓存 UI + P1-4 PushMessage 增量 | 1–2 周 | 改变网盘读取架构，需补实机证据 |

批次 1–3 不改变"字节走挂载点"的架构，可独立交付；批次 4 实质引入主进程代播字节流，必须先做架构决策并补真实网盘/SMB 实机证据（交接文档 P1 已知缺口）。

## 8. 待用户确认

1. 是否把 CloudDrive2 访问性能作为下一项业务任务？如果是，先从批次 1 建 task packet。
2. 是否允许在用户同意后自动给网盘视频目录下发 `SetFolderDiskCache` 规则？还是必须由用户在 CloudDrive2 自己的 UI 配置？
3. 主要目标网盘是哪种（115 / 阿里云盘 / 百度 / OneDrive / SMB / SFTP / 其他）？决定默认并发数、QPS、预取策略。
4. 架构岔路：
   - A. 继续只用 CloudDrive2 挂载点，映匣只做"元数据 + 预取提示 + 缓存策略"加速；
   - B. Phase 2 引入主进程代播字节流（`GetDownloadUrlPath` + 自有管道），可能显著提速但工程量与风险上升一个量级。
