---
date: 2026-10-10
branch: ai/third-party-legal-docs-closeout
type: docs
status: completed_for_documentation_only
---

# FFmpeg 实际构建资料与 Windows 11 验收文档交付

## Context

背景与安全边界：

- 用户已确认未来获准公开 Release 时，愿意同时提供 FFmpeg 及相关运行库依法需要的源码、许可证与构建材料。此确认**不是第三方分发法律批准**。
- 仅在家用 B5 操作（办公电脑 707 禁止使用）。变更前创建项目备份及个人 SQLite 快照，`quick_check=ok`；不触碰真实视频、个人数据库或安装器。
- 仅以历史构建记录、仓库锁定 SHA、真实 `ffmpeg.exe -buildconf`、B5 本地逐字节核验的 REVIEW-v2 ZIP 为事实依据，不虚构编译日期或公开源码 URL。

## Changes

本轮实际修改：

1. 新建 `docs/legal/FFMPEG_BUILD_INFO.md`：真实完整 configure 选项、两个 EXE 精确 SHA、gcc 版本、第三方来源、外部进程调用模式和静态链接待审。
2. 新建 `docs/legal/FFMPEG_SOURCE_NOTICE.md`：未来 Release 应如何同页提供对应源码、补丁/构建/重链接材料，明确目前 ZIP 仍是私人审核包。
3. 新建 `docs/legal/NATIVE_COMPONENTS.md`：七个 FFmpeg/运行库二进制来源、许可候选说明和 SHA，对应源码及构建脚本校验值。
4. 新建 `docs/legal/LICENSE_COMPLIANCE_CHECKLIST.md`：已获证据与必须取得真实批准后才能完成的项目。
5. 新建 `docs/QA/WINDOWS11_CLEAN_INSTALL_TEST.md`：隔离 VM 前提、当前安装器 SHA、实际 PowerShell 命令、人工 UI/播放及脱敏证据模板，未验证项明确 NOT RUN。
6. 更新根目录 `THIRD_PARTY_LICENSES.md`、发行说明草稿与最终发布清单；设置页增加“关于与第三方许可证”分区，说明 FFmpeg、上游链接和对应源码获取文件；新增 UI 测试。

## Verification

验证与未完成项目：

- `npm run lint`：PASS。
- `vitest run tests/renderer/SettingsPage.test.tsx`：15/15 PASS。
- `npm run test:media-candidate-contract`：51/51 PASS。
- 新及更新文档的相对链接检查：44/44 PASS；`git diff --check`：PASS。
- PR #24 上一轮 `cd4d10f` 的五项 GitHub CI 已全部通过；本轮提交需要启动新一轮 CI。
- 未重新打包公众安装器、未运行干净稳定 Win11 的真实手工验收、未关闭 FFmpeg LGPL 静态链接重链接疑点。不能把已记录的技术证据误称为法律批准。
- `build/release-approval.json` 保持 `approved=false`；无 main 合并、正式 Tag 或公开安装包上架。

## Risks and follow-up

- 静态 FFmpeg LGPL、五个 DLL 对应许可证与源码材料的实际分发条件仍待具有相应专业能力者审核，不能仅靠文件和 SHA 判定已经履约。
- 稳定 Windows 11 x64 无开发环境真实测试、项目权属审查、正式社区身份安装包与对应源码同步发行均未运行/未批准；严禁提前发布。
- 所有用户媒体和 SQLite 保持不动，合规和 QA 未通过前 release-approval 必须保持 false。
