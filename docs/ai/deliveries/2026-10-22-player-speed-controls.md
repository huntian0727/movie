# 播放器倍速功能（第二个修复事项，待统一打包）

- 日期：2026-10-22；开发分支 `ai/fix-duplicate-background-banner`，前一项修复基线 `36d7929`。
- 用户决定：剩余问题修复后再统一生成 Windows 发布包；本轮不重打包、不升级界面版本、不推送 GitHub，也不覆盖正在使用的桌面程序。
- 开发前本地备份：`2026-10-21_16-11-35-483_player-playback-speed`，SQLite 0.92 GB / 363216 条视频 / quick_check `ok`；本地 checkpoint `checkpoint-20261022-001131-36d7929-player-playback-speed`。其他 AI 先前留下的 CI、Changelog、交接与测试改动继续保留，不属于本功能提交。

## 功能实现

- `PlayerPage`（实际播放器主入口）底部音量滑块旁新增「播放倍速」选择：`0.5×、0.75×、1×、1.25×、1.5×、1.75×、2×`；默认 `1×`，视频切换保留当前窗口内的选择；播放器不重新创建会话和窗口。
- Chromium/HTML5 `<video>` 直接设置 `playbackRate`，在源切换及视频元数据重新加载时同步当前速率。
- MPV：新增严格枚举白名单的 `embeddedRequestSchema` `speed` 命令；Electron 主进程 `EmbeddedPlayer` 维护当前希望倍速，将它应用到新播放会话加载指令，宿主 C# `NativeHost` 调用 `mpv_set_property_string("speed", ...)`，遥测 snapshot 增加原生实际 `speed`，界面可回显实际状态。无任意命令或任意文件 IPC 参数，安全边界不放宽。
- 保留实验性 `EmbeddedPlayerPage` 的同款速度选择；外部独立 MPV 的控制由外部窗口本身负责，应用倍速框禁用，避免误导。
- `src/renderer/styles.css` 为倍速选择补充深色风格和窄窗口样式；`docs/USER_GUIDE.md`、`docs/user-guide/0.1.16.md`、`CHANGELOG.md` 增加未发布说明。

## 实际测试

- `npm run typecheck`：PASS。
- `npx vitest run tests/renderer/PlayerPage.test.tsx tests/renderer/UnifiedPlayer.test.tsx tests/renderer/EmbeddedPlayerPage.test.tsx tests/renderer/embeddedPauseLatency.test.tsx tests/main/embeddedPlaybackContract.test.ts tests/main/embeddedPauseConfirmation.test.ts tests/main/embeddedPlayer.test.ts`：**7 文件、95 测试 PASS**。覆盖默认倍速、0.5×～2×列表、HTML video 实际 `playbackRate`、视频切换、内嵌 MPV IPC 下发、后端会话保持、恶意/非法数值拒绝、外部窗口禁用等。
- `scripts/build-native-player.mjs` 使用项目固定编译工具链将新 C# 宿主**成功编译**至隔离 `.tmp/player-playback-speed-host/NativeHost.exe`，产物 SHA-256 `2a4e64a26bd6ba59b1de4ef340468e36b839cc8b88a46548bf99eb92592900c7`；未覆盖 `native-bin/NativeHost.exe` 或已交付日常包。
- 额外尝试隔离 Electron + 真 MPV 视频速度探测，但独立 Electron 子进程未产出 `speed-real-smoke.json` 报告，因此**不能记为 E2E PASS**；实际新宿主+视频端到端手动观感待最终统一打包时一并核验。前述 TypeScript / IPC / C# 编译证据仍有效。

## 交付界限

- 本次尚**未**重新打包、安装、启动用户桌面快捷方式或公开发布，不影响现有日常 v1.2；未来统一发布时按约定递增界面次版本一次即可。
- 真实视频和个人媒体文件未被删除；没有修改真实 SQLite。
- 仅针对倍速功能进行定向验证，不重新启动整套企业化发行门禁；用户继续提出其他问题后再一起打包。
