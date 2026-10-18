---
date: 2026-10-18
branch: ai/data-directory-migration
type: feat
status: completed
---

# 应用数据目录选择与自动迁移

## Context

用户确认实施：默认路径不变，设置中更改应用数据目录，自动迁移资料库、设置、应用字幕和媒体缓存；程序包不含用户数据。源视频、旁挂字幕和导出文件不迁移。

## Collaboration

- Task ID / 目标与验收：data-directory-migration；可选择目录、迁移、重启恢复，失败不丢失原数据。
- 当前负责人 / AI 程序与会话标识：Codex / 本会话。
- 状态：completed。
- 最后更新时间：2026-10-18T19:00:00+08:00。
- 工作目录 / 分支：movie / ai/data-directory-migration。
- 基准 Commit / 最近已确认 HEAD：f2632198c7f45ec3074b11b080d8cc31b0945587。
- 开发前快照：2026-10-18_10-17-06-800_data-directory-migration；checkpoint-20261018-181702-f263219-data-directory-migration（已推送）；完整快照成功，SQLite quick_check ok，363528 条视频。维护脚本校验后保留最近三份，删除 1 份旧快照，Errors 0。
- 当前未提交、暂存、未跟踪文件：本任务记录及随后本任务实现文件，开始时工作区干净。
- 最近交接人 / 指定接手人：无。
- 关联 task / handoff 路径：无。
- 桌面程序：release/win-unpacked/拉面影视.exe；实际快捷方式 C:\Users\test\Desktop\拉面影视.lnk；日常资料库 C:\Users\test\AppData\Roaming\local-video-manager（本轮未迁移）。
- 公开下载状态：既有版本未变化；本次不公开发布。

## Handoff history

### 2026-10-18T19:00:00+08:00 · Codex · 完成自动交付

- 最终自动脚本 PASS：lint、typecheck、test（142 文件 / 1316 项，247.87 秒）、build、test:electron-smoke。代码包含 Windows 大小写目录识别及复制文件/资料库落盘同步。
- 功能 Commit 952f3d8 已推送 origin/ai/data-directory-migration 与 origin/main；更新前 main 备份标签 backup-main-20261018-185953-f263219 已推送。
- 本条仅补充实际验证和交付结果，不修改功能；按同轮等价检查使用 -SkipChecks 提交记录更新。最终文档提交可从 Git 查询，不回填自身哈希。
- 桌面源码相同，按最终提交重新生成 release/win-unpacked，并从原快捷方式复核；本机证据文件记录最终 Commit、app.asar 时间/哈希及实际入口。
- 无运行中的测试或迁移任务；日常资料库保持默认位置。后续用户自行更改位置时才迁移真实资料库。

### 2026-10-18T18:54:00+08:00 · Codex · 完成验收，进入自动交付

- 实际默认库和隔离库的桌面验收完成；默认库保持原位置。程序已正常关闭，随后进行最终全量门禁；交付后按最终 Commit 重建并再次从快捷方式启动。
- 修复启动入口就绪顺序；补充 Windows 大小写兼容的迁移清单处理及用例。
- 本机维护脚本重试 PASS：保留三份开发快照、三份数据库升级备份、三份旧程序目录，删除一份旧升级备份和一份旧程序存档，共 1.257 GiB，Errors 0；当前 release/win-unpacked 保留。
- 无其他负责人遗留修改；未提交内容均为本任务的代码、测试和文档。工作区本地 prepare-backup-cleanup.py 的定位适配不提交仓库。
- 阻塞：无；真实跨盘、SMB 与断电等未覆盖项见 Verification。

### 2026-10-18T18:18:42+08:00 · Codex · 已接手

- 已阅读共同规则，核对 ai/readme-screenshots / f263219，diff、暂存、未跟踪文件均无；创建本任务分支。
- 已完成：只读调研、完整快照、备份保留维护。
- 验证：快照和维护 PASS；功能测试 NOT RUN。
- 正在运行的任务：无。
- 下一步：实现固定定位记录、启动前迁移与恢复、设置入口、路径引用更新及专项测试。

## Changes

