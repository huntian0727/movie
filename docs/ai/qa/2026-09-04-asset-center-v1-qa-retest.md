# Asset Center V1 QA 复测报告

## Context

- 任务：映匣 UI V1 增量优化，阶段 2 Asset Center QA 性能修正复测
- 日期：2026-09-04
- QA 结论：**PASS**
- 被测分支：`ai/asset-center-v1`
- 被测 Commit：`a1e126324ecfbbf084b556077afbf3ddd1cbabff`
- 最新 `origin/main`：`a1e126324ecfbbf084b556077afbf3ddd1cbabff`
- 开始复测时工作区：干净
- 原始失败报告：`docs/ai/qa/2026-09-04-asset-center-v1-qa.md`，保持不变

开始复测前已执行远端更新检查。被测分支、HEAD 和最新 GitHub `main` 一致，没有未提交修改，因此允许继续 QA。

本轮没有修改业务代码、测试代码、配置、数据库结构或用户数据。真实资料库只通过 worker 的只读连接读取；测试前后 `library.sqlite` 的长度和修改时间未变化。

## Changes

### 分支

`ai/asset-center-v1`

### Commit

`a1e126324ecfbbf084b556077afbf3ddd1cbabff`

### 修改摘要

- 新增本复测报告。
- 复核 Asset Center 两个 IPC 的 worker_threads 异步链路。
- 验证 worker 数据库只读属性、请求生命周期和故障收敛行为。
- 验证来源列表单 SQL、空结果、越界页、筛选分页与停用状态。
- 执行 32 万视频/100 来源性能门禁和真实资料库只读 worker 测量。
- 重新执行静态检查、完整测试、生产构建、Electron smoke 与原功能回归。

### 新增文件

- `docs/ai/qa/2026-09-04-asset-center-v1-qa-retest.md`

### 删除文件

- 无。

## Verification

### 1. 开发前状态门禁

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `ai/asset-center-v1` |
| 工作区状态 | PASS | 开始复测时 `git status --short` 无输出 |
| GitHub main | PASS | `git fetch origin main` 后，HEAD 与 `origin/main` 均为 `a1e1263...` |
| 未授权覆盖或回滚 | PASS | 未执行 reset、丢弃修改、强制同步或强制推送 |

### 2. 原失败项修正确认

原 QA 的发布阻断是两个同步 SQLite 聚合直接运行于 Electron 主进程，进入资产中心时会阻塞约 1 秒，100 来源合成场景的来源页超过 2 秒。

修正后的调用链为：

```text
Renderer
  -> preload.invoke
  -> IPC handler
  -> AssetCenterQueryService Promise
  -> worker_threads Worker
  -> worker 独立只读 SQLite connection
  -> Asset Center query
```

检查确认：

- `asset-center:summary` 调用 `dependencies.assetCenterQueries.getSummary()`。
- `asset-center:sources` 调用 `dependencies.assetCenterQueries.listSources()`。
- 两个 IPC 不再调用主线程 `VideoRepository` 的同步聚合方法。
- `AssetCenterQueryService` 使用 `new Worker(new URL("./assetCenterWorker.js", import.meta.url))`。
- worker 在首次请求时惰性启动；IPC 立即得到 Promise，不等待主线程执行 SQLite 聚合。
- 应用 `before-quit` 会调用 `dispose()`。

结论：**PASS**。

### 3. Worker SQLite 只读边界

`openAssetCenterReadonlyDatabase()` 明确使用：

- `readonly: true`
- `fileMustExist: true`
- `PRAGMA query_only = ON`
- 独立连接，不复用主进程写连接

自动化测试还验证：

- worker 连接执行 `DELETE` 会抛错；
- 主连接中的记录没有变化；
- 数据库不存在时不会创建空数据库。

真实库测试使用编译后的实际 worker 完成。查询前后数据库文件：

- 大小：`745,103,360` bytes，未变化；
- 修改时间：`2026-09-04 15:50:05`，未变化。

结论：**PASS**。

