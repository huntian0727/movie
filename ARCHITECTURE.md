# 架构记忆

## 总体模型

渲染进程不直接接触 Node、磁盘或数据库。React 通过 `window.videoManager` 调 preload 暴露的窄 API，IPC 主进程用 Zod 校验不可信参数，再调用仓储、扫描、文件、播放或设置服务。`local-video://` 特权协议负责原视频流、封面与时间轴图；原始文件是事实源，SQLite 是索引，缓存是衍生物。

```text
React UI -> preload/contextBridge -> ipcMain/Zod -> services -> filesystem/ffprobe/ffmpeg/mpv
                                      |          -> electron-store
                                      +-> VideoRepository -> better-sqlite3 (WAL)
React <video>/<img> -> local-video:// -> mediaProtocol -> repository + file/cache
main boundaries -> StructuredLogger(JSONL/redaction/rotation) -> settings diagnostics preview/export
```

## 启动与数据流

1. `scripts/start-desktop.mjs` 检测/启动 Vite，随后拉起 Electron；`src/main/index.ts` 注册协议、打开 `userData/library.sqlite`、加载设置、注册 IPC/协议并创建主窗口。
2. 若 `startupSync` 开启，后台顺序扫描 enabled 文件夹。发现器递归枚举；scanner 用文件 stat 与旧记录判断是否需要 ffprobe；逐条 upsert，最后 reconcile missing，并记录扫描错误。
3. UI 查询通过 repository 动态 WHERE/ORDER BY（排序列仅允许白名单）。普通资料库按搜索、视图、目录、排序和页码执行 SQLite COUNT + LIMIT/OFFSET；重复项按重复组执行独立 LIMIT/OFFSET、全局大小排序和统计。
4. 播放请求只传 video id 队列；主进程限制原始队列最多 300 条、去重、保证选中项存在，并按 SQLite 当前记录过滤未知或磁盘缺失文件。独立 BrowserWindow 始终加载固定 `?player=1` URL，完整会话只通过类型化 IPC 快照传递。renderer 先订阅带单调序列号的领域事件，再读取快照并补放较新的事件，避免窗口初始化竞态；扩展名和偏好决定 native/mpv，原生失败可尝试 mpv。
5. 图片请求按规范化路径、大小、修改时间生成 SHA-256 key；协议串行化生成任务，FFmpeg 输出 JPG，后续直接命中磁盘缓存。

## 数据与关键决策

- `source_folders`、`videos`、`timeline_previews`、`play_history` 在启动时用 `CREATE IF NOT EXISTS` 建立；启用 WAL 和外键。
- Windows 路径以 `COLLATE NOCASE` 唯一，应用生成 UUID；重扫同路径保持记录身份与收藏。
- 缺失采用软状态而非立即删除，避免临时离线盘导致用户元数据丢失。
- 收藏只存布尔标记，不移动文件；删除是明确确认后的永久磁盘删除。
- native/mpv 混合是兼容性折中：Chromium 控制体验好但 codec 有限，mpv 覆盖广但应用无法控制其内部状态。
- 自定义协议避免 renderer 获得任意文件路径能力，并为缓存生成提供统一入口。
- settings 使用 electron-store，资料库使用 SQLite：配置与关系/查询型数据分离。

## 边界与风险

- IPC 是信任边界；不要把 renderer 传来的路径直接用于磁盘操作，优先由 video id 反查。
- 当前迁移不是版本化迁移系统；新增/变更列必须设计兼容升级和回滚/备份策略。
- 扫描、ffprobe、图片生成主要是顺序执行。可控但大目录慢；并发优化需限流、取消和错误隔离。
- 自定义协议正确性依赖 Electron Range/stream 行为和 Chromium codec，自动测试无法替代真实媒体。
- cache key 会随大小/mtime 改变；`MediaCacheManager` 通过 10 GiB 总上限、分类配额、365 天 TTL 和近似 LRU 回收旧缓存，并用同目录临时文件、原子发布及 generation epoch 约束清理并发。真实超大缓存、低磁盘和 ACL 场景仍需验证。
- 播放窗口与主窗口是两个 renderer。主进程领域事件总线已覆盖视频更新/移除、收藏、播放历史和资料库重扫，并按窗口当前查询做失效刷新；事件只在操作成功后发布。事件不持久化，renderer 必须保持“先订阅、后快照、按 sequence 去重”的恢复协议，真实双窗口快速操作仍需桌面验证。
- 可观测性以主进程为权威：IPC 写操作、扫描、FFprobe、缓存维护、安全拒绝和进程级异常写结构化 JSONL。原始路径和敏感字段在写盘前脱敏；批量成功项不逐条记录。诊断导出重新应用字段白名单，默认不包含完整应用目录，且永远不包含视频路径/文件名、数据库正文或环境变量值。

## 跨层修改清单

新增领域字段：SQLite 迁移 → repository row/map/query → shared 类型 → IPC/preload（若需要）→ UI → fixtures/tests。新增命令：`IPC_CHANNELS`/`VideoManagerApi` → preload invoke → IPC Zod 校验 → service/repository → UI → contract/behavior tests。媒体功能：URL parser → protocol → cache/工具进程 → renderer 展示与失败降级 → 单测 + 真实视频手测。

## 原始设计与当前实现偏差

| 主题 | 原始设计 | 当前实现 | 维护结论 |
| --- | --- | --- | --- |
| 批量操作 | 多选后批量收藏、取消收藏、移除、永久删除 | 只有分页展示与单项操作 | 未实现；属于未来规划，永久删除需先定义部分失败语义 |
| 导入时关键帧 | 导入时生成封面和少量关键帧 | 封面/时间轴图由协议请求按需生成 | 有意形成的性能折中；首次 hover 可能延迟，是否改回预生成需要基准 |
| 统一播放器体验 | native 与 mpv 尽量呈现统一控制体验 | native 在应用窗口内受控；mpv/系统默认播放器为外部程序 | 部分实现；外部播放器无法共享应用内控制和状态，真实体验需要验证 |
| 数据库分页 | 搜索、排序和分页可下推 SQLite | 普通资料库与重复项均已数据库分页；目录树改用 DISTINCT directory 轻量快照，播放器按队列 id 取数 | 已实现；超深 OFFSET 和模糊搜索基准仍需验证 |
| Schema migration | 数据库层承担 schema 创建与迁移 | 只有幂等建表，没有 schema version 和升级/回滚流程 | 尚未实现；任何改表前必须先建立迁移与备份机制 |
| 真实桌面验证 | 用真实 Windows、媒体格式和大目录验收 | 自动测试较多，部分桌面自查有记录；完整证据链缺失 | 需要验证；以 `docs/verification-results.md` 和手测表为准 |
