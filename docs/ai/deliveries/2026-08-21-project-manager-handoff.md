# 映匣项目经理交接文档

> 交接基准：2026-08-21。接手后先用脚本重新核对 Git；本文是导航和决策摘要，不替代代码、迁移、测试及实时 Git 状态。

## Context

“映匣（Local Video Manager）”是 Windows Electron 本地视频资料库。源视频保留在用户原目录，SQLite 只保存索引和状态，封面与时间轴属于可重建缓存。项目文件夹可整体转交；用户数据库、设置、日志和媒体缓存位于 Electron `userData`，不在仓库内，也不应复制进 Git。

当前不存在正在开发的业务功能。最近完成的是 Agent 工作流优化；`.agent/state/CURRENT_TASK.md` 仍停在 `TASK-WORKFLOW-001 / QA_PASS`，等待项目经理完成行政关闭和用户确认，不代表代码或 CI 阻塞。

## 接手后的前 15 分钟

1. 从仓库根目录读取 `AGENTS.md`，不要覆盖、重置或清理未知修改。
2. 依次读取本文件、`.agent/context/PROJECT_SNAPSHOT.md`、`.agent/state/PROJECT_STATE.md`、`.agent/state/CURRENT_TASK.md`。
3. 运行：

```powershell
git status --short --branch
git rev-parse HEAD
powershell -ExecutionPolicy Bypass -File scripts/agent/verify-github-sync.ps1
node --version
npm --version
```

4. 只有出现冲突或高风险任务时，再展开 `docs/ai/KNOWN_RISKS.md`、`docs/ai/CODE_MAP.md`、架构和历史交付记录。
5. 不要因为旧计划或聊天与当前实现冲突就回滚代码。事实优先级：当前代码 > migrations > tests > Git > 最新正式文档 > `PROJECT_SNAPSHOT` > 历史计划/聊天。

## 已验证交接基线

| 项目 | 当前事实 |
| --- | --- |
| 仓库根目录 | `C:\Users\test\Documents\视频管理\movie`（转交后路径可变化，以 `git rev-parse --show-toplevel` 为准） |
| 当前分支 | `ai/agent-workflow-optimization` |
| 最后一个实现基线 | `895a0d893e07d051fe0d1151c336ef2ca6570323`；之后仅增加本交接文档/入口，当前 HEAD 必须实时查询 |
| 交接文档首次提交 | `cec8af784e53b3c7c96ebce97f03fe5e96a83a6a`；文档后续修订仍以 Git 为准 |
| Git 状态 | 交接提交后 clean；功能分支与远端 ahead=0、behind=0，`origin/main` 已同步 |
| Windows CI | 实现基线 run `32160173533` success；交接提交 run `32484786243` 首次遇到无关的扫描测试 15 秒超时，失败 job 重跑后 Electron smoke 与 Node/Windows safety gate 全部 success |
| 数据库 schema | v10；只允许追加 migration |
| 固定工具链 | Node 22.23.1、npm 10.9.8 |
| 最近完整本地门禁 | 47 files / 479 tests PASS；Node ABI 127、typecheck、build PASS |
| Agent 聚焦 QA | 11/11 PASS；PowerShell AST 0 error；Skills 4/4；模拟 3/3 |
| 正式发布状态 | 未达到正式 Windows Release；GitHub Releases 当前为空，main branch protection 未确认 |

## 当前产品契约

- Desktop only：浏览器不得提供假资料库、假文件操作或 demo fallback。
- 源媒体是事实源；renderer 只传 ID/意图，主进程负责路径反查、校验和磁盘操作。
- 扫描失败、离线、超时或取消时，不能用不完整枚举结果将现有视频标记 missing。
- 播放采用 Chromium native → mpv → 系统默认播放器 fallback；`auto` 按容器、codec 和 probe 状态保守路由。
- CloudDrive2 只完成 Phase 1 挂载点发现和 gRPC 枚举加速；原生播放/文件操作阶段尚未实现。
- 重复候选按 SQLite 缓存的精确大小+时长发现，浏览页面不读取完整文件。
- 用户已明确选择效率优先的“一键永久删除候选移除项”：专用快速通道不做 SHA-256、不做二次确认，接受内容误判风险；主进程仍必须校验候选组、保留项、候选 ID 和每组至少保留一个。通用删除/扫描异常入口不能借此绕过各自 guard。
- “优先保留目录”包含该目录的全部子目录。

特别注意：`TASK.md` 顶部和 2026-08-16 的 SHA-256 安全文档保存的是已被后续用户决定覆盖的历史契约。不要据此恢复“强制 SHA+二次确认”。当前代码、README、`KNOWN_RISKS.md` 和 2026-08-18 快速删除交付记录优先。