### 4. Worker 生命周期、错误和 pending 请求

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| 请求异步性 | PASS | Fake worker 测试确认请求返回 pending Promise，只在 worker 响应后 settle |
| worker error | PASS | 所有 pending 请求被拒绝，旧 worker 被终止，下一次请求惰性创建新 worker |
| worker exit | PASS（代码路径） | `exit` 与 `error` 汇入同一 failure handler，并带退出码拒绝 pending；退出和错误后的重复事件由 worker 身份检查去重 |
| dispose | PASS | 拒绝全部 pending、清空 Map、终止 worker；后续请求立即拒绝 |
| postMessage 异常 | PASS | 对应请求从 pending Map 删除并拒绝，不遗留悬挂请求 |
| 迟到/未知响应 | PASS | worker 身份和 request id 双重校验，已结束请求不会被再次处理 |
| worker 初始化失败 | PASS（有文案风险） | 编译后 worker 指向不存在数据库时，Promise 在 118 ms 内拒绝，没有挂起或创建文件 |

注意：在本机 Electron Node 环境中，实际 worker 初始化错误被调用方捕获为普通对象，显示文本可能退化为 `[object Object]`。该问题不影响拒绝、清理和继续使用的安全性，列为后续 P2 文案改进。

结论：**PASS**。

### 5. 来源列表单 SQL 与分页准确性

实现把 `totalCount`、总页数、越界页回正、排序和当前页读取合并进同一条 SQL：

- `filtered_rows` 使用 `COUNT(*) OVER()`；
- `numbered_rows` 计算 `total_pages`、`resolved_page` 和 `ROW_NUMBER()`；
- 不再先执行 COUNT 再重复聚合来源统计。

性能门禁通过 Proxy 统计 `prepare` 次数，确认 32 万视频/100 来源的来源页只执行 **1 条 SQLite statement**。

额外临时库边界验证：

| 场景 | 结果 |
| --- | --- |
| 75 来源，第 3 页，每页 30 | `page=3`、`totalPages=3`、15 项 |
| 请求第 99 页 | 回正到第 3 页，15 项 |
| 45 个 CloudDrive，第 2 页 | `totalPages=2`、15 项，全部为 CloudDrive |
| 搜索无匹配 | `page=1`、`totalPages=1`、`totalCount=0`、空列表 |
| 筛选已停用来源 | 1 项，availability 为 `disabled` |
| SQL 数量 | 上述 5 次查询共 5 条 statement，每次精确 1 条 |

结论：**PASS**。

### 6. 性能复测

#### 32 万视频/100 来源自动性能门禁

- 数据：320,000 个视频、100 个来源，位于临时 SQLite。
- 查询：来源第一页，每页 30，按容量降序。
- SQL 数量：1。
- 本次耗时：`1251.78 ms`。
- 门禁预算：小于 `2000 ms`。
- 结果内容：`totalCount=100`、`totalPages=4`、30 项，容量排序正确。

结果：**PASS**。

#### 真实 319,986 视频资料库，编译后实际 worker

- 数据库以 worker 内 `readonly + fileMustExist + query_only` 打开。
- 编译产物：`dist-main/main/assetCenter/assetCenterWorker.js`。
- `getSummary` 响应：`573.07 ms`。
- `listSources` 响应：`833.61 ms`。
- 两个请求从主线程同时提交到单 worker，总完成时间：`835.46 ms`。
- 主事件循环 10 ms 采样：查询期间执行 53 次 tick，最大间隔 `21.58 ms`。
- 返回：319,986 个有效视频、7 个来源、第一页 7 项。
- 数据库文件大小与修改时间未变化。

查询本身仍需消耗数百毫秒，但工作已移出 Electron 主线程。实际 worker 查询期间主事件循环保持响应，原 QA 的前端卡顿阻断已解除。

结果：**PASS**。

### 7. IPC、preload 与安全边界

- Renderer 仍然只通过两个 typed preload API 读取资产数据。
- 来源参数继续由严格 Zod schema 验证。
- 两个 channel 仍只允许主窗口角色使用。
- 页面刷新只重新请求资产数据，不启动 `scanAllFolders`。
- 页面不触发视频分页、不显示批量工具、不响应视频翻页快捷键。

结果：**PASS**。

### 8. 原功能回归

| 范围 | 结果 | 覆盖证据 |
| --- | --- | --- |
| 软件启动 | PASS | Electron native smoke 与 `app.whenReady` smoke 通过 |
| 视频列表、分页与搜索 | PASS | `LibraryShell`、repository 和性能测试通过 |
| 播放 | PASS | 原生/外部播放、错误回退、自动播放、全屏测试通过 |
| 播放列表 | PASS | 当前目录列表、切换视频和时长状态测试通过 |
| 扫描 | PASS | Snapshot 增量扫描、CloudDrive、网络扫描和大目录计数测试通过 |
| 扫描失败安全 | PASS | 离线保留、异常重试、取消、缺失确认与清理测试通过 |
| 文件管理 | PASS | 重命名、删除、移动、冲突及回滚测试通过 |
| Asset Center 页面 | PASS | 加载、空状态、错误重试、刷新、入口与页面隔离测试通过 |

