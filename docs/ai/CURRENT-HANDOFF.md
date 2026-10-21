# 当前开发交接：v1.2 重复清理与隔离故障联动 QA

更新时间：2026-10-21（北京时间）

## 最新进展（2026-10-21 下午，QA-only）

- 在家用电脑 `MP2T8QB5` 继续验证，没有修改生产逻辑或 v1.2 显示版本。
- 当前开发分支：`ai/duplicate-background-fault-qa`，基于 `1f526c4` 创建；新会话仍以 `git rev-parse HEAD` 为准。
- 开发前创建**仅本地** checkpoint `checkpoint-20261021-155122-1f526c4-duplicate-background-fault-qa`、数据快照 `2026-10-21_07-51-24-244_duplicate-background-fault-qa`（SQLite quick_check=ok）。
- 新增 2 条真实临时 SQLite + 模拟 CloudDrive 的跨批次测试：明确拒绝产生 `partial`（34 成功/1 失败），请求后断连产生 `blocked`（32 成功/1 未知/2 未提交）；保留文件、失败/未知/未提交索引均按规则保留；重启不自动重试。
- 本轮 `npm run typecheck` PASS；专项 3 文件 25/25 PASS，扩展 6 文件 77/77 PASS。真正 CloudDrive/115 服务器测试 NOT RUN。
- 最新详情：`docs/ai/deliveries/2026-10-21-duplicate-background-fault-qa.md`。只允许本地提交，不推送 GitHub、不公开发版；下一次常规用户可见功能改动才升级 v1.3。

## 最新补充验收

- v1.2 日常打包程序已完成隔离双阶段 packaged smoke，结果 PASS；原快捷方式及日常程序未替换。
- 只读核查数据库：v16、363216 视频、7 个 CloudDrive 来源和 4 个本地来源；本地 API TCP 可连接，未做真正的服务端删除。
- 原备份再次 Verify PASS；本阶段未修改生产代码。详情见 `docs/ai/deliveries/2026-10-21-duplicate-background-fault-qa.md`。

## 最新非删除测试（2026-10-21，用户要求暂缓真实删除）

- 本轮只测试播放器、字幕、扫描、数据库迁移、Windows 文件操作、性能和 CloudDrive 安全逻辑，不操作真实影片和删除 API。
- 37 个测试文件 **466/466** 条 Vitest 用例通过；额外 Electron 主进程 smoke PASS。320k 构造数据性能门禁 4/4 PASS。
- 测试记录：`docs/ai/deliveries/2026-10-21-v12-nondestructive-regression.md`。旧全量回归的 3 项发行批准证据失配仍未处理；不推送、不正式发布。
- 用户已明确暂缓实际 115 删除测试，后续优先其他低风险项目，**不要再要求提供测试目录**。

## 新会话先读

1. `AGENTS.md`：开发、备份、测试和交付规则。
2. 本文件：当前真实开发节点。
3. `docs/ai/START_HERE.md` 与 `docs/ai/CURRENT_STATE.md`：项目入口和长期状态。
4. `docs/ai/deliveries/2026-10-21-duplicate-queued-list-ux.md`：本功能完整变更、测试及交付记录。

## 当前基线

- 家用电脑：`MP2T8QB5`；仓库：`C:\Users\test\Documents\视频管理\movie`。
- 当前分支：`ai/duplicate-background-fault-qa`（仅测试与文档）；原 v1.2 功能完成于 `ai/duplicate-queued-list-ux`。
- 功能实现提交：`c79402c1f904e80b7188eb1d313c101b2ad96ba0`（`feat: hide queued duplicate videos and exit completed folder scope`）。之后新增文档交接提交和隔离故障联动测试提交；新会话开始时请以 `git rev-parse HEAD` 读取最新 HEAD，不要依赖本文件里的固定 HEAD 值。
- 当前工作区：干净。
- 用户可见版本：`v1.2`；技术包版本仍为 `0.1.16`。
- `release/win-unpacked/resources/build-flavor.json` 已核实：`displayVersion=1.2`、构建代码 commit 为 `c79402c1f904e80b7188eb1d313c101b2ad96ba0`、`workspaceDirty=false`。随后只增加了文档和测试，未修改程序代码。桌面快捷方式目标存在，指向 `release/win-unpacked\拉面影视.exe`；上一份交付记录说明该桌面版已启动核对。
- **只做本地开发；未推送 GitHub、未公开发布。** 不要运行会推送远端的自动交付流程，除非用户重新明确授权。

## 本轮完成内容

用户希望重复文件进入后台清理队列后立即从当前列表暂时隐藏；如果一次清理完整覆盖当前筛选目录，则自动退出目录浏览筛选，避免反复手动点击“显示全部”。

- 后台队列记录已确认入队的 `queuedVideoIds`；前端只根据视频 ID 临时隐藏，**不提前修改数据库或删除文件**。
- 若隐藏后某重复组只剩 0/1 个文件，该组暂不显示为重复组；任务结束后刷新真实索引，成功文件消失，失败/未提交文件按真实数据重新显示。
- 后台任务状态跨页面保持并轮询；整页入队有明确提示，避免误认为“没有重复项”。
- 只有当前处于第一页、筛选目录结果恰好一页且本次提交覆盖全部目标时，才自动清除“浏览目录筛选”。数据库保存的“优先保留此目录”偏好保留不动；多页只清理当前页时不自动跳走。
- 候选识别规则仍为精确文件大小 + 四舍五入到整秒的时长，不计算哈希。旧的未经核对快速删除通道继续禁用。

## 主要修改文件

- `src/shared/videoTypes.ts`
- `src/main/media/reviewedDuplicateBackground.ts`
- `src/renderer/components/queuedDuplicateVisibility.ts`（新）
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/DuplicateGroupsPage.tsx`
- `tests/renderer/queuedDuplicateVisibility.test.ts`
- `tests/renderer/LibraryShell.test.tsx`
- `tests/renderer/DuplicateGroupsPage.test.tsx`
- `tests/main/reviewedDuplicateBackground.test.ts`
- `tests/scripts/displayVersion.test.mjs`
- `CHANGELOG.md`、`docs/USER_GUIDE.md`、`docs/DEVELOPMENT_AND_RELEASE.md` 与本轮交付记录。

## 本轮验证

本次交接前实际重新执行：

- `npm run typecheck`：PASS。
- `npx vitest run tests/renderer/LibraryShell.test.tsx tests/renderer/DuplicateGroupsPage.test.tsx tests/main/reviewedDuplicateBackground.test.ts tests/renderer/queuedDuplicateVisibility.test.ts tests/scripts/displayVersion.test.mjs`：PASS，5 个测试文件、148/148 测试通过。React 测试输出少量既有 `act(...)` 警告，不影响通过。
- 全量测试套件未在本次交接前重跑；正式发布门禁也未执行。
- 没有在本轮对真实视频发起删除请求。构建和桌面版验收详情见上面的交付记录。

## 下一步与注意事项

1. 这项用户要求的列表即时隐藏、目录筛选自动退出已实现并通过专项测试，不要从头重复开发。
2. 若用户反馈新问题，先检查当前分支、HEAD、工作区和最新交付记录；开始新代码修改前按 `AGENTS.md` 建立新的本地备份 checkpoint。
3. 后续每次用户可见代码改动，按规则更新界面版本；本次已是 `v1.2`，下一次常规功能改动应递增至 `v1.3`，不要因纯文档整理再次升级版本。
4. 公开发行安全门禁仍有历史批准档案与当前技术版本/依赖哈希失配问题；本轮没有绕过门禁，也没有发布。
