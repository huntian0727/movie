---
date: 2026-10-05
branch: ai/embedded-fullscreen-controls
type: fix
status: completed
---

# 内嵌解码全屏控制栏自动隐藏

## Context

用户反馈内嵌 MPV 全屏仍常驻上下控制栏。此次只修复播放窗口的全屏呈现和相关输入，不修改扫描、数据库结构、文件管理、删除策略或解码选择策略。

- 开发基准：`4f615a1bbbe86fad9c55182e6590a6dbb4db87be`；开始时工作区干净，已核对 `origin/main` 一致。
- 开发前 checkpoint：`checkpoint-20261004-215624-4f615a1-embedded-fullscreen-controls`，已推送。
- 数据快照 ID：`2026-10-04_13-56-27-766_embedded-fullscreen-controls`；一致性快照约 0.87 GB、345,479 条视频记录，SQLite quick_check 正常。
- 开发/检查跨越 10 月 4 日至 5 日，本记录采用最终交付日期。

## Changes

### 原因与实现

1. 原实现刻意排除内嵌播放的自动隐藏；全屏仍通过 grid 为顶部/底部控制栏预留固定高度，因此既常驻又缩小画面。
2. 全屏内嵌视频视口改为占满可用窗口，控制栏为绝对定位。没有交互时约 2.2 秒隐藏，鼠标移动唤出；控制区悬停、键盘焦点、拖动、播放列表、对话框和相关错误状态保持显示。
3. 原生子 HWND 不能由 DOM 的 z-index 覆盖。控制栏显示时使用 `SetWindowRgn` 暂时裁剪对应上下条带，让 DOM 控制栏可见、可点击；隐藏时解除裁剪。改变的是可见区域，不是解码或渲染视口大小，也不重新创建播放会话。
4. 原生端每 100 ms 检查一次真实指针位置，仅在位置变化且位于当前播放器父/子窗口时发送有界坐标。避免全局钩子、模拟输入、静止指针产生重复唤醒，以及跨线程 mpv VO 子窗口无法被 WinForms 消息过滤器完整捕获的问题。
5. Renderer 按 DPR 转换坐标判断控制区；移回画面时清除工具栏残留焦点，避免点击全屏后永远不隐藏。bounds 和区域签名去重，静止界面不反复更新原生区域。
6. 保留窗口模式布局；全屏播放列表底部与 142 px 控制区域对齐，避免重叠。播放列表原有的侧向空间预留保持不变。

原生区域句柄在成功设置后由 Windows 管理，仅失败时自行释放；依据 [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn) 的所有权契约。

### 修改文件

- `native/embedded-mpv/NativeHost.cs`：指针观察、区域裁剪和生命周期释放。
- `src/shared/embeddedPlayback.ts`：可选裁剪参数、指针输入契约。
- `src/main/embeddedPlayer/embeddedPlayer.ts`：拒绝遮挡全部视频的 bounds 请求。
- `src/main/preload.cts`：验证指针坐标，过滤无效/不完整坐标和额外字段。
- `src/renderer/components/useEmbeddedEngine.ts`：测量控制区和 DPR，发送裁剪范围并去重。
- `src/renderer/components/PlayerPage.tsx`：自动隐藏、唤出、交互保持和焦点释放。
- `src/renderer/styles.css`：全屏覆盖布局和播放列表边界。
- `scripts/test-embedded-player.mjs`：生产服务测试增加真实原生视口/区域遥测断言。
- `tests/main/embeddedPlaybackContract.test.ts`、`tests/main/embeddedPlayerBridge.test.ts`、`tests/main/embeddedPauseConfirmation.test.ts`：契约、preload 转发与遮罩边界测试。
- `tests/renderer/UnifiedPlayer.test.tsx`：全屏自动隐藏、悬停坐标、焦点、播放列表、退出全屏、DPR 和视口不变测试。

新增文件：本交付记录。删除文件：无。无运行数据库、媒体、凭据或构建产物提交。

## Verification

### 自动检查（实际运行）

