# AI 开发与交付规则

本文件是本项目后续 AI 程序员的固定工作约定。当前本地代码始终是开发基准；开始任务时先阅读本文件并检查当前工作区。首次接手项目还必须按 `docs/ai/START_HERE.md` 建立项目上下文。

## 工作区与分支安全

1. 不得丢弃、覆盖或回滚任何本地未提交修改。
2. 禁止 `git reset --hard`、`git clean -fd`、`git restore .`、`git checkout -- .` 和任何形式的强制推送。
3. 每项新任务优先创建独立功能分支，使用 `ai/<task-name>`，例如 `ai/scan-fix`、`ai/preview-fix`。
4. `main` 和 `master` 默认是受保护分支，不在这些分支上直接开发。用户已明确授权自动交付脚本在全部检查通过后，以普通快进推送更新 `main`；禁止强制推送。
5. 不访问其他仓库，不重新 clone；需要同步时只使用当前仓库已配置的 `origin`。

## 开发与验证

1. 开始开发前运行并检查 `git branch --show-current`、`git status --short` 和 `git remote -v`。
2. 完成修改后检查 `git diff`、`git diff --check` 和 `git status --short`。
3. 根据 `package.json` 中实际存在的脚本运行质量检查，包括 lint、typecheck、test、build、Electron smoke 和 E2E；不存在的脚本应明确记为“不适用”。
4. 不得声称未实际运行的测试已经通过。测试失败时，优先修复本次修改引起的问题；环境阻塞必须如实报告。
5. 不得提交敏感文件、凭据、运行数据库、日志、媒体缓存、依赖目录、覆盖率、临时文件或构建产物。
6. 每次交付必须新增或更新 `docs/ai/deliveries/YYYY-MM-DD-<topic>.md`，按模板记录真实修改、验证、风险和后续；不得把未运行测试写成通过。

## 自动交付

开发完成并确认修改范围后，必须运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/finish-and-push.ps1 -Message "<规范提交信息>"
```

提交信息使用以下前缀之一：`feat:`、`fix:`、`refactor:`、`test:`、`docs:`、`chore:`。

脚本会检查敏感文件、执行可用质量门禁、提交并同步功能分支，然后先为更新前的远程 `main` 创建并推送 `backup-main-<时间>-<短哈希>` 标签，再以普通快进推送更新 `main` 并核对远程 Commit。远程发生并发更新、rebase 冲突或非快进时必须停止，禁止强制推送。不得绕过失败检查；仅当本轮已经在同一工作区完整执行并记录了等价检查时，才可使用 `-SkipChecks`。只有用户明确要求本次不更新 `main` 时才使用 `-SkipMainUpdate`。

回滚不得强制把 `main` 指针倒退。应从对应 `backup-main-*` 标签创建修复分支，或对问题提交执行 `git revert`，通过新的正常提交恢复。

以后每次开发固定执行：阅读 `AGENTS.md`（首次接手再读 `docs/ai/START_HERE.md`）→ 检查工作区 → 创建功能分支 → 完成开发 → 写交付记录 → 运行测试 → 运行 `finish-and-push.ps1` → 备份旧 `main` → 更新 GitHub `main` → 只报告关键结果和备份标签。

## 桌面端可用性交付（强制）

凡是会影响 Electron 桌面端行为或界面的任务，代码提交和推送不代表用户已经拿到新版本。交付前必须同时完成：

1. 使用当前交付分支重新生成 `release/win-unpacked` 桌面包，不得沿用修改前的旧包。
2. 检查用户桌面快捷方式的真实目标，确保它指向刚生成的可执行文件；不能只检查源码目录或开发启动脚本。
3. 比较 Commit 时间、`app.asar` 时间和快捷方式目标，确认三者属于本轮交付。
4. 必须从用户实际使用的桌面快捷方式启动程序，并人工验证本轮关键入口和界面确实存在。
5. 如果没有完成重新打包和快捷方式启动验证，最终报告必须明确写“桌面版本尚未交付”，不得声称任务已完成或用户已可使用。
6. 最终回复增加桌面交付结果：安装包路径、快捷方式目标、实际启动验证项。

这条规则用于避免“源码已更新，但桌面快捷方式仍启动旧包”的重复交付事故，不能因测试、Commit、Push 或 PR 已成功而跳过。

最终回复只包含：当前分支、Commit、Push 结果、修改摘要、测试结果和阻塞项。不要重新复述整份需求或输出冗长开发过程。

## CloudDrive2 Phase 1 约束

CloudDrive2 开发还必须遵守相邻交接包 `movie-clouddrive-ai-developer-handoff/` 中的任务书和 API 指南。当前只实施 Phase 1；验证完成后停止，不得自动进入 MediaSourceProvider、原生播放、增量同步或原生文件操作等后续阶段。

- 将 `phase1-optimization/cloud-drive-optimization.patch` 视为候选实现，先与当前 `main` 审查和语义合并，不得直接覆盖较新的仓库逻辑。
- CloudDrive 挂载目录通过 `GetMountPoints` 映射 mount 与 `sourceDir`，通过流式 `GetSubFiles` 扫描，并使用 API 返回的 `size` / `writeTime`，避免逐视频 `fs.stat()`。
- 本地硬盘、NAS、SMB 和现有 SQLite Windows 路径行为必须保持不变。
- CloudDrive RPC 部分失败、超时或取消时，不得用不完整结果执行 missing reconciliation。
- Token、JWT、敏感 Header 不得进入 Renderer、日志或源码，不得硬编码凭据。
- 实际服务器对应的 `clouddrive.proto` 和实测行为优先于交接文档；差异必须记录。
- 增补并执行挂载路径、大小写/尾斜杠/根路径、Unicode/空格、gRPC 分帧、大空目录、超时/取消/错误以及失败扫描安全性的测试。
- Phase 1 完成报告必须包含：完成内容、修改文件、架构变化、实际测试结果、风险和下一步；未运行的真实 CloudDrive2 E2E 必须标记为 `NOT RUN`。
