# Playback Diagnostic V1 QA 复测报告

## Context

- 任务：映匣 UI V1 增量优化，阶段 4 Playback Diagnostic 修正后独立 QA 复测
- 日期：2026-09-04
- QA 结论：**PASS**
- 被测分支：`ai/playback-diagnostic-v1-fix`
- 被测 Commit：`f2ce5f6f3b854e95d8fea45803fd48459a3f6146`
- 最新 `origin/main`：`f2ce5f6f3b854e95d8fea45803fd48459a3f6146`
- 开始测试时工作区：干净

开工门禁全部满足：分支正确，工作区无未提交修改，HEAD 与最新 GitHub `main` 一致。本轮未修改业务代码、测试代码、配置、数据库结构或用户数据；只新增本 QA 报告。真实用户资料库仅通过 `readonly + fileMustExist + query_only` 连接读取，没有执行扫描、FFprobe、CloudDrive、预览生成、移动或删除操作。

## Changes

### 分支

`ai/playback-diagnostic-v1-fix`

### Commit

`f2ce5f6f3b854e95d8fea45803fd48459a3f6146`

### 修改摘要

- 新增本 QA 复测报告。
- 复测诊断搜索的文件名/完整路径匹配、SQLite LIKE 字面转义、分页和普通视频列表语义隔离。
- 通过编译后的生产 `PlaybackDiagnosticQueryService` 与真实 worker 对 319,986 条用户资料库执行只读性能与主事件循环响应测试。
- 复测快速连续搜索只保留一个执行中请求和一个最新待执行请求，旧待执行请求会被淘汰。
- 回归播放、播放列表、MPV、诊断状态、standalone 隔离、Asset Center worker、扫描和文件操作。
- 执行 lint、typecheck、完整 Electron ABI Vitest、生产构建与 Electron smoke。

### 新增文件

- `docs/ai/qa/2026-09-04-playback-diagnostic-v1-qa-retest.md`

### 删除文件

- 无。

## Verification

### 1. 开工状态门禁

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `ai/playback-diagnostic-v1-fix` |
| 工作区状态 | PASS | 开始测试时 `git status --short --untracked-files=all` 无输出 |
| Developer Commit | PASS | HEAD 为 `f2ce5f6...` |
| GitHub main | PASS | `git fetch origin main` 后 `origin/main` 与 HEAD 相同 |
| 未授权覆盖/回滚 | PASS | 未执行 reset、checkout 丢弃、强制同步或强制推送 |

### 2. P1：文件名或完整路径搜索

专用查询明确使用：

```sql
videos.filename LIKE @search ESCAPE '!' COLLATE NOCASE
OR videos.path LIKE @search ESCAPE '!' COLLATE NOCASE
```

验证结果：

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 只存在于完整路径中的 token | PASS | `playbackDiagnosticQueries.test.ts` 构造 `D:\Movies\HiddenToken\ordinary.mp4`，搜索 `HiddenToken` 精确返回该记录 |
| `%` 字面量 | PASS | `%` 被转义为 `!%`，只命中包含真实 `%` 的文件名 |
| `_` 字面量 | PASS | `_` 被转义为 `!_`，不会作为单字符通配符 |
| `!` 字面量 | PASS | `!` 先转义为 `!!`，匹配结果正确 |
| 空结果 | PASS | 返回 `page=1 / totalPages=1 / totalCount=0 / videos=[]` |
| 越界页 | PASS | 页码收敛到有效页，不返回错误页码 |
| 真实库第 1/2 页 | PASS | `mp4` 共 263,881 条、8,797 页；第 1、2 页各 30 条且 ID 无重叠 |

诊断搜索使用独立 IPC、服务和 worker，不复用普通列表查询。`VideoRepository.listVideoPage()` 仍只对 `videos.filename` 搜索；本次对该文件的改动仅导出 `VideoRow` 与 `mapVideo` 供专用查询复用，原 SQL、排序、筛选和分页语义未改变。完整 `videoRepository` 44 项测试全部通过。

### 3. P1：真实生产 worker 与大库性能

真实资料库：`C:\Users\test\AppData\Roaming\local-video-manager\library.sqlite`。

- 有效视频：319,986 条。
- 文件大小：745,103,360 bytes。
- 测试入口：生产构建产物 `dist-main/main/playbackDiagnostic/playbackDiagnosticQueryService.js`。
- worker 入口：生产 `playbackDiagnosticWorker.js`，不是测试替身或主线程直接调用。
- SQLite 打开方式：`readonly: true`、`fileMustExist: true`、`PRAGMA query_only = ON`。

| 查询 | 结果数 | 首次实测耗时 |
| --- | ---: | ---: |
| 宽泛 `mp4` | 263,881 | 323.04 ms |
| 明确不存在的 token | 0 | 274.03 ms |

