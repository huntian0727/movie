---
date: 2026-09-22
branch: ai/project-backup-rollback-v1
type: feat
status: completed
---

# 项目备份与回滚机制 V1

## Context

映匣需要在每次开发前保留可验证的代码、资料库与设置检查点，并能安全恢复到指定快照，避免一次调整不满意时只能手工查找旧安装包或直接覆盖现有数据。

## Changes

- 新增 `scripts/project-backup.ps1`，统一提供 Create、List、Verify、Restore 与 RollbackCode 操作。
- 新增 `scripts/project-backup.mjs`，使用 SQLite 在线备份 API 生成一致的独立数据库副本，不复制视频、缓存或日志。
- 每个开发检查点记录 Git 分支、commit、annotated tag、工作区状态、应用版本、数据库统计和每个备份文件的 SHA-256。
- 恢复前强制确认应用已关闭、验证备份完整性，并自动创建“恢复前快照”；恢复失败时回滚原数据库与设置。
- 代码回滚只创建新的 `rollback/*` 分支，不移动 main，不覆盖当前代码。
- 更新开发工作流与 Agent 入口文档，把开发前检查点设为强制步骤。
- 新增使用与灾难恢复说明 `docs/backup-and-rollback.md`。
- 已创建并验证真实资料库基线快照：`2026-09-22_14-15-37-271_backup-system-v1-baseline`，包含 342652 条视频记录，SQLite `quick_check=ok`。

## Verification

- `tests/scripts/projectBackup.test.mjs`：PASS（5/5）。覆盖创建、列出、校验、恢复前自动备份、未确认拒绝恢复、篡改检测与 PowerShell/Git 检查点集成。
- 真实资料库快照校验：PASS；schema 13，342652 条视频记录，`quick_check=ok`。
- `npm run typecheck`：PASS。
- `npm test`：680/681 首轮通过；既有 Asset Center 32 万记录性能门槛在备份后的高磁盘负载下首轮为 2999 ms，空闲状态单独复测为 1435 ms 并通过 2000 ms 门槛。其余 680 项全部通过。
- `npm run dist:win`：PASS；生成 Windows NSIS 安装包。
- `npm run verify:artifact`：PASS；3983 个 asar 条目，无禁止的开发文件。
- `npm run test:packaged-smoke`：PASS；打包应用、数据库、Renderer、预览图、媒体工具和 Worker 查询均通过。
- 静默安装：PASS，安装器退出码 0，已更新用户目录中的 `Local Video Manager.exe`。

## Risks and follow-up

- V1 不自动清理旧备份，避免自动删除唯一可用恢复点；空间管理由用户确认后手工执行。
- 设置备份可能包含 CloudDrive Token，备份目录应仅由当前 Windows 用户访问，不应上传公共网盘或公开仓库。
- 数据回滚要求映匣完全退出；脚本会检测正在运行的 `Local Video Manager.exe` 并拒绝继续。
- 备份只保存索引数据库和设置，不复制原始视频文件，因此不能恢复已经从磁盘或网盘永久删除的视频内容。
