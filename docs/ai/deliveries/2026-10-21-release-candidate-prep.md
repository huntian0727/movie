---
date: 2026-10-21
branch: ai/release-tests-historical-approval-separation
type: release-preparation
status: prepared-with-blockers
---

# v0.1.16 候选发版准备

## 目标与边界

用户希望先完成不需要人工配合的上线/发版准备，人工验收留到最后。只在家用电脑 MP2T8QB5、本仓库进行。**本任务是发版准备，不是公开发行授权**：不得创建/推送 tag、不得上传 Release 附件、不得推送 GitHub；真实 CloudDrive/115 删除测试按用户要求继续暂缓。

## 当前版本与 Git 状态

- 技术包版本：`0.1.16`；界面版本：`v1.2`。
- 当前最新公开版本仍为 `v0.1.15`；只读查询 `origin` 未发现 `v0.1.16` tag。
- 当前分支：`ai/release-tests-historical-approval-separation`。
- HEAD：`861ca815fadb65c62b68f2b7c08229e3eff0f820`（`docs: prepare unpublished 0.1.16 release materials`）。
- 前一提交：`7896fa1`（发行工程测试中，旧审批记录必须继续按原包版本绑定）。
- 最后检查时 `git status --short --branch` 只有干净分支标题，无未提交改动；`git diff --check` 通过。
- 正式发布目标为 Windows x64 免安装 ZIP，不发布 NSIS 安装器。日常桌面版 `release/win-unpacked` 与快捷方式没有被覆盖；本轮构建只使用独立 `release/unsigned-test-build` QA 身份，App ID 为 `com.local.video.manager.unsignedtest`。

## 文档准备

- `README.md` 与 `docs/QUICK_START.md` 现明确当前公开版仍为 0.1.15，0.1.16 是尚未公开的候选。
- `docs/USER_GUIDE.md` 标明为候选滚动教程；`docs/user-guide/0.1.16.md` 更新为候选固定教程，补本页自动分析、播放器切换、后台重复清理/中断语义，并明确真实远端删除未验收。
- `docs/portable.md`、`docs/windows-installation.md`、`docs/SOURCE_COMMUNITY_RELEASE.md` 已纠正仍指向 0.1.16 正式下载页的过期内容，普通用户入口统一指向公开版 0.1.15；`docs/OPEN_SOURCE_RELEASE_SIMPLE.md` 将 beta.3 的旧状态明确标成历史发行记录。
- `docs/releases/0.1.16.md` 列出候选功能、实际自动化证据、公开发行阻塞与尚未完成人工验收的事项。
- `CHANGELOG.md` 不再把 0.1.16 描述成已正式公开；未公开的新功能继续保留在 `[Unreleased]`。
- 文档不再误称重复候选使用完整内容 SHA-256：当前判定为精确文件大小 + 四舍五入到整秒的时长，不等于内容相同。

## 自动化验证结果

- `npm run test:release-gate`：PASS，退出码 0；149 个测试文件、1,391/1,391 用例通过。包括 typecheck/build、Windows 文件操作、数据库迁移、性能门禁、完整 Node 测试、媒体候选契约、原生源码构建检查。
- `npx vitest run tests/scripts/releaseEngineering.test.mjs tests/scripts/sourceReleasePipeline.test.mjs`：PASS，2 文件 / 74 用例。
- `npm run test:media-candidate-contract`：PASS，67/67。
- 私有安装器构建：`npm run dist:win`，退出码 0；Windows x64，Electron 44.7.0，release class 为 `unsigned-test-build`，没有签名。
- `node scripts/verify-packaged-artifact.mjs`（环境显式设为 unsigned-test/source-candidate）：PASS，3,469 个 ASAR 条目、17 份精确匹配许可声明，无禁止的开发产物。
- `node scripts/write-release-metadata.mjs`：PASS，生成当前候选 `build-metadata.json`、SHA-256 清单。
- `npm run test:installer-smoke`：PASS，退出码 0。只在系统临时目录中安装隔离测试身份；覆盖拒绝非空的无关目录、全新安装、修复、拒绝显式删除应用数据、卸载；合成 SQLite 与视频哨兵在安装目录内外均保留，生产注册信息与快捷方式未变。测试日志中有测试窗口的 `ERR_UNTRUSTED_IPC_SENDER` 诊断，但所有 smoke 断言通过，最终退出码为 0。
- 当前私有 QA 安装器：`release/unsigned-test-build/拉面影视-0.1.16-x64-unsigned-test-build-Setup.exe`，SHA-256 `d70815daaa53ea4e87e487e280767096c14fb89ff84b6ae7d277c0be1a0a0003`。该文件**只用于隔离 QA**，不是正式安装器，也不应公开上传。
- 本轮未完成便携 ZIP 构建：远程执行层拒绝启动 `dist:zip` 命令。没有尝试绕过执行控制或改用其他路径强行执行，因此尚无本轮已验证的 0.1.16 ZIP 与便携版校验清单。
- 自动化通过不等于所有者发行批准或真实媒体 E2E 通过。

