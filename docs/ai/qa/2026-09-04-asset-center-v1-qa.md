# Asset Center V1 QA 报告

## Context

- 任务：映匣 UI V1 增量优化，阶段 2 Asset Center QA
- 日期：2026-09-04
- QA 结论：**FAIL**
- 被测分支：`ai/asset-center-v1`
- 被测 Commit：`6830e60befc715b7d18f30187abde1c95335d05c`
- 最新 `origin/main`：`6830e60befc715b7d18f30187abde1c95335d05c`
- 开始测试时工作区：干净
- 基线判断：被测分支、HEAD 和最新 GitHub `main` 一致，可以执行 QA。

本轮没有修改业务代码、测试代码、配置、数据库结构或用户数据。真实资料库仅以 SQLite `readonly + query_only` 模式读取；测试前后 `library.sqlite` 的长度和修改时间未变化。

## Changes

### 分支

`ai/asset-center-v1`

### Commit

`6830e60befc715b7d18f30187abde1c95335d05c`

### 修改摘要

- 新增本 QA 报告。
- 审核 Asset Center 的页面隔离、SQLite 聚合、IPC/preload/security 边界和文案。
- 执行静态检查、生产构建、完整 Vitest、Electron 主进程 smoke、大规模合成库性能检查和真实资料库只读性能检查。

### 新增文件

- `docs/ai/qa/2026-09-04-asset-center-v1-qa.md`

### 删除文件

- 无。

## Verification

### 1. 开发前状态门禁

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `ai/asset-center-v1` |
| 工作区状态 | PASS | 开始测试时 `git status --short` 无输出 |
| GitHub main | PASS | `git fetch origin main` 后 `origin/main` 与 HEAD 均为 `6830e60...` |
| 未授权覆盖或回滚 | PASS | 未执行 reset、checkout 丢弃、强制同步或强制推送 |

### 2. 原功能回归

| 范围 | 结果 | 覆盖证据 |
| --- | --- | --- |
| 软件启动 | PASS | Electron 33.4.11 主进程 smoke：`app.whenReady` 完成 |
| 视频列表及分页 | PASS | 完整测试中的 `LibraryShell`、`VideoRepository` 与性能门禁通过 |
| 搜索 | PASS | `LibraryShell` 搜索与数据库分页相关测试通过 |
| 播放 | PASS | `PlayerPage` 原生/外部播放、失败回退、自动播放、全屏测试通过 |
| 播放列表 | PASS | 当前目录播放列表、切换视频、待分析时长显示测试通过 |
| 扫描 | PASS | Snapshot 增量扫描、网络扫描和大目录计数测试通过 |
| 扫描失败安全 | PASS | 离线保留、失败重试、缺失确认、取消和异常清理测试通过 |
| 文件管理安全 | PASS | 重命名、删除、跨卷移动、回滚与冲突处理测试通过 |

没有对用户真实媒体执行扫描、播放、删除、移动或其他写操作。

### 3. Asset Center 功能

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| 侧边栏入口与页面打开 | PASS | `LibraryShell` 组件测试验证入口和独立页面渲染 |
| 核心数量与容量 | PASS | 仓储测试验证排除缺失记录并聚合缓存大小 |
| 资料库数量和类型 | PASS | 本地/挂载、UNC NAS、CloudDrive 分类逻辑存在；来源列表支持类型过滤 |
| 可访问性 | PASS | `reachable/offline/checkFailed/unknown/disabled` 基于最近终态扫描，不做实时探测 |
| 可访问性与问题数量分离 | PASS | 仓储测试验证离线状态与 missing/metadata/failure 计数彼此独立 |
| 最近扫描和扫描结果 | PASS | 从 `scan_tasks` 的最近终态任务读取新增、更新、缺失和失败计数 |
| 活动扫描状态 | PASS | 复用现有 `FolderScanStatus[]`，展示 queued/scanning/paused |
| 健康提醒 | PASS | 播放风险、元数据异常、重复候选、文件缺失均为只读展示 |
| 加载状态 | PASS | 首次摘要和来源列表具有 loading 状态 |
| 空状态 | PASS | 组件测试覆盖无符合筛选条件的来源 |
| 错误和重试 | PASS（有覆盖缺口） | 来源读取失败和只读重试已测试；摘要错误分支有实现，但没有独立自动化断言 |
| 手动刷新 | PASS | 测试证明只重读两个 Asset IPC，不调用 `scanAllFolders` |
| 来源分页 | PASS（基础） | 分页由 SQLite 执行，IPC 限制每页 30/50/100；现有测试未覆盖第二页 UI 和大页边界 |
| 页面隔离 | PASS | 资产页不触发视频分页、不显示批量工具、不响应视频翻页快捷键 |
| 数据更新 | PASS | `refreshSequence` 变化会重新读取摘要和来源页 |

