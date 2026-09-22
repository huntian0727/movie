# AI 开发交付工作流

开始新任务时，AI 先检查 `git status`，保留现有修改。工作区干净后，必须在修改文件和创建功能分支前生成开发 checkpoint：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-backup.ps1 -Action Create -Label "<task-name>"
```

该命令会创建并尽力推送 Git checkpoint 标签，保存可离线恢复的源码 bundle，使用 SQLite 在线备份生成一致的 `library.sqlite` 快照，复制设置并写入带 SHA-256 的 manifest。视频、预览缓存、日志、依赖和构建产物不会进入备份。备份失败时停止开发。

备份成功后，从当前开发基准创建清晰的功能分支：

```powershell
git switch -c ai/<task-name>
```

开发和测试完成后，在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/finish-and-push.ps1 -Message "fix: describe the completed change"
```

脚本会识别仓库和分支、阻止在受保护分支直接开发及敏感/生成文件，根据 `package.json` 运行现有质量检查，执行 `git diff --check`，提交修改并安全同步远程同名分支。随后它会先把更新前的远程 `main` 保存为 `backup-main-<时间>-<短哈希>` 标签并推送，再用普通快进推送更新 `main`，最后核对远程 Commit。没有修改时不会创建空提交。

如果 rebase 出现冲突、远程 `main` 在执行期间被其他人更新，或更新不是快进，脚本会停止且不会强制推送，也不会自动选择任何一方。维护者应逐个确认冲突文件，完成 `git rebase --continue` 后重新运行脚本。备份标签即使已经推送也可以安全保留。

需要回滚时，从对应备份标签创建修复分支，或者用 `git revert` 生成反向提交；禁止强制把 `main` 倒退。若仓库启用了必须 Pull Request 的分支保护，脚本会在 `main` 推送处停止，此时使用已推送的功能分支创建 Pull Request。

项目数据和设置回滚使用 `scripts/project-backup.ps1`，完整说明见 `docs/backup-and-rollback.md`。恢复脚本会拒绝在映匣运行时替换数据库，并会在恢复前再创建一个安全快照。
