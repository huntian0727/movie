# 交接文档：CloudDrive 加速 & 扫描异常模块重构

> 交接对象：接手的 AI 项目经理
> 交接日期：2026-08-23
> 分支：`ai/clouddrive-perf-batch1`
> 最新提交：`147a12c`
> 文档维护人：上一轮实现 AI

---

## 1. 一句话概览

本轮工作在一个本地视频管理器（Electron + React + TypeScript + better-sqlite3，管理本地盘与 CloudDrive2 挂载的 115 网盘视频）上完成了两条主线：

1. **CloudDrive2 网盘访问加速**（批次 1–3）：收紧 ffprobe、gRPC 长连接保活、播放预取、令牌桶限流。
2. **扫描异常模块重构**：从“分页 + 仅确认损坏可清理”升级为“7 类错误分类 + 虚拟滚动 + 批量重试/删除 + 导出”。

工作区干净，所有改动已提交并推送到 `origin/ai/clouddrive-perf-batch1`。应用已打包验证（`release/win-unpacked`），**但尚未合入 main、未制作 NSIS 安装包、未正式发布**。

---

## 2. 项目基本信息

| 项 | 值 |
|---|---|
| 应用名 | Local Video Manager |
| 技术栈 | Electron 33.4.11 + React 18 + TypeScript 5.7 + Vite 6 + better-sqlite3 11.8 |
| 主进程 | `src/main/`（tsc → `dist-main/`） |
| 渲染进程 | `src/renderer/`（Vite → `dist-renderer/`） |
| 共享类型 | `src/shared/` |
| 数据库 | SQLite，schema 当前 **v10**（迁移在 `src/main/db/migrations/`） |
| 包管理 | npm 10.9.8，Node 22.23.1（volta 锁定） |
| 云盘接入 | CloudDrive2 通过 gRPC（`src/main/clouddrive/`），115 网盘挂载为本地盘 |

### 常用命令

```bash
npm run typecheck        # tsc 主进程 + 渲染进程
npm run build            # clean + tsc + vite build
npm run test:node        # vitest run（全部单测）
npm run rebuild:electron # 重编 better-sqlite3 给 Electron ABI 130
npm run package:dir      # 构建 + 重编原生模块 + electron-builder --dir → release/win-unpacked
npm run dist:win         # 构建 + NSIS 安装包（本轮未执行）
```

---

## 3. 已完成的改动（按提交）

| 提交 | 日期 | 说明 |
|---|---|---|
| `8004e06` | 08-21 | CloudDrive2 网盘访问加速批次 1–3（含此前未提交的 codec 路由、迁移 008–010、AI 工作流） |
| `70e33f4` | 08-22 | 重复项页面新增单文件永久删除按钮 |
| `792d467` | 08-22 | 云端视频延迟探测（deferred）+ 禁用收藏/待删除页自动刷新 |
| `77801db` | 08-23 | 修复扫描异常“重试”对云端视频是空操作的 bug |
| `3b47e07` | 08-23 | 扫描异常模块重构（核心交付） |
| `147a12c` | 08-23 | 文档：补 CHANGELOG、标注规格已重构 |

### 3.1 CloudDrive2 加速（批次 1–3）

**批次 1 — ffprobe 收紧 + 连接保活**
- `metadataService`：新增 cloud probe profile（`-probesize 500k -analyzeduration 1M`），云端探测走小参数。
- `clouddrive/grpcClient`：分层超时（firstByte + idle）、HTTP/2 PING keepalive（30s）、`CloseFileReader` RPC 主动释放服务端 EntryReader。
- `mountedScanner`：`isCloudDrivePath` / `tryReleaseCloudDriveReader`。
- `metadataQueue` / `playbackMetadataEnricher`：`resolveProbeProfile` + `afterProbe` hook。

**批次 2 — 播放预取**
- `prefetchManager`：播放开始 HIGH 8MiB、seek HIGH、下一集 NORMAL 4MiB、缩略图 LOW。
- `mediaProtocol`：Range 请求触发 seek 预取；`playerWindow` 切集时预取当前文件头 + 下一集。

**批次 3 — 限流 + 字段补全**
- 令牌桶限流器：115 网盘默认 **4 QPS**，可用环境变量 `LOCAL_VIDEO_MANAGER_CLOUDDRIVE_QPS` 覆盖。
- gRPC 所有 RPC 自动过限流；`CloudDriveFile` 扩展 8 个字段解码；protobuf 编码工具补全。

> ⚠️ 4 QPS 是基于 115 网盘的保守默认值。若用户反馈限流，调大该环境变量；若触发 429/封控，调小。

### 3.2 云端延迟探测（deferred）

