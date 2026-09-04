---
date: 2026-09-04
branch: ai/playback-diagnostic-v1-fix
type: fix
status: completed
---

# 映匣 Playback Diagnostic V1 QA 修正交付记录

## Context

阶段 4 QA 发现播放诊断的路径搜索口径不正确，并且 32 万条资料库搜索会同步阻塞 Electron 主线程。本次以最小范围修正这两个 P1，不改变普通视频库搜索和其他稳定业务流程。

## 分支

`ai/playback-diagnostic-v1-fix`

## Commit

待项目经理完成提交后填写最终哈希。本次修正开始基线为 `f70462f900ef0450e39e415c82554674502bc6f5`。

## Changes

- 新增播放诊断专用只读搜索接口。诊断搜索现在按文件名或完整路径匹配，路径中独有的关键字可以命中。
- 对用户输入的 `%`、`_` 和 `!` 执行 SQLite `LIKE` 字面转义，避免用户输入被意外解释为通配符。
- 原有资料库 `listVideoPage` 查询和搜索语义保持不变；只有播放诊断页使用新接口。
- 新增独立 `worker_threads` 查询服务。SQLite 连接使用只读、`fileMustExist` 和 `query_only`，查询不在 Electron 主线程执行。
- 搜索调度采用“一个执行中、一个最新待执行”。新请求会替换尚未执行的旧请求，避免快速输入时积压过期的全库搜索。
- worker 查询结果继续复用 `VideoRepository` 现有 `VideoRecord` 映射，不建立第二套视频记录语义。
- worker 错误、异常退出、同步发送失败和服务关闭均会拒绝对应请求；关闭会等待 worker 完整退出，避免 Windows 下 SQLite 文件仍被占用。
- Renderer 保留每页 30 条、225 ms 防抖和 request id 迟到响应丢弃，不加载封面，不触发媒体文件读取。
- 未修改扫描、播放、文件管理核心、数据库结构或普通资料库分页接口。

## 新增文件

- `src/main/playbackDiagnostic/playbackDiagnosticQueries.ts`
- `src/main/playbackDiagnostic/playbackDiagnosticQueryService.ts`
- `src/main/playbackDiagnostic/playbackDiagnosticWorker.ts`
- `src/main/playbackDiagnostic/playbackDiagnosticWorkerProtocol.ts`
- `tests/main/playbackDiagnosticQueries.test.ts`
- `tests/main/playbackDiagnosticQueryService.test.ts`
- `tests/gates/playbackDiagnosticSearchPerformance.test.ts`
- `docs/ai/deliveries/2026-09-04-playback-diagnostic-qa-fix.md`

## 修改文件

- `src/shared/videoTypes.ts`
- `src/main/db/videoRepository.ts`
- `src/main/preload.cts`
- `src/main/ipc.ts`
- `src/main/index.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/PlaybackDiagnosticPage.tsx`
- `tests/main/ipcContracts.test.ts`
- `tests/main/security.test.ts`
- `tests/renderer/LibraryShell.test.tsx`
- `tests/renderer/PlaybackDiagnosticPage.test.tsx`

## 删除文件

无。

## 数据来源

- 搜索数据仅来自现有 SQLite `videos` 表中的缓存字段。
- 匹配字段为 `filename` 和 `path`，并排除已有 `is_missing = 1` 记录。
- 返回值通过现有 `mapVideo` 映射为 `VideoRecord`。
- 不访问媒体文件、CloudDrive、ffprobe、扫描服务、预览图或封面缓存，不执行数据库写入。

## Verification

- `npm run typecheck`：PASS。
- `npm run lint`：PASS。
- 定向 Node Vitest：PASS，7 个测试文件、106 项测试。覆盖 IPC、安全策略、查询服务、诊断页面迟到响应、LibraryShell 隔离、App 和 PlayerPage 回归。
- Electron 33.4.11 Node 模式定向 Vitest：PASS，3 个测试文件、12 项测试。覆盖查询语义、服务生命周期和 32 万条性能门禁。
- 32 万条合成数据开发实测：宽泛搜索 `111.32 ms`，无结果搜索 `116.10 ms`，worker 工作期间主事件循环最大采样间隔 `24.36 ms`。主审把门禁预算进一步收紧为单次查询 `2000 ms`、主线程间隔 `100 ms`。
- 生产构建后的真实 worker 路径只读烟测：PASS。完整路径独有关键字返回 1 条正确记录，并可在等待 `dispose()` 后清理 SQLite 临时文件。
- `npm run build`：PASS。
- Electron 33.4.11 Node 模式完整 Vitest：PASS，64 个测试文件、609 项测试。
- 收紧门禁后的 32 万条定向复测：宽泛搜索 `125.75 ms`，无结果搜索 `127.77 ms`，主事件循环最大采样间隔 `24.11 ms`。
- Electron 主进程 smoke：PASS。

## 未验证事项

- 尚未在真实 32 万视频用户资料库中执行人工输入、分页和快速连续改词的视觉体验测试。
- 尚未执行 Windows 安装包打包与安装验证；本任务按要求不打包。
- 性能数字来自本机合成 SQLite 数据，真实磁盘、杀毒软件和数据库碎片情况会影响绝对耗时。

## Risks and follow-up

- `filename OR path` 的包含搜索无法使用普通 B-tree 前缀索引，极大资料库的单次查询仍需要扫描 SQLite 缓存行；worker 已将该成本移出主线程并合并过期请求，但搜索结果出现时间仍受磁盘性能影响。
- 正在执行的 SQLite 查询不能被新输入强制中断；新输入只会替换等待队列中的旧请求。因此最坏情况下需要等待当前一次查询完成，再执行最新一次查询。
- 诊断搜索只反映数据库最近缓存状态，不为搜索实时访问文件系统或远端服务。

## 后续建议

- QA 在真实资料库中重点验证：仅路径关键字、连续快速输入、清空搜索、跨页切换、关闭应用时仍有查询进行中。
- 若真实库单次搜索明显超过合成门禁，优先采集 SQLite 查询耗时和磁盘队列证据；不要回退到 Electron 主线程查询，也不要改变普通资料库搜索语义。
