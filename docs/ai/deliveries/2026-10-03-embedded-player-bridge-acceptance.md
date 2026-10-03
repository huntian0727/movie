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

重新打包和实际快捷方式播放复验进行中；完成后追加真实结果。长时间播放 NOT RUN，真实听音 NOT RUN。

## Risks and follow-up

默认保持自动选择；试用结束恢复用户原设置。运行库仍为本机配置，不附带到公开包；许可证及长时稳定性边界沿用上轮说明。修正前桌面版本不能作为可用内嵌试用交付；须确认新包的桥接实际生效、画面及控制区可操作、回退和关闭清理后才宣告本机试用可用。
