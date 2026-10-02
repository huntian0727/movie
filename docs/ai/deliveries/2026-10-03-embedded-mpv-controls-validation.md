# 内嵌 MPV 连续控制测试交付

## Context

用户要求“继续测试”，范围为隔离实验里的快捷键、连续跳转与读取等待状态，不接入正式原生播放器。初始工作区干净，分支 `ai/embedded-mpv-seek-validation`，HEAD 与 GitHub main 一致：`073dcca3e09612251b5f5581e3e4a8c257e9205e`。

开发前按 AGENTS 备份成功：快照 `2026-10-02_17-12-09-888_embedded-mpv-controls-validation`，checkpoint `checkpoint-20261003-011206-073dcca-embedded-mpv-controls-validation` 已推送；含源码 bundle、数据库一致性副本、设置及 manifest。数据库约 0.87GB / 345479 视频，quick_check OK。随后创建分支 `ai/embedded-mpv-controls-validation`。

## Changes

新增：

- `scripts/spikes/embedded-mpv/control-queue.mjs`：一个执行中操作，每种一个最新待执行项；ack、token、seek/restart/属性就绪判据；超时、加载、关闭清理；读取状态标签。
- `scripts/spikes/embedded-mpv/control-validation.mjs`：真实媒体突发跳转/混合控制、恢复、加载取消、seek 期间关闭，失败输出匿名结果。
- `tests/main/embeddedMpvControls.test.mjs`：七项队列/状态回归。
- `docs/ai/reports/2026-10-03-embedded-mpv-controls-validation.md` 及本交付记录。

修改：

- `scripts/spikes/embedded-mpv/probe-main.mjs`：可选 controls/control-auto 模式、队列调度、窗口局部键盘候选、DOM 阶段计数。
- `scripts/spikes/embedded-mpv/preload.cjs`、`probe-ui.js`、`probe.html`：阶段与候选键盘消息、ES module、读取/缓冲状态展示。
- `scripts/spikes/embedded-mpv/README.md`：运行说明及未通过事项。

删除：无。正式 `src/`、schema、扫描/文件管理/播放器调用、release 包及快捷方式均未改。未更换 DLL 或 C# 宿主源码；未安装新工具链。生成报告、真实文件清单、视频、DLL、数据库不进入 Git。

## Verification

实际执行结果：

- 定向 Vitest：3 文件 / 13 测试 PASS；包含七项新增回归。超时、负 ack、旧 token 取消在模拟状态中验证，不是实际断网测试。
- 第一批真实实验：四个合成格式及同一挂载盘 4K HEVC/AAC 短片 PASS，五次 seek 实际只发送 2 与 10 秒，混合控制实际三项；加载/退出清除旧队列。
- 第一批后补充恢复 0° ready 判据，最终源码重新执行四个本地样本及一个云盘样本，均 PASS，两次实验进程退出码 0。最终云盘合并 17.811s、混合 26.657s、seek 中关闭 240ms；main/renderer 心跳额外延迟 12.48/14.10ms。DOM 在等待期间持续上报 reading/seeking/buffering，不代表画面持续无缓冲。
- 使用 computer-use 实际操作中性测试窗口：初始 Space、点击 HTML 区域后的 F、显式激活后的 Space 均 **FAIL**；没有对应动作报告。退出按钮 PASS，正常退出。保留未通过事项，不宣称焦点已修复。
- `npm run test:release-gate`：PASS，固定 Node 22.23.1 / npm 10.9.8，2 forks。包含 lint/typecheck、build、Windows 文件 37 测试、迁移 32 测试、性能子集 25 测试；全量 **84 文件 / 762 测试 PASS**。
- `npm run prepare:electron`、`npm run test:electron-smoke`：PASS，最终 SQLite 原生依赖恢复 Electron 33.4.11 / ABI 130，app.whenReady 正常。
- 未运行项目 E2E：没有 test:e2e/e2e 脚本，不适用。真实声音、长片 4K、字幕/多音轨/HDR、冷缓存和本地同文件对照：NOT RUN。
- `git diff`、`git diff --check` 和 status 检查本次范围；交付脚本执行前再次核对 main 未并发变化。

完整等价质量门禁在当前工作区真实执行后，按 AGENTS 使用 `finish-and-push.ps1 -SkipChecks`，避免重复 ABI 切换；脚本正常备份旧 main、推送功能分支和 main。最终 commit/backup-main 标签及远端核对以脚本 RESULT、最终回复为准，不预填未生成值。

## Risks and follow-up

1. 控制队列减少冗余请求，不消除挂载盘读取；17–27 秒仍不可称为丝滑画面。未清空缓存、未复制完整视频，不做唯一瓶颈归因。
2. 简单 Electron 局部输入候选没让实际按键生效，不能采用为成品修复；尚未确定唯一输入丢失层。下一步应定向诊断自有原生窗口键盘路由，避免全局按键拦截。
3. 队列取消只清理未发送请求；已经发出的原生 IO 不能宣称立刻取消。离线/读故障时关闭的真实行为仍需验证。
4. 只有短片和合成媒体证据，没有持续音画与许可证/安装器验收。不得自动接入正式播放器或替换用户稳定版。
5. 未打包、未更新快捷方式、未从新包启动；**桌面版本尚未交付**。原有正式拉面影视运行窗口及安装包保留。
6. 回滚可从本轮 checkpoint 创建修复分支或 revert 本轮实验提交；不强制倒退 main，不恢复本轮未改变的真实资料库数据。
