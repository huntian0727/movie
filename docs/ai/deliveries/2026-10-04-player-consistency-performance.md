---
date: 2026-10-04
branch: ai/player-consistency-performance
type: fix
status: verified
---

# 播放器交互一致性与有界工作量优化

## Context

- 用户授权按审查优先级实施，范围仅视频播放，不涉及资料库管理、扫描、重复删除或数据库迁移。
- 基线 `f5e410b4aca2a9ebaa5f47a62eadde1df83dc820`；开始时工作区干净，fetch 后与 origin/main 一致。
- 开发前快照 `2026-10-04_10-23-36-014_player-consistency-performance`；checkpoint `checkpoint-20261004-182332-f5e410b-player-consistency-performance` 已推送。SQLite 一致性备份 quick_check OK。
- 确认风险：目录侧栏无限追加后会超过主播放会话 300 项上限；加载阶段发送 pause 会失败；主动重播错误复用关闭自动播放的设置；切换视频的续播位置不一致；暂停时仍重复写入同一历史位置；滑块逐输入精确 seek；列表全量渲染/反复刷新已加载页。

## Changes

- 新增 `src/shared/playerQueue.ts`、`tests/shared/playerQueue.test.ts`：浏览列表不截断，但主播放队列使用围绕当前项、最多 300 项的滚动窗口，保留原有接口上限。
- `src/renderer/App.tsx`：目录选中、上一部、下一部使用有界窗口；最后一项片尾不反复重启；补充浏览器进度记录与可见 ID 查询回调。
- `src/main/playerWindow.ts`、`src/main/ipc.ts`、`src/main/db/videoRepository.ts`：各播放入口统一读取单视频历史位置，保留显式截图时间/零起点，已播完记录重新从零播放。不再依赖最近 200 条历史列表，或在选中视频时把续播位置写成零。新增仓储只读方法，无新 IPC、无数据库结构变化。
- `src/main/embeddedPlayer/embeddedPlayer.ts`、`native/embedded-mpv/NativeHost.cs`：MPV 音量及零音量跨解码会话保持；未变化的暂停位置不反复写库；启动历史查询进入错误处理范围。桌面复查另发现 stop 后空闲状态仍关联旧 videoId，下一次 start/dispose 会将历史覆盖为零；新增两个先失败再通过的回归测试，stop 保存后解绑旧 ID/snapshot。保留原有解码进程新建/释放契约。
- `src/renderer/components/useEmbeddedEngine.ts`：加载期间保留最新播放/暂停意图，就绪后发送；主动重播覆盖 autoplay 一次；保留现有真实属性 ACK 与过期回复防护。前台活动轮询 250ms，暂停 500ms，隐藏 2000ms，恢复可见立即复查；相同状态、相同画面 bounds/visible 不重复发布。
- `src/renderer/components/PlayerPage.tsx`：拖动仅更新显示，松手提交一次 seek，取消不提交，键盘 seek 保持；切换视频清除拖动状态。95px 固定高度虚拟播放列表及少量 overscan，只刷新可见 pending ID（5 秒、有界防重叠、隐藏时跳过），不循环重查所有加载页。播放/缓冲/读取阶段侧栏封面及时间轴预览只读缓存，暂停后允许已有生成服务补图；缓存未命中显示占位。切换失败给出可重试提示；浏览器进度有界写入并在切换/退出时补保存。
- `src/shared/playerTimelinePreview.ts`、`src/main/playerTimelinePreview.ts`、`src/renderer/components/PlayerTimelinePreviewWindow.tsx`：现有预览请求增加可选 cachedOnly，传递到浮动预览；URL、路径解析和沙箱边界不变。
- 测试修改：`tests/main/embeddedPlayer.test.ts`、`embeddedPauseConfirmation.test.ts`、`playerWindow.test.ts`、`playerTimelinePreview.test.ts`；`tests/renderer/App.test.tsx`、`PlayerPage.test.tsx`、`UnifiedPlayer.test.tsx`。真实验证脚本 `scripts/test-embedded-player.mjs`、`scripts/test-unified-player-validation.mjs` 更新仓储接口；生产矩阵加入静音会话替换及失败阶段记录。
- 新增文件：上面两个队列文件及本交付记录。删除文件：无。没有修改扫描/删除算法、解码库、硬件解码策略、窗口复用策略、全屏布局或音轨字幕 UI。

## Verification

