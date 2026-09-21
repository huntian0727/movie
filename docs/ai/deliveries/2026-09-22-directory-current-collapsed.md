# 目录浏览当前目录默认折叠

## Context

分支：`ai/directory-current-collapsed`。用户要求目录浏览页中的“当前目录”默认折叠，以减少首屏信息密度和不必要的目录查询。

## Changes

- “当前目录”子目录列表进入页面时默认折叠。
- 折叠状态展示“展开查看”，并提供明确的展开箭头和 `aria-expanded` 状态。
- 折叠时不发送子目录数据库查询；用户展开后才通过既有只读 worker 按需加载。
- 切换到新的目录后重新恢复默认折叠状态。
- 全局目录搜索结果保持自动展开，避免搜索后看不到结果。
- 当前范围的视频预览、范围切换和其他资料库操作保持不变。

修改范围：

- `src/renderer/components/DirectoryBrowserPage.tsx`
- `src/renderer/components/directoryBrowserPage.css`
- `src/renderer/components/LibraryShell.tsx`
- `tests/renderer/LibraryShell.test.tsx`

## Verification

- TypeScript 类型检查通过。
- `LibraryShell` renderer 测试 51 项全部通过。
- 新测试确认默认折叠时不查询目录，展开后才加载直接子目录。

## Risks and follow-up

- 这是纯 renderer 展示与查询触发时机调整，没有修改数据库、扫描、播放或文件管理逻辑。
- 搜索结果仍保持自动展开，因此搜索场景不会额外增加一次点击。
