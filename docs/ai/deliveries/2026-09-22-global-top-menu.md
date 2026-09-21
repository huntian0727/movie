---
date: 2026-09-22
branch: ai/global-top-menu
type: feat
status: completed
---

# 全局顶部菜单与最近目录迁移

## Context

左侧栏同时承担页面导航、资料库来源、最近目录、添加入口和设置入口，信息层级混杂且挤占资料库列表空间。本次把跨页面工具收拢到统一顶部菜单，并把最近目录放回与目录定位语义一致的目录浏览首页。

## Changes

- 将“设置”从左侧栏底部移至所有主页面共享的顶部菜单栏。
- 将“浏览目录”和“添加资料库”一并收拢到顶部菜单栏，形成稳定的全局工具入口。
- 左侧栏保留页面导航和资料库来源列表，不再混放全局工具入口。
- 将“最近目录”从左侧栏迁移到目录浏览首页，展示目录名与完整路径。
- 顶部点击“浏览目录”会回到目录浏览首页；资料库来源条目仍可直接进入对应根目录。
- 调整公共工具栏、资产中心、播放诊断和异常中心的吸顶偏移，避免与新增顶部菜单栏重叠。
- 顶部菜单只放跨页面且高频的全局操作。刷新、扫描、批量删除、排序和后台任务继续保留在各自业务页面，因为它们的作用域随页面变化。

修改文件：

- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/DirectoryBrowserPage.tsx`
- `src/renderer/components/directoryBrowserPage.css`
- `src/renderer/styles.css`
- `tests/renderer/LibraryShell.test.tsx`

新增文件：`docs/ai/deliveries/2026-09-22-global-top-menu.md`。删除文件：无。

## Verification

- `npm run typecheck`：PASS。
- `npm test`：PASS，72 个测试文件、667 项测试全部通过。
- `npm run dist:win`：PASS。
- `npm run verify:artifact`：PASS，3982 个 ASAR 条目，无禁止的开发产物。
- `npm run test:packaged-smoke`：PASS。
- `Local-Video-Manager-0.1.15-x64-Setup.exe /S`：PASS，安装成功。

## Risks and follow-up

- 未覆盖多显示器、系统级缩放比例组合下的人工视觉检查。
- 极窄窗口下顶部菜单会比原来占用更多横向空间，但当前应用最小宽度和响应式布局下不会遮挡主要页面操作。
