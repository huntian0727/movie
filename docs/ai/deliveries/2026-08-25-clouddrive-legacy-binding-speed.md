---
date: 2026-08-25
branch: ai/clouddrive-mount-binding
type: fix
status: completed
---

# CloudDrive 旧资料库快速绑定提速

## Context

旧资料库共有约 31,559 个未绑定重复候选，分布在 3,208 个远端目录。原实现固定 8 并发查询全部目录，并在所有 RPC 结束后一次性写库；因此等待时间长，中途关闭会丢失全部进度，页面也无法显示进度或取消。

## Changes

- 将远端目录绑定改为 64 目录一批，成功身份每批立即提交；下一次运行由现有未绑定候选查询自然续跑。
- 并发从 16 起步，按批次延迟和错误率在 8–32 之间自适应，并复用应用内目录列举缓存。
- 取消信号传入活动 `GetSubFiles` HTTP/2 流；取消后停止派发新目录，保留已落库批次。
- 新增绑定状态和取消 IPC；重复项页面显示目录进度、速度、并发、匹配数量和 ETA。
- 增加取消后分批结果仍保留、再次运行仅处理剩余候选，以及页面进度/取消的回归测试。

## Verification

- `npm run typecheck`：PASS。
- Node 22.23.1 针对性测试：PASS，3 个测试文件、27 项测试。
- `npm run test:release-gate`（Node 22.23.1 / npm 10.9.8）：PASS，49 个测试文件、507 项测试。
- `npm run package:dir`：PASS；Electron 33.4.11 / ABI 130 native smoke PASS。
- `npm run verify:artifact`：PASS，asar 3,958 个条目，无禁止开发产物。
- `npm run test:packaged-smoke`：PASS，打包应用数据库、协议、Renderer、Preload、CSP、FFmpeg/FFprobe 检查通过。
- 桌面快捷方式 `C:\Users\test\Desktop\Video Manager (Dev).lnk` 已确认指向本轮 `release\win-unpacked\Local Video Manager.exe`，并从该快捷方式实际启动。
- 真实 CloudDrive2 + 115：PASS。旧实现日志中 3,208 个目录耗时 1,074,178ms（约 3.0 目录/秒）；本轮对剩余 309 个目录实测耗时 32,224ms（约 9.6 目录/秒），界面实时显示 11–16 目录/秒、并发和 ETA，成功保存 134 个绑定结果。剩余目录多为上一轮已失败目录，因此不将成功率与旧任务直接比较。

## Risks and follow-up

- 实际吞吐仍受 CloudDrive 服务端并发上限与网盘响应时间限制；界面会展示真实速度和 ETA，错误时自动降并发。
- `GetSubFiles` 只提供单层目录列举，当前仍需按不同候选目录请求；未在缺少实测语义的情况下改用全局搜索接口。
