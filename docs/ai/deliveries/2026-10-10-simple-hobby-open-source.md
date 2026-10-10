---
date: 2026-10-10
branch: ai/simple-hobby-release
type: docs
status: completed
---

# 面向个人免费开源发布的一页最简指引

## Context

用户明确选择：映匣仅用于个人业余爱好开源免费分享，不考虑盈利，不购买签名证书；不要把内部 FFmpeg 许可证核对按企业级审批讨论和重复审核。

家用 MP2T8QB5 项目备份：`checkpoint-20261010-110930-eb9596d-simplify-hobby-open-source-release`（本地备份、SQLite quick_check=ok），严禁使用办公 D200707。开始时分支 HEAD `eb9596d`，工作区干净。

## Changes

- 新建 `docs/OPEN_SOURCE_RELEASE_SIMPLE.md`：用户只关心三件实际工作：MIT/第三方声明、源代码和许可随 Release 交付、一次真实安装/播放/卸载安全验证。仅明确留下 FFmpeg Lite 静态链接适用 LGPL 材料的确切疑点；动态替代是必要时备选，并非默认重构。
- `README.md` 第一屏链接最简指南；更新明显不符合当前策略的签名包/旧版 FFmpeg 9.0.2 描述，区分历史 BtbN 和现有 Lite 8.1.2、测试身份、独立无签名社区身份。
- `THIRD_PARTY_LICENSES.md`、`docs/RELEASE_CHECKLIST.md`、`docs/COMMUNITY_CANDIDATE_RUNBOOK.md` 提供简单入口，明确详尽技术归档不是普通用户必须学习的企业审批流程。
- 原始许可证全文、第三方归档、发行技术事实和主程序数据保护措施保持不变。没有新增或自动生成无依据的许可证批准；未经授权不创建 tag，不合并 main，不公开 GitHub Release。

## Verification

- B5 已保存完整项目开发 checkpoint，个人 SQLite `quick_check=ok`。
- README/指南/第三方说明/内部作业手册 47 个相对 Markdown 链接全部存在。
- `npm run test:media-candidate-contract`：51/51 PASS。
- `git diff --check`：PASS；`scripts/release-engineering.mjs` 与 Windows 社区工作流无净变更。
- `build/release-approval.json.approved=false`，`scripts/native-media-lite.lock.json.distributable=false`，公众安装包不可意外放行。

## Risks and follow-up

- 简化的是**个人项目的实际执行流程与文档入口**，不是 FFmpeg/GNU LGPL 的法律义务。静态编译 CLI 自身对应源码/必要重链接材料的适用性仍需要确切核对。
- B5 中已核验私人 239 MB 对应源码审核 ZIP，但它不是可供外界下载的正式来源；将来 Release 附件必须和当次实际安装器对应。
- 独立稳定 Win11 人工操作验收未运行、社区版安装包未批准生成/发布。安全门禁未降低，不需要用户学习内部多套审批变量；当实际发行条件具备时交由开发者完成。
