---
date: 2026-09-02
branch: ai/manual-scan-reconcile
type: fix
status: completed
---

# 0.1.10 手动扫描可靠检测同路径替换

## Context

普通 local/SMB 的目录快照由目录 mtime、直属文件/子目录数量和名称摘要组成。文件同路径原地替换、父目录 mtime 不变时，原实现会跳过该目录，无法发现视频自身 size/mtime 变化。产品契约要求自动和全库扫描保持快速，用户主动重新扫描当前文件夹则可靠检查轻量文件版本信息。

## Changes

- 先加入精确回归测试，确认 size 100/T1 变为 size 200/T2、目录 mtime 和文件名/数量不变时，旧实现返回 `updatedVideos: 0`，P1 风险真实存在。
- 普通 local/SMB 的 `current-folder` 模式在快照命中时逐个读取直属视频 size/mtime，并复用现有 `processVideoFile` 版本判断；未变化视频不进入 FFprobe，变化视频才重置为 pending 并加入 MetadataQueue。
- `scan-all` 和启动后台同步保持 Directory Snapshot fast path，未变化 10,000 视频树继续为 0 次视频 stat。
- CloudDrive API 分支不进入 local reconcile，继续依赖强制刷新 listing 的 scanIdentity、size 和 modifiedAt。
- ScanManager 仍保持全局串行；仅收紧任务复用语义，运行中的 `scan-all` 不再吞掉随后到来的可靠 `current-folder` 请求，可靠扫描会在其后排队。
- 新增 10,000 视频平铺目录单 entry 变化计数测试：当前 changed-directory 分支执行 10,000 次视频 stat、每个直属视频至多一次；本轮保留架构，不做无证据重构。
- 打包 smoke 增加仅在测试环境输出的预览阶段标记，并显式聚焦窗口、滚动到真实卡片、点击真实“重新生成预览”控件；避免隐藏测试窗口的 IntersectionObserver 时序影响门禁，不影响正常应用运行。
- 版本更新至 0.1.10；未修改数据库 schema、重复项逻辑、SHA 路径或用户视频文件。

## Verification

- 修复前定向 P1 回归：FAIL，`updatedVideos` 实际为 0，确认风险。
- `vitest run tests/main/libraryScanner.incremental.test.ts`：PASS，23/23。
- 扫描相关回归：PASS，`libraryScanner`、network、incremental、CloudDrive 和 ScanManager 共 68 项。
- P2 本机合成基线：10,000 视频平铺目录一项变化时 `directoryReads=1`、`directoryStatReads=1`、`videoStatReads=10000`。
- `npm run lint`：PASS，包含 Node/Web TypeScript typecheck。
- `npm test`：PASS，54 个文件、549 项测试，Node 22.23.1 / ABI 127。
- `npm run dist:win`：PASS，生成 0.1.10 win-unpacked 和 NSIS 安装包；Electron 33.4.11 / ABI 130 native smoke 通过。
- `npm run test:electron-smoke` / `npm run verify:artifact`：PASS，asar 3960 项且无禁止的开发产物。
- `npm run test:packaged-smoke`：PASS，创建/重开数据库、媒体协议、renderer 安全、FFmpeg/FFprobe 及预览稳定性均通过。初始运行暴露 detached `Image.decode()` 和未聚焦测试窗口的时序不稳定；门禁改为验证真实可见卡片并点击真实重生成控件后通过，未发现扫描代码错误。
- 0.1.10 NSIS 静默安装：PASS，安装包内 `package.json` 版本为 0.1.10。
- 桌面快捷方式：`C:\Users\test\Desktop\Local Video Manager.lnk`，目标为正式安装目录 `C:\Users\test\AppData\Local\Programs\Local Video Manager\Local Video Manager.exe`；从快捷方式启动后确认正式进程存在。
- release 与正式安装目录的 `resources/app.asar` SHA-256 均为 `90ea5efcaa4da79b2e78dda0792d86f15c4370e5bf7a2291b8db9ba0296e1efb`。
- Windows Computer Use 当前未枚举到原生应用窗口，因此未进行额外截图式人工验收；真实打包页面入口、可见封面、重生成和 5 秒轮询稳定性由 packaged smoke 验证。

## Risks and follow-up

- 手动 current-folder 扫描普通 local/SMB 会按视频数量产生轻量 stat，超大网盘目录耗时高于快速全库扫描；这是可靠识别同路径替换的明确成本，不读取视频内容。
- changed-directory 的超大平铺目录仍会检查全部直属视频。已有计数基线证明其为 O(n) 且每项一次；后续只有真实性能数据显示不可接受时再评估分批或提供商级变更日志。
- 真实 SMB 在文件原地替换、父目录 mtime 不变场景仍需实机验证；自动测试使用受控 Stats 模拟。
- 真实 CloudDrive2 E2E：NOT RUN。
