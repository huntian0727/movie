# 当前项目状态

更新时间：2026-08-16。本文只描述当前维护基线；精确 Commit 以 `git rev-parse HEAD` 和最新交付记录为准。

## 产品与技术基线

- Windows 桌面应用：Electron 33、React 18、TypeScript 5.7、Vite 6。
- 产品为 Windows Electron Desktop Only；React/Vite 仅作为 Renderer 技术栈，不再维护浏览器 demo 或假业务 fallback。
- 数据：better-sqlite3，当前 `LATEST_SCHEMA_VERSION = 8`；electron-store 保存应用设置。v8 只增加四个 nullable codec 字段，不批量探测历史视频。
- 媒体：静态 FFprobe/FFmpeg 读取元数据和生成缓存；可选 mpv；最终可回退系统默认播放器。
- 测试：Vitest、Testing Library、jsdom，以及 Electron/打包 smoke 和 Windows 发布门禁脚本。
- 工具链固定为 Node 22.23.1、npm 10.9.8。Node 测试与 Electron native ABI 必须使用隔离 checkout/worktree。

## 已实现的主流程

- 源目录可添加、重扫、移除；允许父目录和显式子目录重叠，视频归属最具体的源目录。
- 扫描按目录持久化快照与异常；当前目录增量扫描、异常重试、全部源目录扫描是三个独立入口。
- 新视频先快速入库，再由单并发 MetadataQueue 后台读取元数据。
- 普通资料库和重复项均在 SQLite 分页；资料库支持搜索、排序、目录、收藏、最近播放和待删除视图。
- 重复项正式规则是“缓存的精确大小 + 精确时长”，不读取视频内容或生成新指纹；时长未就绪的文件不参与分组。
- 重复项永久清理由 schema v7 持久后台任务执行，提交前与实际删除前继续检查存在性、大小和修改时间。
- 播放支持 native → mpv → 系统默认播放器 fallback；`auto` 使用容器+codec 保守路由，历史 ready 视频仅在首次实际播放时懒补全 codec，失败时不阻塞会话并转向 mpv；播放器队列有界并由主进程按当前资料库记录解析。
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

## 仍需验证或推进

- 真实 CloudDrive2 服务器、SMB/映射盘长阻塞、断线和十万级目录的完整 E2E。
- 真实旧用户数据库副本从旧 schema 升级、失败恢复和多实例竞争。
- 多格式媒体、mpv 缺失、系统文件关联、旋转铺满、双窗口高频状态同步。
- 两个真实物理卷、ACL、文件独占、磁盘满、跨卷移动和不可逆删除的人工证据。
- 签名安装包、上一正式版本升级、干净 Windows VM 安装/卸载。
- 超深 OFFSET、`%关键词%` 搜索和 10 万以上资料库的性能演进。

未在代码、测试或人工证据中确认的能力必须标记“需要验证”，不能由历史计划推断为已完成。