没有对用户真实媒体执行播放、扫描、删除、移动或其他写操作。

### 9. 静态检查、完整测试、构建和 smoke

| 命令/方式 | 结果 | 记录 |
| --- | --- | --- |
| `npm run lint` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run typecheck` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run build` | PASS | 1600 modules transformed，生产构建完成 |
| 完整 Vitest（Electron `RUN_AS_NODE`） | PASS | 59 个测试文件、575 项测试全部通过，15.09 秒 |
| Asset Center 性能门禁 | PASS | 1251.78 ms，1 条 SQL，预算 2000 ms |
| 编译后实际 worker | PASS | 成功启动并读取真实只读库，主事件循环保持响应 |
| `npm run test:electron-smoke` | BLOCKED（环境） | 项目锁定 Node 22.23.1/npm 10.9.8；本机是 Node 24.14.0/npm 11.9.0 |
| 直接执行 `scripts/run-electron-smoke.mjs` | PASS | Electron 33.4.11、ABI 130；native smoke 和主进程 ready 通过 |

完整 Vitest 使用项目 Electron 33.4.11 的 `ELECTRON_RUN_AS_NODE=1` 环境执行，以匹配当前 `better-sqlite3` Electron ABI。该方式真实运行了全部测试，但最终发布仍需在锁定的 Node 22.23.1/npm 10.9.8 环境执行标准 release gate。

## Risks and follow-up

### P2：打包后 ASAR worker 启动尚未验证

- 本轮已验证 `npm run build` 后的实际 worker 文件可以启动。
- `electron-builder.yml` 会包含 `dist-main/**`，并将 `better-sqlite3` 原生依赖解包。
- 但本阶段明确不生成永久打包产物，因此没有验证安装包/ASAR 环境中的 worker URL 和 native module 加载。
- 最终交付阶段必须在 `package:dir` 或安装包 smoke 中实际打开 Asset Center，验证两个 worker 请求成功，并在退出后确认没有残留 worker 进程。

### P2：worker 启动错误文案可能不友好

实际缺失数据库测试能在 118 ms 内安全拒绝，但 Electron Node 环境中捕获值可能显示为 `[object Object]`。建议后续把 worker `error` 事件统一标准化为 `Error`，并增加真实 worker 初始化失败的消息断言。

### P3：单 worker 串行执行两个资产查询

摘要和来源页会提交到同一 worker 并串行处理。真实库总完成时间为 835.46 ms，页面具有独立 loading 状态且主线程不阻塞，当前可接受；若未来统计继续增加，应保持性能门禁并避免无限扩充首次加载查询。

### P3：性能门禁存在机器差异

本次 1251.78 ms 距 2000 ms 预算有约 748 ms 余量。应在正式 Node 22 发布环境和 CI 上持续观察，不应放宽预算来掩盖回归。

### 未验证事项

- 未验证 ASAR/安装包中的 worker 启动；留待阶段 6 打包 smoke。
- 未在 Node 22.23.1/npm 10.9.8 标准环境执行 `test:release-gate`。
- 未执行用户真实媒体播放、扫描或文件写操作；原功能通过自动化回归验证。
- 未执行真实桌面窗口人工视觉检查。

### 剩余风险

- 最终打包环境中的 worker 路径和解包原生模块仍需实测。
- 最近可访问状态仍是历史扫描结果而非实时探测；现有页面已明确标注“最近”和“非实时”。
- 播放风险 SQL 与共享播放路由规则是两份表达，未来规则更新时需要同步维护。

## Final decision

**PASS — Asset Center V1 通过阶段 2 QA 复测。**

原同步查询卡顿已经通过 `worker_threads + 独立只读 SQLite connection` 解除；来源分页缩减为单 SQL，32 万视频性能门禁、真实库 worker 响应性、完整自动化回归、生产构建和 Electron smoke 均通过。

可以进入 Playback Diagnostic 开发阶段。打包后 ASAR worker smoke 保留为最终交付的强制验收项。
