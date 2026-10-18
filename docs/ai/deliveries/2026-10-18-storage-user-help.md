---
date: 2026-10-18
branch: ai/storage-user-help
type: feat
status: completed
---

# 设置内的数据目录用户说明

## Context

用户补充要求：普通用户应能在数据存储位置功能处直接阅读说明。上一任务交付维护手册与本地文件，本任务增加程序内置、离线可读的用户说明入口。

## Collaboration

- Task ID：storage-user-help；负责人：Codex / 当前会话；状态：completed。
- 最后更新时间：2026-10-18T21:41:00+08:00。
- 基准：ai/data-directory-guide / e695c4e9ac87c2ef6840c7a27c38c8a4d370e88e；接手时工作区干净，未发现其他 AI 写入。
- 工作目录 / 分支：movie / ai/storage-user-help。
- 开发前快照：2026-10-18_13-27-46-919_storage-user-help；checkpoint-20261018-212741-e695c4e-storage-user-help 已推送；SQLite quick_check=ok、363528 条视频。
- 备份维护：PASS，校验后三份保留，删除一份旧快照 0.879 GiB，错误 0。
- 本次交付范围：用户说明组件、数据存储设置入口与样式、相关测试和文档；未改数据格式、迁移逻辑及凭据。最终提交通过本记录 Git 历史追溯，不预填自身 hash。
- 最近交接 / 指定接手人：同会话 Codex；关联 handoff：无。
- 桌面交付：已打包日常版并从真实桌面快捷方式人工验收入口、展开/收起、表格换行和全文滚动；提交后再生成最终 Commit 对应的干净工作区包并核对构建证据。
- 公开下载：不发布 Release，公开 0.1.15 不变。

## Changes

- 在设置的数据存储位置区，打开目录/更改位置按钮旁增加“查看目录说明”，原位展开/收起，使用设置页自身滚动；按钮带 aria-expanded/controls。
- 新增 DataStorageHelp.tsx，展示实际当前/默认位置、12 类主要数据项的用途与维护说明，以及默认运行环境、迁移、备份、清理、离线磁盘和分享程序的用户说明。
- 内容随 renderer 打包，离线可读；目录状态加载失败仍能展开。没有新增外部文件读取、IPC、网络请求、文件写入或迁移动作。
- 更新 Changelog、用户教程、组件 README 和维护手册入口；同步此前本机两份维护手册副本。

## Verification

- 开发快照与维护：PASS。
- `npm exec vitest run tests/renderer/DataStorageSettings.test.tsx`：PASS，5 项；覆盖原迁移交互及说明展开/收起、当前路径展示、只读无副作用、状态失败仍可阅读。
- `npm run lint`、`npm run typecheck`：PASS（Node 22.23.1 / npm 10.9.8）。
- `npm run test`、`npm run build`、`npm run test:electron-smoke`：PASS，142 文件 / 1318 项测试，全量测试耗时 259.73s；日志与退出码保存于 .tmp/storage-help-checks.jsonl 和 .tmp/storage-help-*.txt。
- `git diff --check`：PASS；现有无 E2E 脚本，不适用。
- `npm run package:development`：PASS，重新生成 release/win-unpacked，仅本地 local-development，不生成 ZIP/安装器及公开附件。更新前正常退出，并保留旧程序存档 win-unpacked.pre-storage-help-20261018-213733。
- `.tmp/storage-help-task.mjs verify --draft`：PASS，3 个 renderer 产物与 app.asar 内文件逐字节一致，包含说明入口及正文；构建时间晚于基准提交。开发验收包如实标记 workspaceDirty=true。
- 真实桌面快捷方式 `C:\Users\test\Desktop\拉面影视.lnk` → `movie/release/win-unpacked/拉面影视.exe`，从此快捷方式启动：PASS。原日常库路径与当前/默认位置显示正常；查看目录说明 → 展开文章 → 滚动读取全部表格和备份/清理末尾 → 收起均 PASS，没有进入迁移确认或修改业务设置。
- computer-use 首次 activate_window 超时，按技能要求刷新窗口选择后重试成功，后续操作正常。
- 交付调用既有 finish-and-push.ps1；允许 -SkipChecks 的依据是本轮同一工作区已完整执行上述全部检查。最终 clean Commit 构建与 packaged smoke 证据保存在 .tmp/storage-help-package-proof.json / storage-help-checks.jsonl，并由最终回复确认；不以开发验收包冒充公开发行包。

## Risks and follow-up

- 用户说明须保持普通用户语言，不混入开发备份路径、源码索引或历史本地文件清单。
- 维护手册继续保留，程序内说明与迁移行为同步维护。
- 此次没有重复执行真实迁移、NAS/SMB 或网盘服务测试，均 NOT RUN；迁移和后端未变，本轮验证聚焦用户说明及打包。无独立 E2E 脚本。

## Documentation and release impact

- 更新 CHANGELOG Unreleased、USER_GUIDE 和组件模块 README。
- 日常桌面版需交付；候选/正式发行与版本教程快照不适用。

## Handoff history

### 2026-10-18T21:30:00+08:00 · Codex · 开始 / 已接手

- 已核对分支、HEAD、干净工作区和前一任务记录，完成快照与保留策略维护。
- 已确认设置区现有打开目录/更改位置按钮，采用同区内联说明，避免新窗口与外部文件依赖。
- 下一步：开发用户说明、检查与实际桌面交付；当前无阻塞。

### 2026-10-18T21:41:00+08:00 · Codex · 完成

- 已完成：用户版离线说明入口、内容、样式、测试和文档。项目门禁全部 PASS，日常桌面入口及全文阅读实际验证 PASS。
- 接手基准 e695c4e，当前 ai/storage-user-help；仅本任务 9 个源码/文档文件，无其他 AI 修改混入。
- 旧桌面版及验收程序均正常退出，不强制结束进程。未改定位记录和资料库业务数据，未自动迁移用户数据。
- 交付顺序：既有脚本提交/推送并备份 main → 干净 Commit 重打包 → 校对 asar/renderer/快捷方式 → 最终包隔离 smoke → 从真实快捷方式复验入口。最终 Commit/备份标签以 Git 和交付回复为准，构建验证证据留在 .tmp。
- 未留需继续开发或接手的事项；公开发布不在本任务授权范围。
