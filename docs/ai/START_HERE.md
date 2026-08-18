# 新 AI 接手入口

这是任何首次接手“映匣”项目的 AI 必须先读的文件。目标不是一次读完整个仓库，而是用最短路径建立可靠上下文，并知道哪些结论必须回到代码和测试验证。

## 先确认你正在正确的位置

- Git 仓库根目录：`C:\Users\test\Documents\视频管理\movie`
- 本地工作区是开发基准；不要重新 clone，也不要覆盖或丢弃未提交修改。
- 开始任务先运行 `git branch --show-current`、`git status --short`、`git remote -v`。
- 完整安全与交付规则见根目录 `AGENTS.md`，它的约束高于本目录中的说明。
- 本地运行状态、任务包、角色职责和 Agent handoff 见 `.agent/`；可复用角色流程见 `skills/movie-*`。`docs/ai/` 继续保存长期项目事实，两者不要混用。

## 首次阅读顺序

1. `AGENTS.md`：不可违反的工作区、测试、桌面交付和 Git 规则。
2. `.agent/context/PROJECT_SNAPSHOT.md`：低成本缓存，只用于快速建立项目模型。
3. 当前 task、角色规则和最新 required handoff。
4. `docs/ai/CODE_MAP.md`：定位 3–8 个直接相关的代码和测试文件。
5. 只有发生冲突、高风险或证据不足时，再展开 `CURRENT_STATE`、`KNOWN_RISKS`、架构和历史交付。

不要把 `docs/plans/`、`docs/superpowers/plans/` 或历史执行包当作当前事实。它们保存设计背景；如果与代码、迁移、测试或最新交付记录冲突，以当前代码为准，并在交付记录中说明偏差。

## 五分钟建立项目模型

映匣是 Windows Electron 本地视频资料库。源视频始终留在用户磁盘或映射网盘；SQLite 只保存索引和用户状态，封面与时间轴是可重建缓存。React renderer 不直接访问 Node、磁盘或数据库，而是通过 sandboxed preload 和经过校验的 IPC 调用主进程服务。

```text
React renderer
  -> preload/contextBridge
  -> ipcMain + Zod 校验
  -> repository / scan / metadata / file / player / cache services
  -> SQLite、文件系统、FFprobe/FFmpeg、mpv 或系统播放器
```

最重要的维护原则：

- 源视频是事实源；数据库和缓存不能反过来证明磁盘文件仍然安全可删。
- 文件永久删除、移动、重命名都必须在主进程按 video id 反查路径并进行最终校验。
- 网络盘读取昂贵且不稳定；扫描优化不能用不完整结果执行 missing 对账。
- SQLite schema 只能通过有序迁移演进，升级前备份，失败必须回滚。
- renderer、preload、IPC、shared 类型和 repository 是一条跨进程契约链。
- 自动测试不能替代真实 Windows、真实媒体、映射盘和桌面快捷方式验收。

## 开始修改前如何验证事实

1. 用 `rg` 搜索实际类型、IPC channel、handler、repository 方法和测试，不能仅按文档猜测。
2. 查看 `src/main/db/migrations/index.ts` 的 `LATEST_SCHEMA_VERSION`，不要引用旧文档中的版本号。
3. 查看 `package.json` 的实际脚本和固定 Node/npm 版本；不要假定本机全局版本可用。
4. 查看最近提交和 `docs/ai/deliveries/`，区分“已合并代码”“已自动测试”和“已真实桌面验证”。
5. 若报告与代码不一致，把差异写入本轮交付记录；不静默沿用过期结论。

## 完成任务时

- 更新受影响模块 README、`TASK.md`/`CHANGELOG.md` 中真正发生变化的部分。
- 在 `docs/ai/deliveries/` 新建一份交付记录，使用 `TEMPLATE.md` 的固定结构，写清真实验证和剩余风险。
- 执行项目质量检查；影响 Electron 行为或界面的任务还要重新打包并从用户桌面快捷方式验证。
- 最后按 `AGENTS.md` 运行 `scripts/finish-and-push.ps1`。脚本会阻止缺少本轮交付记录的提交。

## 发生矛盾时的可信度顺序

当前可执行代码 > migrations > 当前自动测试 > Git > 最新正式文档 > `PROJECT_SNAPSHOT` > 历史计划/审查/聊天记录。任何“通过”都必须能指出实际执行的命令或人工证据。
