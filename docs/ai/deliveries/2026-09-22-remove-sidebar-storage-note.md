---
date: 2026-09-22
branch: ai/remove-sidebar-storage-note
type: fix
status: completed
---

# 移除侧栏底部资料库说明区

## Context

全局设置入口迁移到顶部菜单后，左侧栏底部仍残留“本地资料库 / 文件保留在原位置”说明区。该信息不提供操作能力，还会占用资料库来源列表的垂直空间。

## Changes

- 删除左侧栏底部整个资料库说明区域。
- 删除对应的桌面端与窄窗口响应式样式。
- 资料库来源列表可以自然使用原说明区释放出的空间。
- 增加回归断言，确保侧栏不再出现两段说明文字。

## Verification

- `npm run typecheck`：PASS。
- `npm run test -- --run tests/renderer/LibraryShell.test.tsx`：PASS，53 项测试全部通过。
- `npm run dist:win`：PASS。
- `npm run verify:artifact`：PASS，3982 个 ASAR 条目。
- `npm run test:packaged-smoke`：PASS。
- `Local-Video-Manager-0.1.15-x64-Setup.exe /S`：PASS，安装成功。

## Risks and follow-up

- 无已知功能风险；本次只删除无交互的说明区域及失效样式。
