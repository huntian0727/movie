---
date: 2026-09-22
branch: ai/duplicate-current-page-delete
type: feat
status: completed
---

# 重复项当前页批量删除

## Context

重复项页面原有“批量删除全部筛选结果”，但缺少只处理当前分页的快捷操作。用户需要根据当前选择的分页大小，明确地只提交当前页面实际显示的候选组。

## Changes

- 新增“批量删除当前页（N 组）”按钮，与“批量删除全部筛选结果”并列展示。
- 当前页操作直接基于已加载的 `groups` 构建删除计划，不查询或包含其他分页。
- `N` 使用当前页实际显示数量，因此常规页面与分页大小一致，最后一页则按实际不足数量显示和处理。
- 当前页按钮复用既有 CloudDrive 后台清理任务，不阻塞前端。
- 当前页任务完成后会刷新重复候选列表；只有“全部筛选结果”任务才执行原有的筛选和优先目录清理逻辑。
- 使用描边式危险按钮区分“当前页”与范围更大的“全部筛选结果”。

## Verification

- `npm run typecheck`：PASS。
- `npm run test -- --run tests/renderer/DuplicateGroupsPage.test.tsx`：PASS，33 项测试全部通过。
- `npm test`：PASS，72 个测试文件、668 项测试全部通过。
- 新增回归测试确认第 3 页显示 20 组时，后台计划恰好提交当前 20 组。
- `npm run dist:win`：PASS。
- `npm run verify:artifact`：PASS，3982 个 ASAR 条目。
- `npm run test:packaged-smoke`：PASS。
- `Local-Video-Manager-0.1.15-x64-Setup.exe /S`：PASS，安装成功。

## Risks and follow-up

- 当前页中缺少 CloudDrive 远端身份的候选文件仍受既有删除资格规则限制，不会被后台任务删除。
- 当前页按钮按候选组计数；每个组实际删除的文件数由该组的保留项和可删除候选数量决定。
