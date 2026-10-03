# 原播放器界面与内嵌 MPV 解码统一

## 实现边界

保留 `PlayerPage` 的播放列表、上一部/下一部、详情、收藏、待删除、删除确认、快捷键和预览业务；仅把视频画面与控制指令接入独立的 `useEmbeddedEngine`。不再把内嵌播放路由到精简的 `EmbeddedPlayerPage`，历史组件暂保留但不作为当前入口。

```text
视频浏览 / 视频数据 / 播放诊断
  → 既有 player session（ID / 队列 / 起始位置）
  → App → PlayerPage（唯一播放界面）
      ├─ 浏览器支持：既有 HTML video
      └─ 兼容解码：useEmbeddedEngine
          → 精简、可信 player preload → EmbeddedPlayer
          → 独立 NativeHost → 本机 libmpv → 原界面的画面区域
```

`choosePlaybackRoute` 原规则不变；`integratedPlaybackRoute` 仅在播放窗口把非显式外部优先的 MPV 路由映射到内嵌引擎。明确选择“外部 MPV 优先”仍保留。浏览器实际解码失败时，在同界面从当前时间切换到内嵌引擎；内嵌失败只提示重试/手动外部播放，不自动跳出软件。诊断页同步展示这一策略，但规则分析不等于实际解码保证。

## 关键契约

- Renderer 只提交视频 ID、受限控制值和会话键，不提交路径、DLL、HWND 或任意原生命令；主进程仍检查可信来源与当前播放窗口。
- 独立会话键隔离旧轮询、迟到的卸载和快速换片；元数据更新不重启解码器。状态轮询 250ms 且不重叠。
- ResizeObserver、布局变化和窗口 resize 只更新画面边界；播放列表占用独立侧栏，原生画面不能覆盖按钮。详情/确认框显示时隐藏原生子窗口。
- Windows 原生子窗口有独立焦点。点击后让宿主 HWND 接收键盘，通过受限事件白名单转发给原快捷键；读取消息时刻的 `GetKeyState` 保留组合键，不采用硬件即时状态。Chromium 控件焦点下的键同样走一次转发；输入框不触发播放快捷键，Tab/Enter 等控件默认交互保留。
- `keep-open=yes` 下 EOF 不一定产生 END_FILE；检查 `eof-reached` 并按 token 只通知一次，复用原队列续播。
- 手动外部播放和永久删除前先释放解码会话/文件句柄。释放失败不调用删除回调；重试及外部启动失败恢复当前播放位置。删除核心规则没有放宽。
- 不改扫描核心、数据库 schema、重复判断、CloudDrive API 或文件操作服务。

## 限制

原生 HWND 不能被 DOM z-index 覆盖。因此原控制栏在内嵌全屏时保持可见，播放列表停靠在画面旁；不是另一套播放器 UI。音轨/字幕接口沿用已有服务，本轮不额外开发新的选择面板。

本机需配置 libmpv 运行库；包内仅含 NativeHost，不自动下载或公开捆绑解码 DLL。当前云盘播放仍使用已有挂载路径，网络、容器索引与文件完整性仍会影响读取。不能承诺所有文件都能播放；公网分发前需完成运行库许可证/打包审查。

长期播放、真实听音、真实 CloudDrive 播放及全屏中 HTML/MPV 混合队列切换未专项验收。长期测试按用户要求留到正常使用中。

焦点实现参考：[Microsoft SetFocus](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setfocus)、[GetKeyState 消息时刻状态](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getkeystate)。
