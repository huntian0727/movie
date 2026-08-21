# Renderer 模块

Electron Renderer 的 React 展示层，不拥有磁盘/数据库权限。`App.tsx` 在入口验证 preload API：缺失时只显示 unsupported-runtime，存在时把必需的 `DesktopVideoManagerApi` 注入 `DesktopApp` 并负责页面状态与业务编排；`api/client.ts` 定义运行时边界；`components/` 放资料库、播放器和设置；`styles.css` 是全局视觉系统。

项目没有独立 Web 模式。Vite 只构建/服务 Electron Renderer；无 API 的普通浏览器不能进入资料库或模拟文件操作。组件测试可以显式注入 mock API/props，但不能在生产业务组件中保留假成功分支。多窗口各有状态，改变收藏/历史时要考虑另一窗口刷新。需求定位：运行时/API 注入与页面数据刷新看 `api/client.ts`、`App.tsx`；具体交互看 components；布局/性能看 CSS 与 LibraryShell。覆盖见 `tests/renderer`；焦点、窗口、fullscreen、真实 video 元素仍需 Electron 手测。

