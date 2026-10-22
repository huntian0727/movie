# 重复文件后台清理列表即时隐藏、全量清理退出目录（v1.2）

## 背景与边界

用户实测 v1.1 后台删除速度已经改善，但确认清理后排队文件仍留在重复列表，导致误以为尚未清理；单页覆盖整个选中目录时仍需额外点击「显示全部」。
家用电脑 MP2T8QB5，repo `C:\Users\test\Documents\视频管理\movie`，基准 `3163279`，分支 `ai/duplicate-queued-list-ux`。仅本机改动，不推 GitHub、不公开发版，不对真实视频做自动删除。

## 改动

1. 主进程 `ReviewedDuplicateBackgroundQueue.submit` 返回并持久化已受理目标的 `queuedVideoIds`，而非通过前端猜测或用文件名推断目标。
2. 独立纯展示层 `queuedDuplicateVisibility.ts` 在 job running 时以 ID 临时隐藏排队文件，不改 DB、不动媒体。如果一个重复组隐藏后剩余少于两份则不再显示为重复组；多份时保留安全的推荐保留者和清理空间估计，其他组复用原对象以减少不必要渲染。
3. `LibraryShell` 收到后台受理结果时立刻更新排队视图；后台状态跨页面保持，每 1.5 秒轮询。任务结束后触发重复文件和视频列表查询，并继续临时隐藏直到**后端查询成功返回**，避免成功删除项的旧页面闪现；明确失败、未提交文件由刷新后的真实数据重新显示。断连时不自动重试。
4. `DuplicateGroupsPage` 当确认清理范围覆盖整个过滤目录（处于第一页、总页数只有一页且提交目标完整）时，自动退出**浏览目录筛选**；保留数据库中的「优先保留此目录」规则，不把它当作筛选一起删除。多页范围只清理当前页时不跳走，提供下一页候选快捷入口。
5. 页面顶部给出排队隐藏提示，页计数标注数据库原始统计仍含排队项，整页隐藏时不会误报「没有重复文件」。
6. 双段可见版本只递增一次 `v1.1 → v1.2`，保留技术包版本 `0.1.16` 和既有正式发行安全门禁。

## 质量与风险

- 开发前本地备份 `2026-10-21_06-08-58-526_duplicate-queued-list-ux`，363216 条视频，SQLite quick_check=ok，checkpoint `checkpoint-20261021-140857-3163279-duplicate-queued-list-ux`。
- 初轮 TypeScript typecheck PASS；专项回归四文件 141/141 PASS（包括隐藏入队、完成/失败恢复、单页自动退出、多页保留范围、跨页 UI、后台队列持久化）。
- v1.2 升级后 `npm run typecheck` PASS；6 个专项测试文件 **163/163 PASS**：包括跨页面列表立即隐藏、完整筛选目录退出、其他页未清理时保留目录、排队保留项安全、后台已受理目标 ID 复用与版本升级规则。测试中 React 旧异步状态警告不影响结果。
- 本轮实测 `npm run typecheck` PASS；5 个专项测试文件 **148/148 PASS**（LibraryShell 73、DuplicateGroupsPage 60、后台队列 5、版本 7、排队隐藏纯函数 3）。React 测试里有既存 `act(...)` 警告，不影响通过结果。全量 148 文件回归未重跑；早前 v1.1 全量 1379/1382、发行门禁旧版问题 3 项失败，原因是冻结批准文件与当前技术版本/依赖锁哈希失配，本轮没有绕过门禁。
- `npm run package:development` 实际成功；桌面日常版 `release/win-unpacked` 已更新并从桌面快捷方式启动。`resources/build-flavor.json` 显示 `displayVersion=1.2`、构建代码 commit `c79402c1f904e80b7188eb1d313c101b2ad96ba0`（之后只新增了文档交接提交，不涉及程序代码）、`workspaceDirty=false`；新旧 `app.asar` 与 staging SHA-256 一致；桌面快捷方式指向本次 `release/win-unpacked\\拉面影视.exe`。更新前目录备份为 `.tmp\\canonical-before-v1-2-duplicate-ux-20261021-145154`。
- 本轮未发起真实视频删除；检查到已持久化的上次后台任务为 `completed`，才执行桌面更新。未推送 GitHub、未公开发布。
- 全项目发行批准档案已有三项历史失配（冻结批准的技术版 0.1.15 与当前 0.1.16/依赖 SHA），本次不绕过、不伪造批准、不尝试公开发布。
- 云盘实际删除由用户小范围测试；本轮没有对真实文件发删除请求。
