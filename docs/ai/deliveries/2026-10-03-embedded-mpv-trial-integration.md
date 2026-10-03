# 内嵌 MPV 个人试用集成交付记录

## Context

用户同意在已完成原型验证后进行可回退的正式个人试用集成。默认稳定播放策略不变；长时间播放按用户要求不测。

- 分支：`ai/embedded-mpv-trial-integration`
- 开发基准：`946ab7bd6e1c01217e7ca9fbf9e703160059693a`，开发前与 origin/main 一致、工作区干净。
- 开发前快照：`2026-10-03_04-17-49-623_embedded-mpv-trial-integration`
- checkpoint：`checkpoint-20261003-121745-946ab7b-embedded-mpv-trial-integration`，已推送。
- 数据库一致性快照成功，quick_check 通过。没有主动修改扫描/文件管理/删除流程/数据库 schema。

## Changes

新增：`native/embedded-mpv/NativeHost.cs`；`src/main/embeddedPlayer/{embeddedPlayer,controlQueue}.ts`；`src/shared/embeddedPlayback.ts`；`src/renderer/components/EmbeddedPlayerPage.tsx`；原生构建/生产服务验证脚本；三组试用回归测试；本轮架构说明文档。

修改：设置及共享播放类型/规则解释、现有 main/preload/trusted IPC 桥、播放窗口只读访问入口、App 的可选播放分支、独立页面样式、打包脚本和资源配置、IPC channel 合同测试、gitignore。原播放器组件没有修改。没有删除文件。

新增独立内嵌试用策略：暂停、跳转、旋转、音量、全屏、切换队列、音轨、字幕、SRT；进度复用原播放历史；key/token 隔离及期限失败提示；保存位置后回退到原方式。Renderer 不接受文件路径/原生命令，native 进程在关闭时清理。

本机已部署开发前验证的 DLL 到 userData/native-player，只用于本机试用；Git 及公开安装包不附带该 DLL。许可证边界见 [方案说明](../reports/embedded-mpv-trial-integration.md)。

## Verification

- 初次 targeted 测试发现 IPC 期望 channel 列表未更新；已补齐并通过后续全量测试，不隐去该失败。
- 正式服务五类中性样本短时实测通过；不使用原型成功代替生产服务验证。
- 缺失运行库、错误调用窗口、已标记缺失文件、过期停止请求的服务单测通过。
- 完整最终 `test:release-gate` 通过：lint/typecheck/build；Windows 文件门禁 37；migration 32；performance 25；全量 Vitest 89 文件、781 测试全部通过。
- `prepare:electron`、`test:electron-smoke` 通过，Node 22.23.1/npm 10.9.8，Electron 33.4.11/ABI 130；原生 C# 编译成功。
- 增强完成状态断言后再次运行正式服务短时脚本，退出码 0，五类样本通过；检查无 NativeHost 残留。
- 独立 `test:e2e` 脚本不存在，不适用；不把它写成通过。
- `package:dir`、`verify:artifact`、`test:packaged-smoke` 全部通过。包内 3997 项，原生 helper 34,816 字节；不附带 libmpv DLL。打包 smoke 含预期的非信任页面 IPC 拒绝测试日志，不是将失败绕过。
- 功能 Commit：`2258d08`；已正常推送功能分支及 main，旧 main 备份：`backup-main-20261003-124313-946ab7b`。
- 本轮功能包：`release/win-unpacked/拉面影视.exe`；真实桌面 `拉面影视.lnk` 指向该文件。`app.asar` 生成于 2026-10-03 12:44:03 +08:00，晚于功能 Commit 的 12:43:06。
- 已从实际快捷方式启动，识别到正确 exe 路径和主窗口，Accessibility 证实正式资料库及顶部设置入口加载。程序进程 Responding=true。
- **桌面版本尚未交付（完整界面验收阻塞）**：Computer Use 两次激活均报 `failed to activate captured window`，截图只捕获到桌面背景。已按技能停止 UI 输入，未尝试绕过限制。新的设置选项和实际正式播放页的人工点击验收仍为 NOT RUN；需要用户将窗口切到可见前台后继续。

## Risks and follow-up

个人可选试用，不改默认。长时播放/真实听音 NOT RUN；云盘原始带宽、服务器随机读取能力无法由内嵌解码器消除。该策略读挂载路径，非新 CloudDrive 直链播放。现有恢复历史查询覆盖最近 200 条，不保证所有旧视频自动恢复。

公开附带 DLL 发布尚未通过运行库及其依赖的再分发审查；换机器需单独配置运行库。停止异常有强制结束期限，桌面验收仍需检查进程残留。下一阶段优先实际使用反馈，不自动将试用选项设为默认，也不增加长时测试。

本次最后追加只修改交付记录，功能包来自 `2258d08`，不得把文档后续 Commit 时间冒充该包构建时间。待用户恢复可见窗口后，完成设置试用、暂停/跳转/旋转/全屏/回退及关闭验收，并按桌面交付规则再次检查最终 Commit 与包时间。
