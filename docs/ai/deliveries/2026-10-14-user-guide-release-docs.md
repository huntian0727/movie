---
date: 2026-10-14
branch: ai/user-guide-release-docs
type: docs
status: completed
---

# 使用教程、公开版本说明与后续文档维护

## Context

维护者要求输出最新使用教程并发布 GitHub，参考其他工具类项目写法，并在后续迭代和发版时持续更新。已确认流程为日常开发版持续使用，维护者要求准备发版时再制作隔离绿色候选、测试和正式发布；同一台电脑可使用独立资料库与 Windows 沙盒完成对应验证。

本轮开始分支 `ai/api-settings-shortcut`，工作区干净，基准 `c51a9c3`。备份快照 `2026-10-14_03-31-20-596_user-guide-release-docs`，checkpoint `checkpoint-20261014-113116-c51a9c3-user-guide-release-docs`；源码、设置和约 0.87 GB SQLite 一致性快照成功，345892 视频、quick_check 正常。随后执行工作区维护脚本，验证保留快照和升级备份后清理一份旧存档，保留最近三份。

## Changes

- 新增 `docs/USER_GUIDE.md`，按下载、首次添加、导入方式比较、115/API、目录与视频、播放字幕、快捷键、异常去重、数据备份和常见问题组织。
- 新增 `docs/user-guide/0.1.15.md` 版本快照；比对正式 tag 与开发代码，排除未进入公开包的 API 配置快捷入口。最新教程和 Changelog 清楚保留该开发差异。
- 重写 README 与快速开始、下载校验、免安装说明，去掉“没有公开程序”“需要自己准备 libmpv”等过时用户指引，指向真实 0.1.15 资产及社区数据目录；保留签名、删除、隐私和实际验收范围说明。
- 为发布页准备版本教程与快速开始链接；对应本次文档 Commit，不替换原程序、源码、校验和或验证附件，也不新建程序版本/tag。
- 新增 `docs/DEVELOPMENT_AND_RELEASE.md`，将每次迭代更新 Unreleased 与相关教程、发版同步版本快照/README/发行说明写入 AGENTS 和交付模板。当前源码推送与 Release 分开，未添加定时发布或应用自动更新。
- 补充 Changelog 0.1.15 与未发布条目，给旧发布检查表、签名/NSIS 和静态 Lite 记录明确历史边界；技术门禁与历史证据不被修改或削弱。
- 实时阅读 LocalSend 与 ShareX 官方文档；[参考报告](../2026-10-14-user-guide-references.md)包含精确 Star、创建/首次 Release/默认分支提交时间、来源、依赖与未实测说明。只借鉴组织方法，未引入依赖或复制正文。

## Verification

- 固定 Node 22.23.1 / npm 10.9.8；`lint`、`typecheck`：PASS。
- `npm run test`：PASS，140 文件 / 1293 项；`npm run build`、`npm run test:electron-smoke`：PASS。时间和退出码记录在本地 `.tmp/user-guide-delivery-gates.json`。Vite 大 chunk 为已有非阻塞提示。
- 文档检查：本地脚本逐一检查修改/新增 Markdown 的相对链接、标题锚点、代码围栏、乱码字符及稳定教程排除未发布入口；PASS。校验数随本记录新增变化，以 `.tmp/user-guide-doc-check.json` 最终结果为准。
- 功能事实核对：对 `v0.1.15` 中实际导入按钮、设置字段、默认快捷键、字幕按钮、扩展名、数据身份逐项只读核对；PASS。与当前开发差异对应，未把新配置入口写进稳定版。
- GitHub 公共 Release 实时读取：正式 `v0.1.15`、非 draft/非 prerelease，8 个现有资产；下载教程的 214740659 字节及 SHA-256 与真实程序资产一致。
- GitHub 文档交付通过既有脚本同步 main，随后发布说明仅补教程链接；线上正文和原有 8 个资产的 ID、名称、大小、digest、目标提交一致性在交付结束前复核，结果保存在本地 `.tmp/user-guide-publication-proof.json`。
- `git diff --check`：PASS。没有独立 E2E 脚本，本轮未重新做视频/网盘播放验收。
- 桌面重新打包、安装或快捷方式替换：不适用。本轮仅修改 Markdown，不修改程序行为、运行配置或既有桌面包，不把源码文档更新表述为新程序交付。

## Risks and follow-up

- 公开下载仍是既有 0.1.15；API 配置快捷入口保留在 Unreleased。教程发布不触发程序版本发布或日常版/测试版数据迁移。
- 文档错误可明确修订，后续发版必须按具体 Commit 与实际界面再次核对；旧 tag 和已发布二进制不可为补教程而改写。
- 后续维护约定依赖每次开发执行 AGENTS 和交付流程，不宣称已实现全部文档自动生成或自动发版。

## Documentation and release impact

- 用户文档：最新教程、固定版本教程、README/快速开始、下载/免安装说明已同步；CHANGELOG Unreleased 与公开 0.1.15 分开。
- 程序版本：不变；本轮为公开文档补充，非候选包或二进制发版。
- 后续动作：真实功能迭代时按维护约定更新相关章节，维护者决定发版时同步版本教程、变更记录和 Release。
