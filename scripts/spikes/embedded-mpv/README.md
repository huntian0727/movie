# Windows 内嵌 MPV 隔离验证（非正式播放实现）

只验证 Electron 自有窗口中的播放画面与控制。**播放原型不导入 src/main/index，不读写资料库数据库、设置、媒体缓存，不改变正式播放器、安装包或桌面快捷方式。** 可选 `select-cloud-samples.mjs` 仅以只读方式查询既有数据库，生成隔离目录里的匿名样本清单（清单含真实路径，不可提交）。

## 架构

```text
沙箱 HTML 控件 → 白名单 preload/IPC → 实验 Electron main
                                       ↓ stdio JSON
                                  独立 .NET 宿主
                                  libmpv → 原生子窗口
```

采用 Windows 现成 .NET Framework C# 编译器与 libmpv C API；这是无需安装 C++ 工具链的实验适配，不承诺正式采用 C#。DLL 与所有生成媒体/报告位于明确的隔离临时目录，不能提交到 Git。Electron renderer 不加载原生模块；解码宿主退出不会终止 Electron。头尾 HTML 控件放在视频区域之外，避免原生窗口覆盖 DOM。原型移除默认菜单，避免浏览器内容与父窗口客户区的坐标偏移；同时同步自有宿主及 mpv 子窗口尺寸，覆盖首次 VO 配置晚于宿主 resize 的情况。

## 运行

先准备合法来源、固定版本的 Windows x64 `libmpv-2.dll`，放入 `<isolated-directory>`。本次验证运行时来源及哈希见交付记录，未纳入正式发布。

```powershell
node scripts/spikes/embedded-mpv/prepare.mjs <isolated-directory>
node_modules/electron/dist/electron.exe scripts/spikes/embedded-mpv/probe-main.mjs --spike-root=<isolated-directory> --spike-samples=<isolated-directory>/samples.json --spike-auto=1
```

去掉 `--spike-auto=1` 可人工操作。真实媒体清单仅能由可信 CLI 传入，不能由 renderer 传文件路径/任意 MPV 命令。报告只记录匿名样本名、codec、耗时和状态，不记录实际私有路径。单次最多 10 个样本。音量初始化 20%。

可传 `--spike-report=<name>.json` 保存各轮报告。自动检查报告包含逐样本 `pass` 和整体 `pass`，失败退出码为 1；不要只根据进程能启动判断成功。Windows PowerShell 启动 GUI exe 时需确保等待进程退出，批量测试可通过 Node `spawnSync` 等待并核对退出码。Codex 环境若有 `ELECTRON_RUN_AS_NODE`，应仅从实验子进程环境删除该值，否则启动的是 Node 而不是 Electron。

## 定向 seek / 控制诊断

`--spike-matrix=1` 执行八个有界场景：基线、seek、旋转、全屏、重叠操作、串行操作，以及软件解码对照。每个场景重新创建并释放自有宿主；仅使用清单第一个样本，可用 `--spike-sample-name=<anonymous-name>` 指定样本。不清空 CloudDrive 缓存，不复制整片，不测试正式应用。

```text
--spike-matrix=1 --spike-sample-name=cloud-hevc-aac --spike-report=seek-matrix.json
--spike-matrix=1 --spike-cases=combo-overlap-auto,combo-serial-auto --spike-repeat=3 --spike-report=seek-repeat.json
```

`cases` 必须是既有场景名，`repeat` 限制 1–3。hwdec 只接受 `auto-safe` / `no`，不向 renderer 开放配置或任意命令。串行组合在 seek 和每次旋转引起的播放重启完成后再进行下一项。

不要把 `time-pos` 到达目标当成 seek 成功：正常 seek 检查还要求同一 load token、`seeking=no` 和新增 `PLAYBACK_RESTART`。恢复检查要求取消暂停、无待完成 seek、实际时间推进超过 0.6 秒；随后观察 700ms。故 `resumeMs` 包含这段观察时间，不等于纯解码延迟。重叠场景刻意模拟旧判据，不用它宣称 seek 已完成。

报告包含 seek/restart 计数、缓存等待、实际硬解模式、音频输出模块，以及 main / renderer 的 100ms 心跳额外延迟。心跳是整轮累计指标，不能代表正式应用的点击延迟；进度推进通过也不代表长时间无缓冲。`--spike-start-paused=1` 只用于手动快捷键/焦点测试。

本轮证据与限制见 [seek 验证报告](../../../docs/ai/reports/2026-10-03-embedded-mpv-seek-validation.md)。原始匿名结果保留在隔离目录，不把私有媒体清单、DLL 或视频提交到仓库。

## 可选控制调度验证

