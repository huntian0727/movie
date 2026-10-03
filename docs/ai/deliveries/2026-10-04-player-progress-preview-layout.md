# 播放进度条加粗与上方悬停预览

## Context

用户要求播放进度条厚度增至当前 3 倍，悬停预览从下方移到上方。开发基线 `9412678573db5a7ee19f37b24697bd28f1ea0239`，与 GitHub main 一致，工作区干净；分支 `ai/player-progress-preview-layout`。

开发前快照：`2026-10-03_17-42-16-756_player-progress-preview-layout`（快照名称使用 UTC）；checkpoint：`checkpoint-20261004-014212-9412678-player-progress-preview-layout` 已推送。数据库约 0.87 GB / 345479 视频，quick_check OK。

## Changes

- `src/renderer/styles.css`：普通进度轨道 4→12px，全屏 6→18px；滑块调为 20px；预览统一位于进度区域上方 8px，撤掉内嵌解码模式的向下定位规则。
- `src/renderer/components/PlayerPage.tsx`：测量悬停预览实际高度。原生子窗口无法被 DOM 覆盖，仅悬停时缩小其底部范围以留出预览空间，离开恢复。沿用现有 bounds 通道，不重启解码会话，不改变进度跳转、预览缓存或生成逻辑。
- `tests/renderer/UnifiedPlayer.test.tsx`：验证悬停让位、全屏保持、离开恢复、不重启/跳转。
- 新增 `tests/renderer/playerProgressStyles.test.ts`：普通/全屏三倍厚度、轨道宽度不变、两个解码模式上方定位回归。
- 新增本交付文档；未修改扫描、数据库、主进程或解码核心。

## Verification

- 定向 PlayerPage / UnifiedPlayer：38 项 PASS。
- 完整 `npm run test:release-gate`：PASS，类型检查、构建、Windows 文件 37 项、迁移 32 项、性能 25 项；完整 Vitest 94 文件 / 806 项 PASS。
- `git diff --check`：PASS。
- `npm run prepare:electron` / `npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。
- 提交后桌面打包、产物检查、packaged smoke、实际快捷方式启动及上方预览界面检查为交付收尾项；最终实测结果见本任务最终回复，未提前标为 PASS。

## Risks and follow-up

内嵌解码原生窗口有层级限制，悬停预览出现时画面区域会临时变小，移开恢复；预览不覆盖视频窗口，不引入第二套播放器或新的窗口。时间预览沿用已有懒加载缓存，未缓存截图仍可能需要生成等待。本轮使用合成媒体和独立资料库验证，不播放真实私有媒体或删除文件。回滚使用本轮 checkpoint/快照和更新 main 前的 backup-main 标签，以新提交恢复，不强制倒退 main。最终桌面包未通过打包/实际快捷方式验证前不得宣称桌面版本交付。
