---
date: 2026-09-03
branch: ai/duplicate-delete-live-refresh
type: fix
status: completed
---

# 0.1.11 重复项删除结果即时同步

## Context

CloudDrive API 后台删除已在每个文件成功后发布 `video:removed`，任务进度和完成也会发布 `duplicate-cleanup:changed`。重复项页面的数据加载没有监听全局刷新序号，因此数据库记录已移除后仍显示旧候选；绿色任务启动提示也没有跟踪任务状态，完成后不会自动清除。

## Changes

- 将全局 `refreshSequence` 纳入重复项分页查询依赖。收到删除成功事件后重新读取轻量候选查询，已删除文件及不再成立的重复组随即从当前页面消失。
- 绿色批量删除提示记录本次提交的任务 ID，并在任务变为 `completed`、`completed_with_errors` 或 `cancelled` 时自动清除。
- 后台任务计数继续由任务列表真实 `activeCount` 更新，不再长期停留在提交时的乐观计数。
- 增加两个回归测试，分别覆盖删除事件触发候选刷新，以及后台任务结束后绿色提示消失。
- 版本更新至 0.1.11；未修改 CloudDrive 删除、重复候选判定、数据库 schema 或视频文件操作逻辑。

## Verification

- `vitest run tests/renderer/DuplicateGroupsPage.test.tsx tests/renderer/LibraryShell.test.tsx`：PASS，2 个文件、75 项测试。
- `npm run lint`：PASS，Node/Web TypeScript typecheck 通过。
- `npm test`：PASS，54 个文件、551 项测试。
- `npm run test:release-gate`：PASS，包含 lint、生产构建、Windows 文件操作、迁移、性能基线和完整 Node 测试。
- `npm run dist:win`：PASS，生成 0.1.11 win-unpacked 与 NSIS 安装包；Electron 33.4.11 / ABI 130 native smoke 通过。
- `npm run test:electron-smoke` / `npm run verify:artifact`：PASS，asar 3960 项且无禁止的开发产物。
- `npm run test:packaged-smoke`：PASS，包含数据库、媒体协议、renderer 安全、FFmpeg/FFprobe、预览生成与页面轮询稳定性。
- `npm run test:installer-smoke`：PASS。
- 0.1.11 NSIS 已静默覆盖安装到 `C:\Users\test\AppData\Local\Programs\Local Video Manager`；桌面快捷方式目标为该目录下的 `Local Video Manager.exe`，并已从快捷方式启动正式安装版本。
- release 与正式安装目录的 `resources/app.asar` SHA-256 均为 `ea758a66d738f5a825e9f2ccc7e854449ce81ac1f87a7314cf9fbf040d3ebf3d`。
- 当前 Computer Use 未提供原生应用窗口枚举，因此未进行真实用户资料库的截图式删除操作；候选即时消失和任务提示清理分别由 renderer 回归测试验证。

## Risks and follow-up

- 删除成功后的消失速度取决于本地 SQLite 重复候选查询耗时，不再依赖重新扫描或远端 API 列举。
- `completed_with_errors` 会清除绿色“已启动”提示；具体失败项仍保留在后台任务中心供查看或重试。
- 真实 CloudDrive2 E2E：NOT RUN。
