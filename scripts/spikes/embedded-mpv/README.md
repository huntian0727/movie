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

## 验证边界

- 自动验证：真实 libmpv 加载/进度、嵌入 parent、暂停稳定、seek、音量属性、窗口全屏/恢复、宿主退出/异常隔离/重新启动、Electron 主线程定时器延迟。
- 人工验证：实际可见画面、按钮/快捷键、缩放/旋转与控件层级；实际声音/主观音画同步由用户或有音频输出验证能力的环境确认，不能仅由 codec 属性推出。
- 未将 HTML5 与 MPV 混用作自动转换，不做后台转码，不修改原文件，不新增整片下载任务；播放和挂载盘预读仍会读取视频内容，不能承诺不会读取完整短视频。
- `hwdec=auto-safe` 允许软件回退；32 MiB 前向/8 MiB 后向是 mpv 缓存预算，不限制 CloudDrive 自身预读。
- 不代表已完成 React PlayerPage 对接、HDR/字幕/音轨矩阵、长时间 4K 性能、安装器/DLL许可证合规、Electron 升级兼容或所有云盘媒体验证。原生子窗口获得焦点时键盘事件不一定抵达 DOM；Esc 实测未生效，按钮恢复正常，正式集成必须处理快捷键焦点转发。
- 实验不提供网络/外部导航或用户凭据配置，禁止打开不可信播放清单。实际使用前仍需明确来源和许可证审查。
