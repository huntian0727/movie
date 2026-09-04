# 项目技术架构

## 技术栈

| 领域 | 当前实现 |
| --- | --- |
| 应用形态 | Windows Electron 桌面端，没有独立 Web 产品模式 |
| 桌面容器 | Electron 33.4.x，主窗口 + 独立播放窗口 |
| UI | React 18 + React DOM，函数组件与 Hooks |
| 语言 | TypeScript 5.7；preload 为 `.cts`，其余为 ESM |
| 构建 | Vite 6（renderer）+ TypeScript compiler（main/preload/shared）+ electron-builder/NSIS |
| UI 组件库 | 无通用组件框架；图标使用 `lucide-react`，样式集中在 `src/renderer/styles.css` |
| 状态管理 | 无 Redux/Zustand/MobX；使用 React `useState/useMemo/useEffect/useRef` 与主进程领域事件 |
| 路由 | 无 React Router；主界面依靠 `LibraryShell` 的 `view` 状态切换，设置和播放由 `App.tsx` 条件渲染 |
| 本地数据 | SQLite + `better-sqlite3`，schema v12，通过顺序 migration 演进 |
| 设置 | `electron-store`，由主进程 `SettingsStore` 持久化 |
| 进程通信 | `contextBridge` + 白名单 IPC + Zod 入参验证 |
| 媒体工具 | `ffprobe-static` / `ffmpeg-static`，外部 mpv，系统默认播放器 fallback |
| CloudDrive | gRPC client + protobuf，用 API 枚举远程目录，本地挂载路径用于播放 |
| 日志/诊断 | 主进程结构化 JSONL 日志，路径脱敏，设置页可预览/导出诊断包 |

## 运行时分层

```text
src/renderer/main.tsx
  └─ React App / LibraryShell / PlayerPage / SettingsPage
       └─ window.videoManager（受限制的类型化 API）
            └─ src/main/preload.cts / contextBridge
                 └─ src/main/ipc.ts / Zod / trusted sender check
                      ├─ VideoRepository -> SQLite
                      ├─ ScanManager -> LibraryScanner -> MetadataQueue -> FFprobe
                      ├─ PlayerWindowCoordinator -> native/mpv/system player
                      ├─ Media protocol/cache -> file stream/FFmpeg
                      ├─ file operations / duplicate cleanup
                      └─ settings / logging / diagnostics / CloudDrive gRPC
```

## 核心入口

- Electron 装配根：`src/main/index.ts`。创建数据库、repository、缓存、元数据队列、扫描管理器、重复清理服务和播放窗口，再注册 IPC 与媒体协议。
- Renderer 入口：`src/renderer/main.tsx` -> `src/renderer/App.tsx`。
- 主窗口：`src/main/index.ts#createWindow`，打包时加载 `dist-renderer/index.html`。
- 播放窗口：`src/main/playerWindow.ts#createPlayerWindow`，使用同一 renderer bundle，但用 `--video-manager-window-role=player` 限制 preload API。

## 进程与安全边界

- Renderer 禁止 Node integration，启用 `contextIsolation` 和 sandbox。
- Renderer 只传 video ID/查询意图，文件真实路径在主进程由 repository 反查。
- `src/main/security.ts` 按 `main/player/smoke` 角色限制 IPC；播放窗口不获得扫描、文件夹变更、设置写入或诊断导出等能力。
- `local-video://` 协议用 video ID 提供流式播放、封面和时间轴图片，不向 DOM 暴露直接 `file://` 路径。

## 状态和同步

- `DesktopApp` 保存设置、导航摘要、文件夹、扫描状态、播放会话和刷新序号。
- `LibraryShell` 保存当前页面、分页、搜索、排序、目录树和弹窗状态。
- 主进程 `DomainEventBus` 广播单调 sequence 事件；`renderer/windowSync.ts` 先订阅再读快照，避免多窗口丢事件。
- 大列表由 `VideoRepository.listVideoPage` 在 SQLite 中分页/排序/筛选，正式应用不向 renderer 传输全部视频。

## 对新 UI 的架构结论

1. 新页面应继续挂在当前 `LibraryShell` 的 sidebar/content 边界内，不需要为 V1 引入新路由库或全局状态库。
2. 不要把“资产中心/诊断中心”当成 `LibraryPageQuery.view` 的数据库列表类型；它们是 UI workspace section，不是视频筛选条件。
3. 新数据必须沿 `shared type -> preload -> IPC/Zod -> service/repository -> renderer` 完整契约链增加，不允许 renderer 直读 SQLite、日志或媒体文件。
4. 优先新增聚合查询和按需诊断服务，不复用“加载全量视频后在前端统计”的模式。
