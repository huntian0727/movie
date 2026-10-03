# 内嵌 MPV：输入链路与故障退出验证

## 范围与结论

继续验证独立 Electron + libmpv 原型，不接入正式播放器。没有修改 `src/`、扫描、文件管理、数据库结构、安装包或快捷方式；没有复制云盘整片、清空缓存、改网络配置或增加全局键盘钩子。

本轮确认两个原型问题并局部修正：快捷键只匹配物理键码，漏掉自动输入提供的逻辑键；宿主退出仍保留旧的 loaded 状态和操作队列。额外发现首次读取没有可靠的整体等待上限：协议层 `network-timeout=15` 不能覆盖本轮回环服务不返回 HTTP 响应的情况。

本轮输入及四项故障场景通过。仍不能宣布“所有视频都能内置播放”或“可以正式替换当前播放器”。

## 开发基准与备份

- 初始分支：`ai/embedded-mpv-controls-validation`；工作区干净。
- 初始 HEAD 与 GitHub main：`c011f0ef4baa6addf69494b49ee67b0842d70b38`，开始时一致。
- 本轮分支：`ai/embedded-mpv-input-failure-validation`。
- 修改前快照：`2026-10-02_17-31-10-462_embedded-mpv-input-failure-validation`。
- checkpoint：`checkpoint-20261003-013107-c011f0e-embedded-mpv-input-failure-validation`，已推送。SQLite 快照 quick_check 正常。
- Node 22.23.1 / npm 10.9.8；Electron 33.4.11；libmpv `v0.41.0-1092-g3186d369f`，沿用前轮隔离 DLL。

## 输入问题：证据修正

1. 首先仅开启 MPV 原生按键并绑定白名单，画面点击后的空格仍无效，最终报告 Electron/native key 事件都为 0。该探索性修改已撤除，`NativeHost.cs` 最终与基准相同。
2. 补充物理 `code` 优先、逻辑 `key` 回退后，HTML 标题焦点下 F 全屏、空格恢复、Esc 返回窗口均成功；点击原生画面后 F / Esc 也成功。报告记到 5 个 Electron 快捷键事件、0 个原生按键事件。
3. 最终重新编译原宿主，保留 `input-vo-keyboard=no`。点击画面后空格让实际进度从 0 推进到 8.6 秒，F 全屏、Esc 返回窗口均通过。报告记录 3 个快捷键事件，**3 个均使用逻辑键回退**，证明本轮测试失败的关键原因是输入识别缺口，不是已经证明的原生窗口焦点丢失。

只记录三种白名单 shortcut code 和事件计数，不记录其他键内容。页面输入控件有焦点时不接管快捷键，重复和组合键忽略。自动 UI 使用 Computer Use，未用 shell / Win32 助手发送按键。

Electron 事件分别提供 `key` 与 `code`，二者不应混同；这与本轮计数相符。[Electron before-input-event 文档](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event)

限制：上述是实际桌面窗口中的自动输入，不等于人类物理键盘、输入法、多显示器、切出/切回等完整矩阵。上一轮失败报告保留，不把过去的失败改写为通过。

## 故障测试及结果

最终自动验证使用中性 HEVC/AAC 12 秒测试片，重启场景从同一正常样本恢复。回环服务只监听本机随机端口，不发送响应，不接触用户网盘。

| 场景 | 最终结果 | 证据 |
|---|---|---|
| 路径不存在 | PASS | 收到真实 libmpv end-file error=-13；显示失败、界面心跳继续；通过切换样本恢复 |
| 待执行 seek 时终止自有宿主 | PASS | active / pending 清空，loaded 失效，旧 seek 被拒绝；切换样本可重建宿主并推进时间 |
| 回环读取不返回响应 | PASS（应用上限） | 30,076ms 后应用加载上限触发；宿主关闭、失败状态保持；切换样本恢复 |
| 读取等待时关闭宿主 | PASS | 自然退出 120ms，未强制终止；队列清空，Electron 仍活着 |

最终四项场景报告整体 pass=true，无意外 failures；expectedFaults 有不存在路径和应用加载超时两项。整轮 renderer 心跳 361 次；main 100ms 心跳最大额外延迟 28.09ms，renderer 16.20ms。5 次正常宿主退出为 116–184ms，全部 forced=false。