查询期间用 10 ms 定时器监测 Electron 主事件循环：最大额外调度延迟 14.62 ms，即最大观察间隔约 24.62 ms，低于 100 ms 门禁。SQL 本身仍需约 0.3 秒，但已完全离开 Electron 主线程，不再形成同等时长的前端冻结。

测试前后数据库：

- 文件大小相同：PASS。
- `LastWriteTimeUtc` 相同：PASS。
- 未生成 WAL、未迁移、未写入记录：PASS。

合成 320,000 条性能门禁也通过：宽泛查询 144.61 ms、无结果查询 177.91 ms、主循环最大间隔 23.55 ms，均低于查询 2,000 ms、主循环 100 ms 的门禁。

### 4. P1：快速连续请求与旧错误隔离

`PlaybackDiagnosticQueryService` 的队列模型只有两个位置：

- `inFlight`：最多一个正在 worker 中执行；
- `queued`：最多一个最新待执行。

新请求到达且已有待执行请求时，旧待执行请求立即以 `PlaybackDiagnosticSearchSupersededError` 结束，随后只派发最新请求。worker error、worker exit、`postMessage` 失败和 `dispose` 均会清理并拒绝所有 pending，避免 Promise 泄漏。

真实生产 worker 连续提交 3 个请求的结果：

- 第 1 个宽泛搜索正常完成；
- 第 2 个待执行搜索返回 `PlaybackDiagnosticSearchSupersededError`；
- 第 3 个最新搜索随后执行并返回 0 条；
- 总历时 535.91 ms，未并发堆积多个 SQLite 搜索。

服务单元测试进一步通过 fake worker 消息计数证明：第 1 个请求执行时，第 2 个不会派发；第 3 个会替换第 2 个；第 1 个完成后只派发第 3 个。

Renderer 对搜索请求使用单调递增 request ID。过期请求的 `then`、`catch` 和 `finally` 都先比较当前 ID；因此被替代请求的错误即使经 IPC 序列化，也不会写入当前页面的错误状态。225 ms 防抖还会在请求进入主进程前合并更快的输入变化。

### 5. 播放、播放列表与 MPV 回归

| 范围 | 结果 | 覆盖证据 |
| --- | --- | --- |
| 内置播放 | PASS | 控件、自动播放、音量、进度、全屏和旋转测试通过 |
| native 失败回退 | PASS | native error 后尝试外部播放测试通过 |
| MPV | PASS | MPV 参数、外部播放调用及自动启动路径测试通过 |
| 播放列表 | PASS | 当前目录分页、切换视频及待分析时长状态测试通过 |
| 播放详情 | PASS | 打开/关闭、Escape、复制路径和字段回退测试通过 |
| 播放核心未改动 | PASS | 修正提交未修改 `PlayerPage`、`playbackRouting` 或 MPV controller |

本轮没有使用用户真实视频做主观画面、声音、解码或真实 MPV 窗口测试；以上为自动化调用与状态回归。

### 6. 诊断页面与字段状态

| 场景 | 结果 |
| --- | --- |
| 侧边栏独立页面正常打开 | PASS |
| 默认不枚举全库 | PASS |
| 最近记录最多 10 条且不加载预览图 | PASS |
| VideoDetailsDialog 提供入口 | PASS |
| PlayerPage 不出现诊断入口 | PASS |
| 搜索服务端分页、固定每页 30 条 | PASS |
| `pending` 显示尚未采集/低置信度 | PASS |
| `failed` 显示读取失败/低置信度 | PASS |
| `unprobed` 显示尚未探测 | PASS |
| 完成但字段为 `null` 显示未记录，不误称无音频 | PASS |
| `missing` 禁用播放、MPV 和 metadata retry | PASS |
| 数据库记录已移除时显示明确 removed 状态 | PASS |

播放建议继续直接调用真实 `choosePlaybackRoute(video, playbackPreference)`，解释层只说明已选 route，不实现第二套决策。auto、native-first、mpv-first、HEVC/DTS 及低置信度规则测试全部通过；页面文案为风险提示，没有“保证可以播放”等过度承诺。

### 7. 只读刷新与 standalone 隔离

- 诊断页刷新只调用 `listVideosByIds([selectedVideoId])` 读取 SQLite 缓存。
- 默认进入页面、最近记录和搜索结果不加载封面或时间轴预览。
- 页面代码与专用 worker 不调用文件系统视频读取、CloudDrive、FFprobe/FFmpeg、扫描、封面或预览服务。
- “补充元数据”仅在用户明确点击时进入既有 metadata pipeline，不属于进入页面或刷新行为。
- standalone 页面不渲染普通分页、批量工具栏或普通搜索框；方向键分页快捷键无效。
- scan status / refresh sequence 变化不触发普通 `onLoadVideoPage`，也不调用全局 `onRefresh`/`scanAllFolders`。

