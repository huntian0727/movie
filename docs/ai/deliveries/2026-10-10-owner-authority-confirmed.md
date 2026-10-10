---
date: 2026-10-10
branch: ai/owner-authority-confirmed
type: docs
status: ownership-confirmed-publication-blocked
---

# 自有代码、文档和三张测试截图的 MIT 权属确认

## Context

用户在 2026-10-10 北京时间约 13:36 对下列明确问题回复“确认”：

> 本项目的自有代码、文档和三张测试截图，是否都是你有权以 MIT 许可证公开分享的内容？

这构成**项目所有者对限定范围内资产的明确权属与 MIT 公开分享授权确认**，不是对第三方组件授权的保证、企业法务签字或对指定安装器立即上架的命令。确认范围只包括：项目自身可授权源代码、自有文档、仓库的三张测试截图。不延伸到 FFmpeg、OpenH264、Electron/npm 依赖或未知素材。

本次仍仅使用家用 B5（MP2T8QB5）开发。操作前备份 `checkpoint-20261010-133731-b782ae6-owner-authority-confirmation`：家用 SQLite 345892 视频、quick_check=ok。办公 D200707 未操作。

## Changes

- 将 `build/release-approval.json.ownersConfirmed` 从 false 更新到 **true**，这是**单独的所有者授权状态**，不批准对外分发。
- `build/release-approval.json.approved=false`、`manualQaApproved=false`、`legacyUpgradeApproved=false`、所有第三方二进制 `sourceComplianceApproved=false`、`scripts/native-media-lite.lock.json.distributable=false` 均维持不变。
- 更新 `docs/legal/PERSONAL_RELEASE_FINAL_DECISIONS.md`、`docs/OPEN_SOURCE_RELEASE_SIMPLE.md`、`docs/RELEASE_CHECKLIST.md`，明确已收到自有资产的授权确认，无需再次就同一事项询问。
- 更新 `tests/scripts/releaseEngineering.test.mjs` 的状态预期，并增加单独的 `manualQaApproved=false` 防误发布断言。
- 未创建 tag、未公开上传第三方源码包或安装程序、未修改 main 或个人媒体数据。

## Verification

- 针对性 releaseEngineering 测试、媒体合规专项、文档链接及 Git 差异校验会在本次提交前执行；验证记录以本次实时输出为准。
- 安全原则：可将单项 `ownersConfirmed` 记录为 true，**不因此更改发行总开关或第三方适用条件**。

## Risks and follow-up

- 业余、免费分发不豁免 FFmpeg LGPL、第三方 DLL 或编解码专利的实际要求。现有静态构建许可证材料已整理，但尚未证明所有适用条款均已履行。
- 稳定 Win11 真正隔离环境的安装、真实播放与卸载尚未验收。按用户最新允许，办公 D200707 **未来仅作为隔离 VM/沙盒宿主**，本轮不访问。
- 在确认第三方发行条件、完成干净 Win11 QA 并获得针对最终社区版的明确上架指示前，全部正式发行门禁保持关闭。
