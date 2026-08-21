# 文档索引

首次接手的 AI 从 [`ai/START_HERE.md`](ai/START_HERE.md) 开始，再按其中顺序读取当前状态、代码地图、风险与架构。历史设计文档保留为决策背景，不能覆盖当前代码和验证记录。

| 文档 | 用途 |
| --- | --- |
| `ai/START_HERE.md` | 新 AI 的第一入口、阅读顺序、事实验证与完成定义 |
| `ai/CURRENT_STATE.md` | 当前技术/功能基线、最近重点和待验证边界 |
| `ai/CODE_MAP.md` | 模块关系与自然语言需求到代码/测试的定位表 |
| `ai/KNOWN_RISKS.md` | 文件、扫描、数据库、IPC、缓存、ABI 等高风险不变量 |
| `ai/deliveries/` | 每次 AI 更新的背景、修改、真实验证和后续风险 |
| `decisions/` | 当前仍有效的关键架构与交付决策 |
| `scan-modes-and-snapshots.md` | 三种扫描模式、v5 快照、异常恢复、路径与缺失安全不变量 |
| `verification-results.md` | 已实际运行命令、自动测试结果、ABI 阻塞和待手测证据 |
| `manual-test-checklist.md` | Windows、真实媒体、网盘、播放器与高风险文件操作手测 |
| `windows-release-checklist.md` | 发布前数据安全和真实环境签字门禁 |
| `native-abi-workflow.md` | Node/Electron 的 better-sqlite3 ABI 隔离与恢复 |
| `electron-security.md` | 窗口角色、preload、IPC sender、CSP 与协议安全边界 |
| `release-workflow.md` | CI、打包、签名、artifact 与 smoke 流程 |
| `feature-audit.md` | 功能现状、风险和历史审计（注意各节更新时间） |
| `features.md` | 产品行为和验收标准 |
| `plans/`、`superpowers/plans/` | 原始设计/实施计划；只作历史依据，偏差以架构文档为准 |

扫描本轮执行包保留在根目录 `movie-scan-optimization-execution-pack/`，其中任务规格与验收清单是 2026-08-01 扫描优化的交付依据；真实实施结果记录在 `scan-optimization-final-report.md`。
