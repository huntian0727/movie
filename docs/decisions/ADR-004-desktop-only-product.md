# ADR-004：产品仅支持 Windows Electron Desktop

状态：Accepted（当前有效）

## Context

浏览器模式没有 SQLite、扫描、文件系统、FFmpeg、设置或完整播放器能力，只靠 `demoVideos`、`demoFolders` 和大量 `api ? real : demo` 分支模拟成功。这种双模式会掩盖 preload 注入错误，并让每个桌面功能同时维护一套无真实语义的假行为。

## Decision

取消独立 Web 产品和浏览器演示模式。React、React DOM、Vite、HTML、CSS、`tsconfig.web.json`、`dist-renderer` 和 Renderer 测试继续保留，因为它们属于 Electron Renderer 技术栈。

正式业务 UI 必须获得 preload 暴露的 `window.videoManager`，并继续通过 contextBridge/IPC 调用 Main。缺少 API 时只显示轻量 unsupported-runtime 页面，不初始化资料库，也不模拟收藏、扫描、设置、播放或文件操作。开发模式仍由 `scripts/start-desktop.mjs` 启动 Vite dev server 后加载 Electron。

## Consequences

- 单一运行模型减少 fallback 和假成功，preload/IPC 故障更容易暴露。
- `npm run dev` 不再表示 Web 产品；`dev:renderer` 仅用于调试 Renderer 资源，完整开发使用 `dev:electron`。
- 隔离组件测试仍可使用 props 或 mock API，但 mock 不进入生产运行路径。
- UI 调试需要 Electron 或组件测试；普通浏览器不再提供可操作的演示资料库。
