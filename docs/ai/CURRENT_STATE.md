# 当前项目状态

更新时间：2026-10-21。本文主体是长期项目维护基线；精确 Commit 以 `git rev-parse HEAD` 和最新交付记录为准。与本文冲突时，以当前代码、以下最新覆盖、`CHANGELOG.md` 的 `[Unreleased]` 和最新交付记录为准。

## 当前开发节点（2026-10-21）

- 当前直接交接入口：[`CURRENT-HANDOFF.md`](CURRENT-HANDOFF.md)。新会话先读该文件，再读 `AGENTS.md`、`START_HERE.md` 和对应交付记录。
- 当前分支 `ai/release-metadata-display-version`，基于发行预检修复提交 `b0f1296`；代码修复提交 `ad6e853` 仅补齐发行元数据生成器的 displayVersion。原 v1.2 功能实现提交仍为 `c79402c1f904e80b7188eb1d313c101b2ad96ba0`。新会话以 `git rev-parse HEAD` 和 `git status --short` 获取实时状态；界面版本仍为 `v1.2`，技术包版本 `0.1.16`。
- 容错联动专项：真实临时 SQLite + 模拟 CloudDrive，已验证跨 30+5 批次的明确失败（34 成功/1 失败）和第 31 次调用断连（32 成功/1 未知/2 未提交），重启均不自动重放；`npm run typecheck` PASS，6 文件 77/77 PASS。未进行真实 115 API 删除；详见 `deliveries/2026-10-21-duplicate-background-fault-qa.md`。
- 用户已明确暂缓真实删除验证。随后完成 v1.2 非删除专项回归：Windows 文件/网络 37、迁移 41、常规性能/缓存 31、播放器/字幕/扫描 283、320k 构造数据性能 4、CloudDrive 模拟/安全 70，共 **466/466 PASS**（37 个 Vitest 文件）；Electron 主进程 smoke 另行 PASS。仅测试和文档，无生产代码修改、无用户可见版本升级。见 `deliveries/2026-10-21-v12-nondestructive-regression.md`。
- 新一轮仅只读运行检查和隔离打包测试：真实资料库 v16，363216 视频，CloudDrive 来源 7、本地来源 4，当前 API TCP 可达；v1.2 双阶段 packaged smoke PASS、备份 Verify PASS。真实远端删除仍 NOT RUN，详见 2026-10-21 容错 QA 交付记录。
- 当前已完成“重复文件入后台后临时隐藏排队项、整页覆盖单页筛选目录时自动退出浏览筛选”的实现。专项 typecheck 及 5 个测试文件 148/148 通过。细节与风险见 `deliveries/2026-10-21-duplicate-queued-list-ux.md`。
- 全量 `npm run test:node` 已重跑：149 文件，1388/1391 PASS；3 项失败均为旧 0.1.15 发行审批与当前 0.1.16 package.json / package-lock 失配。新增发行预检绑定测试 16/16 PASS，`npm run test:media-candidate-contract` 67/67 PASS，`npm run typecheck` PASS，`npm run build` PASS；Electron、renderer security、现有 v1.2 packaged smoke 均 PASS。
- 发行预检现实际阻塞：批准版本 0.1.15 与当前 0.1.16 不一致，审批 lockfile SHA256 与当前 lockfile 不一致；LICENSE/QA 文件哈希匹配，但稳定 Windows/标准用户覆盖未批准、原生二进制合规未批准、私有 REVIEW ZIP 缺失。主工作区旧 `release/unsigned-test-build` 的 metadata/flavor 仍不一致；为不覆盖旧候选，另在隔离 worktree 重建 0.1.16 私有 QA 包，`release:metadata`、`verify:artifact` 和 `test:installer-smoke` 均 PASS。详见 `deliveries/2026-10-21-release-preflight-binding-guard.md` 与 `deliveries/2026-10-21-release-metadata-display-version.md`。

## 最新覆盖（2026-10-21）

- 本地开发版重复清理继续优化：默认主要保留单项删除和“清理当前页”，高级维护按钮折叠。每批最多 100 条、进度反馈和部分失败明细；失败项重试先由用户确认再重新安全预检。通信中断导致某批结果未知时停止后续批次，前序已确认结果不丢失，未知结果不得自动重放。隔离真实文件夹测试只使用系统临时目录，不动资料库真实影片。
- 当前重复视频判定只比较精确文件大小与四舍五入到整秒的时长，不计算视频内容哈希。手动单项/当前页清理恢复一次确认，执行前自动复查路径、大小、时长、修改时间和文件身份；后台高级核对任务仍要求检查计划并输入大写 `DELETE` 二次确认。
- 旧 CloudDrive API 快速删除通道、筛选全集快速删除和 workflowVersion=3 旧任务续跑/重试仍保持禁用，不自动恢复任何快速删除行为。
- 重复清理交互已恢复到单项/当前页一次确认的快捷模式（本地开发版）。先由主进程按数据库重复组及文件状态校验大小、时长、路径、版本，再调用现有受管文件删除安全入口；单文件和当前页操作不强制创建两阶段后台任务。原按钮消失的根因是两阶段安全改造移除了旧 `onAutoDelete` 回调，但按钮仍以旧回调作为渲染条件。
- 本地未发布改动：大小与时长判重和单项/当前页一次确认的简洁删除界面，保持旧快速 API 关闭；本地开发分支，不推送 GitHub、不公开发版，除非维护者明确要求。没有对真实媒体执行删除或清理。