## 发行预检实际结果

使用已找到的私有 FFmpeg-Lite REVIEW-v2 ZIP 重跑 `node scripts/audit-release-readiness.mjs`，退出码 2，结果 `OUTCOME=BLOCKED`；机器证据写入 `.tmp/release-final-readiness/preflight.json`。

已通过的部分：
- LICENSE 文件哈希仍与记录匹配。
- 现有隔离 Windows QA 证据文件的 SHA-256 与其记录匹配（这不等于证据覆盖足够）。
- FFmpeg QA 候选二进制/配置哈希匹配。
- REVIEW-v2 对应源码 ZIP 核验通过：239,488,121 字节，SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`。此文件仍是私人审核材料，不上传。

仍被阻塞的检查：
1. 当前私有 QA 安装器 SHA-256 与历史 QA 安装器批准/固定记录不一致；不能只更新固定哈希来假装原审批覆盖了新包。
2. 此预检只检查隔离 `unsigned-test-build`，不能批准公开 `unsigned-public-release`。
3. `build/release-approval.json` 仍绑定 0.1.15；当前 `package.json` 是 0.1.16。
4. 批准的 `package-lock.json` SHA-256 为 `7d1bdecc332cb95c412787953d0cd80b682a14aa1d3109459dc4865a78ba3e0c`，当前为 `06e88837cf56f399e173652a833d0008c011032a25dc91f4eea6ffff3158ecf1`。
5. 原生媒体分发尚未批准：`scripts/native-media-lite.lock.json` 仍标记 `CANDIDATE_NOT_APPROVED` / `distributable=false`；静态 FFmpeg LGPL 重链接与组件级许可处置未最终签核。
6. 稳定 Windows 11 与标准用户覆盖尚未完成并由所有者批准；现有隔离沙盒证据只证明其声明范围。
7. 历史发行批准绑定的版本、依赖锁与 QA 证据不能自动延伸到新候选。
8. FFmpeg 静态链接 LGPL 义务及组件级许可处置仍未完成审核。

不得编辑批准 JSON、改写哈希、将 QA 文件改名为正式包，或将私有源码审核材料公开，以消除上述阻塞。

## 当前未做与剩余事项

- 未创建或推送 Git tag；未上传或发布 GitHub Release；未推送 GitHub。
- 未生成本轮已验证的 portable ZIP。
- 未覆盖日常开发版 `release/win-unpacked`，未改桌面快捷方式，未触碰真实用户资料库。
- 未操作真实 CloudDrive/115 删除；遵守用户暂缓真实删除测试的决定。
- 播放器切换、字幕与下载等最终人工体验尚未做，按用户要求留到最后。
- 正式发布前需人工/所有者处理：为 0.1.16 候选重新审查并批准确切版本与依赖锁；完成原生媒体许可与分发批准；完成稳定 Windows 11 / 标准用户验收；明确远端删除验收安排；再构建、校验最终 portable ZIP。
- 只有在上述事项按项目规则完成并且用户明确要求发布后，才进行公开发行操作。

## 下一步

1. 在允许的执行通道中完成隔离的 0.1.16 portable ZIP 构建、`verify:zip` 双阶段 packaged smoke 与 `release:metadata --portable`；确保候选身份和审批仍为 private QA，不上传。
2. 更新本交付记录、`CURRENT-HANDOFF.md` 与 `CURRENT_STATE.md`，提交本地文档。
3. 将需要所有者/人工参与的事项保留为最终清单，不要求用户现在中断手头工作。
