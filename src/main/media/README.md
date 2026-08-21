# 媒体模块

- `fileDiscovery.ts`：基于 `opendir` 流式递归枚举支持的视频，跳过临时后缀并隔离子目录错误；网盘保护采用单次目录条目读取 30 秒无响应超时，而不是整个目录的固定总时限。
- `metadataService.ts`：调用静态 ffprobe；一次解析时长、分辨率、容器和首个视频/音频流的 codec、profile、pixel format，不得为 codec 再启动第二次 probe。
- `playbackMetadataEnricher.ts`：只为历史 metadata ready 且 `codec_probe_status = unprobed`、并且真正准备播放的视频懒补全编码信息；同视频并发合并，成功写 `ready`（包括 codec 为空），失败写 `failed` 且普通播放不重试。播放器最多等待 2 秒，后台 probe 自行收尾并按文件版本更新。禁止把它改成启动时或迁移时的全库回填。
- `metadataQueue.ts`：单并发后台 FFprobe 队列；按视频 id 去重，启动时恢复 `pending` 任务，并用路径/大小/修改时间防止慢任务覆盖新文件版本。FFprobe 失败写入持久 `scan_failures`，成功后只解决 metadata 阶段异常并通知侧栏刷新。
- `libraryScanner.ts`：实现当前目录快照扫描和异常项重试。每个目录用 mtime、直属视频/子目录计数和排序摘要独立判断；父目录可跳过直属视频但永远不跳过子目录检查。只对完整枚举的直属目录做缺失对账，父目录明确删除子目录后才清理旧子树快照并软标缺失。
- `scanManager.ts`：三种模式的串行调度、同源互斥、任务状态/计数、暂停和协作式取消；全盘逐源复用当前目录扫描，不启用无界并发。
- `cacheService.ts`：持久缓存位置、旧缓存安全迁移、缓存 key、FFmpeg 封面/时间轴帧生成，以及短视频封面截帧回退。
- `cacheManager.ts`：缓存生成事务、近似 LRU/TTL/配额淘汰、清理 epoch、临时文件恢复、缓存状态统计和数据库引用失效通知。

## 预览缓存维护规则

- 当前目录固定为 `app.getPath("userData")/media-cache`；Windows 默认是 `%APPDATA%\local-video-manager\media-cache`，跟随本工具的用户数据，而不是安装目录。安装目录可能只读且升级时可能被替换，因此不能承载长期缓存。
- `covers/` 保存卡片封面，`timeline/` 保存进度条 hover 帧。默认总上限 10 GiB（封面 2 GiB、时间轴 8 GiB），最长保留 365 天；TTL 清理至少保留最近 200 张封面和 2,000 张时间轴帧，容量上限仍具有最高约束。访问用文件 `mtime` 表示近似 LRU，但同一路径最多每 10 分钟写一次时间，避免图片请求持续写盘。
- 缓存 key 包含规范化路径、文件大小和修改时间；封面文件名还包含当前“封面截帧位置”。路径、大小或修改时间变化会产生新 key，视频删除/重命名/移动/移除资料库后会异步回收不再被数据库身份引用的旧 key。仅改变封面截帧秒数不会改变 key，旧帧会由 TTL/容量策略逐步回收，而不是同步全库删除。
- FFmpeg 只能写入最终文件同目录、带 `.video-manager-cache-` 标记的专用临时文件；非空校验通过后才原子重命名。手动清理会递增 generation epoch、等待当前任务/读取结束，再只清理 `media-cache/covers` 和 `media-cache/timeline`。旧 epoch 任务不得发布或登记结果；崩溃残留的本应用临时文件在下次启动删除。
- 设置页展示总量、分类用量、条目数、上限、最近自动检查和失败数。手动清理逐项报告失败；失败项留在缓存中以便重试。自动/手动清理只处理应用缓存，绝不读取、删除或改名源视频，映射网盘离线不会导致源文件删除。
- 旧版本使用 `userData/cache`，在 Windows 上会与 Electron 的 `Cache` 大小写折叠到同一目录。启动迁移只处理旧目录中的 `covers` 和 `timeline`，严禁迁移或删除 `Cache_Data` 等 Electron 子目录；迁移失败不得阻止应用启动。
- FFprobe、扫描和缓存维护失败通过 `src/main/logging` 记录；只传 video ID、扩展名、计数或会被脱敏的路径，不得记录 ffprobe stdout。禁止恢复任何从主进程或 renderer 向调试端口发送路径、媒体元数据、播放器尺寸、预览 URL 或命令输出的临时代码。
- 修改清理逻辑时必须验证：视频原文件和 SQLite 不受影响、Electron `Cache_Data` 不受影响、清理后封面/hover 帧可重新生成、迁移有旧目录和部分目标目录两种场景。
- `mediaProtocol.ts`/`mediaUrl.ts`：解析并服务 `local-video://media|cover|preview`；图片请求通过 cache manager 串行生成并在返回时记录节流后的访问时间。
- `mpvController.ts`/`playerRouting.ts`：外部播放与路由。`auto` 区分 metadata pending 和 ready/unknown：pending 的常见容器临时 native-first，ready 但 probe 未就绪/失败时保守走 mpv；WebM native 白名单要求 VP8/VP9 + `yuv420p` + Opus/Vorbis/无音轨。`native-first` 与 `mpv-first` 语义不变，Renderer native 失败回退与主进程 mpv→系统默认播放器回退必须保留。

扫描写 repository；协议按 id 反查真实路径；renderer 只持有协议 URL。修改时重点保护路径解析、Range/流式播放、FFmpeg 失败降级、任务队列资源上限和缓存可重建性。目录超时必须区分“持续但很慢”和“没有响应”：不得重新引入覆盖整个发现阶段的固定总时限；不完整扫描不得执行缺失清理。

需求定位：漏扫/扫描慢看 discovery/scanner；首次导入长期“分析中”看 metadataQueue/metadataService/repository metadata 状态；封面或 hover 异常看 protocol/url/cache；格式不能播看 shared playback routing、协议和 mpv。覆盖见同名 `tests/main/*.test.ts`；真实 codec、长视频、损坏媒体和打包二进制仍需手测。
