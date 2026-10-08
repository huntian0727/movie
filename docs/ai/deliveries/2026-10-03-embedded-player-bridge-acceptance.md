# 内嵌播放桥接修正与桌面复验

## Context

用户将软件打开后继续上轮受阻的桌面验收。基准 `73de62e` 与 origin/main 一致，工作区干净。分支：`ai/embedded-player-bridge-acceptance`。

开发前快照：`2026-10-03_05-03-15-401_embedded-player-bridge-acceptance`；checkpoint：`checkpoint-20261003-130312-73de62e-embedded-player-bridge-acceptance` 已推送；SQLite 0.87GB、345479 条记录、quick_check 成功。备份时播放策略为临时试用，测试结束需恢复先前 `auto`。

## Changes

桌面观察确认试用选项存在，但点击视频后播放窗口空白、没有 NativeHost。源码检查定位：`mainApi` 有内嵌接口，实际播放窗口的精简 `playerApi` 未包含 `embeddedPlayback` / `subscribeEmbeddedKeys`。组件 effect 因缺少方法抛错；先前完整 API mock 没覆盖角色桥接，因此即便生产服务和 mock 组件测试通过，也不能替代桌面验收。

最小修正：仅为精简桥接增加这两个现有类型化方法，并用 Pick 类型强制保留；不添加通用 invoke、不开放主窗口管理接口。打包 smoke 新增实际播放器桥接方法存在性断言。

新增 `tests/main/embeddedPlayerBridge.test.ts`：执行真实 preload 的 player-role，而不是伪造完整 API。覆盖 ID-only IPC 转发、精简权限不变、键事件白名单和监听器清理、非信任页面不暴露桥接。

修改文件：`src/main/preload.cts`、`src/main/packagedSmoke.ts`。新增上述测试及本交付文档。删除文件：无。扫描/数据库 schema/文件删除流程/播放器核心逻辑均未修改。

## Verification

真实用户快捷方式的当前包已观察到试用策略；复验中发现并记录上述空白窗口，不将此前测试通过作为桌面通过。

修正后的 `test:release-gate` 通过：lint/typecheck/build；Windows 文件门禁 37、migrations 32、performance 25、全量 Vitest 90 文件/784 测试。`prepare:electron` / `test:electron-smoke` 通过（Electron 33.4.11、ABI 130）。独立 test:e2e 不存在，不适用。

功能修正 commit `e1f7c2a` 后执行 `package:dir`、`verify:artifact`、`test:packaged-smoke`，均通过；实际打包 preload 的 `playerBridgeHasEmbeddedPlayback=true`、`playerBridgeMinimized=true`。产物包含 NativeHost.exe，不包含 libmpv DLL。功能 commit 时间 13:07:03，app.asar 时间 13:07:41，二者属于本轮。

从真实桌面快捷方式 `%USERPROFILE%/Desktop/拉面影视.lnk` 启动新包，目标为 `%USERPROFILE%/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。使用本地测试视频验证：

- 内嵌窗口显示连续视频画面，不再空白；音轨列表识别到 pcm_alaw。
- 暂停、前进 10 秒（16.3 秒到 26.3 秒）、90° 旋转均实际生效。
- 全屏及 Escape 返回窗口成功，控制区未被原生视频遮挡。
- 下一部切换至 7:48 视频，文件名和画面更新、旋转重置。
- 回退返回旧 PlayerPage，显示保留的 00:41 进度，并按用户既有外部播放配置打开 PotPlayer；非声称回退仍使用内嵌解码。随后关闭本轮测试窗口。
- 再次打开内嵌视频后点击“关闭”，窗口消失；只读检查确认 NativeHost 在清理时限内退出，无残留。不把刚关闭瞬间仍处于退出中的进程视为清理完成。
- 将临时播放策略从 embedded-first 恢复为原来的“自动选择”；未变更 API 配置或扫描设置。

长时间播放 NOT RUN（按用户要求）；真实听音 NOT RUN；本轮真实 SRT/多音轨切换、CloudDrive 播放 NOT RUN。历史进度重开恢复未单独验收，不以回退进度保留代替该项测试。未进行文件删除、重新扫描或修改数据库结构。

交付记录提交后仍须再次以最终分支生成桌面包、检查快捷方式/asar 时间并实际启动；最终回复以该轮检查结果为准。本轮更新便携桌面包，不声称生成或安装新的 NSIS 安装器。

## Risks and follow-up

默认保持自动选择，用户原设置已恢复。运行库仍为本机配置，不附带到公开包；许可证及长时稳定性边界沿用上轮说明。修正后的本机可选试用已通过上述桌面检查，不代表所有格式、网络来源或长时运行已验收；公开发行解码运行库前仍需完成许可证及分发审查。后续优先在正常使用中收集问题，再决定是否扩大默认覆盖范围。
