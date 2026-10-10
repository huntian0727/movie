---
date: 2026-10-10
branch: ai/community-attachments-staging
type: feat
status: offline-preparation-only
---

# 个人免费分享版：离线发布附件准备及验收设备范围更新

## Context

用户授权办公电脑 D200707 **仅用于最后阶段的隔离、干净 Windows 11 验收**；明确要求在此之前先完成其他剩余工作。工作范围仍以家用 MP2T8QB5 为唯一研发机器，本轮没有访问办公电脑。修改前 Git 工作区干净，先创建 B5 本地快照 `checkpoint-20261010-114847-efd50e1-community-release-attachments-staging`，个人 SQLite 345892 视频、quick_check=ok。

## Changes

- 新增 `scripts/prepare-community-release-attachments.mjs`：独立离线材料准备工具。严格验证 FFmpeg 8.1.2 源码 ZIP 的实际 SHA256 + 大小、七个已锁定的真实 FFmpeg/运行时二进制字节、MIT 许可和当前未批准的发行状态，才会在工作区外创建新目录。自动收集对应 FFmpeg 源码 ZIP、MIT/LGPL 文本、第三方声明、构建选项、原生组件列表、SPDX SBOM 和当前 Release 说明草稿。输出独立 SHA256SUMS、状态 JSON 和醒目的“未正式发布/不含安装器”声明。不会修改发布审批、构建安装器、提交大型源码包或上传 GitHub。
- 新增 `tests/scripts/prepareCommunityReleaseAttachments.node-test.mjs` 及标准 `test:media-candidate-contract` 接入：验证锁定源码完整性、可重复 SHA 文本格式、不安全/重复文件名和坏哈希拒绝。
- `docs/OPEN_SOURCE_RELEASE_SIMPLE.md`、`docs/RELEASE_CHECKLIST.md` 增加已经生成的家用 B5 离线材料路径与边界。修正 `docs/release-notes-v0.1.15-draft.md` 中 1,188 的过期 Vitest 项数，记录此前确实通过的 1,189。
- `docs/QA/WINDOWS11_CLEAN_INSTALL_TEST.md` 更新用户最新授权：**只有其他准备完成后**才可将办公电脑作为隔离 Win11 VM/沙盒宿主，不准在办公宿主安装/研发或访问公司数据，也不擅自更改安全策略。
- 无主分支合并、正式 tag、Release 上传、正式社区版安装器或许可审批变更。所有输出仍是私有候选资料。

## Verification

- FFmpeg 源码原件 SHA256 `a996afcfd3f2601d0ef324f635d2c63adbb3abfb441c1d5aa0c87652db3258b4`，239,498,523 字节，15/15 原始源码 ZIP 条目此前已逐项验证。
- 实际工具在 B5 执行并生成私有离线附件 `D:\CodexReleaseAudit\movie-community-support-20261010`：10 项资料，实测逐一 SHA256 **10/10 PASS**，`publicInstallerIncluded=false`、`approved=false`。工具输入的七个候选原生二进制与固定锁逐一核对。
- 新增 3 项 Node 级单测 **3/3 PASS**。完整测试最终结果在本轮跑完后补充；`git diff --check` 和发布门禁待复核。
- 未在办公电脑执行任何操作。家用 B5 当前测试不是干净稳定 Windows 11 人工验收，不据此宣称正式 QA 完成。

## Risks and follow-up

- 这套目录不包含 `unsigned-public-release` 正式身份安装包，更不是可对外发布的制品；仍须对静态 FFmpeg LGPL 适用要求做最终技术确认、源码材料真实同页可下载。
- 最后阶段需在获得使用许可的办公电脑上**仅通过隔离 VM/沙盒**运行干净 Windows 11 的安装/真实播放/卸载和数据保护验收。不得在办公宿主安装、访问企业数据或调整公司的安全策略。
- 正式版本还要由维护者确认自有代码/素材授权、通过发布门禁；新正式安装器生成后应重新验证 SHA256，源码/许可证随同一次 Release 发行。
