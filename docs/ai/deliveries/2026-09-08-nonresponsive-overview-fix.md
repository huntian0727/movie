## Context

映匣在约 34 万条视频、近 3 万个目录的真实资料库中启动并进入资产中心时，Electron 主进程会同步执行资料库目录统计和导航树查询。大量 SQLite 读取占用主进程消息循环，Windows 因而可能短暂显示“本地视频管理（未响应）”。

## Changes

- 将资料库目录统计与导航快照查询迁移到现有 Asset Center 只读 Worker，避免在 Electron 主线程执行全库聚合。
- 通过 SQLite `data_version` 感知主连接提交，在数据未变化时复用 Worker 缓存，变化后自动失效并重新查询。
- Renderer 对目录列表和导航快照做结构相等判断；结果未变化时保留原引用，避免重复构建大型目录树和无效重渲染。
- 扩充打包冒烟检查，确认发行版中的 Worker 可以完成资产中心、目录列表和资料库导航查询。
- 新增 32 万视频、2.5 万目录的性能回归测试，同时约束 Worker 查询耗时和 Electron 主事件循环停顿。

## Verification

- `npm run test:release-gate`：通过，72 个测试文件、655 项测试全部成功。
- 大型资料库概览门禁：Worker 查询约 931.93 ms，主事件循环最大停顿约 22.36 ms。
- Asset Center 聚合门禁：32 万视频、100 个来源约 1721.91 ms，1 条聚合语句。
- TypeScript 类型检查、生产构建、数据库迁移测试、Windows 文件操作测试和发布性能门禁均通过。
- `npm run verify:artifact` 与 `npm run test:packaged-smoke`：通过，发行版 Worker 概览查询检查成功。
- `npm run test:installer-smoke`：通过，安装、首次启动、重启和数据库重新打开均成功。
- 已重新生成 `release/win-unpacked` 和 `Local-Video-Manager-0.1.15-x64-Setup.exe`，并更新桌面快捷方式指向最新便携发行目录。
- 通过真实桌面快捷方式启动用户资料库后连续采样 20 秒，窗口每次均为 `Responding=True`，工作集约 200–215 MB。

## Risks and follow-up

- 资产中心统计仍会产生磁盘读取，但已隔离到只读 Worker，不再阻塞窗口消息循环。
- 首次生成大型导航树仍需要 Renderer 处理一次；本次已消除数据未变化时的重复构建。若未来目录量继续显著增长，可再将树构建改为按需展开，但当前不需要重构。
- Worker 缓存依赖 SQLite `data_version`；同一 Worker 连接以外的已提交数据库更新会使缓存自动失效。
