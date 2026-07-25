# Renderer 模块

React 展示层，不拥有磁盘/数据库权限。`App.tsx` 负责页面状态、真实 API/浏览器演示数据切换和业务编排；`api/client.ts` 获取 preload API；`components/` 放资料库、播放器和设置；`styles.css` 是全局视觉系统。

修改时保持 renderer 可在无 Electron API 的 Vite 浏览器模式运行，但不要让 mock 数据掩盖桌面错误。多窗口各有状态，改变收藏/历史时要考虑另一窗口刷新。需求定位：页面导航/数据刷新看 `App.tsx`；具体交互看 components；布局/性能看 CSS 与 LibraryShell。覆盖见 `tests/renderer`；焦点、窗口、fullscreen、真实 video 元素仍需 Electron 手测。

