# 内嵌 MPV 输入与故障验证交付

## Context

用户同意继续隔离验证快捷键及故障退出，不接入正式播放器。基准 `c011f0e`，工作区干净且与 GitHub main 一致。分支 `ai/embedded-mpv-input-failure-validation`。

修改前完成快照 `2026-10-02_17-31-10-462_embedded-mpv-input-failure-validation`，checkpoint `checkpoint-20261003-013107-c011f0e-embedded-mpv-input-failure-validation` 已推送，SQLite quick_check 正常。

## Changes

修改：实验 `probe-main.mjs`、`probe-ui.js`、README。新增：实验 `host-lifecycle.mjs`、`load-deadline.mjs`、`failure-validation.mjs`、`tests/main/embeddedMpvHostLifecycle.test.mjs`，本轮报告及交付记录。删除文件：无。

补充 shortcut 白名单逻辑键回退；宿主退出失效 loaded、清空队列、拒绝旧操作，切换样本重建宿主；首次加载增加有界等待。故障注入只终止自有宿主，超时服务只监听回环随机端口。自动验证窗口关闭后台计时器节流，手动模式保持默认。探索性原生按键修改已撤除，NativeHost.cs 最终未改变。

没有修改 src/、业务代码、扫描、正式播放器、数据库结构、文件管理、安装包、用户快捷方式；没有清空缓存或复制云盘整片。

## Verification

- 实际原型窗口 UI：默认关闭原生输入时空格恢复、F 全屏、Esc 恢复窗口通过，3 个事件全部走逻辑键回退。
- 最终故障四场景 PASS：不存在路径、宿主退出清队列和恢复、回环读取 30 秒 deadline 和恢复、等待中自然退出（120ms）。保留首轮协议超时失败及后台节流误报报告。
- 新增单测 6 项、原队列单测 7 项，共 13 项 PASS。测试断言兼容问题已修正。
- 四格式控制回归 PASS，覆盖突发 seek、seek/旋转混合、实际恢复、旧 token 取消及关闭。最终故障/控制矩阵的所有自有宿主 PID 已退出，无实验窗口残留。
- 完整 `test:release-gate` PASS（退出码 0）：lint/typecheck、build、Windows 文件、迁移、性能门禁、Node native smoke；全量 85 文件 / 768 项通过。
- `prepare:electron`、`test:electron-smoke` PASS：依赖恢复 ABI=130，Electron 33.4.11 app.whenReady 正常；独立 test:e2e 脚本不存在，不适用。
- 自动交付使用 `-SkipChecks`，因为本轮已在同一工作区执行以上全部等价检查；完成后仅补充文档，没有再改可执行代码。不是绕过失败检查。
- 打包、快捷方式启动、安装器、用户物理键盘、长时间播放：NOT RUN。

详见 docs/ai/reports/2026-10-03-embedded-mpv-input-failure-validation.md。

## Risks and follow-up

本轮不是正式播放器交付，**桌面版本尚未交付**。仅覆盖首次加载 deadline；持续播放中卡流、宿主冻结强制退出、输入法/多显示器与恢复入口快速并发仍需验证。

下一轮建议长时稳定播放和中途卡流，再覆盖音轨/字幕/HDR/声音实听，最后才考虑正式接入及 DLL 许可证/打包。不以短样本通过代表全部格式和真实云盘离线行为已通过。
