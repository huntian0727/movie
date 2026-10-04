---
date: 2026-10-04
branch: ai/player-startup-priority-fix
type: fix
status: completed
---

# 播放启动等待与读取优先级优化

## Context

- 用户授权按诊断方向优化启动。基线 `b11563b0e5ec7c8c4873f2e6e8a0a831f46f50ec`，工作区干净，fetch 后与 origin/main 一致。
- 旧逻辑先等待 lazy codec FFprobe（最多 2 秒）再打开播放窗口，超时后继续探测；最近实际探测 6656ms。用户当前配置 embedded-first，libmpv 自己进行媒体解析，额外探测没有必要。
- 开发前快照 `2026-10-04_05-04-44-762_player-startup-priority-fix`，345479 视频，SQLite quick_check OK；checkpoint `checkpoint-20261004-130441-b11563b-player-startup-priority-fix` 已推送。

## Changes

- `src/main/playerWindow.ts`：embedded-first 打开/切换使用缓存立即建立会话，不启动播放前 FFprobe；其他策略保持原有探测契约。窗口打开/关闭和失败接入有界启动优先级，新增窗口打开耗时日志。
- 新增 `src/main/media/playbackStartupPriority.ts`：启动读取优先，解码就绪、停止、失败、关闭时释放；15 秒超时兜底。替换视频时取消旧计时器，忽略旧视频完成通知。
- `src/main/media/imageGenerationQueue.ts`、`cacheManager.ts`：启动期间中断正在生成的截图并保留订阅者，等待旧进程/文件句柄结束后再排队恢复；不会把暂停误报为截图失败。已缓存图片不受影响，取消和 stop 保持原行为。
- 专项缓存测试暴露已有竞争：缓存命中触发维护时，会把另一张正在写入的临时截图视为废弃文件，Windows rename 报 EPERM。已把生成临时文件纳入 activePaths 保护，退出生成后释放。
- `metadataQueue.ts`：独立 playbackPaused 标记，不破坏扫描 pause/resume。暂缓新分析，已有 FFprobe 正常结束，不因中断被误判为元数据异常。
- `embeddedPlayer/embeddedPlayer.ts`、`index.ts`：生产服务接入同一启动预约，首次 loaded 且不 seeking / paused-for-cache 时释放；记录 host-ready 和 decode-ready 耗时。保持进程创建、解码器、控制、旋转、播放列表和文件路径行为。
- 测试：修改 playerWindow、cacheManager、metadataQueue、imageGenerationQueue、embeddedPlayer、embeddedPauseConfirmation 测试；新增 playbackStartupPriority 测试。
- `scripts/test-unified-player-validation.mjs`：仅新增 `--seed-ui --startup-profile` 隔离 QA 模式，构造 embedded-first、未探测编码的中性素材资料库；不使用真实资料库。
- 删除文件：无。没有数据库迁移、扫描算法、CloudDrive API 或媒体删除改动。

## Verification

- `npm run test:release-gate` 最终复测 PASS：100 文件 / 851 项；lint/typecheck/build、Windows 文件 37、迁移 32、性能 29 PASS。
- 新增/修改专项测试：不执行播放前探测、窗口加载失败恢复、启动超时、过期完成、缓冲/停止、共享图片中断后恢复、不重叠写文件、取消/关闭、已有图片读取、临时图片维护保护、扫描暂停不被解除、已有元数据分析不被误标异常：PASS。
- `npm run prepare:electron`、`npm run test:electron-smoke`、`node scripts/run-timeline-preview-smoke.mjs`：PASS，Electron 33.4.11 / ABI 130。
- 真实生产 EmbeddedPlayer + libmpv 中性矩阵：H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨字幕全部 PASS；30 次 pause/resume 属性确认 0～1ms（服务侧，不包含 UI/网络）；seek、旋转回零、进度和会话替换 PASS。
- 首次 `npm run package:dir`、`verify:artifact`、`test:packaged-smoke`：PASS；packaged smoke 覆盖启动、IPC、安全策略、worker 数据查询、截图生成/重新生成/轮询稳定。
- 从用户真实桌面快捷方式打开当前新包，进程临时使用隔离 user-data，5 个中性视频：HEVC/DTS 有首幅画面、播放按钮推进画面、片尾切换 VP9 正常；侧边播放列表显示全部 5 项，选 H.264 可正常就绪；没有触发 codec_probe_started。
- 本机初步桌面日志：window opened 116ms；HEVC/DTS host ready 122ms，embedded startup settled 508ms，整体预约 651ms；随后 VP9 / H.264 startup settled 532 / 597ms。这里只统计窗口/解码就绪，不是严格像素级首帧测量，也不是云盘性能承诺。
- 独立 E2E npm 脚本不适用，以真实 Electron、生产 MPV 矩阵及桌面操作补充。最终 Commit 后再次生成包、核对 app.asar/快捷方式并启动验证，结果由最终交付回复记录，不能以此处初步包代替。

## Risks and follow-up

- 网盘播放仍走挂载路径；无法消除源文件离线、网络等待、关键帧 seek 和 MPV 初始化成本。未复用解码进程，避免扩大生命周期改造。
- 启动优先只暂缓新元数据分析；已有分析不强杀。截图中断会重试，可能重做少量工作，换取启动带宽。15 秒后即使仍缓冲也恢复其他任务，避免无限饥饿。
- embedded-first 不再仅因播放填充编码缓存；播放诊断显示未知时仍需显式媒体分析。auto/native-first/mpv-first 的原有选择契约不变。
- host-ready / decode-ready / window-opened 日志不含路径、文件名和 Token；decode-ready 不等于任何媒体都已经输出可见画面。
- 真实用户网盘启动带宽竞争、长期播放：NOT RUN。中性资料库 QA 不替代这些场景。
- 桌面快捷方式目标 `C:/Users/test/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。本次交付 win-unpacked，不生成 NSIS 安装包，不改变用户原有设置/资料库。
- 回滚使用 checkpoint / backup-main 标签构造新的正常修复提交；数据恢复使用开发前一致性快照，不强制倒退 main。