## 架构与导航

```text
React renderer
  → sandboxed preload / typed IPC / Zod
  → main-process services / repositories
  → SQLite、Windows 文件系统、FFprobe/FFmpeg、mpv/系统播放器
```

- 代码导航：`docs/ai/CODE_MAP.md`
- 活风险与不变量：`docs/ai/KNOWN_RISKS.md`
- 项目快照：`.agent/context/PROJECT_SNAPSHOT.md`
- 当前任务/状态：`.agent/state/`
- 角色规则：`.agent/{project-manager,developer,qa,ui-designer}/`
- 可复用角色 Skills：`skills/movie-*`
- Agent 确定性脚本：`scripts/agent/`
- 最近交付：`docs/ai/deliveries/2026-08-19-agent-workflow-optimization.md`、`2026-08-18-fast-duplicate-permanent-delete.md`

## 项目经理运行方式

项目采用风险驱动调度：

- `LITE`：小型、局部、可逆；Developer + targeted gate。
- `STANDARD`：有明确回归风险；Developer + 独立聚焦 QA，UI 按需。
- `FULL`：永久/批量用户文件操作、数据损失风险、迁移、播放架构、CloudDrive 核心、重大 UI、安装发布、安全边界；启用全部适用门禁。

Task 必须写 Workflow、Risk Areas、QA/UI/Web 是否需要及原因。风险可自动升级；Developer 不能降级，只有 PM 可以降级并记录理由。成功 handoff 使用短 JSON；失败才详细记录 findings、reproduction、impact 和 retest scope。PM 负责 Task、State、Handoff、Gate，不在角色之间重复转述。

## Changes

- 新增本交接文档，并从根 README 提供显式入口。
- 未修改 `src/`、schema、依赖、播放器、扫描、删除或 UI 业务代码。
- 未复制用户数据库、配置、日志、缓存或凭据。

## 桌面产物

- 当前免安装程序：`release/win-unpacked/Local Video Manager.exe`。
- `verify:artifact` 已通过：app.asar 3955 entries，无禁止的开发产物。
- 该包是在 2026-08-18 快速重复删除交付后构建；之后的提交只修改 Agent/文档基础设施，因此业务代码与当前 HEAD 一致，但它仍是本地 unsigned/unpacked 构建，不是正式发布证明。
- `release/` 下的 `win-unpacked.pre-*` 是历史本地备份。不要擅自删除；若需清理，先确认精确目录和恢复需求。

## Verification

- 交接时重新执行 GitHub 同步脚本：clean、ahead=0、behind=0、远端 SHA 一致。
- 重新查询 Windows CI `32160173533`：`success`。
- 从代码核对 `LATEST_SCHEMA_VERSION = 10`。
- 对当前 unpacked 包运行 `npm run verify:artifact`：PASS。
- 文档中的产品决定与 README、`PROJECT_SNAPSHOT`、`KNOWN_RISKS` 和当前代码方向交叉核对。

## Risks and follow-up

当前无已知开放 P0，但以下证据仍不足，正式发布前不能省略：

- 真实 SMB/映射盘断线、重连、长阻塞和不同服务器 rename/file identity 行为。
- 真实旧用户数据库副本升级、恢复演练和多实例竞争。
- 两个物理卷、NTFS ACL、文件独占、磁盘满、跨卷失败与部分恢复。
- 多格式真实媒体、mpv 缺失、系统文件关联和高频双窗口一致性。
- 上一正式版本升级、签名安装包、干净 Windows VM 安装/卸载和数据保留。

不要把自动故障注入、unsigned smoke 或本地 unpacked 启动等同于上述实机证据。Node Vitest 与 Electron native ABI 必须使用独立 checkout/worktree，不能在同一 `node_modules` 上来回 rebuild。

## 建议的新项目经理第一步

1. 向用户确认风险驱动的 LITE/STANDARD/FULL 结构继续作为默认工作方式。
2. 将 `TASK-WORKFLOW-001` 从 `QA_PASS` 行政关闭为 `VERIFIED`，不要为此重跑无关业务门禁。
3. 不主动继续播放器、永久删除、UI、数据库或 CloudDrive 开发；等待用户指定下一项产品任务。
4. 下一项业务任务开始前，先按 `scripts/agent/select-workflow.ps1` 分类，再创建紧凑 task packet。

交接到此结束。新项目经理无需读取原聊天记录即可接管；若本文与实时仓库冲突，以前述事实优先级重新验证并更新状态。
