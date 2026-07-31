# 文档索引

面向维护 AI 的阅读顺序：先读根目录 `README.md` 与 `ARCHITECTURE.md`，再按问题进入下列专题。历史设计文档保留为决策背景，不能覆盖当前代码和验证记录。

| 文档 | 用途 |
| --- | --- |
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
