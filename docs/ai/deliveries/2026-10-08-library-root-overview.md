---
date: 2026-10-08
branch: ai/library-root-overview
type: feat
status: completed
---

# 资料库一级目录总览

## Context

用户希望点击“资料库目录”后在右侧展示全部已添加的一级目录，并在这里搜索；确认第一版先实现一级目录总览、一级目录名称/路径搜索、进入/返回及排序同步。基准为本地已提交 `094ecf1`，工作区干净。开发前快照 `2026-10-07_16-59-18-333_library-root-overview`（快照 ID 使用脚本的 UTC 时间；用户日期为北京时间 2026-10-08），数据库 0.87GB / 345892 条记录，quick_check OK。checkpoint `checkpoint-20261008-005912-094ecf1-library-root-overview` 已在本地创建；初次和一次重试推送均被 GitHub Internal Server Error 拒绝，本地 bundle、SQLite 一致性快照、设置和 manifest 已生成，备份命令退出成功。门禁完成后再次推送已成功，checkpoint 已在 origin。

## Changes

- 新增 LibraryDirectoryOverview 及样式：全部注册来源根（含未扫描/空来源和重叠注册来源）作为一级目录，以文件夹卡片显示名称、完整路径、来源类型和扫描状态。名称/路径大小写与路径分隔符归一后即时筛选，安全 React mark 高亮；清空、Esc、未添加、无匹配状态。
- 左侧取消上轮 SidebarDirectorySearch 组件及样式；标题文字导航到右侧总览，箭头独立控制折叠。树保持挂载，已有分支缓存、展开和同级拖拽/键盘排序继续可用。
- 总览使用原排序 key/scopes，DirectoryFilterTree 排序回调在本次会话即时同步；恢复默认排序也同步，不改磁盘顺序或目录归属。
- LibraryShell 新增 libraryDirectories UI view，使用来源列表筛选，不调用目录或视频查询。全局浏览目录和 Ctrl+K 指向总览，Ctrl+K 聚焦搜索框。搜索及滚动位置保留于本次会话，返回按钮/面包屑恢复，重挂载清空查询。
- 卡片进入沿用 browseDirectory/selectDirectory，默认 exact 视频范围，保留已有子目录、图片、视频分页、播放和扫描逻辑。目录截断入口仍保留独立已索引深层搜索；本轮不添加“包含子目录”搜索开关。
- 不改数据库 schema、IPC、Worker 查询、安全凭据、扫描/文件操作或播放器。

## Verification

- Node 22.23.1 / npm 10.9.8：typecheck PASS。
- 定向 renderer 3 文件 / 76 项 PASS：折叠与导航分离、已添加一级根过滤/完整路径/高亮、零视频和目录查询、进入/返回 exact 范围、会话搜索与滚动恢复、根排序即时同步/重挂载/重置、来源增删与重叠来源身份、原目录展开/图片子目录合并回归。
- 完整 release gate PASS：lint/typecheck、build、Windows 文件、迁移、发布性能、Node native ABI 127 和 122 文件 / 1060 项全部通过（334.69s）；日志 `.tmp/root-overview-release-gate.log`。32 万条/100 来源目录搜索 1135.57ms，视频数据实际 Worker 分页 760.01ms / main-loop gap 25.10ms。
- prepare:electron 和 test:electron-smoke PASS（Electron 33.4.11 / ABI 130），含主/播放器 sandbox preload 和 OS-backed safeStorage 安全回归。
- 本轮已在同一工作区完整运行门禁和 Electron smoke；自动交付使用 `-SkipChecks` 避免重复完整批次及 Node/Electron SQLite ABI 切换，没有绕过失败检查。
- 提交后重新生成 win-unpacked / NSIS，执行 artifact/packaged smoke 及实际桌面快捷方式验收。最终结果、Commit/asar/快捷方式时间、界面验收和截图保存至 `.tmp/root-overview-desktop-proof.json`；仅该记录为 PASS 后报告桌面版本已交付。
- 独立 E2E 脚本不适用（package.json 未定义）；安装/卸载逻辑不在本轮修改范围。

## Risks and follow-up

- 一级目录是已添加来源根，不把所有深层文件夹混进总览；目录名称或路径过滤只针对这些来源。已索引深层目录仍受原数据库缓存范围限制。
- 扫描状态基于已有 source/scanStatuses，离线标为最近扫描状态；打开总览不探测网盘或启动扫描。
- 查询和滚动位置为会话状态，重启清空。排序仍为现有本机 profile 偏好，保存失败时本次会话左右保持同步并沿用原错误提示。
- 本轮不执行真实媒体扫描、播放、移动、删除或批量解析。