### 4. IPC、preload 和安全边界

新增接口只有：

- `asset-center:summary`
- `asset-center:sources`

检查结果：

- 两个接口均经 `VideoManagerApi` 类型系统暴露。
- Renderer 没有直接访问数据库。
- 来源分页参数经严格 Zod schema 校验，页码、页大小、类型、可访问性、排序和方向均有白名单。
- 两个 channel 仅允许主窗口角色调用；播放器窗口无权限。
- IPC handler 只调用 `VideoRepository` 的只读方法。
- Asset Center 刷新按钮不会复用会启动扫描的全局刷新入口。

结论：**PASS**。

### 5. 文件、网络和媒体读取边界

静态检查确认 `getAssetCenterSummary()` 与 `listAssetCenterSources()`：

- 只运行 SQLite SELECT/CTE 聚合；
- 不调用文件 `stat/readdir/readFile`；
- 不访问 CloudDrive API；
- 不调用 ffprobe/ffmpeg；
- 不加载或生成预览图；
- 不修改扫描状态、视频记录或来源记录。

结论：**PASS**。

### 6. 数据口径与文案

- 视频数量和总容量只统计 `is_missing = 0` 的有效视频。
- 文件缺失单独统计，数据库记录仍保留。
- 元数据异常统计有效视频中 `pending/failed` 的记录。
- 重复候选沿用大小与整数秒时长分组。
- 播放风险是按当前自动播放规则对缓存字段进行估算，不会触发深度分析。
- 页面使用“最近可访问”“最近离线”“基于最近一次检查”“非实时”等限定语，没有将历史状态描述为实时在线状态。
- 页面没有“保证播放”“一定可以播放”或“一定无法播放”等过度承诺。

结论：**PASS**。

### 7. 静态检查、测试、构建与 smoke

| 命令/方式 | 结果 | 记录 |
| --- | --- | --- |
| `npm run lint` | PASS | TypeScript 两套配置无错误 |
| `npm run typecheck` | PASS | Node 与 Web 类型检查无错误 |
| `npm run build` | PASS | 1600 modules transformed，renderer 生产构建完成 |
| 完整 Vitest（Electron `RUN_AS_NODE`） | PASS | 57 个测试文件、570 项测试全部通过，13.08 秒 |
| `npm run test:electron-smoke` | BLOCKED（环境） | 项目要求 Node 22.23.1/npm 10.9.8，当前系统为 Node 24.14.0/npm 11.9.0 |
| 直接执行 `scripts/run-electron-smoke.mjs` | PASS | Electron 33.4.11、ABI 130；native smoke 和 `app.whenReady` 均通过 |

完整 Vitest 使用 `ELECTRON_RUN_AS_NODE=1` 和项目 Electron 33.4.11 自带 Node 20.18.3 执行，以匹配当前 `better-sqlite3` 的 Electron ABI。该替代方式真实执行了全部测试，但不等同于锁定的 Node 22.23.1 标准发布环境。

### 8. 性能验证

#### 合成库

临时 SQLite 中创建 320,000 个视频和 100 个来源，测量前预热一次，测试结束后删除临时目录。未访问真实媒体。

| 查询 | 5 次耗时 |
| --- | --- |
| `getAssetCenterSummary()` | 368.14 / 368.70 / 374.90 / 388.15 / 413.54 ms |
| `listAssetCenterSources()` 第一页 | 2173.99 / 2294.97 / 2394.98 / 2243.15 / 2117.77 ms |

#### 真实资料库只读测量

- 数据库：`%APPDATA%/local-video-manager/library.sqlite`
- 打开方式：`readonly: true`、`fileMustExist: true`、`PRAGMA query_only=ON`
- 有效视频：319,986
- 根来源：7
- 测试前后数据库大小与修改时间不变。

