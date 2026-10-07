---
date: 2026-10-07
branch: ai/collapsible-sidebar-menu
type: feat
status: completed
---

# 左侧菜单分层与折叠

## Context

用户希望左边的资料库等菜单以可折叠的一、二级菜单呈现。原文件夹目录树已有多级折叠，因此按菜单分组方向实现，同时为下方资料库目录增加总折叠入口。基准 `dd1eb7b`，工作区干净；开发前快照 `2026-10-07_09-11-40-848_collapsible-sidebar-menu`，标签 `checkpoint-20261007-171134-dd1eb7b-collapsible-sidebar-menu` 已推送。SQLite 0.87 GB、345479 条记录，quick_check 正常。

## Changes

- 新增 `SidebarMenuGroup`，概览、资料库、清理与健康、工具作为一级分组，原有页面按钮作为统一缩进的二级菜单。
- 各分组通过独立本机 localStorage 偏好保存展开/收起，首次默认展开；原生 button 提供 aria-expanded/controls，隐藏内容不可点击或键盘聚焦。收起时仍提示当前页面所属分组。
- 下方明确命名为“资料库目录”，保留来源计数并支持整体折叠。内容保持挂载，原目录树展开、缓存、当前选择及拖拽顺序继续保留。
- 导航区域可滚动，窄侧栏保留分组折叠按钮；不改变页面路由、视频分页、目录索引、扫描、播放器、文件动作或数据库。

## Verification

- Node 22.23.1/npm 10.9.8；Node SQLite ABI 127 已恢复。
- `typecheck` PASS。
- 定向 renderer 3 文件 / 80 项 PASS（LibraryShell 64、DirectoryFilterTree 7、App 9）：折叠不改页面或查询、独立记忆、重挂载恢复、原导航可用、目录缓存和展开保留、存储写入失败仍可操作。
- 最终 `test:release-gate` PASS：115 文件 / 1003 项，包含 lint/typecheck、build、Windows 文件、迁移和性能检查；全量用时 217.57s，日志 `.tmp/sidebar-release-gate.log`。
- `prepare:electron` PASS：Electron 33.4.11 / SQLite ABI 130，native 与 main-process smoke 正常。
- `test:electron-smoke` PASS。本轮已完整运行等价质量门禁，自动交付使用 `-SkipChecks` 避免 Node/Electron 原生 ABI 再次交叉切换。
- 提交后重新生成 NSIS/unpacked，检查制品及 packaged smoke，并核对 Commit/asar 时间、快捷方式目标及实际启动交互。最终证据保存 `.tmp/sidebar-desktop-proof.json`；必须成功才能报告桌面交付。
- 独立 E2E 脚本不适用（package.json 未声明）；安装/卸载 smoke 未运行（本轮未改安装器）。

## Risks and follow-up

- 折叠状态只在当前 Electron profile 记忆，不跨设备同步；存储异常时仍可在当前会话使用。
- 一级分组收起后不自动切换页面或自动展开；需点击标题重新展开。
- 资料库文件夹保持真实多级结构，未限制为只有两层。本轮不对媒体执行扫描、移动、删除或播放。