`--spike-controls=1` 仅开启实验控制调度和候选窗口键盘处理，不改变正式播放器。每次只执行一个 seek/旋转，最多各保留一个最新待执行值；执行中请求不能取消已经发出的本机读操作。完成要求 native ack、同一视频 token、无待完成 seek、新增播放重启及目标属性匹配。单项超过 30s 则清空待执行队列并显示失败；切换样本/关闭宿主会清空旧操作。

```text
--spike-controls=1 --spike-control-auto=1 --spike-report=controls-synthetic.json
--spike-controls=1 --spike-control-auto=1 --spike-sample-name=cloud-hevc-aac --spike-report=controls-cloud.json
```

自动场景包括五次突发跳转、跳转/旋转混合、恢复播放、重新加载取消旧 token、seek 期间退出。测试突发请求在同一轮事件循环发出，证明合并机制，不是实际鼠标拖动频率基准。DOM 显示区分“正在读取”“正在跳转”“正在缓冲”“已暂停”“操作未完成”，心跳只上报白名单阶段计数，不上报文件名或 DOM 文本。

候选键盘处理使用实验窗口自己的 `before-input-event`、webContents focus 与 preload 转发，没有全局快捷键或系统键盘钩子。上一轮按键复测失败已保留在 [控制验证报告](../../../docs/ai/reports/2026-10-03-embedded-mpv-controls-validation.md)。本轮补充白名单逻辑键 `key` 回退（物理 `code` 优先），默认关闭 MPV 原生键盘输入时，真实窗口的自动输入测试已通过空格/F/Esc；三个事件均使用逻辑键回退。此证据纠正了“必然是跨进程焦点丢失”的过早判断，不代表已覆盖用户物理键盘、输入法和所有跨窗口焦点状态。滑块有焦点时不接管快捷键，组合键/重复按键忽略。

## 故障退出验证

```text
--spike-controls=1 --spike-failure-auto=1 --spike-report=failure-validation.json
```

只使用中性测试媒体。覆盖不存在路径、宿主退出且有待执行 seek、切换样本恢复、回环 HTTP 连接不返回响应、等待读取期间关闭宿主。HTTP 服务只监听 `127.0.0.1` 的随机端口，结束时清理连接；不改网络配置、不访问云盘凭据、不删除文件。测试故障记入 `expectedFaults`，其他异常仍记入 `failures`；任一场景失败退出码为 1。

本轮发现仅设 `network-timeout=15` 时，回环服务不返回数据仍能等待超过 45s。因此实验主进程新增加载上限，默认 30s，可信 CLI `--spike-load-timeout-ms` 只接受 1000–60000ms。超时关闭独立宿主、失效旧状态、清空操作队列并显示失败；正常加载完成/更换视频/关闭取消旧计时器。它只覆盖首次加载，已播放后的持续卡流尚未覆盖。正常退出等最多 4s，再仅终止自己创建的宿主并等最多 4s；报告区分自然退出与强制终止。正式播放器不受此机制影响。

自动模式关闭实验窗口的后台计时器节流，避免用 350ms 心跳检查误判后台窗口卡死；手动模式保留 Electron 默认节流。性能数字仅表示此控制环境的定时器额外延迟，不是正式应用体验承诺。详情及失败/复测证据见 [输入与故障验证报告](../../../docs/ai/reports/2026-10-03-embedded-mpv-input-failure-validation.md)。

## 验证边界

- 自动验证：真实 libmpv 加载/进度、嵌入 parent、暂停稳定、seek、音量属性、窗口全屏/恢复、宿主退出/异常隔离/重新启动、Electron 主线程定时器延迟。
- 人工验证：实际可见画面、按钮/快捷键、缩放/旋转与控件层级；实际声音/主观音画同步由用户或有音频输出验证能力的环境确认，不能仅由 codec 属性推出。
- 未将 HTML5 与 MPV 混用作自动转换，不做后台转码，不修改原文件，不新增整片下载任务；播放和挂载盘预读仍会读取视频内容，不能承诺不会读取完整短视频。
- `hwdec=auto-safe` 允许软件回退；32 MiB 前向/8 MiB 后向是 mpv 缓存预算，不限制 CloudDrive 自身预读。
- 不代表已完成 React PlayerPage 对接、HDR/字幕/音轨矩阵、长时间 4K 性能、安装器/DLL许可证合规、Electron 升级兼容或所有云盘媒体验证。快捷键已通过本机自动输入复测，但真实物理键盘、输入法、多显示器及切出/切回焦点仍需覆盖。
- 实验不提供网络/外部导航或用户凭据配置，禁止打开不可信播放清单。实际使用前仍需明确来源和许可证审查。
