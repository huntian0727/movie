---
date: 2026-10-05
branch: ai/background-performance-v1
type: refactor
status: completed
---

# 后台性能优化 V1

## Context

用户要求优先完成不影响正在使用电脑的后台性能优化，并确认现在以低 CPU 优先级完成开发前完整备份。原分支与 GitHub main 均为 `b7c3fb8b170525076a56e31bca9f06e1042063b2`，开始时工作区干净。

## 备份

- Snapshot：`2026-10-04_18-05-29-678_background-performance-v1`（工具生成的快照 ID，不按客户端日期改写）。
- Git checkpoint：`checkpoint-20261005-020526-b7c3fb8-background-performance-v1`，已推送。
- 源码 bundle、设置备份、manifest：生成成功。
- SQLite 一致性快照：约 0.87 GB，345,479 视频，quick_check=ok。
- 备份和验证均采用 BelowNormal CPU 优先级；这不等于硬性限制磁盘 I/O。

## Changes

详细实施边界见 `docs/ai/reports/2026-10-05-background-performance-v1.md`。

### 新增文件

- `src/main/queries/coalescingReadQueue.ts`
- `tests/main/coalescingReadQueue.test.ts`
- `tests/main/directoryFailureState.test.ts`
- `tests/main/libraryPageQueryService.test.ts`
- 本次报告与交付记录。

### 修改文件

- `src/main/assetCenter/assetCenterQueryService.ts`：串行派发和相同等待读取合并；新增异常分页读取方法。
- `src/main/assetCenter/assetCenterWorkerProtocol.ts`：新增 scanFailures 请求/响应类型。
- `src/main/assetCenter/assetCenterWorker.ts`：异常分页在只读事务中读取。
- `src/main/ipc.ts`：异常分页复用只读 Worker，Renderer 契约未变。
- `src/main/db/videoRepository.ts`：定向读取目标异常及当前目录异常状态，复用现有索引。
- `src/main/libraryPage/libraryPageQueryService.ts`：复用合并队列，增加可注入测试 Worker。
- `src/main/media/cacheManager.ts`：Set 查询已移除的缓存路径。
- `src/main/media/imageGenerationQueue.ts`：用线性选择代替全队列排序。
- `src/renderer/components/LibraryShell.tsx`：每帧合并侧栏拖动，拖动结束保存宽度。
- `src/renderer/components/DuplicateGroupsPage.tsx`：单组标量选择及稳定回调，避免其他卡片无关重绘。
- `tests/main/assetCenterQueryService.test.ts`、`tests/main/imageGenerationQueue.test.ts`、`tests/main/ipcContracts.test.ts`、`tests/renderer/LibraryShell.test.tsx`、`tests/renderer/DuplicateGroupsPage.test.tsx`：对应定向回归。

### 删除文件

无。

### 数据来源及保持不变的区域

- 仍使用现有 SQLite、VideoRepository 和只读 Worker；不新增表、字段、索引或第二套扫描架构。
- 未修改播放器核心、扫描发现/变化检测/FFprobe策略、文件删除授权或执行核心、CloudDrive API 协议。
- 不在测试中使用正式库、用户视频、网盘 API 或 Token。
- 测试使用合成数据，不修改用户的资料库或视频。用户确认电脑空闲后，已重新生成 `release/win-unpacked` 目录包。

## Verification

开发阶段的定向验证采用 BelowNormal CPU 优先级、Vitest 单 worker；用户确认电脑空闲后，按项目正常发布门禁完成全量验证。

- `node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit`：PASS。
- `node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit`：PASS。项目 lint 即这两项 typecheck。
- 纯队列、截图调度、IPC 契约：23 项 PASS。
- 异常目录状态、资产查询服务、缓存管理：31 项 PASS。
- 视频浏览查询服务：3 项 PASS。
- LibraryShell：59 项 PASS。
- DuplicateGroupsPage：35 项 PASS。
- Snapshot 增量扫描：26 项 PASS。
- VideoRepository、异常复查、批量异常服务：74 项 PASS。
- 数据库测试使用现有 Electron 原生模块的无窗口命令行运行时，未重编译或替换 better-sqlite3。

最终统一回归：使用 `ELECTRON_RUN_AS_NODE=1` 的 Electron 33.4.11 命令行运行时，运行上述 13 个测试文件（`--maxWorkers=1 --minWorkers=1`），**251/251 PASS**，耗时 17.59 秒。此测试模式没有启动 Electron 桌面窗口。

`npm run test:release-gate`：PASS；其中完整 `vitest run` 为 104 个测试文件、895 项测试全部通过，包含 320k 合成资料库及性能基线。`npm run prepare:electron`、`npm run test:electron-smoke`：PASS。`npm run package:dir`、`npm run verify:artifact`、`npm run test:packaged-smoke`：PASS；包内 4004 个 asar 条目，未含禁止的开发产物。打包烟测使用隔离资料库，确认应用启动、默认资产中心、浏览、预览生成/缓存/重新生成、多个查询 Worker 和安全限制。烟测期间记录了预期的非受信页面 IPC 拦截及重新生成预览时旧缓存文件瞬时不可用的日志，最终断言全部通过。

`git diff --check`：PASS。逐项复查改动范围：未修改迁移、CloudDrive 协议、播放器核心或删除执行核心。真实 CloudDrive E2E 和正式资料库 p95 未执行，不能据合成测试承诺具体提速百分比。

### 分支、Commit、Push

- 分支：`ai/background-performance-v1`。
- HEAD/基线：`b7c3fb8b170525076a56e31bca9f06e1042063b2`。
- 交付使用 `scripts/finish-and-push.ps1`；最终开发 Commit、远程分支与 main、备份标签以该脚本结果和最终验收记录为准。
- 完整发布门禁和 Electron smoke 已在本工作区执行；交付脚本使用 `-SkipChecks` 避免在 Electron ABI 下重复运行 Node ABI 测试，不代表跳过质量验证。

### 未验证范围

- 正式用户库的响应时间分布、真实 CloudDrive E2E 和长时间使用情况。此轮没有生成 NSIS 安装器，因此未运行安装器专项烟测。
- 桌面快捷方式启动检查在最终 Commit 后对同一交付版本执行；当前记录中的打包烟测不代替该人工验收。

## Risks and follow-up

- 本轮只改善上述已覆盖的开销，不代表全部性能问题已解决；尚未测试正式数据规模的响应分布。
- 队列只合并相同等待读取，不取消不同参数查询；完整消费者级取最新和精准缓存失效待后续独立实施。
- 大批量清理准备、超大单组/页面虚拟化、少量选择导出、目录预取及日志等优化仍未实施。
- 回滚源码应基于开发前 checkpoint 创建修复分支或正常 revert；数据回滚使用完整快照脚本，须先关闭软件并遵守脚本流程，不能强制回退 main。
- 交付前已有桌面快捷方式 `C:/Users/test/Desktop/拉面影视.lnk` 指向本仓库的 `release/win-unpacked/拉面影视.exe`，没有修改快捷方式。最终 Commit 后会重打包并从真实快捷方式启动验收；实际完成状态以最终交付消息为准。
