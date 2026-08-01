# AI 开发交付工作流

开始新任务时，AI 先检查 `git status`，保留现有修改，并从当前开发基准创建清晰的功能分支：

```powershell
git switch -c ai/<task-name>
```

开发和测试完成后，在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/finish-and-push.ps1 -Message "fix: describe the completed change"
```

脚本会识别仓库和分支、阻止受保护分支及敏感/生成文件，根据 `package.json` 运行现有质量检查，执行 `git diff --check`，提交修改，安全同步远程同名分支并推送。没有修改时不会创建空提交。

如果 rebase 出现冲突，脚本会停止且不会推送，也不会自动选择任何一方。维护者应逐个确认冲突文件，完成 `git rebase --continue` 后重新运行脚本。禁止强制推送，因为它可能覆盖其他开发者已经上传的提交并破坏可追溯历史。

推送成功后，在 GitHub 的分支提示中选择 **Compare & pull request**，确认变更和测试结果后创建 Pull Request；`main`/`master` 的合并继续由仓库保护规则控制。
