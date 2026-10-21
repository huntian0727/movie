# 日常桌面 v1.5 — 播放倍速 3× / 4× / 5×

- 开发电脑：家里电脑 MP2T8QB5；本地功能分支 ai/player-speed-3x-5x；基础版本 v1.4。
- 新增 3× / 4× / 5×，旧 0.5×～2× 均保留；共享白名单供 HTML5 与内嵌 MPV 使用。
- 原生 NativeHost 同步扩展速度上下限 0.5～5，包括首次 load 与后续 speed 指令；不开放任意 IPC 数值。
- PlayerPage 和 UnifiedPlayer 的测试已覆盖 3×、4×、5× 与视频切换保留 5×，IPC 拒绝不在预设列表的数值。
- 已运行 npx vitest run tests/main/embeddedPlaybackContract.test.ts tests/renderer/PlayerPage.test.tsx tests/renderer/UnifiedPlayer.test.tsx tests/renderer/EmbeddedPlayerPage.test.tsx：4 files，72 tests PASS。
- 已运行 npm run typecheck：PASS。
- 本地备份：2026-10-21_17-36-34-880_player-speed-3x-4x-5x，quick_check=ok，363039 视频。没有启动真实视频删除。
- 本地 GitHub Push/Release 未执行；既有五项不相关的未提交文件保持不变，CHANGELOG.md 另有先前遗留改动不可直接整体提交。
- 桌面包 / 快捷方式 / 原生宿主端到端验证：以实际后续执行结果为准，不能将单元测试当作真实视频播放验收。