## 产品与技术基线

- Windows 桌面应用：Electron 33、React 18、TypeScript 5.7、Vite 6。
- 产品为 Windows Electron Desktop Only；React/Vite 仅作为 Renderer 技术栈，不再维护浏览器 demo 或假业务 fallback。
- 数据：better-sqlite3，当前 `LATEST_SCHEMA_VERSION = 10`；electron-store 保存应用设置。v8 增加四个 nullable codec 字段，v9 增加 `codec_probe_status`，v10 增加重复清理的完整 SHA-256、强文件身份、授权 revision 和可恢复隔离状态；迁移不读取媒体内容。
- 媒体：静态 FFprobe/FFmpeg 读取元数据和生成缓存；可选 mpv；最终可回退系统默认播放器。
- 测试：Vitest、Testing Library、jsdom，以及 Electron/打包 smoke 和 Windows 发布门禁脚本。
- 工具链固定为 Node 22.23.1、npm 10.9.8。Node 测试与 Electron native ABI 必须使用隔离 checkout/worktree。

## 已实现的主流程

- 源目录可添加、重扫、移除；允许父目录和显式子目录重叠，视频归属最具体的源目录。
- 扫描按目录持久化快照与异常；当前目录增量扫描、异常重试、全部源目录扫描是三个独立入口。
- 新视频先快速入库，再由单并发 MetadataQueue 后台读取元数据。
- 普通资料库和重复项均在 SQLite 分页；资料库支持搜索、排序、目录、收藏、最近播放和待删除视图。
- 重复候选仍按“缓存的精确大小 + 精确时长”发现，普通浏览不读取视频内容；时长未就绪的文件不参与候选分组。
- 重复页恢复单文件和当前页快速清理：一次人工确认后自动完成大小/时长和文件版本预检查，并复用受管文件的安全删除入口。两阶段后台核对作为高级可选操作保留，旧未经核对的 CloudDrive 快速删除通道仍关闭。
- 播放支持 native → mpv → 系统默认播放器 fallback；`auto` 使用 metadata/probe 状态+容器+codec 保守路由。历史 ready 视频按 `codec_probe_status` 最多自动探测一次，播放准备最多等待 2 秒；失败后不重复探测，文件版本变化后重新允许。pending 的常见 native 容器临时 native-first，WebM 10-bit 等复杂格式转 mpv。
- 封面和时间轴按需生成并写入 userData 下的持久缓存；缓存可重建、有限额、可手动清理。
- 文件移动、重命名和永久删除集中在主进程，包含路径校验、冲突处理和失败恢复逻辑。
- 扫描异常工作台支持筛选、重试和对确认损坏/不可播放文件执行安全清理。
- CloudDrive2 Phase 1 已实现挂载点发现和基于 gRPC 列举的扫描加速；后续原生播放/文件操作等阶段未实施。

## 最近维护重点

- Renderer 已收敛为 desktop-only：`window.videoManager` 是业务运行前提，缺失时只显示明确的 unsupported-runtime 页面。
- 扫描异常的重试、空目录/映射盘行为和损坏视频清理。
- 重复项预检过期状态刷新、后台清理任务和高频删除交互性能。
- 自动交付：功能分支提交后备份旧 `main` 为注释标签，再用普通快进推送更新 `main`。
- 本轮建立 `docs/ai/` 项目记忆入口和每次交付记录门禁。
- Agent 运行层采用风险驱动的 LITE/STANDARD/FULL：小型可逆任务只走 Developer+定向门禁；一般回归风险加入独立聚焦 QA；不可逆文件动作、迁移、播放架构、CloudDrive 核心、重大 UI 和发布走 FULL。默认从 `PROJECT_SNAPSHOT`、task、角色规则和相关代码/测试按需展开；handoff 使用短 JSON，Git/测试/状态事实由脚本生成。

## 仍需验证或推进

- 真实 CloudDrive2 服务器、SMB/映射盘长阻塞、断线和十万级目录的完整 E2E。
- 真实旧用户数据库副本从旧 schema 升级、失败恢复和多实例竞争。
- 多格式媒体、mpv 缺失、系统文件关联、旋转铺满、双窗口高频状态同步。
- 两个真实物理卷、ACL、文件独占、磁盘满、跨卷移动和不可逆删除的人工证据。
- 签名安装包、上一正式版本升级、干净 Windows VM 安装/卸载。
- 超深 OFFSET、`%关键词%` 搜索和 10 万以上资料库的性能演进。
- 接管分支的 PowerShell 换行与 Windows 8.3/长路径断言已修复；`main@2bc1359` 的 Windows CI 已在重跑后全绿。
- 2026-08-18 用户明确将重复清理改为效率优先：快速路径接受同大小同缓存时长但内容不同造成误删的风险；真实 SMB/映射盘断线和部分失败行为仍需实机验证。

未在代码、测试或人工证据中确认的能力必须标记“需要验证”，不能由历史计划推断为已完成。