这里的“超时”不是 libmpv 自己的网络超时通过：首轮在 45,200ms 检查时仍无 end-file，场景 FAIL。主进程新增 **首次加载**整体 deadline，默认 30 秒，CLI 只可设置 1–60 秒；过期先关闭独立宿主再显示失败。正常完成、重新加载、退出取消旧计时器。其正常退出等待 4 秒，失败则仅终止自己创建的子进程并再等最多 4 秒。未实测真正冻结宿主的强制终止分支。

第二次恢复入口复测曾出现 uiAlive=false：后台窗口节流时，renderer 最大额外间隔 911.8ms，350ms 窗口不足以观察下一次心跳。自动模式现在显式关闭后台节流后重跑，四项全通过；手动模式保持默认。不能把这项测试配置推广成正式应用的节电策略。[Electron WebPreferences 文档](https://www.electronjs.org/docs/latest/api/structures/web-preferences)

## 原有控制回归与质量门禁

最终中性四格式控制矩阵全部通过：

| 样本 | 突发 seek（ms） | seek/旋转混合（ms） | 宿主关闭（ms） |
|---|---:|---:|---:|
| H.264/AAC MP4 | 374 | 563 | 176 |
| HEVC/AAC MP4 | 312 | 624 | 179 |
| HEVC/DTS MKV | 310 | 622 | 180 |
| VP9/Opus MKV | 372 | 561 | 248 |

四样本均验证真实进度恢复、重新加载清空旧 token、seek 期间关闭队列；整体 pass=true。main 最大额外延迟 52.98ms、renderer 15.10ms，184 次 renderer 心跳。退出后逐一检查最终故障与控制矩阵记录的自有宿主 PID，均已退出；没有残留实验窗口。

新增生命周期 / deadline 单测 6 项通过，连同原控制队列 7 项共 13 项通过。一次使用当前 Vitest 不支持的断言导致失败，改用已有断言后通过；不是产品运行失败。

本轮完整 `test:release-gate` 退出码 0：lint/typecheck、build、Windows 文件测试（37）、迁移测试（32）、性能门禁（25）均通过；全量测试 85 文件 / 768 项通过，Node SQLite ABI=127 检查通过。随后 `prepare:electron` 和 `test:electron-smoke` 退出码均为 0，SQLite 恢复至 Electron ABI=130，Electron 33.4.11 main-process app.whenReady 检查通过。项目没有单独 test:e2e 脚本；本轮隔离 libmpv 与实际窗口测试不能代替正式程序 E2E 或安装器验证。

## 原始证据

原始匿名 JSON 保留在既有隔离输出目录，不提交 DLL、媒体、运行报告或私有清单：

- `input-native-keys-ui.json`：探索性原生按键路线无效。
- `input-normalized-ui.json`：第一次逻辑键回退，5 项按键事件。
- `input-default-final-ui.json`：原宿主默认关闭原生输入，3 项按键、3 次 fallback。
- `input-failure-validation.json`：首次回环超时 FAIL（45 秒）。
- `input-failure-bounded-validation.json`：增加应用 deadline 后第一次四项 PASS。
- `input-failure-final-validation.json`：恢复入口复测中后台节流误报，整体 FAIL。
- `input-failure-unthrottled-final.json`：最终明确关闭自动窗口节流，四项 PASS。
- `input-control-regression-final.json`：最终四格式控制矩阵全部 PASS。

## 下一步与剩余风险

1. 20–30 分钟连续播放，观察真实 CPU/GPU、内存、音画同步、卡流和关闭后的资源释放；先正常播放，再测持续播放后的网络停流。当前 deadline 只处理首次加载，不能覆盖中途无限卡流。
2. 物理键盘、输入法、切出/切回、不同 DPI 和多显示器；连续点切换/恢复入口的并发启动与过期回调竞争。
3. 音轨切换、外挂/内嵌字幕、DTS 声音实听、HDR 色彩、坏片、超长片等媒体矩阵。
4. 冻结原生宿主时强制退出分支、父进程异常退出后的清理。
5. 正式接入前评估 React 控件覆盖、安装包 DLL 依赖、第三方发行版与许可证。不能以本轮短片和计时器检查代替这些验证。

本轮不打包正式程序，**桌面版本尚未交付**；当前正式应用、播放器和快捷方式保持不变。
