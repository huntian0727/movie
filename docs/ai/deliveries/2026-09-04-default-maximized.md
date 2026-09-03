---
date: 2026-09-04
branch: ai/default-maximized
type: fix
status: completed
---

# 0.1.13 主窗口启动时默认最大化

## Context

映匣主窗口此前创建后立即以固定的 1280×800 尺寸显示。用户要求每次打开软件默认全屏；本轮按 Windows 桌面应用的常见语义实现为最大化窗口，保留标题栏、任务栏和正常的还原能力，而不是进入播放器式独占全屏。

## Changes

- 主窗口创建时使用 `show: false`，完成本地页面或开发服务器页面加载后先调用 `maximize()`，再调用 `show()`，避免启动时出现从小窗口放大的视觉闪动。
- 最大化行为仅应用于资料库主窗口；播放器窗口尺寸及播放器内部全屏控制保持不变。
- 抽取可单测的窗口展示函数，并增加“先最大化、后显示”的顺序回归测试。
- 版本更新至 0.1.13；未修改资料库、扫描、CloudDrive 或删除逻辑。

## Verification

- 定向 `windowPresentation` 回归：1/1 PASS；`npm run lint`：PASS。
- `npm test`：PASS，55 个测试文件、556 项测试。
- `npm run test:release-gate`：PASS；lint、生产构建、37 项 Windows 文件操作、32 项迁移、23 项性能/缓存/播放器基线及完整 Node 套件全部通过。
- `npm run dist:win`：PASS，生成 0.1.13 `win-unpacked` 与 NSIS 安装包；Electron 33.4.11 / ABI 130 native 与主进程 smoke 通过。
- `npm run verify:artifact`：PASS，asar 3,961 项且无禁止的开发产物。
- `npm run test:packaged-smoke` 与严格当前版本 `npm run test:installer-smoke`：PASS；安装器明确为 `Local-Video-Manager-0.1.13-x64-Setup.exe`。未授权 IPC 拒绝日志是安全负向检查的预期结果。
- 0.1.13 已静默覆盖安装到 `C:\Users\test\AppData\Local\Programs\Local Video Manager`，桌面快捷方式指向正式安装路径并已启动。
- 使用 Windows `IsZoomed` 对真实安装窗口检查：`True`；确认启动后的主窗口处于最大化状态。
- release 与正式安装的 `resources/app.asar` SHA-256 均为 `c56bf29283be764a532f920fb332c53c80e5704ddb2ade02d95001ebee7dfac0`；安装包内版本为 0.1.13。

## Risks and follow-up

- 最大化使用当前显示器的可用工作区，因此会保留 Windows 任务栏；如果未来需要无边框独占显示，应作为独立设置提供，而不应改变本次默认最大化契约。
- 多显示器时窗口仍由 Windows/Electron 的默认放置策略决定，本轮不新增窗口位置持久化。
