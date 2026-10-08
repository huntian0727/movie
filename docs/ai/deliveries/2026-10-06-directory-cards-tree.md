---
date: 2026-10-06
branch: ai/directory-cards-tree
type: feat
status: completed
---

# 目录筛选树与文件夹卡片

## Context

用户希望采用文件管理器的目录呈现方式，以最小改动实现左侧目录筛选树和右侧视频列表上方的子文件夹卡片。开发前快照 `2026-10-06_15-17-06-302_directory-cards-tree`，标签 `checkpoint-20261006-231701-181ee42-directory-cards-tree` 已推送；SQLite 0.87 GB、345479 条视频，quick_check 正常。

## Changes

- 新增 `DirectoryFilterTree`：逐层加载、会话内分支缓存、展开与选中分离；资料库刷新后失效，过期响应不覆盖新结果，错误只读重试。
- 搜索/卡片/同目录入口共用选中目录；搜索结果超出前 100 个同级项时仍可显示选中路径。
- compact 目录区域默认展示子文件夹卡片；跟随卡片大小，列表视图使用紧凑行，截断时提供目录搜索。
- 进入目录默认 exact，清除搜索并重置页码；切换时清除上一目录的视频与多选、滚回顶部，避免旧列表显示在新路径下。保留 recursive 切换和原有视频分页、播放、多选及文件操作。
- 无数据库迁移，不更改磁盘枚举、扫描、播放器、文件动作或重复项规则；目录卡片不参与视频批量操作。

## Verification

- `npm run typecheck`：PASS（初步类型检查）。
- 定向 renderer 测试：2 文件 / 64 项 PASS，包括展开不筛选、缓存收起、目录卡片导航、扫描范围一致、只读重试、过期响应、截断路径定位及切换时隔离旧视频/选择。
- 最终 `test:release-gate`：PASS，115 文件 / 996 项；包括 lint/typecheck、build、Windows 文件、迁移与性能检查。日志 `.tmp/directory-release-gate.log`，固定 Node 22.23.1/npm 10.9.8，1–2 workers。
- 系统默认 Node 24/npm 11 的 native 检查 FAIL（版本不符合项目要求）；切换 `.tmp/run-node22.cjs` 隔离的 Node 22.23.1/npm 10.9.8 后 `verify:native:node` PASS，ABI 127。
- `prepare:electron` 与 `test:electron-smoke`：PASS，Electron 33.4.11 / SQLite ABI 130。
- `package:dir`：PASS，重新生成 `release/win-unpacked`。首包 app.asar SHA-256 `B9CF87FD42ED47AB0D89514D37A9106E79E822B00FA2BCEB70BA345BC29DE0F0`。
- 桌面快捷方式 `%USERPROFILE%/Desktop/拉面影视.lnk` 已核对并实际启动，目标为当前仓库 `release/win-unpacked/拉面影视.exe`。
- 使用 computer-use 在真实约 34.5 万视频资料库验收：展开来源保持资产中心；进入来源显示 13 个直属文件夹卡片和 189 个直属视频；切换 recursive 后视频数为 945，扫描按钮同步改为递归文案；切换列表出现视频表格和文件夹入口；点击文件夹进入 19 视频的 exact 范围，面包屑可返回，恢复网格卡片布局。未点击扫描或文件操作。
- 独立 E2E 脚本：不适用（package.json 未声明）；已执行上述真实桌面交互验证。
- 源码最终提交后将从同一分支重建 NSIS/unpacked，执行制品/packaged smoke 并复核最终快捷方式启动。结果留存在 `.tmp/directory-desktop-proof.json`；若失败必须在最终报告标明，不能以本条预期代替成功。

## Risks and follow-up

- 只展示已索引有效视频对应的目录；空目录/未扫描目录仍不展示。
- 同一级最多展示 100 个子目录，更多目录通过搜索进入；文件夹和视频分别展示，视频页码不包含文件夹。
- 默认 exact 是用户确认的产品行为调整；recursive 仍可手动选择，但导航到另一个目录会恢复 exact。
- 本轮不执行用户媒体的扫描、删除或移动。
