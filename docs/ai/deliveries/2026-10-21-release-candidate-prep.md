---
date: 2026-10-21
branch: ai/release-tests-historical-approval-separation
type: release-preparation
status: in-progress
---

# v0.1.16 候选发版准备

## 目标与边界

用户希望先完成不需要人工参与的上线/发版准备，人工验收留到最后。只在家用电脑 MP2T8QB5、本仓库进行。**本任务是发版准备，不是公开发布授权**：不得创建/推送 tag、不得上传 Release 附件、不得推送 GitHub；真实 CloudDrive/115 删除测试按用户要求继续暂缓。

## 当前版本与发布状态

- 技术包版本：`0.1.16`；界面版本：`v1.2`。
- 当前最新公开 tag 仍为 `v0.1.15`；只读查询 `origin` 未发现 `v0.1.16` tag。
- 本地分支：`ai/release-tests-historical-approval-separation`。候选公开目标为 Windows x64 免安装 ZIP；不发布 NSIS 安装器。
- 用户可见程序逻辑不在本轮修改；只更新发版文档并制作独立 QA 候选。现有日常版 `release/win-unpacked`、桌面快捷方式和真实资料库不得覆盖或迁移。

## 文档准备

- `README.md` 与 `docs/QUICK_START.md` 现明确当前公开版仍为 0.1.15，0.1.16 是尚未公开的候选；清理重复的描述改为实际大小/整秒时长判定，不再误称完整内容 SHA-256。
- `docs/USER_GUIDE.md` 标明为候选滚动教程；`docs/user-guide/0.1.16.md` 更新为候选固定教程，补本页自动分析、播放器切换、后台重复清理/中断语义，并明确未实测的真实远端删除。
- `docs/releases/0.1.16.md` 扩展为候选发行说明，列出功能范围、自动化证据与公开阻塞。
- `CHANGELOG.md` 不再把 0.1.16 描述成已正式公开；未公开的新功能继续保留在 `[Unreleased]`。

## 自动化验证

- `npm run test:release-gate`：PASS，退出码 0；149 个测试文件、1,391/1,391 Vitest 用例通过。包括 typecheck/build、Windows 文件操作、数据库迁移、性能门禁、完整 Node 测试、媒体候选契约、原生源码构建检查。
- `npx vitest run tests/scripts/releaseEngineering.test.mjs tests/scripts/sourceReleasePipeline.test.mjs`：PASS，2 文件 / 74 用例。
- `npm run test:media-candidate-contract`：PASS，67/67。
- 上述自动化通过不等于所有者发行批准或真实媒体 E2E 通过。

## 已核实的审批阻塞

- `build/release-approval.json` 的版本仍是 0.1.15；当前 package 是 0.1.16，package-lock SHA-256 不匹配。不能修改批准文件哈希来伪造批准。
- `scripts/native-media-lite.lock.json` 仍是 `CANDIDATE_NOT_APPROVED` 且 `distributable=false`；静态 FFmpeg LGPL 重链接与组件级许可处置未最终签核。
- 现有 Windows QA 证据仅覆盖其声明的隔离沙盒范围；稳定 Windows 11 / 标准用户覆盖未获批准。
- 私人 FFmpeg-Lite REVIEW-v2 ZIP 已找到并核验：239,488,121 字节，SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`。只用于内部审核，不公开上传。
- 发行预检使用该私有 ZIP 后，源码归档检查 PASS；其他审批门禁仍 BLOCKED。旧 `release/unsigned-test-build` 的 QA installer metadata/flavor 失配，需通过新构建重新生成并验证，不沿用旧文件。
- 用户已明确真实 CloudDrive/115 删除测试暂缓；播放器与字幕的最终人工体验也留到最后。

## 下一步（本交付仍在进行）

1. 在当前已提交候选文档的干净工作区构建私有 `unsigned-test-build` 安装器，运行 `verify:artifact` 和 `test:installer-smoke`；将旧候选目录移入 `.tmp` 保留，绝不覆盖。
2. 另构建 `unsigned-community-qa` 的当前提交便携 ZIP，运行 `verify:zip` 和双阶段 packaged smoke；只作为内部 QA，不冒充可分发正式包。
3. 使用已核验的私有 REVIEW-v2 ZIP 重跑 `audit-release-readiness.mjs`，记录所有剩余 BLOCKED 项。
4. 更新本交付记录、`CURRENT-HANDOFF.md` 与 `CURRENT_STATE.md`，本地提交。最终不运行 `finish-and-push.ps1`，不推送 GitHub。