| 查询 | 预热调用 | 后续 3 次 |
| --- | --- | --- |
| `getAssetCenterSummary()` | 519.95 ms | 506.02 / 486.93 / 568.02 ms |
| `listAssetCenterSources()` 第一页 | 536.21 ms | 523.58 / 559.27 / 600.77 ms |

性能判定：**FAIL**。

两个仓储方法是同步 SQLite 查询，并在 Electron 主进程 IPC handler 中直接执行。进入页面时摘要和来源请求同时发起，但主进程仍会串行执行同步工作；在当前真实库上累计约 1.0–1.17 秒。在 100 来源合成场景中，来源查询单次超过 2 秒。此延迟会阻塞 Electron 主进程并造成可感知卡顿，不符合“页面无明显性能下降”和项目既定的丝滑交互目标。

来源分页查询还会对相同的 `source_rows` 聚合执行两次：一次计算 `totalCount`，一次读取当前页，因此会重复扫描和聚合视频统计。这是本轮测得高延迟的主要可见风险之一。

## Risks and follow-up

### 阻断问题

#### P1：Asset Center 同步聚合会阻塞 Electron 主进程

- 影响：首次打开、手动刷新及资产相关 domain event 刷新时，主窗口可能出现约 1 秒或更久的无响应感。
- 证据：真实 319,986 视频库两项查询合计约 1.0–1.17 秒；320,000 视频/100 来源合成库的来源页为 2.12–2.39 秒。
- 建议的最小修正方向：
  1. 将来源 `COUNT` 与当前页结果合并为一次 SQL（例如窗口计数），避免重复执行整套 `source_rows` 聚合。
  2. 为摘要和来源查询增加 32 万视频规模的明确性能回归门禁。
  3. 评估按 domain event 失效的短期内存快照，或把重聚合移出 Electron 主线程；不要因此重构扫描器或数据库结构。
  4. 修正后必须在当前真实库的只读模式和 100 来源合成库上重新测量。

按照总体开发计划“禁止跳过 QA 直接进入下一阶段”，该 P1 修正并通过复测前，不应开始 Playback Diagnostic 阶段。

### 非阻断覆盖缺口

#### P2：缺少 Asset Center 专用性能门禁

当前 release performance 测试覆盖视频分页、重复组和扫描大目录，但没有约束新摘要/来源查询的延迟。

#### P2：没有完整桌面渲染导航 smoke

本轮页面入口与打开由 React 组件测试验证，Electron smoke 只验证 native SQLite 和主进程 ready；没有通过真实窗口自动化点击“资产中心”。

#### P2：锁定 Node 22 标准门禁未在当前机器执行

当前系统 Node/npm 版本与项目锁定版本不符。完整测试使用 Electron Node/ABI 作为替代并已全通过，但最终发布前仍需在 Node 22.23.1/npm 10.9.8 环境运行标准 `test:release-gate`。

#### P3：部分交互边界缺少独立测试

- 摘要请求失败后的错误 UI 未有单独测试。
- 来源第二页、100 条页大小、过滤后页码回正等边界主要依赖实现审查，自动化覆盖不足。

### 未验证事项

- 未执行打包和安装包 smoke；阶段 2 指令明确不打包。
- 未在 Node 22.23.1/npm 10.9.8 标准环境运行 release gate。
- 未对用户真实媒体执行播放、扫描或文件操作；这些功能只通过自动化回归验证。
- 未执行真实 Electron 窗口中的人工视觉检查。

### 剩余风险

- 当前主进程同步查询延迟是明确发布阻断。
- “最近可访问”依赖历史扫描终态，长时间未扫描的来源仍可能显示旧状态；当前文案已经限定为非实时信息。
- 播放风险 SQL 与共享播放路由规则是两份表达，后续播放规则变更时存在口径漂移风险。

## Final decision

**FAIL — Asset Center V1 暂不通过阶段 2 QA。**

功能、数据安全、IPC 隔离、类型检查、完整自动化回归、生产构建和 Electron smoke 均通过；但大库下的同步只读聚合会阻塞 Electron 主进程，必须先完成最小性能修正并重新 QA，才能进入 Playback Diagnostic 开发。