- 最终 `npm run test:release-gate` PASS：101 文件 / 868 项（19:59，全量复跑包含 stop 续播补修），包含 lint/typecheck/build、Windows 文件 37、迁移 32、性能 30。当前 Node 22.23.1 / ABI 127 与 Electron 33.4.11 / ABI 130 分阶段重建验证。
- 新增专项：2,000 项队列窗口、超过 300 项目录选中、片尾不循环、已播完续播归零、显式起点、加载中反复点击/自动播放意图、关闭自动播放后的主动重播、拖动多输入只提交一次/取消/键盘、2,000 条列表 DOM 少于 20 行、仅可见 pending IDs、相同状态引用不变、暂停/隐藏轮询降频、缓存策略跨浮窗传递、浏览器最终位置保存、暂停不重复写库、零音量跨会话：PASS。
- `prepare:electron`、`test:electron-smoke`、`run-timeline-preview-smoke.mjs` PASS；真实浮动预览 Renderer 显示图片和时间。
- 生产 EmbeddedPlayer + NativeHost + libmpv 中性素材矩阵 PASS：H.264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus、双音轨字幕；30 次暂停/恢复服务 ACK 0～2ms，seek、旋转回零、会话替换、进度保存、静音保持通过。20:05 的最终五格式复测加入真正 stop 后、未指定起点的新 start，均恢复至保存的 3 秒，30 次 ACK 0～1ms。这个耗时不包含前端/网络，不是操作总延迟承诺。
- 首次短时矩阵出现没有阶段信息的 test-timeout；补充分阶段诊断并把测试的静音指令放到 EOF 前，复测五种格式全部通过。首次超时没有完整定位证据，不认定其为已确认的生产逻辑根因。
- 独立生产验证 9 个场景 PASS：5 格式技术解码、缺失文件恢复、无效文件恢复、播放进程退出恢复、8 次快速替换/过期 stop 忽略；进程均释放。短样本 AV 同步最大约 42ms，非长播结论。结果在临时隔离验证目录，不提交用户数据或原始媒体日志。
- `package:dir`、`verify:artifact`、`test:packaged-smoke`、`test:electron-smoke` PASS；asar 4002 项，无禁止开发产物。实际桌面快捷方式启动隔离五视频库，HEVC/DTS 内嵌播放、侧栏列表、拖动后画面/显示时间一致及浮窗不挤压已复查。最终补修后再次操作：双音轨视频暂停在 5 秒→静音→上一部→返回，画面与滑块均恢复 5 秒且音量仍为 0；最后一部 EOF 不循环，关闭自动播放仍可主动重播。未操作用户真实资料库。
- 实际桌面快捷方式 `%USERPROFILE%/Desktop/拉面影视.lnk` 的目标是 `release/win-unpacked/拉面影视.exe`。Commit 后仍须再生成包、比对时间和实际启动；最终提交/包时间结果在最终交付回复确认，不以源代码测试代替。
- 自动交付允许 `-SkipChecks`，仅因为上面同一工作区已完整执行等价 Node 门禁、Electron 与打包验证；避免混用 Node/Electron 的原生 ABI，不绕过失败测试。
- 独立 `test:e2e` npm 脚本不适用，以生产解码器、Electron/packaged smoke、实际快捷方式操作补充。

## Risks and follow-up

- 网盘仍从挂载路径播放，弱网/离线、关键帧 seek、解码初始化成本不能消除。真实 CloudDrive/NAS 弱网、高码率 4K/HDR 与长时间播放：NOT RUN；按用户要求不额外等待长播测试。
- 主播放队列有限窗口并不预加载整个目录；未滚动加载的后续页不保证自动连续播放。虚拟列表采用固定行高，未来行高变化需同步测量策略。
- 缓存预览缺失时播放中优先保障解码，暂停后才补生成；其他页面原有后台截图/分析任务并非全程停机。不能宣称播放期间全部网络带宽都停止。
- 音量保持仅指本次服务存活期间的内嵌 MPV 视频切换，不承诺重启软件或手动外部播放器同步音量。
- 内嵌进程复用、事件订阅替代全部轮询、全屏遮挡/自动隐藏重新设计尚未实施；避免一次扩大生命周期修改。
- 桌面包路径/快捷方式目标：`%USERPROFILE%/Documents/视频管理/movie/release/win-unpacked/拉面影视.exe`。交付 win-unpacked，不生成 NSIS 安装包，不改用户原有资料库/设置。
- 回滚：用 checkpoint/backup-main 标签建立正常修复提交；数据回滚使用上述一致性快照，不强推倒退 main。
