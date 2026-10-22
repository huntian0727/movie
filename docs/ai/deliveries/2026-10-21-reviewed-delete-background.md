# 重复文件清理后台化（本地开发交付）

**工作区**：家用 PC `MP2T8QB5`，仓库 `C:\Users\test\Documents\视频管理\movie`，基于 `ai/duplicate-cloud-delete-speed`。
**发布状态**：严格本地，不推送 GitHub，不发布公开版本；不得拿用户已有影视资料做自动化删除测试。

## 需求

原始“清理当前页”的删除请求始终挂起 UI 弹窗、无法顺畅切换模块。用户要求保留点击确认后将删除转入后台执行，页面可正常浏览、目录筛选、播放；可跨页面查看已确认进度、失败和云盘结果未知项。

## 实际实现

- 新增 `src/main/media/reviewedDuplicateBackground.ts`：独立主进程任务队列；确认后 `submit(plan)` 立即返回包含任务 ID 与状态的回执，底层以 `setImmediate` 异步运行。
- 分批最多 30 个文件，逐批复用既有安全核对删除 `deleteReviewedDuplicatePlan`，仍按“文件大小完全相等 + 时长四舍五入到整秒相同”判重，**没有内容哈希**。CloudDrive 删除仍沿用既有最多三个受控并发及远端 providerFileId/path/size/mtime 核查、保留文件检查、结果未知不重试保护。
- Electron IPC 新增 `duplicate:background-submit` 与 `duplicate:background-status`；main 同步进行重复组计划校验和后台任务占用检查后才确认受理；单次最多 500 个目标。
- 一个时刻只有一个受控后台任务，其他重复清理任务的提交/确认/重试/继续被安全拒绝；普通资料库内其他操作和播放器不阻断。
- 任务记录存储于应用 userData 的 `reviewed-duplicate-background.json`，按每批结果原子更新；应用重新启动时如记录仍在 running，标记 `interrupted`、剩余结果需要核实，**绝不自动续删/重放未知 RPC**。
- React 重复文件页将单文件与当前页清理都改为调用后台提交，收到受理结果后立即关闭确认弹窗；不再循环等待本页所有批次结束。全局 `LibraryShell` 每 1.5 秒读取任务状态并显示 `ReviewedBackgroundStatus`，任意视图可看到进度或展开失败原因。任务结束后刷新重复页/视频页列表。
- 用户应在任务完成前保持应用开启；最小化及切换视图不妨碍任务，**关闭应用不等于程序关闭后自动继续清理**。
- 构建脚本新增 `MOVIE_SAFE_STAGE_LOCAL=background` 输出至 `release/local-background/win-unpacked`，避免覆盖可能正在进行清理的旧程序。只有经过验证才更新日常桌面快捷方式；用户自行等旧任务结束再重启。
- `src/renderer/styles.css` 添加低干扰全局状态栏样式。
- `docs/USER_GUIDE.md`、`CHANGELOG.md` 更新本地未公开说明。

## 验证结果

- `npm run typecheck` PASS。
- `tests/main/reviewedDuplicateBackground.test.ts` 覆盖立即返回、30 项分批、拒绝重复提交、断连结果未知、重启后状态中断、不自动重试、重复目标和保留者保护。
- `tests/renderer/DuplicateGroupsPage.test.tsx` 覆盖单文件与当前页后台受理后立即关闭弹窗、旧同步路径不调用。
- `tests/renderer/ReviewedBackgroundStatus.test.tsx` 覆盖全局状态及异常详情。
- `tests/main/ipcContracts.test.ts` 固定 IPC 合约增加两个新渠道。
- 最终相关聚焦回归：`ReviewedBackgroundStatus`、`reviewedDuplicateBackground`、`ipcContracts`、`DuplicateGroupsPage`、`LibraryShell` 5 文件 **144/144 PASS**；TypeScript `npm run typecheck` PASS。
- 全套 `npm run test:node` 在补齐两个 IPC 合约预期之前执行：146 文件中 143 文件通过，**1369/1373 项通过**，4 项失败。其中 1 项为新增 IPC 名称尚未同步旧合约断言，本轮现已修复且该文件 8/8 PASS；另 3 项为既有发行审批冻结版本 0.1.15 与当前 0.1.16 及 package-lock SHA256 不匹配，**不擅自修改发行批准记录**。新 UI 状态组件的 2 项测试在全量执行后新增，已在单独聚焦回归通过。
- CloudDrive 远端 API 只在 mock 环境模拟删除，测试没有发送实际用户影片删除请求。

## 风险与下一步

1. JavaScript 主进程仍可能受到较重本地 SQLite/目录操作影响，前端可继续交互但不能保证在所有设备 100% 无瞬时卡顿；后续需要独立性能实测。
2. 单个后台运行任务占用应用生命周期；如果使用者主动退出，最后进行中的批次按结果未知保守处理，重启不自动继续。
3. 只保留最近一次任务的详细记录，旧的成熟两阶段任务中心独立保留；本期不提供“暂停”“取消”按钮以免在网络 RPC 执行中留下无法确认的删除结果。
4. 不能在当前用户真实网盘上无人值守测试删除；正式验收先使用无关紧要的测试媒体副本。
