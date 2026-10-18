---
date: 2026-10-18
branch: ai/data-directory-guide
type: docs
status: completed
---

# 数据目录说明文件

## Context

用户要求在数据文档目录内提供详细说明，帮助理解各目录内容并长期维护。现有数据已迁移至自选盘，默认 profile 目录保留定位记录、Chromium 运行环境和历史文件，因此说明必须覆盖两处。

## Collaboration

- Task ID：data-directory-guide；验收：详细说明覆盖两处实际目录、清理与备份边界，副本放入当前数据目录。
- 负责人：Codex / 当前会话；状态：completed。
- 最后更新时间：2026-10-18T19:33:00+08:00。
- 工作目录：movie；分支：ai/data-directory-guide。
- 基准 / 最近确认 HEAD：c7489218c34e9c884c18d4c06964d26cd0d4212c；接手时工作区干净，无其他 AI 写入迹象。
- 快照：2026-10-18_11-16-14-823_data-directory-guide；checkpoint-20261018-191607-c748921-data-directory-guide 已推送；SQLite quick_check=ok，363528 条视频。
- 维护：首次清理因执行脚本硬编码迁移前目录而在删除前失败；修正工作区本地 apply-backup-cleanup.ps1 的定位解析后重跑成功，保留三份快照/三份升级备份，删除一份旧快照 0.879 GiB，错误 0。未修改受保护资料库。
- 本次交付文件范围：本记录、docs/DATA_DIRECTORY_GUIDE.md、docs/USER_GUIDE.md、src/main/storage/README.md、CHANGELOG.md；本地维护脚本和 .tmp 验证工具不入库。最终提交以本记录的 Git 历史为准，不预填自身 hash。
- 关联 handoff：无；接手人：本任务 Codex。
- 桌面交付：文档任务，不修改运行代码、程序行为或界面，不需重打包及关闭日常程序。
- 公开下载：既有版本不变，本任务不发布 Release。

## Changes

- 新增 docs/DATA_DIRECTORY_GUIDE.md，共 207 行，解释默认位置与自选数据位置、主库/WAL/SHM、升级备份、设置与凭据、字幕和选择记录、封面/图片/时间轴缓存、日志、迁移状态及 Electron 内部数据。
- 说明手工维护边界、完整备份和开发快照的区别、保留三份策略、绿色包分享范围、故障核对和开发代码索引；历史 native-player、非标准 SQLite 文件及旧缓存单独标为待核实，未擅自删除。
- 同内容副本以“数据目录说明.md”放入已确认的当前自选数据目录与固定默认 profile 目录，并请求在 Codex 打开当前副本。
- 教程补充文档链接和迁移后的定位记录/字幕/归属标记备份说明；storage 模块 README 增加维护入口；Changelog 增加文档条目。

## Verification

- 开发快照与备份维护：PASS，详情见 Collaboration。
- `.tmp/verify-data-guide.mjs`：PASS，核对两处实际根目录全部名称（安装说明后 12 / 28 项）、代码路径及相对文档链接；仅核对目录名称与结构，没有扫描凭据正文或私人视频清单。
- 迁移白名单逐项覆盖核对：PASS；两份副本与仓库原稿字节一致，SHA-256 为 5b5a8f867effdda46c19faf754f490cfe018c2407531c5cd6cde0c6e263e25d5。
- `npm run lint`、`npm run typecheck`：PASS；Node 22.23.1 / npm 10.9.8。
- 首轮完整测试收集：未完成。临时 PowerShell 收集器因 Git 换行符 stderr 警告在 ErrorAction=Stop 下终止，未获得测试退出码，不记 PASS；核对已无遗留 npm/vitest 进程后改用 Node 子进程直接写日志并重新执行。
- `.tmp/check-data-guide.mjs` 顺序执行的 `npm run test`、`npm run build`、`npm run test:electron-smoke`：PASS，全部退出码 0；142 个测试文件 / 1316 项测试通过，完整测试耗时 228.63s。日志及退出码保存在 .tmp/guide-check-*-retry.txt / guide-check-results.json。
- 交付采用 `scripts/finish-and-push.ps1 -SkipChecks`：本轮同一工作区已实际完整执行并记录全部等价检查，符合既有规则。没有跳过任何失败检查，首轮收集失败已重跑。
- `git diff --check`：PASS；E2E 脚本未定义，不适用。桌面重打包和快捷方式验收：不适用，未改桌面行为或界面。

## Risks and follow-up

- Electron 内部目录随版本变化，无法仅凭名称确认历史文件可删；说明明确区分已确认职责与待核实遗留物。
- 此次交付说明文件，未新增自动生成或自动迁移说明文件的程序能力。

## Documentation and release impact

- 新增目录说明，更新使用教程、storage 模块文档与 Changelog 文档条目。
- 仅文档交付；绿色程序包、真实桌面快捷方式和公开 0.1.15 下载不变；发版不适用。

## Handoff history

### 2026-10-18T19:23:00+08:00 · Codex · 开始 / 已接手

- 核对基准分支 ai/data-directory-migration、HEAD、远程与干净工作区；新分支已建立。
- 已完成快照、定位当前自选资料库、检查目录名称及代码用途；未读取或公开凭据正文、视频清单。
- 下一步：编写说明、安装本地副本、检查并按既有脚本交付。

### 2026-10-18T19:33:00+08:00 · Codex · 完成

- 已完成：207 行详细说明、两处本地副本、教程与模块入口；核对目录覆盖、迁移白名单、链接和 SHA-256。
- 验证：lint/typecheck/test/build/test:electron-smoke 全部 PASS，142 文件 / 1316 测试；未修改运行代码、业务数据库或现有程序包。不存在需继续观察的测试进程或阻塞项。
- 文档边界：说明副本目前不自动迁移，已在说明与教程中明确；历史文件只记录、不清理；本地维护脚本修正不进入项目仓库。
- 下一步：既有 finish-and-push 脚本提交、推送分支、创建旧 main 备份标签并快进同步 main，最终结果通过 Git 与交付回复核对。未留后续开发需求。
