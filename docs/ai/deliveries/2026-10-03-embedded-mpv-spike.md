# 2026-10-03 内嵌 MPV 隔离验证

## Context

用户授权按建议进行最小验证：确认能否在拉面影视 Electron 窗口里使用内嵌解码，避免跳转外部播放器。本轮不替换正式播放实现。

- 分支：`ai/embedded-mpv-spike`。
- 基准 Commit：`ba0b896a9c186962e8afae254e98c1bd3bc9bd02`；开始时 HEAD=origin/main，工作区干净。
- 修改前数据/设置/源码一致性快照：`2026-10-02_16-06-31-623_embedded-mpv-spike`。
- Git checkpoint：`checkpoint-20261003-000627-ba0b896-embedded-mpv-spike`，已推送。
- 自动交付 Commit 与 `backup-main-*` 标签以 finish-and-push 实际结果为准，不预填不存在的哈希。

## Changes

新增文件：

- `scripts/spikes/embedded-mpv/NativeHost.cs`：独立 libmpv 宿主、自有子窗口、UTF-8 stdio、退出释放。
- `scripts/spikes/embedded-mpv/probe-main.mjs`：隔离 Electron 窗口、IPC 白名单、真实播放检查、失败报告。
- `scripts/spikes/embedded-mpv/preload.cjs`：沙箱控制桥。
- `scripts/spikes/embedded-mpv/contract.mjs`：实验控制和尺寸校验。
- `scripts/spikes/embedded-mpv/probe.html`、`probe.css`、`probe-ui.js`：中性实验画面及按钮。
- `scripts/spikes/embedded-mpv/prepare.mjs`：编译宿主及生成四种合成媒体，输出到隔离目录。
- `scripts/spikes/embedded-mpv/select-cloud-samples.mjs`：只读查询现有索引，生成不提交 Git 的云盘样本清单。
- `scripts/spikes/embedded-mpv/README.md`：复现步骤及验证边界。
- `tests/main/embeddedMpvSpike.test.mjs`：两项控制/几何契约测试。
- `docs/ai/reports/2026-10-03-embedded-mpv-spike.md`：含失败证据的完整结论。
- 本交付记录。

修改已有业务文件：无。删除文件：无。未修改 `src/`、package/锁文件、播放/扫描/文件管理/数据库结构。资料库只读选样，没有修改用户媒体、缓存或设置。DLL、exe、生成媒体、完整运行报告和含路径清单均不提交。

## Verification

- 项目 `npm run test:release-gate`：最终通过，退出码 0。包含 lint/typecheck、build、Windows 文件 37 项、migration 32 项、专项性能门禁 25 项和全部 Node/Vitest 测试 82 文件 / 751 项（68.49 秒）。固定 Node 22.23.1 / npm 10.9.8，Vitest 限制 1–2 forks；包含本轮 2 项契约测试。
- 实验契约测试：2 项，通过；纳入已有 Vitest 集合。
- 真实 libmpv 合成播放最终 `synthetic-release.json`：4/4，通过；整体退出码 0。覆盖 H264/AAC、HEVC/AAC、HEVC/DTS、VP9/Opus，中文/空格路径、尺寸、暂停/继续、旋转、音量属性、全屏恢复、宿主隔离与释放。
- 云盘最终 `cloud-release.json`：起播 3/3，完整链路 2/3；整体退出码 1。4K HEVC 在控制操作后恢复播放超时；不写成全通过。早期起播失败和早期 3/3 成功轮次均在报告中保留。
- 实际窗口验收：可见合成画面、后退、旋转、全屏按钮进/出、HEVC 切换及退出通过；Esc 失败，听音/字幕/多音轨/DPI矩阵未验收。
- `npm run prepare:electron` 和 `npm run test:electron-smoke`：最终通过，退出码 0；native ABI=130、Electron 33.4.11，正式 main `app.whenReady` smoke 成功。依赖已恢复 Electron ABI，未修改锁文件。既有 libpng iCCP 警告不影响退出结果。
- 独立 `test:e2e` / `e2e` 脚本：不存在，不适用；不把自动实验或 smoke 写成正式桌面快捷方式 E2E。
- 正式 package/installer/shortcut 验收：NOT RUN，本轮未更新正式桌面包。**桌面版本尚未交付。**

完整脚本日志不提交。真实媒体路径不公开；运行版本/哈希、失败状态与匿名耗时详见本轮报告。自动交付只可在相同工作区上述项目门禁和 smoke 完整通过并记录后使用 `-SkipChecks`；该标记不豁免真实云盘实验的失败，也不把隔离验证变为正式发布。

## Risks and follow-up

结论：内嵌解码和进程隔离已验证可行，**云盘稳定性仍未通过**，不建议直接替换正式播放器。

剩余风险：HEVC seek/旋转/全屏后恢复超时原因未定；原生窗口焦点下 Esc 未生效；短片抽样不代表长时间 4K/HDR、音轨/字幕/实际听音或全部格式；第三方 DLL 许可证与再分发条件尚未完整审查，不能直接打包正式发布；MPV 缓存预算不能限制 CloudDrive 预读，本轮无实际带宽字节统计。

下一步先隔离定位一个失败云盘样本的 seek/恢复，再决定接入现有 PlayerPage 的可关闭试用开关。需单独确认，不自动进入生产集成。回滚本次验证只需正常 revert 对应新增源码/文档提交，不恢复或删除用户资料库；现有正式播放器没有变化。
