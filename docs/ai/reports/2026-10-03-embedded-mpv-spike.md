# Windows 内嵌 MPV 最小可行性验证

日期：2026-10-03。分支：`ai/embedded-mpv-spike`。开发基准：`ba0b896a9c186962e8afae254e98c1bd3bc9bd02`，开始时工作区干净，HEAD 与 origin/main 一致。

## 结论

**内嵌解码和独立进程隔离可行，但尚不具备直接替换正式播放器的交付条件。**

- 四组合成媒体通过真实 libmpv 加载、画面尺寸、暂停、seek 位置反馈、音量属性、旋转、全屏及恢复、继续播放、宿主关闭/异常隔离/重启检查。
- 三个真实 CloudDrive 挂载视频均成功起播，包括一个 3840×2160 HEVC 视频。早期不含旋转的有效样本轮次 3/3 通过。
- 加入旋转和原生画面尺寸检查后的最终云盘轮次只有 2/3 完整通过：4K HEVC 在 seek/旋转/全屏操作后恢复播放超时，`seeking=yes`，不能把起播成功等同于完整播放链路稳定。
- 正式 `src/` 播放逻辑、扫描、数据库、原文件、设置和安装包均未修改。**桌面版本尚未交付；本轮是隔离验证，不是正式播放器升级。**

## 方案与隔离边界

```text
实验 HTML 控件（沙箱、无 Node）
  → 白名单 preload / IPC
  → 实验 Electron main（不导入正式 main）
  → stdio JSON
  → 独立 .NET Framework 宿主进程
  → libmpv C API / 自有原生子窗口 / D3D11
```

本机没有 C++ 编译工具链，使用现有 Windows C# 编译器验证 C API 与 HWND 嵌入，不安装开发工具，不承诺正式使用 C#。解码及同步 native 调用在独立宿主中，Electron main 不执行解码。

