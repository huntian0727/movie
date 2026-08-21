# 当前项目状态

更新时间：2026-08-18。本文只描述当前维护基线；精确 Commit 以 `git rev-parse HEAD` 和最新交付记录为准。

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
- 重复页默认提供效率优先的“一键永久删除候选移除项”：按当前缓存的精确大小+时长生成 keep/delete 计划，主进程重新验证组归属与“每组只保留一个”，随后跳过 SHA-256 和二次确认直接永久删除。schema v10 的完整 SHA-256 两阶段任务仍保留为可选安全模式及历史任务处理能力。
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