- 新增元数据状态 `deferred`（介于 pending/ready/failed 之外）。
- 云端视频扫描时以 `deferred` 入库，**阻止后台 MetadataQueue 通过网络批量跑 ffprobe**。
- `PlaybackMetadataEnricher` 在**实际播放时**才用 cloud profile 执行完整探测，成功转 ready，失败转 failed。
- cloud profile 探测失败时**不再回退**到无限制参数（5MiB/10s），避免大流量。
- 用户可手动点视频卡片上的胶片图标，对 deferred/failed 视频触发分析。

### 3.3 扫描异常重试修复（`77801db`）

- **Bug**：用户点“重试”时，云端视频只把状态 `failed → deferred` 并标记异常已解决，没有真正跑 ffprobe，导致用户感觉“重试没反应、异常还在”。
- **修复**：`retryScanFailure`（用户显式重试）始终将视频入队 MetadataQueue 执行实际 ffprobe，覆盖 deferred 策略。注意**批量重试路径**（启动同步 `retryScanFailures`）仍保留 deferred 策略以省带宽——这是有意区分。

### 3.4 扫描异常模块重构（`3b47e07`，核心）

**错误分类**（`src/shared/scanFailureCleanup.ts`）
从 4 类扩展为 7 类，每类独立正则：
`network` / `permission` / `missing` / `corrupt` / `busy` / `io-error` / `unknown`。

**列表与选择**
- 每页 100 条 + 虚拟滚动（行高 120px，overscan 5），替代原 30/50/100 分页。
- “全选本页 / 反选 / 取消选择”，可一次处理数千条。
- 顶部多选错误类型 chip 筛选，实时显示每类数量；后端返回 `errorTypeCounts`。

**批量操作**（新增两个 IPC 通道）
- `scan-failure-review:batch-retry`：逐个重试，单个失败不阻塞其余（策略 A），结束报告成功/跳过/失败；云端并发 1。
- `scan-failure-review:batch-delete`：**所有文件类型**均可批量删除（不再只限“确认损坏”）。后台逐项安全检查：受管目录边界、文件存在性、大小/mtime 匹配、SHA-256 重复项守卫；任一失败自动跳过该项并继续。删除后自动移除资料库记录并统计释放空间。
- 批量删除只需一次确认弹窗；单条删除仍保留确认。

**其他**
- 重试成功后异常立即从列表消失。
- 导出报告 CSV / JSON。
- `cleanupScanFailures` 放宽为所有文件类型可处理，新增 `action: "retry"`。
- 未改数据库 schema。

---

## 4. 文件清单（本轮重点改动）

```
src/shared/scanFailureCleanup.ts        # 7 类错误分类器（重写）
src/shared/videoTypes.ts                # ScanFailureBatchActionResult 等新类型 + 2 个 IPC 通道
src/main/db/videoRepository.ts          # listScanFailureReviewPage 支持 errorTypes 筛选 + errorTypeCounts
src/main/files/scanFailureActions.ts    # 放宽删除限制 + retry action
src/main/ipc.ts                         # batch-retry / batch-delete handler
src/main/preload.cts                    # 暴露 batchRetryScanFailures / batchDeleteScanFailures
src/main/media/libraryScanner.ts        # 单条重试始终真实 ffprobe（上一轮修复）
src/renderer/components/ScanFailuresPage.tsx  # 虚拟滚动 + 多选筛选 + 批量操作（重写）
src/renderer/components/LibraryShell.tsx
src/renderer/App.tsx
src/renderer/styles.css
tests/main/scanFailureReview.test.ts
tests/renderer/ScanFailuresPage.test.tsx
tests/renderer/LibraryShell.test.tsx
tests/main/ipcContracts.test.ts
CHANGELOG.md
SCAN_FAILURE_REVIEW_FEATURE_SPEC.md    # 顶部加了“已重构”备注
```

---

## 5. 测试与构建状态

### 单元测试
- 扫描异常相关 **172 个测试全部通过**（scanFailureReview / ScanFailuresPage / LibraryShell / scanManager / videoRepository / duplicateResolveSafety 等）。
- `npm run test:node` 全量跑时有 **3 个预先存在的失败，与本轮改动无关**：
  1. `tests/main/cacheManager.test.ts` — “keeps maintenance bounded for a large cache index” 性能断言 14s > 10s 阈值（环境敏感，旧问题）。
  2. `tests/scripts/agentManagementScripts.test.ts` — 2 个子用例依赖临时 git 仓库的 `HEAD`/`origin/main`，在沙箱里初始化不完整。
  3. `tests/scripts/finishAndPush.test.ts` — 同上，git 环境依赖问题。
- 接手后建议单独排查这 3 个，确认是否在干净环境也复现。

### 构建 / 打包
- `tsc`（主+渲染）类型检查通过。
- `vite build` 通过，产物 `dist-renderer/assets/index-*.js` 约 299 KB。
- `release/win-unpacked/Local Video Manager.exe`（188 MB）已生成，asar 内已验证包含 `batch-retry`/`batch-delete`/`errorTypeCounts` 及中文 UI 文案。
- **未执行** `npm run dist:win`（NSIS 安装包）。