| 检查 | 结果 |
| --- | --- |
| `npm run test:release-gate` | PASS：lint/typecheck/build、Windows 文件 37 项、迁移 32 项、性能 30 项、完整 Node 套件 101 个文件 / 873 项测试 |
| Renderer UnifiedPlayer | PASS：31 项，包含新增自动隐藏与鼠标坐标测试 |
| `npm run package:dir` | PASS：最终源码含播放列表 CSS 调整；原生 C# 编译、Electron ABI 重建和目录包成功 |
| `npm run verify:artifact` | PASS：4,002 个 asar 条目，没有禁用产物 |
| `npm run test:packaged-smoke` | PASS |
| `npm run test:electron-smoke` | PASS |
| 生产 EmbeddedPlayer 五格式矩阵 | PASS：H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨/字幕 |
| 原生裁剪切换 | PASS：每种格式 4 次，共 20 次；1000×500 解码/渲染视口不变，保持暂停 |
| 矩阵既有播放回归 | PASS：暂停确认 0–2 ms、seek、旋转含恢复 0°、音量/静音、全屏、会话替换、陈旧 stop、恢复进度、EOF 和轨道信息 |
| `git diff --check` | PASS |
| 独立 E2E npm 脚本 | 不适用：package.json 没有该脚本；使用生产矩阵与真实桌面交互验证 |

全量 gate 在最终播放列表底部的 CSS-only 调整之前执行；随后完整构建、桌面包检查和真实播放列表布局验证覆盖该调整。Node 与 Electron 的 better-sqlite3 ABI 不同，分别按各自运行时构建；等价检查已在本轮同一工作区完整执行，交付脚本可使用 `-SkipChecks`，不是豁免失败检查。

### 真实桌面验证（提交前已完成）

使用 Computer Use 技能，通过用户实际桌面快捷方式启动当前目录包，但以独立测试 user-data 和五个中性合成媒体验证。没有打开/扫描用户真实资料库，没有操作真实媒体删除。

- HEVC/DTS 在既有播放器壳内显示；全屏静置 3 秒上下栏隐藏，画面比例/位置保持。
- 移动指针唤出；停留在底部控制区超过 3 秒仍可见。
- 播放列表按钮可操作，五个视频正常列出；列表开启时控制栏保持，列表底部与控制区没有重叠。
- 浏览器播放残留焦点、内嵌退出全屏恢复布局由 Renderer 回归测试覆盖；提交后的快捷方式复查继续验证真实退出全屏。

第一次真实 UI 验证发现仅靠 WM_MOUSEMOVE 消息过滤不能可靠唤出，已改为作用域受限的指针位置观察并复测通过。第一次生产矩阵扩展使用 readline.close 干扰共享 stdout，导致测试等待超时；改为可拆卸 data 监听后完整矩阵通过。两项失败均已修正，不将失败运行计为通过。

### 桌面交付路径

- 目录包：`release/win-unpacked/拉面影视.exe`。
- 已核对 `%USERPROFILE%/Desktop/拉面影视.lnk` 真实目标为当前仓库的上述可执行文件，无附加参数。
- 提交后必须再次重新打包，检查 app.asar / 原生宿主时间晚于 Commit，并从同一实际快捷方式复查全屏；完成之前不宣称桌面交付。具体 Commit、推送旧 main 备份标签及最终包时间由自动交付输出和最终回复记录。

## Risks and follow-up

- 原生窗口与 DOM 不能透明混合，唤出时控制栏使用不透明背景并遮住上下条带；隐藏时恢复完整可见区域，不挤压画面。
- 原生指针观察上限 10 Hz，唤出存在最多约一个采样周期及 UI 调度的延迟，不承诺零延迟。暂停、解码和磁盘读取策略未因鼠标移动改变。
- 真实桌面验证在单屏当前 DPI；DPR=2 有自动测试，但多屏跨 DPI、高码率 4K/HDR、CloudDrive 弱网实际播放、长时间播放均 NOT RUN。
- 五种合成格式通过不代表所有格式/驱动一定正常。播放列表开启时原有的宽度预留仍存在，此次保证的是上下控制栏显隐不改变视口尺寸。
- 回滚从上述 checkpoint / 自动创建的旧 main 备份标签创建修复分支，通过正常 revert/提交交付；禁止强制回退 main 或覆盖用户数据。
