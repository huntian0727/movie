---
date: 2026-09-04
branch: ai/nonblocking-duplicate-cleanup
type: fix
status: completed
---

# 0.1.14 重复项批量删除无阻塞交互

## Context

用户在重复项页面提交大量 CloudDrive API 删除后，界面仍会卡顿。检查发现后台任务虽然异步请求网盘，但成功结果仍逐文件写数据库、逐文件发布领域事件；Renderer 又把每个删除和任务进度事件扩散为资料库刷新、重复项查询和导航统计。全筛选任务创建还会先构建计划，再逐组重新查询校验，增加提交等待。

用户确认两项交互契约：提交后立即退出当前目录筛选并继续显示剩余重复项；失败或取消的候选在任务结束并释放占用后自动重新出现。

## Changes

- 全筛选任务在点击后立即乐观隐藏当前候选；任务成功受理后清除目录筛选、回到第一页并刷新剩余候选，受理失败则恢复原候选。
- 全筛选计划直接产生已解析的保留/删除记录并提交，避免每个重复组再次查询；占用检查改为 500 条分块，规避大型计划的 SQLite 参数上限。
- CloudDrive 成功批次使用批量视频删除和批量任务项状态更新，并为整个批次只发布一个 `video:removed` 事件。
- `duplicate-cleanup:changed` 仅更新任务中心；连续 `video:removed` 在 500ms 窗口合并为一次资料库、重复项和导航刷新。
- 全筛选任务无论成功、失败或取消都会触发一次候选刷新；只有完全成功才清除优先保留目录，失败和取消保留规则并恢复候选。

## Verification

- TypeScript typecheck：PASS。
- 定向仓储、后台清理和 Renderer 回归：PASS；覆盖候选立即隐藏、受理失败恢复、CloudDrive 批次单事件以及进度事件不刷新导航。
- `npm run test:release-gate`：PASS；lint、生产构建、37 项 Windows 文件操作、32 项迁移、23 项性能/缓存/播放器门禁及完整 Node 套件全部通过。
- 完整 Node 套件：55 个测试文件、560 项测试全部通过。
- `npm run dist:win`：PASS，生成 0.1.14 `win-unpacked` 与 NSIS 安装包；Electron 33.4.11 / ABI 130 native 与主进程 smoke 通过。
- `npm run test:electron-smoke`、`npm run verify:artifact`、`npm run test:packaged-smoke` 与 `npm run test:installer-smoke`：PASS；asar 3,961 项且无禁止的开发产物。未授权 IPC 拒绝日志是安全负向测试的预期结果。
- 0.1.14 已静默覆盖安装到 `C:\Users\test\AppData\Local\Programs\Local Video Manager`；正式桌面快捷方式目标已核对，并从该快捷方式成功启动，主窗口进程响应正常。
- release 与正式安装目录的 `resources/app.asar` SHA-256 均为 `917c35faa86d689f9310ba4076abc98f20f8fba024b4d63152de84c33692cf08`。

## Risks and follow-up

- CloudDrive 实际删除耗时仍由服务端响应、网盘限流和网络质量决定；本轮目标是隔离这些延迟，不承诺远端完成时间。
- 远端部分失败时，失败项只会在任务进入最终状态并释放占用后重新出现在候选结果中，避免处理中途与仍在执行的任务重复提交。
- 本轮保持既有大小加整秒时长的候选判定和 CloudDrive API 快速删除契约，不增加视频内容读取或 SHA-256。