---

## 6. 已知问题与待办（交给下一轮）

### P0 — 发布前必须确认
1. **未合入 main**：当前在功能分支 `ai/clouddrive-perf-batch1`。按项目交付流程（见 `AGENTS.md` / `.agent/`），需经 QA + UI review 后才能合入 main。
2. **真机验证缺失**：所有云端逻辑（CloudDrive2 gRPC、115 网盘限流、延迟探测、批量重试）只在单元测试层面验证，**没有在真实挂载的 115 网盘上端到端跑过**。强烈建议接手后用真实库验证一遍，重点：
   - 批量重试几千条 missing 记录的耗时与限流表现；
   - 云端视频点击播放时 deferred → ready 的探测是否真的省流量；
   - 4 QPS 默认值是否合适。
3. **打包进程占用问题**：运行中的 `Local Video Manager.exe` 会锁住 `chrome_100_percent.pak`，打包前需用 PowerShell `Stop-Process` 结束所有实例（bash 下 `taskkill //PID` 有转义问题，用 PowerShell）。

### P1 — 体验/健壮性
4. **批量操作无进度条**：当前批量重试/删除是一次性 await，几千条时 UI 只显示 spinner，没有“已处理 X/Y”的实时进度。建议后续加进度事件（参考 duplicate cleanup 的任务中心模式 `DuplicateCleanupTasksPanel`）。
5. **批量重试云端并发=1 是硬编码**：在 IPC handler 里串行循环。若要提速，可引入与 MetadataQueue 一致的并发控制，但要兼顾 115 限流。
6. **虚拟滚动行高固定 120px**：长路径换行或小屏时卡片高度可能溢出。响应式断点（1050px）下布局会变 flex，行高估算可能不准，需在窄屏验证。

### P2 — 技术债
7. `listScanFailureReviewPage` 为了按错误类型筛选，把未过滤行全部加载到内存再 JS 过滤（几千条可接受，但若异常量级到几万需改 SQL 内联分类或加列）。
8. 旧的 `onCleanupScanFailures` prop 已从 `ScanFailuresPage` 移除（改用 onBatchRetry/onBatchDelete），但 `VideoManagerApi.cleanupScanFailures` IPC 仍保留给旧的 mark-pending-delete 流程，可评估是否统一。
9. 3 个预先存在的失败测试（见第 5 节）建议清理。

---

## 7. 关键设计决策（避免后人误改）

1. **单条重试 vs 批量重试的差异是有意的**：
   - 用户在界面点单个“重试” → 真实跑 ffprobe（即使是云端），因为用户明确要求现在分析。
   - 启动批量重试 / 后台同步 → 云端视频保持 deferred，只在播放时探测，省带宽。
   - 不要把两者统一成同一种行为。

2. **批量删除放宽到所有文件类型，但安全检查不放松**：
   - 旧版只允许删除“确认损坏”（4 个 ffprobe 特征），用户反馈几千条 missing 文件没法一次清。
   - 现在所有文件类型都能批量删，但删除前逐项 stat 校验大小/mtime + SHA-256 守卫，检查失败就跳过。这是“UI 放宽、后台守住”的模式，不要为了省事去掉后台校验。

3. **删除后行为 = 移除资料库记录**（用户明确确认选 A 后“移除记录”），不是标记 missing。`deleteScanFailureFile` 里调 `repo.removeVideo`。

4. **deferred 状态**是云端性能优化核心，不要在普通扫描路径给本地视频用 deferred（本地视频应正常 pending → ready）。

---

## 8. 接手建议步骤

1. 先读 `CHANGELOG.md` 顶部 5 条 + `ARCHITECTURE.md` 建立全貌。
2. `npm install` → `npm run rebuild:electron` → `npm run typecheck` → `npm run test:node`，确认环境。
3. 重点 review `src/shared/scanFailureCleanup.ts`（分类正则）和 `src/renderer/components/ScanFailuresPage.tsx`（虚拟滚动）。
4. 在真实 115 挂载盘上端到端验证（第 6 节 P0-2）。
5. 处理 P0 后走 `.agent/` 的 QA/UI review 流程合入 main。
6. 合入后执行 `npm run dist:win` 出 NSIS 安装包。

---

## 9. 联系方式 / 上下文恢复

- 本轮工作日志：`.workbuddy/memory/2026-08-23.md`（AI 会话级，非项目正式文档）。
- 项目长期约定：`.workbuddy/memory/MEMORY.md`、`AGENTS.md`。
- 上一轮（8-22 及之前）的交接与性能评估见 `docs/clouddrive2-acceleration.md`、`docs/scan-optimization-final-report.md`。
- 扫描异常初版设计：`SCAN_FAILURE_REVIEW_FEATURE_SPEC.md`（顶部有重构备注，已过时但保留作背景）。

如有疑问，优先查 git history：`git log --oneline -10` 与 `git show <sha>`。
