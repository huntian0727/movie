# 播放器旋转后无法恢复：专项修复

## Context

- 分支：`ai/player-rotation-return-fix`。
- 开发基线：`1fc7edbaa404a368b3574182fad82973244a7b26`；工作区干净，fetch 后与 GitHub main 一致，未覆盖任何已有修改。
- 开发前 SQLite 一致性快照：`2026-10-04_00-57-47-480_player-rotation-return-fix`（UTC 命名），约 0.87GB / 345479 视频，quick_check OK。源码 bundle、设置、manifest 一并备份。
- Checkpoint：`checkpoint-20261004-085743-1fc7edb-player-rotation-return-fix` 已推送。
- 本次 Commit 和 main 更新前备份标签由自动交付脚本生成，见 Git 历史及任务最终回复。

## Changes

旋转共用了 seek 的完成条件：成功 ACK、角度已达到目标且 seeking=no 后，仍要求 restartCount 增长。只更新视频输出而没有 PLAYBACK_RESTART 的路径会一直占用队列，后续旋转回零及跳转被堵住，30 秒后甚至触发播放失败。新增准确回归测试先在旧代码运行，`90 → 0` 的第二条请求没有发出，测试 FAIL；分离完成条件后 PASS。

1. `src/main/embeddedPlayer/controlQueue.ts`：旋转按成功 ACK + 实际目标角度 + 非 seeking 完成，不再等待播放重启；seek 仍保留原有重启和目标位置验证。保留串行、最新值合并、session token 和超时保护。
2. `src/renderer/components/PlayerPage.tsx`：就绪后补发加载期间的旋转请求，按 ready / sessionKey / 目标角度触发，不随每次状态轮询重复发送。
3. `tests/main/embeddedPlaybackContract.test.ts`：暂停且没有 restart 的转回零、快速连续旋转合并、未 ACK / 未到角度 / seeking 不可提前完成、seek 强条件不变、错误及 session 更换丢弃旧请求。
4. `tests/renderer/UnifiedPlayer.test.tsx`：Ctrl+右再 Ctrl+左回零、加载期间请求就绪后补发、轮询不重复发送。
5. `scripts/test-embedded-player.mjs`：正式 EmbeddedPlayer + 真 libmpv 的矩阵增加暂停时 `90 → 0 → 270 → 180 → 90 → 0` 和快速四次旋转回零。
6. 本交付文档。删除文件：无。未改数据库、扫描、文件管理、解码器或快捷键配置，不增加 UI。

桌面复查补充发现：进度/音量 range 获得焦点后，DOM 和内嵌输入适配器的“所有 input 均忽略快捷键”逻辑吞掉 Ctrl+方向键，转而执行 range 默认微调。增加聚焦进度条后“先旋转 90，再转回 0”的确定性回归，补充修复前 FAIL（最后请求仍为 90）；修复两个输入入口，只允许显式旋转快捷键穿过 range 的输入保护并阻止其默认动作。普通 range 方向键、真实文本输入、select、editable 和对话框保护保持不变。

## Verification

- 第一轮 `npm run test:release-gate`：PASS，完整 Vitest 96 文件 / 820 项。桌面复查补充的焦点修复后第二轮完整门禁 PASS，96 文件 / 821 项；两轮类型检查/构建、Windows 文件 37、迁移 32、性能 26 均通过。
- `npm run prepare:electron` / `npm run test:electron-smoke`：PASS，Electron 33.4.11、ABI 130。
- `node scripts/run-timeline-preview-smoke.mjs`：PASS，既有浮动预览渲染、授权、焦点和释放回归无异常。
- 旧构建的真实 libmpv 合成矩阵也 PASS：这些样本会发重启事件，因此不能声称在真实样本上复现了用户视频的故障；确定性无重启回归测试证实队列缺陷。
- 修复后真 libmpv 合成矩阵：PASS，H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨/字幕共 5 种，暂停多次旋转回零、快速四次旋转回零、seek、音量、全屏、重开会话和进度保存通过。
- 最终桌面包和快捷方式启动人工验证为本次交付收尾门禁；实际结果在最终回复中报告，不提前声明通过。
- 无独立 E2E npm 脚本：不适用，以既有 packaged smoke、真实 Electron/MPV 矩阵及桌面操作覆盖。

## Risks and follow-up

最终 Commit 后重新生成 `release/win-unpacked`，检查实际桌面 `拉面影视.lnk` 目标为 `C:/Users/test/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`，核对 Commit / app.asar 时间，从该快捷方式启动合成资料库，验证旋转和恢复。

用户提到的「学院第一个视频」未实际播放复测，真实 CloudDrive 网络、所有 GPU/解码组合和长时间播放未穷举。修复不改变视频自身旋转元数据或写入源视频。回滚采用 checkpoint / 本次 main 备份标签创建修复分支并正常提交；数据仅在需要时用一致性快照恢复，不强制回退 main。
