# 当前开发交接：v0.1.16 发版准备 + v1.2 功能 QA

更新时间：2026-10-21（北京时间）
## 最新进展（2026-10-21 夜：源构建 SUCCESS，新 QA 绿色包完成）

- 用户已恢复正式发布准备授权；优先完成可自动实测内容，**不因催进度绕过原生分发审批、实际播放或真实 Windows QA**。主仓当前开发分支 `ai/native-runtime-candidate-integration`；基线 `3b73062`，最终 commit 以实时 Git 状态为准。开工前备份 snapshot `2026-10-21_14-42-15-269_native-source-runtime-qa-20261021`，checkpoint `checkpoint-20261021-224208-3b73062-native-source-runtime-qa-20261021`。
- 新源码 CI [39612312642](https://github.com/huntian0727/movie/actions/runs/39612312642) 已 **SUCCESS**，新原生运行库 26/26 文件 SHA 和 DLL 闭包通过、0 unresolved imports；25 份源码输入完整核验/恢复，244 MPV + 298 shaderc 编译源审计；FFmpeg `--disable-gpl --disable-nonfree --disable-static --enable-shared`。
- 新原生私有 ZIP SHA256 `46b7a00a9275da307efc89e320ef0c5c87a846fd020e5d1167f838a0d394447a`；对应私有源码 ZIP SHA256 `4325dc1a0d216ff89785337ab68833b0a5f6f35fcfd9795370802e1c6c621130`。相关私有附件已下载并存储于 `.tmp/native-run-39612312642/`，不发布原始候选二进制。
- 更新 `scripts/native-source-media.lock.json`、`scripts/native-source-player-runtime.lock.json` 到新精确生产运行库，`CANDIDATE_NOT_APPROVED` 和 `distributable=false` 仍为硬约束。修复旧审批与新源码锁相等的测试假设，目标是**拒绝**旧的 39 PE 批准自动覆盖新候选；该测试 47/47 PASS。**未修改**旧 `build/native-source-approval.json`、`build/release-approval.json`、`build/public-test-approval.json`。
- **最新干净 Commit QA 包**：代码/测试/文档提交 `245dc156bcf247d73e38417cb3b803f43869fcc8`，已推到 GitHub `ai/native-runtime-candidate-integration` 并创建 [Draft PR #29](https://github.com/huntian0727/movie/pull/29)。从该干净提交重新构建 `release/unsigned-test-build/拉面影视-0.1.16-x64-unsigned-test-build-Portable.zip`：214,807,755 字节，最终 SHA256 `75ee4f58d8479c1b2132c1fc3a313dcfcbbf9f4bc8bfaa84d5fc8e353e37599de9`；`dist:zip`、`verify:zip`、`release:metadata`、`test:packaged-smoke` 均 PASS（230 项文件核验，`workspaceDirty=false`，`displayVersion=1.2`，`publicReleaseApproved=false`）。此前临时 SHA `7dd193f2...` **不是最终 QA 包**。Windows CI/安全审计由 PR 触发，当前仍不是正式发行。
- `npm run test:release-gate` 已重新全量 **PASS**（终态 `wc_job_ukbAhzEPnrCjRBLD` 退出码 0），三个历史批准文件未被修改。**真实 MPV 5 种中性编码样片隔离播放 5/5 PASS**（含 H.264/HEVC/VP9、双音轨和字幕，`production-service-test.json` 0 failures）；实际人工听音仍 NOT RUN。源库本批次人工批准及正式公共绿色发行仍未完成。尚未替换日常桌面快捷方式、没有在真实资料库执行删除。详见 [独立交付记录](deliveries/2026-10-21-native-source-candidate-integration.md)。


## 当前最高优先级：发版准备（覆盖旧的发行准备状态）

用户要求：人工验收暂时没时间，先把能独立完成的发版准备做好，人工工作留到最后。

- 私有 NSIS QA 安装器构建代码提交为 `861ca815fadb65c62b68f2b7c08229e3eff0f820`；私有 portable QA ZIP 构建代码提交为 `bbc1a42ca4784bda1fee788f9ee3256b781900a7`。之后只有交接/状态文档提交；当前 HEAD 以实时 Git 查询为准，新会话先运行 `git status --short --branch`、`git rev-parse HEAD`。
- 技术版本 0.1.16，界面版本 v1.2；GitHub 最新公开版仍是 v0.1.15。没有 v0.1.16 公开 tag/Release。
- 文档准备已完成：README、快速开始、完整教程、CHANGELOG、候选发行说明、绿色版说明、Windows 下载校验指南和源码社区发布说明已统一到当前公开版 0.1.15 / 私有候选 0.1.16；不再把候选功能误写成已发布，也修正重复项并非内容哈希判定的说明。
- `npm run test:release-gate` PASS：149 个测试文件、1,391/1,391 用例；发行工程单测 74/74、媒体候选契约 67/67。
- 在隔离身份 `unsigned-test-build` 下重新构建私有 QA NSIS 安装包。 `node scripts/verify-packaged-artifact.mjs` PASS（3,469 ASAR 条目、17 份精确许可声明）；`node scripts/write-release-metadata.mjs` PASS；`npm run test:installer-smoke` PASS（安装、修复、拒绝删除应用数据、卸载；合成 SQLite/视频哨兵保留，生产注册信息与快捷方式未变）。安装器 SHA-256：`d70815daaa53ea4e87e487e280767096c14fb89ff84b6ae7d277c0be1a0a0003`。
- 当前私有安装器路径：`release/unsigned-test-build/拉面影视-0.1.16-x64-unsigned-test-build-Setup.exe`。它不是正式包，不得公开上传；日常版 `release/win-unpacked` 和桌面快捷方式未覆盖。
- 使用私有 FFmpeg-Lite REVIEW-v2 ZIP 重跑 `audit-release-readiness.mjs`，源码 ZIP 哈希核验 PASS（239,488,121 字节，SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`），但总结果 `OUTCOME=BLOCKED`。除旧审批绑定 0.1.15、package-lock 哈希不匹配、稳定 Windows/标准用户覆盖未获批准外，本轮 ZIP 所用 `source-candidate` 原生媒体锁仍为 `CANDIDATE_NOT_APPROVED`，上游生产 CI 为 FAIL、`originalCiClosureValid=false`；本地打包 smoke 不能覆盖此问题。旧 `lite-candidate` 也仍未批准，静态 LGPL/组件级许可存在待决项。当前私有安装器哈希不在历史 QA 批准记录中；该审计本身不能批准公开包。
- 私有 `unsigned-community-qa` 绿色 ZIP 已通过 `dist:zip`、`npm run verify:zip` 和 `npm run release:metadata -- --portable`；229 个文件逐项校验、双阶段 packaged smoke PASS。SHA-256：`4d8f099bf436ed3f1ac46bebe3020672786d66de4c49fb56820f15e848e9e9d1`，构建 commit `bbc1a42ca4784bda1fee788f9ee3256b781900a7`；未签名、`publicReleaseApproved=false`，仅私有 QA。
- 没有推送 GitHub、创建/推送 tag、上传或发布 Release。没有运行真实 CloudDrive/115 删除；遵守用户要求，将真实远端删除与播放器/字幕人工体验留到最后。
- 当前本地分支为 `ai/native-source-closure-fix`，基于远端 `ai/traceable-player-runtime` 的 commit `757348117960dc2e184a9c1ad5facbeca2cf2d0f`；本轮修复仅在本地分支提交，不推送。原生构建 run `39598671777` 失败于 MPV/FFmpeg 弃用警告被 `-Werror` 当作错误；本地修复仅对该类警告取消“视为错误”，并修复上游配方吞掉 Meson 失败状态的问题。固定上游配方哈希核验通过，`npm run test:native-source-build` 13+10+6=29 项通过；新代码尚无 CI 重建结果。审批范围澄清：旧 `build/native-source-approval.json` 的 `approved=true` 精确绑定 38134981406 的旧锁/ZIP/源码哈希；不授权 0.1.16 新候选。`build/public-test-approval.json` 仅针对 0.1.15-beta.3，`build/release-approval.json` 仅针对 0.1.15。详见 `docs/legal/NATIVE-SOURCE-APPROVAL-SCOPE-ADDENDUM.md`。完整证据与下一步：`docs/ai/deliveries/2026-10-21-release-candidate-prep.md`。**禁止通过编辑审批文件、改哈希、改名 QA 包来绕过发行阻塞。**

## 之前的 v1.2 功能 QA 进展

## 最新进展（2026-10-21 夜间：隔离安装验收）

- 本阶段起始分支：`ai/release-metadata-display-version`；界面版本 v1.2、技术包版本 0.1.16。开发前 checkpoint `checkpoint-20261021-174629-b0f1296-release-metadata-display-version`（local-only）。
- 修复 `scripts/write-release-metadata.mjs`：预期 BuildFlavor 补入唯一来源的 `displayVersion`，解决元数据严格匹配失败。
- 在独立 detached worktree 构建当前 0.1.16 私有 unsigned QA 安装包；`dist:win`、`release:metadata`、`verify:artifact` 均 PASS。
- `test:installer-smoke` PASS：隔离安装、修复、拒绝误删数据、卸载；合成 SQLite/视频哨兵保留，正式注册信息与快捷方式未变。
- `node --check`、`npm run typecheck` PASS；`npm run test:media-candidate-contract` 67/67 PASS。历史阶段全量测试曾有 3 项旧发行审批绑定失败；随后修订了发行工程测试，使历史批准与当前候选正确隔离。最新 `npm run test:release-gate` 已 PASS，详情以本页顶部最新覆盖及 `deliveries/2026-10-21-release-candidate-prep.md` 为准。
- QA 安装包使用未获公开发行批准的 source-candidate，仅限内部测试；没有替换日常桌面版或推送 GitHub。详细记录：`docs/ai/deliveries/2026-10-21-release-metadata-display-version.md`。

## 最新进展（2026-10-21 晚间：独立质量门禁与发行预检）

- 用户要求先完成无需人工配合的工作，真实删除与人工体验留到最后。本轮未操作真实媒体、未调用 115 删除、未公开发布。
- 上一轮任务分支：`ai/release-preflight-binding-guard`，基于 `830b32c`；开发前 checkpoint `checkpoint-20261021-173152-830b32c-release-preflight-stale-approval-guard`（local-only），数据快照 `2026-10-21_09-31-54-514_release-preflight-stale-approval-guard`。
- 修改仅涉及发行预检脚本及其 Node 单测：现在核对批准版本、package-lock、LICENSE 和实际 QA 证据文件 SHA256；只有证据真实匹配且明确声明稳定 Windows/标准用户覆盖时才通过对应检查。未修改审批文件或其哈希。
- 新增的绑定单测 16/16 PASS；`npm run test:media-candidate-contract` 67/67 PASS；`npm run typecheck` PASS；`npm run build` PASS（应用源码未修改）；Electron smoke、Renderer 安全 smoke、现有 v1.2 packaged smoke 均 PASS；原生源码审计 28/28 PASS。
- 全量 `npm run test:node`：149 文件，1388/1391 PASS；仅 3 项发行元数据测试失败，原因是审批仍固定在 0.1.15 / 旧 package-lock，而当前 package.json 是 0.1.16。没有篡改或绕过这些失败。
- `audit-release-readiness.mjs` 现在明确阻塞版本与 lockfile 失配、未批准的第三方二进制分发、缺少稳定 Windows 11/标准用户覆盖、缺失私有 REVIEW ZIP。
- 自动安装 smoke 因旧 `release/unsigned-test-build` 的 build-metadata 与 build-flavor 不同而在安装前退出；未执行安装、修复或卸载。该候选包不可作为当前源码验收证据。
- UI 仍为 v1.2；未重打包/替换桌面日常版。没有 GitHub Push/tag/Release。详细记录：`docs/ai/deliveries/2026-10-21-release-preflight-binding-guard.md`。

## 最新进展（2026-10-21 下午，QA-only）

- 在家用电脑 `MP2T8QB5` 继续验证，没有修改生产逻辑或 v1.2 显示版本。
- 当时开发分支：`ai/duplicate-background-fault-qa`，基于 `1f526c4` 创建；当前分支以本文件顶部最新进展及 `git rev-parse HEAD` 为准。
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
- 当时分支：`ai/release-metadata-display-version`（发行元数据脚本与交接文档）；本轮基线 `b0f1296`，应用仍以 `c79402c1f904e80b7188eb1d313c101b2ad96ba0` 为 v1.2 功能构建。原 v1.2 功能完成于 `ai/duplicate-queued-list-ux`。
- 功能实现提交：`c79402c1f904e80b7188eb1d313c101b2ad96ba0`（`feat: hide queued duplicate videos and exit completed folder scope`）。之后新增文档交接提交和隔离故障联动测试提交；新会话开始时请以 `git rev-parse HEAD` 读取最新 HEAD，不要依赖本文件里的固定 HEAD 值。
- 本轮变更范围为发行预检与元数据脚本、对应单测和交接文档；不改桌面程序。交付后以 `git status --short` 核实工作区干净。
- 用户可见版本：`v1.2`；技术包版本仍为 `0.1.16`。
- `release/win-unpacked/resources/build-flavor.json` 已核实：`displayVersion=1.2`、应用构建 commit 为 `c79402c1f904e80b7188eb1d313c101b2ad96ba0`、`workspaceDirty=false`。当前分支只改发行预检工具与测试，不修改应用运行代码；未重新打包桌面版。快捷方式仍指向 `release/win-unpacked\拉面影视.exe`；本轮对该现有 v1.2 exe 直接执行 packaged smoke 并通过，未启动新桌面版本。
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