MPV 的 Windows `wid` 会创建自己的子窗口，见 [官方嵌入选项](https://mpv.io/manual/master/#options-wid)。宿主和 MPV 子窗口都按 renderer 专属 viewport 更新尺寸；HTML 控件位于视频区域之外。不能推断普通 DOM 弹层可以盖在原生画面之上。

renderer 不可提交播放路径、任意 MPV 命令或 shell 命令；路径由可信测试 CLI 清单提供。IPC 校验 sender/main frame、控制类型、数值及 bounds。仅一个自有宿主；退出会释放 libmpv，必要时终止本实验的挂起宿主，不操作用户其他播放器。

可选云盘清单选择器通过 `node:sqlite` 的 `readOnly:true` 对实际资料库执行 SELECT；播放原型本身不访问资料库。媒体、exe、DLL、实验 userData 和完整报告均在临时目录，不提交 Git。真实路径只出现在临时清单，不记录到公开报告。不获取 API token。

## 环境和依赖来源

- Windows x64；Electron 33.4.11；项目质量门禁使用固定 Node 22.23.1 / npm 10.9.8。
- 现有 `.NET Framework64/v4.0.30319/csc.exe` 编译实验宿主。
- 合成媒体由项目已有 `ffmpeg-static` 生成，12 秒、640×360、24fps、中性测试图和正弦音，路径包含中文及空格。
- libmpv：`mpv v0.41.0-1092-g3186d369f`。运行时来自 [shinchiro Windows build 20261002](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261002)，这是 [MPV 安装页](https://mpv.io/installation/)列出的第三方 Windows 构建，不是 MPV 官方签名安装包。
- 归档：`mpv-dev-x86_64-20261002-git-3186d369f9.7z`，31,499,009 字节；SHA-256：`d873450cc1a7f881a8a10c33936d9555ad18a3809d827b9dbea55ba55caebcf9`。
- DLL：`libmpv-2.dll`，120,781,312 字节；SHA-256：`8ca42a74311b813abc21f4264e7ed5f12a16419596bcbda96e49f10f8187befe`。
- 实验输出目录：`%USERPROFILE%/AppData/Local/Temp/lamian-embedded-mpv-spike-20261003`。

上述文件哈希是本次下载实测，用于重复实验识别，不表示已完成供应链或许可证审计。DLL 未进入 release、系统目录或仓库。正式打包前必须审查该构建的 libmpv/FFmpeg 等许可证、再分发义务和构建配置。

## 最终合成样本结果

证据：隔离目录 `synthetic-release.json`；整体 `pass=true`，等待子进程的 Node launcher 返回 0。

| 样本 | 起播 / ms | seek 位置反馈 / ms | 硬解 | 完整检查 |
| --- | ---: | ---: | --- | --- |
| H.264 + AAC / MP4 | 770 | 126 | d3d11va | PASS |
| HEVC + AAC / MP4 | 374 | 125 | d3d11va | PASS |
| HEVC + DTS / MKV | 436 | 124 | d3d11va | PASS |
| VP9 + Opus / MKV | 362 | 127 | d3d11va | PASS |

`viewportMatches` 同时检查宿主和 MPV 子窗口客户区，四组均为 true。全屏/恢复和旋转属性检查通过，继续播放时进度确实前进。抽样掉帧计数均为 0；`avsync` 接近 0 只代表运行时属性，不代替实际听音验收。

宿主主动停止、模拟异常退出后 Electron 存活、重新启动及最终清理均通过。100ms 主线程定时器最大额外延迟约 16.2ms，仅为本次轻载观测，不是正式前端流畅度或性能 SLA。

**seek 表中耗时仅表示 `time-pos` 已反馈目标时间。** MPV 可以先更新该值再完成读取，故自动检查还要求之后继续播放进度前进；任何恢复超时均判整体 FAIL，不以位置反馈冒充已解码目标帧。

## 真实云盘结果与负面证据

仅从已有远端身份记录里按缓存 codec 选择少量样本；实际媒体仍从 F: 挂载盘读取，不使用新 API URL、不变更 CloudDrive 配置。

最终证据：`cloud-release.json`；整体 `pass=false`，launcher 返回 1。

| 匿名样本 | 分辨率 | 大小 / 字节 | 起播 / ms | 最终结果 |
| --- | --- | ---: | ---: | --- |
| cloud-hevc-aac | 3840×2160 | 261428404 | 4685 | 起播/暂停/旋转/窗口检查成功；恢复播放超时 |
| cloud-mpeg4-mp3 | 1920×1080 | 37857108 | 8477 | 完整 PASS；软件解码 |
| cloud-h264-pcm_s16le | 1920×1080 | 269508401 | 3627 | 完整 PASS；d3d11va |

HEVC 失败时：`time=5`、`pause=no`、`paused-for-cache=no`、`cacheDuration=0`、`seeking=yes`。这只能确认仍处于 seek 且未恢复推进，不能单凭此判断是网盘吞吐、demux seek、旋转重新配置、驱动还是缓存预算问题。最终主线程定时器额外延迟约 21.6ms，宿主隔离/重启/清理仍通过，实验失败没有终止正式应用。

其他轮次全部保留，不用一次成功掩盖失败：

- `cloud-auto.json`：首次选择包含一个 9,912 字节、无有效缓存时长的 MPEG4 样本；该样本和 H.264 样本起播等待 60 秒超时，4K HEVC 通过。小文件的原因未进一步确认，不判定损坏。
- `cloud-valid-auto.json`：筛选改为大小 > 1MB 且缓存时长 > 10 秒；三个样本完整通过，起播 2450 / 2889 / 5649ms。H.264 是此前相同文件，不把重试成功解释为永久修复。
- `cloud-verified.json`：加入旋转/尺寸后，HEVC 和 H.264 在继续播放时超时，MPEG4 通过。
- `cloud-release.json`：完整保留失败阶段与缓存/seek 状态，H.264 恢复正常，HEVC 仍超时。该轮部分过程与项目门禁并行运行，耗时不可直接与早期轻载轮次比较。

因此**不能宣称云盘稳定性通过，更不能保证全部格式或所有视频都可播放**。32MiB 前向/8MiB 后向只是 MPV 缓存预算，不能限制 CloudDrive 自身预读，也没有测量实际网络字节数。短视频、小样本和缓存命中不代表长片、冷缓存、远距离拖动或断网表现。

## 实际窗口验收

通过 computer-use 在中性合成媒体上逐步操作，不操作用户正式应用：

- 实际可见画面位于 Electron 窗口内，无需弹出独立外部播放器。
- 修正了默认菜单造成的 viewport 坐标偏移，以及首次 VO 初始化后 MPV 子窗口停留在源视频尺寸的问题。
- 点击后退后，画面和时间从 12 秒回到约 7 秒；点击旋转可见 90° 画面；全屏按钮进入全屏、再次点击恢复普通窗口，控件未被视频覆盖。
- 切换样本后，同一窗口实际显示 HEVC 画面及推进的时间；退出按钮正常关闭窗口和宿主。
- `Esc` 人工尝试没有抵达 renderer，未恢复全屏；按钮恢复有效。原生窗口焦点/键盘转发是正式集成待解决项，不能标记快捷键已通过。
- `manual-verified.json` 记录 seek、rotate、fullscreen、next、quit 操作；`hostStopped=true`、宿主正常退出、错误列表为空。
- 没有完成实际听音、声道/字幕、主观音画同步、跨屏/DPI矩阵验收。

## 本轮发现并修正的实验问题

1. Electron ESM 顶层等待 `app.whenReady()` 导致无窗口，改为 `.then` 初始化。
2. .NET stdin 默认编码使中文路径加载失败，双方固定 UTF-8，并通过中文/空格合成路径验证。
3. HTML 控件与自有原生窗口坐标不一致、初始画面未缩放：移除实验默认菜单，在 loaded / video-reconfig 及 resize 时同步两个自有窗口。
4. 测试必须等待 GUI 子进程；整体报告失败返回非零，不把可启动或无显式 error 当作成功。

这些只影响隔离脚本，不改生产播放器。

## 下一阶段建议（需单独授权）

先做**云盘 seek/恢复的窄范围定位**，不要立即替换播放器：用一个失败 HEVC 样本分离 seek、旋转和全屏操作，分别验证缓存/硬解配置，等待 `seeking=no` 且目标帧实际推进；保留失败报告，不盲目无限重试或下载整片。

通过后，再以可关闭的实验开关接入现有 PlayerPage，保持数据库、扫描和文件管理不变；正式实现需要播放会话/历史/关闭清理、失效文件错误反馈、快捷键焦点、原生画面与 UI 层级、字幕/音轨及许可证/打包验收。保留现有策略作为回退，不自动改变所有视频的默认播放方式。

本轮验证任务到此停止，没有自动开展正式集成。