结果：**PASS**。

### 8. Asset Center、扫描和文件操作回归

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Asset Center UI | PASS | 3 项 renderer 测试通过 |
| Asset Center worker 生命周期 | PASS | 4 项 query service 测试通过 |
| Asset Center 320k/100 来源性能 | PASS | 1,211.98 ms，单条 SQL，低于 2,000 ms 门禁 |
| 扫描器 | PASS | `libraryScanner`、incremental、network、ScanManager 测试通过 |
| 扫描失败安全 | PASS | 定向复查、批量复查、根目录离线保留索引测试通过 |
| 文件操作 | PASS | 27 项移动、重命名、删除、冲突和补偿回滚测试通过 |
| 重复项清理安全 | PASS | cleanup job 与 resolve safety 测试通过 |

未对用户真实媒体、挂载盘或 CloudDrive 执行写操作。

### 9. 完整测试、构建与 Electron smoke

| 命令/方式 | 结果 | 记录 |
| --- | --- | --- |
| `npm run lint` | PASS | 项目 lint 脚本执行 Node/Web TypeScript 检查，无错误 |
| `npm run typecheck` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run build` | PASS | Vite 6.4.3，1602 modules transformed |
| 完整 Vitest（Electron `RUN_AS_NODE`） | PASS | 64 个测试文件、609 项测试全部通过，15.07 秒 |
| `npm run test:electron-smoke` | 环境门禁阻止 | 项目要求 Node 22.23.1/npm 10.9.8；当前系统为 Node 24.14.0/npm 11.9.0 |
| 直接执行 Electron smoke | PASS | Electron 33.4.11、ABI 130；native smoke 与 `app.whenReady` 通过 |

完整 Vitest 使用项目 Electron 33.4.11 的 `ELECTRON_RUN_AS_NODE=1` 执行，确保 `better-sqlite3` 使用真实 Electron ABI。生产构建产物进一步以同一 Electron ABI 启动真实 Playback Diagnostic worker 并查询真实资料库，证明实际 worker 文件可以从编译后目录加载。

生产 renderer 构建结果：

- JavaScript：352.28 kB，gzip 104.38 kB；
- CSS：71.66 kB，gzip 14.09 kB。

## Risks and follow-up

### 已关闭的 P1

1. **路径搜索缺失：已关闭。** 文件名或完整路径均可命中，特殊字符按字面匹配，分页正确；普通资料库列表语义未变化。
2. **诊断搜索阻塞 Electron 主线程：已关闭。** 真实生产 worker 在 319,986 条库上执行，主事件循环最大观察间隔约 24.62 ms；连续输入不会堆积所有历史查询。

### 未验证事项

- 未在锁定的 Node 22.23.1/npm 10.9.8 环境执行标准 release gate；当前机器版本不匹配，环境检查按设计阻止标准 smoke。
- 未执行安装包或 ASAR 内 worker 启动验证；本轮已验证生产编译目录中的真实 worker，安装包验证应留到阶段 6 最终交付。
- 未使用用户真实视频验证实际硬件解码、画面、声音或真实外部 MPV 窗口。
- 未执行真实 Electron 窗口的人工视觉、超长路径布局和完整键盘焦点巡检。

### 剩余风险

- 前后通配搜索在 32 万条记录上仍需约 0.3 秒 CPU/磁盘读取；worker 已消除 UI 主线程冻结，但搜索结果仍会有约 0.3 秒加载等待。当前有 loading 状态、225 ms 防抖和 latest-only 队列，属于可接受的剩余延迟，不是卡顿阻断。
- SQLite worker 与 Asset Center worker 都是独立只读连接。极端磁盘拥堵时两者可能争用磁盘吞吐，但不会直接占用 renderer 或 Electron 主事件循环；后续可通过实际用户场景监控决定是否需要统一只读任务调度，当前不建议预先重构。
- metadata retry 完成后仍可能需要再次刷新才能看到最终数据；这是现有异步任务的体验问题，不影响本次只读诊断安全或 QA 结论。

## 测试结果

**PASS。** 两个原 P1 均已按修正目标关闭；完整 Electron ABI 测试、生产构建、Electron smoke、真实生产 worker 大库性能、队列淘汰与数据库只读性均通过。

## 未验证事项

见“Risks and follow-up / 未验证事项”。这些事项应进入阶段 6 最终发布验证，不阻断阶段 4 功能 QA。

## 剩余风险

见“Risks and follow-up / 剩余风险”。当前没有 P0/P1 阻断问题。

## Final decision

**PASS — Playback Diagnostic V1 通过阶段 4 QA 复测。**

允许项目经理进入阶段 5 UI 体验优化。阶段 6 最终交付时仍必须在锁定 Node/npm 环境执行标准 release gate，并验证安装包/ASAR 内 worker 与真实桌面启动。
