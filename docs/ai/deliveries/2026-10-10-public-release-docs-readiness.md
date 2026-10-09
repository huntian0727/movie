# 2026-10-10 公开发布用户材料与安全状态收敛

## Context

- 接续家用 B5 的 v0.1.15 内部 QA 候选；不使用办公 707。
- 本次范围仅为发布信息准确性和用户文档，不变更媒体、播放器、安装身份或真实视频/SQLite。
- 修改前分支 `ai/public-release-audit`，提交 `ba01936`；工作区干净。
- 修改前以项目脚本成功创建本地 checkpoint `checkpoint-20261010-000503-ba01936-public-release-docs-readiness`，备份快照 `2026-10-09_16-05-04-457_public-release-docs-readiness`，SQLite quick_check: ok。

## Changes

- README 首屏解释“映匣”项目名与当前“拉面影视”安装身份的差异，直达快速开始、安装校验、第三方通知、发行草稿。
- 新增 `docs/QUICK_START.md`：本地/NAS 来源、扫描、播放限制、本地数据位置、CloudDrive/在线字幕网络行为与永久删除风险。
- 新增 `THIRD_PARTY_LICENSES.md`：实际组件、许可证与源代码信息索引，明确内部 FFmpeg Lite 未批准公开分发。
- 新增 `docs/release-notes-v0.1.15-draft.md`：用户说明草稿、真实 QA 范围、发布门禁，禁止把 QA Setup 重命名为公版及推不匹配现有 workflow 的 Beta tag。
- 不对 `main`、正式 Release 或已存在的私有/真实用户数据做修改。

## Verification

- 2026-10-10 家用 B5：四份目标 Markdown 文件的 33 个相对路径链接全部存在（0 缺失）。
- `git diff --check` PASS；`npm run lint`（TypeScript node / web typecheck）PASS，退出码 0。
- 本次纯文档改动未重新打包、未重新跑全量测试、未执行无 Node 干净系统验收。此前同一代码基线完成 1,188/1,188 单测、内部安装/修复/卸载 smoke PASS，但这**不是公众发行证明**。
- 当前 Git tracked 文件未发现独立私钥、`.env`、SQLite/DB 或视频等敏感扩展名；字符串搜到的 Token/路径候选为文档与测试上下文，不能据此认定全部历史隐私已授权。Gitleaks 本轮未重新执行。

## Risks and follow-up

- `build/release-approval.json.approved=false`；LGPL 静态链接、第三方适用许可证和对应源码公开提供等材料仍需审核。
- 尚无稳定版 Windows 11 x64 无开发环境的真实视频播放交互验收；家用 B5 是 Insider 开发机。
- 当前 PR #24 仍为 Draft；不能在缺审批与完整附件时创建正式二进制 GitHub Release。
- 真实软件名仍为“拉面影视”。对外统一改为“映匣”需要单独变更安装身份和升级/数据迁移测试，不能简单改文件名。
