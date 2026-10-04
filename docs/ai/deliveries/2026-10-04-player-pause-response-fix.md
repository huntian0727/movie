---
date: 2026-10-04
branch: ai/player-pause-response-fix
type: fix
status: completed
---

# 播放/暂停点击延迟修复

## Context

- 基线 `9ce7660d55b6882c69b4ca168f41df96a57544a6`，工作区干净，fetch 后与 origin/main 一致。
- 开发前快照 `2026-10-04_01-57-56-111_player-pause-response-fix`（UTC 命名）；345479 视频，SQLite quick_check OK，源码 bundle、设置及 manifest 一并保存。
- Checkpoint `checkpoint-20261004-095752-9ce7660-player-pause-response-fix` 已推送。更新 main 前的备份标签由交付脚本生成，最终回报提供。
- 原生画面先等待 Windows 双击时间，再进入 Renderer 220ms 单击延迟；按钮请求忽略返回状态，界面要再等 250ms 查询与原生 200ms snapshot。快速点击基于滞后的 playing 状态，重复发相同暂停值；缓冲/跳转阶段错误地把 phase 非 playing 当作已暂停。

## Changes

- `native/embedded-mpv/NativeHost.cs`：第一下点击立即上报，双击定时器仅分类第二下；pause 返回真实 MPV pause 属性、token、controlId 的关联确认，保留 200ms 周期遥测，不提高轮询频率。
- `src/main/embeddedPlayer/embeddedPlayer.ts`：pause IPC 等待对应实际确认；3 秒超时、最多 64 条待确认，结束/失败/切换会话时释放；不会把“已发送”当成“已暂停”，不进入 seek/rotate 队列。不新增公开 IPC、不扩大权限。
- `src/renderer/components/useEmbeddedEngine.ts`：pause 确认后立即应用状态；单独维护最新暂停意图，快速点击交替正确；旧查询、旧命令与旧会话返回不能覆盖最新确认；失败释放意图并保留真实已观察状态。
- `src/renderer/components/PlayerPage.tsx`：单击立即执行；双击恢复第一下点击前的播放意图再切换全屏；暂停判断改用真实 pause 属性，不受 buffering/reading 阶段误导。未新增 UI、未改播放路由、数据库、扫描或用户文件。
- `scripts/test-embedded-player.mjs`：5 种中性编码每种增加 6 次 pause/resume，必须在控制返回中获得确认，逐次记录耗时（上限 500ms，非 UI/网盘性能承诺）。
- 测试：新增 `tests/main/embeddedPauseConfirmation.test.ts`、`tests/renderer/embeddedPauseLatency.test.tsx`；修改 `UnifiedPlayer.test.tsx`、`PlayerPage.test.tsx`。
- 删除文件：无。

## Verification

- 修复前 4 项 Renderer 回归：FAIL，证实按钮滞后、快速连点值重复、单击延迟及 buffering 暂停误判；修复后 PASS。
- 确认关联、错误 token、真实属性不匹配、超时/停止释放，以及旧查询/失败/会话替换测试：PASS。
- `npm run test:release-gate`：PASS，99 文件 / 835 项；lint/typecheck/build、Windows 文件 37、迁移 32、性能 26 全部通过。新增测试初次执行的 fixture/import 问题已修复，最终门禁成功。
- `npm run prepare:electron`、`npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。
- `node scripts/run-timeline-preview-smoke.mjs`：PASS，悬浮预览未挤压视频且不夺取焦点。
- 真正生产 EmbeddedPlayer + libmpv 中性矩阵：PASS，H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨字幕；30 次 pause/resume 实际属性确认 0～2ms（仅本机服务侧，不包含鼠标、Renderer、网络/解码缓冲）；seek、旋转回零、音量、全屏、替换会话、播放历史通过。
- 无独立 E2E npm 脚本：不适用；以真实 Electron、MPV 矩阵、packaged smoke 与桌面快捷方式人工验证覆盖。
- 最终 Commit 后重建 win-unpacked、artifact/packaged smoke 和快捷方式验证是收尾门禁，实际结果在最终回复报告，不在尚未执行前声明通过。

## Risks and follow-up

- 双击为了让单击无延迟，会先短暂执行第一下点击，再恢复先前播放意图进入全屏；最终播放状态保持不变，不承诺完全没有瞬时播放/暂停。
- 网络读取、缓存不足、GPU 解码仍可能影响“恢复画面”的耗时，不能把 pause 属性即时确认等同于任何媒体都立即出帧；真实用户云盘素材及长期播放 NOT RUN。
- main 与 NativeHost 的 pause 协议必须同包更新，不能混用旧 helper。旧直接验证脚本未携带 controlId 时原生兼容返回 0；生产服务总是提供关联 ID。
- 桌面快捷方式目标 `C:/Users/test/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。本轮正常退出旧软件后，用独立中性资料库复测，不操作用户真实视频。
- 回滚从本次 backup-main/checkpoint 标签创建修复提交；数据必要时用一致性快照恢复，不强制回退 main。