- 固定默认目录保存 data-location.json，保留现有默认路径；同一发行 profile 继续读取自选目录。独占锁和目录归属标记防止多实例写入和跨身份接管。
- 设置增加数据目录查看、打开、原生目录选择、文件数量/大小预览与“迁移并重启”；renderer 只提交已由主进程生成的预览 token。
- 新进程启动前白名单复制、SHA-256 校验、SQLite quick_check、事务重写应用缓存路径；目标同级 staging 发布后才原子切换定位。原视频/旁挂字幕/导出文件不动。
- 中断 staging 保留并重试，已发布目标须凭据匹配并重新校验；目标磁盘丢失时停止并提供已有目录恢复，不创建空资料库。原文件变化或新增时不清理；清理仅逐文件校验/unlink 及空目录 rmdir。
- 开发备份读取目录定位记录；本机维护脚本 prepare-backup-cleanup.py 同样跟随自选目录归并数据库升级备份（工作区本地工具，不提交仓库）。
- 新增本机日常版 package:development 构建入口，local-development 标记不可分发，沿用原开发库，生成 release/win-unpacked；不改变公开发布门禁。

## Verification

- 首轮完整回归：FAIL，设置页旧 mock 缺少新增 API，以及原有 320k 检索测试超过 90 秒。已补 mock；性能单项复测 PASS（59.21 秒总耗时）。
- 再次完整 npm run test：PASS，142 文件 / 1315 测试（Node 22.23.1 / npm 10.9.8，261.00 秒）。
- npm run lint（含 typecheck）：PASS。开发桌面构建：PASS；存在原有 Vite 大分包、缺作者/说明等非阻断提示。
- npm run test:electron-smoke：PASS，新增真实 Electron / DPAPI 迁移后读取设置与密文、SQLite 及清理校验，主/播放器窗口的迁移能力隔离 PASS。
- 桌面首轮实际快捷方式启动发现 Electron ESM 顶层 await ready 导致等待：已修复为 ready 回调内启动，增加迁移进度窗关闭时的启动保护。只终止了本任务启动的隔离测试进程（PID 32000，SQLite 未打开），未强退用户真实库程序；原资料库正常关闭后才归档。
- 最新启动顺序的完整打包入口 smoke：PASS，两次实际进程创建/重开 SQLite、renderer/preload/CSP/来源限制、FFmpeg 预览和 worker 查询均通过。安全负向用例的 ERR_UNTRUSTED_IPC_SENDER 为预期拒绝。
- 实际桌面快捷方式 + 隔离数据完整迁移：PASS。使用本机自制 2 秒视频、预置字幕与封面，迁移后核对收藏、播放历史、seekStepSeconds=17、字幕选择、封面 SHA-256、原视频未移动及原 SQLite 已清理。证据 .tmp/data-migration-desktop/proof.json、settings.png。
- 原生目录选择 → 预览 → 取消：PASS，展示正确原位置/新位置/数量/容量，取消不触发迁移。
- 日常快捷方式启动 → 设置入口：PASS，显示新“数据存储位置”及原默认目录。日常库原为 schema v14，本轮正常启动按既有 migration 升级 v15，升级前 library.sqlite.v14.2026-10-18T10-49-33.735Z.sqlite 已生成；非本功能新增 schema。
- 本机备份维护在数据库备份文件仍被升级过程占用时 FAIL 并停止，没有删除；正常关闭程序后重试。最终维护结果见交接历史。
- E2E 独立 npm 脚本：不适用；真实跨物理磁盘、NAS/SMB/移动盘拔插、实际磁盘写满与断电：NOT RUN，权限/空间/中断/损坏有故障注入测试，不能替代真实环境。

## Risks and follow-up

- 跨物理盘、NAS/SMB、真实断电/磁盘满尚未实测；中断 staging 保留，不自动递归清除不明目录。
- 不跨发行身份自动合并资料库，不搬源媒体，不公开凭据。
- 旧版本不认识 data-location.json，迁移后不要并行启动旧版本。重新定位仅接受当前 profile 的归属标记；跨机器/Windows 用户的 DPAPI 凭据仍需重配。

## Documentation and release impact

- 已更新 CHANGELOG Unreleased、USER_GUIDE 数据目录章节、storage README 与本机日常包构建约定；既有 0.1.15 下载不变。
- 桌面日常版已重建并从原快捷方式验证；最终 Commit 由本记录所属 Git 提交查询，随后按该 Commit 再次构建并核对 app.asar 时间与 build-flavor，证据在 .tmp/data-directory-desktop-proof.json；最终哈希/推送结果见交付回复。
- 发版任务：不适用。
