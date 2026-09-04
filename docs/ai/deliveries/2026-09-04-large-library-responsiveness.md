---
date: 2026-09-04
branch: ai/nonblocking-duplicate-cleanup
type: performance
status: completed
---

# 大资料库前端流畅度优化

## Context

真实资料库约 745 MB，包含约 32 万条有效视频和 2.3 万个目录。前端的每次聚焦、定时轮询、预览图完成、搜索输入以及深页翻页都可能引发大范围 React 更新或慢 SQL；启动还在每次正常打开时执行整库完整性检查。本轮以大资料库下的操作响应为优先，不改扫描架构、CloudDrive 语义或删除规则。

## Changes

- 将 renderer 刷新改为事件驱动并合并短时间内的连续更新；窗口重新聚焦时先检查轻量序号，只在真有变化时重载。
- 主窗口扫描状态改为活跃时 1 秒、空闲时 4 秒的自适应轮询；播放窗口不再读取文件夹树、扫描状态和无关的资料库更新。
- 视频搜索增加 200 ms 防抖；全库文件夹模糊搜索最多渲染 200 条，并明确提示结果已限制。
- 目录显示改为单次构建可见 ID Set；预览图加载成功不再回写父组件大数组，避免一张图完成就重渲染整页卡片。
- schema v12 新增视频列表常用排序复合索引和预览缓存部分索引；保留任意页码跳转，不强制改为只能前后页。
- 来源文件夹统计由多个关联子查询改为一次集合聚合；缓存清理只读取真实存在的封面/时间轴路径，不再为 32 万条记录重新生成哈希标识。
- 正常且 schema 已是最新的启动不再每次执行整库 `foreign_key_check + quick_check`；异常退出、数据迁移和显式验证仍执行完整检查。
- 应用版本提升到 0.1.15，已重新打包并覆盖安装。

## Verification

- Node 22.23.1 / npm 10.9.8 下 `npm run test:release-gate`：PASS；lint、build、37 项 Windows 文件安全、32 项迁移、性能门禁和 55 个 Node 测试文件/564 项测试全部通过。
- 真实数据库的只读/备份基准：默认排序首页约 250 ms 降到 1.3 ms，接近尾页约 2.46 s 降到 43 ms，大小/时长排序首页约 285/269 ms 降到 2.3/2.4 ms。
- 缓存身份旧路径仅查询与哈希 32 万记录就需约 1.33 s；新路径仅返回真实 896 个缓存路径，并有部分索引支持。
- `npm run verify:artifact`：PASS，asar 3,962 个条目，无禁入开发产物。
- `npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130，main process ready。
- `npm run test:packaged-smoke`：PASS，数据库、扫描夹具、协议、Renderer/preload、安全边界、预览图稳定性与 FFmpeg/FFprobe 通过。
- NSIS 覆盖安装：PASS，安装器退出码 0；已安装 asar 版本为 0.1.15。
- 桌面快捷方式实启：PASS；`Local Video Manager.lnk` 指向安装目录程序，日志记录 0.1.15 启动完成，首次 v12 迁移后本次启动用时 8.364 s，主窗口 renderer 进程已运行。当前 Computer Use 未暴露原生应用表面，因此未执行图形点击式桌面手测；关键界面入口由 packaged smoke 覆盖。
- CloudDrive 真实网络与删除：NOT RUN；本轮未改动 CloudDrive 扫描、身份或删除语义。

## Risks and follow-up

- 0.1.15 首次启动会备份数据库并创建索引，真实大库本次用时 8.364 s；后续正常启动不再重复迁移或整库检查。
- 硬件加速仍因历史 GPU 兼容性策略全局禁用；本轮没有在缺少多机型数据时改动该策略。
- 更进一步的阶段可将重 SQL 读取迁入专用只读 worker，将视频网格改为真正的窗口化渲染，并为扫描/预览/删除建立统一 I/O 调度器。这些都需要单独的性能基准和兼容性回归，不宜在本次最小修复中仓促重写。
