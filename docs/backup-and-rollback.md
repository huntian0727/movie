# 映匣开发备份与回滚

本机制同时保护代码版本、SQLite 资料库和软件设置。它不复制原始视频，也不备份可重建的预览缓存、日志、依赖或构建目录。

## 开发前创建快照

工作区必须干净。每次开发在创建功能分支、修改文件前运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Create -Label "任务名称"
```

默认备份位置是 Windows“文档”目录下的 `映匣备份`。每个快照包含：

- SQLite 在线备份生成的独立 `library.sqlite`，不会直接拆分复制 WAL 文件；
- `settings.json`；其中可能含 CloudDrive Token，备份目录应视为敏感私人数据；
- 当前 Commit 可离线恢复的 `source.bundle`；
- Git 分支、Commit、checkpoint 标签及标签推送结果；
- Schema 版本、视频数量、来源数量、未解决异常数；
- 每个文件的 SHA-256、大小和 SQLite `quick_check` 结果；
- `manifest.json` 和总索引 `backup-index.json`。

如果需要给稳定版本同时保存安装包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Create -Label "stable-版本说明" -IncludeInstaller
```

## 查看和验证

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action List
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Verify -Snapshot "快照ID"
```

`Verify` 会重新计算全部备份文件的 SHA-256，并再次运行 SQLite `quick_check`。快照 ID 带完整日期与时间，可以精确定位某一天的某次开发。

## 恢复资料库和设置

先完全退出映匣，然后运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Restore -Snapshot "快照ID"
```

恢复流程固定执行：

1. 确认没有 `Local Video Manager.exe` 进程；
2. 校验目标快照的哈希和 SQLite 完整性；
3. 为当前数据库和设置自动创建一个 `pre-restore` 快照；
4. 在用户数据目录内准备替换文件；
5. 移走当前数据库、WAL、SHM 和设置，再原子放入备份数据库；
6. 重新运行完整性检查；
7. 任一步失败时把原文件放回。

若快照包含安装包，可同时恢复配套程序：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Restore -Snapshot "快照ID" -InstallSnapshot
```

恢复会丢失快照日期之后新增的索引、收藏、播放记录和设置，因此执行前自动生成的 `pre-restore` 快照必须保留。

## 恢复代码

不允许强制倒退 `main`。从目标快照的 checkpoint 标签创建安全回滚分支：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action RollbackCode -Snapshot "快照ID"
```

确认旧版本满足要求后，使用普通提交或 `git revert` 完成交付。若本地 Git 仓库损坏，可从快照中的 `source.bundle` 恢复。

## 空间与保留策略

资料库当前较大，每个数据快照可能接近 1 GB。本版不会自动删除任何备份。建议人工保留：

- 最近 20 次开发快照；
- 最近 12 个每周快照；
- 每月和重要稳定版本长期保留；
- 删除旧快照前，至少验证一个更新快照和一个稳定快照。

自动清理属于破坏性操作，后续只有在备份界面能够清楚预览删除范围并要求确认后再增加。
