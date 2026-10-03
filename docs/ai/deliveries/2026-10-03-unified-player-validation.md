---
date: 2026-10-03
branch: ai/unified-player-validation
type: test
status: partial
---

# 统一播放器补充验证交付

## Context

用户授权继续验证统一原播放器 UI 与内嵌 MPV 的兼容、全屏、音频字幕及故障恢复。本轮不扩大为业务修复。

基线 `af3cb18`，开始时工作区干净、与 GitHub main 一致；开发前快照 `2026-10-03_12-36-59-582_unified-player-validation`，checkpoint `checkpoint-20261003-203656-af3cb18-unified-player-validation` 已推送，一致性快照 quick_check OK。

## Changes

- 新增 `scripts/test-unified-player-validation.mjs`：生产引擎隔离短样本验证及临时 UI 资料库生成。
- 新增 `docs/ai/qa/2026-10-03-unified-player-validation.md`：五项结果、真实全屏问题、音轨字幕 UI 缺口与建议。
- 新增本交付记录；删除文件：无。
- 业务代码、真实资料库、设置均未修改；无用户文件删除、网络断开或扫描操作。

## Verification

- 本轮生产引擎隔离测试：初始运行 9/9 PASS；最终补充断言后重跑 9/9 PASS，退出码 0。最终临时报告 `lamian-unified-validation-myToQM/report.json`，最大绝对 avsync 41.665ms，快速切换进程释放断言通过。
- 实际桌面包界面：窗口态混合路由、列表、画面恢复 PASS；MPV 全屏切原生后退出 FAIL（详情见 QA 报告）。
- WASAPI 输出及短时同步 PASS，真实人工听音 NOT RUN。
- 音轨/字幕引擎 PASS；统一界面选择控件不存在。
- 真实 CloudDrive/网络波动 NOT RUN；长期播放按用户要求不测。
- 本轮 `npm run test:release-gate`：PASS，退出码 0。包含 lint/typecheck、build、Windows 文件 37 项、迁移 32 项、专项性能 25 项、完整 Vitest 92 文件 / 797 测试通过；专项与全套重叠，不累加成独立测试数量。
- 本轮 `npm run prepare:electron` 与 `npm run test:electron-smoke`：PASS，Electron 33.4.11 / ABI 130。Node 22.23.1 / npm 10.9.8；原生依赖先重建 Node ABI 127 执行测试，再恢复 Electron ABI 130。
- `git diff --check`：PASS。无独立 `test:e2e` 脚本，桌面交互由实际基线包的隔离 UI 测试覆盖；不把它写成全部自动 E2E 通过。
- 本轮不涉及桌面行为修改，不重新发布业务安装包；所验证的是已交付基线桌面包，不是本轮修复版。

## Risks and follow-up

- P1：两套全屏状态跨模式切换不一致，建议下一任务优先修正。
- P2：补齐统一 UI 的音轨/字幕选择控件，复用已有引擎命令。
- 使用用户指定的普通 CloudDrive 样本补测拖动/缓冲；人工确认音量和音画同步。
- 当前 libmpv 运行时来自本机已配置目录，其他机器安装、授权及运行时分发仍需独立验证。
- 回滚本轮测试/文档可以正常 revert 本轮提交；不用回滚数据库或正式播放逻辑。
