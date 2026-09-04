# 当前 UI 结构图

## 入口与导航

- 主窗口创建：`src/main/index.ts#createWindow`
- React 入口：`src/renderer/main.tsx`
- 根组件：`src/renderer/App.tsx#App` / `DesktopApp`
- 侧栏与主内容骨架：`src/renderer/components/LibraryShell.tsx`
- 导航位置：`LibraryShell` 内的 `<aside className="sidebar">` 和 `<nav className="primary-nav">`
- 路由方式：没有 URL router。`LibraryShell` 用本地 `view` 状态切换视频列表、异常和重复页；`DesktopApp` 用 `settingsOpen` 和 player session 切换设置/播放页。

```text
DesktopApp
├─ SettingsPage（settingsOpen）
├─ PlayerPage（独立 player BrowserWindow 的 session 有 selected video）
└─ LibraryShell（主窗口）
   ├─ 所有视频 / 收藏 / 待删除 / 最近播放 / 文件夹
   ├─ ScanFailuresPage
   ├─ DuplicateGroupsPage
   └─ 详情、重命名、删除、移动、文件夹异常等弹窗
```

## 页面清单

### 所有视频

- 文件路径：`src/renderer/components/LibraryShell.tsx`
- 页面组件：`LibraryShell` + `Toolbar` + `VideoGrid`/`VideoTable`
- 路由位置：`view === "all"`，主窗口默认值
- 作用：全库分页浏览、搜索、排序、网格/表格切换和批量操作
- 数据来源：`VideoManagerApi.listVideoPage` -> `library:page` -> `VideoRepository.listVideoPage`；侧栏数量/目录来自 `getLibraryNavigation`
- 依赖组件：`Toolbar`、`VideoGrid`、`VideoTable`、`PreviewImage`、`VideoDetailsDialog`
- 修改风险：中。不应把聚合中心数据塞入现有分页查询或视频数组。

### 收藏

- 文件路径：`src/renderer/components/LibraryShell.tsx`
- 页面组件：同用资料库列表组件
- 路由位置：`view === "favorites"`
- 作用：查看 `is_favorite = 1` 的视频
- 数据来源：`listVideoPage({ view: "favorites" })`
- 依赖组件：`Toolbar`、`VideoGrid`/`VideoTable`
- 修改风险：低，但必须保持领域事件的跨窗口刷新。

### 待删除

- 文件路径：`src/renderer/components/LibraryShell.tsx`
- 页面组件：同用资料库列表 + 批量工具栏
- 路由位置：`view === "pendingDelete"`
- 作用：展示待删除标记，支持全部永久删除
- 数据来源：`listVideoPage({ view: "pendingDelete" })`、`LibraryNavigationSnapshot.pendingDelete*`
- 依赖组件：批量删除弹窗、`VideoGrid`/`VideoTable`
- 修改风险：高，涉及永久文件操作，不应与 UI 中心页联动重构。

### 最近播放

- 文件路径：`src/renderer/components/LibraryShell.tsx`
- 页面组件：同用资料库列表
- 路由位置：`view === "recent"`
- 作用：按最近播放时间展示视频
- 数据来源：`play_history` join `videos`，分页由 `listVideoPage`；导航数量来自 `listPlayHistory` 最多 200 条
- 依赖组件：`Toolbar`、`VideoGrid`/`VideoTable`
- 修改风险：中。当前“最近数量”是限定 200 条的历史列表长度，不是全部历史聚合。

### 文件夹视图

- 文件路径：`src/renderer/components/LibraryShell.tsx`
- 页面组件：侧栏目录树 + 同用资料库列表
- 路由位置：`view === "folder"`，兼容 recursive/exact scope
- 作用：按目录或目录树浏览、从卡片跳转同目录、管理源目录扫描
- 数据来源：`LibraryNavigationSnapshot.directoryPaths`、`listFolders`、`listFolderScanStatuses`、`listVideoPage({ view: "folder" })`
- 依赖组件：`DirectoryPicker`、文件夹问题/移除弹窗、CloudDrive 添加弹窗
- 修改风险：高，它同时是导航、扫描入口和源目录管理区。

### 扫描异常

- 文件路径：`src/renderer/components/ScanFailuresPage.tsx`
- 页面组件：`ScanFailuresPage`
- 路由位置：`LibraryShell` 内 `view === "scanFailures"`
- 作用：异常分类/分页、单项重试、批量复查、元数据分析、删除/移除缺失记录
- 数据来源：`scan_failures` + 关联 `videos/source_folders`；IPC 为 `scan-failure-review:*` 和 `scan-failure-batch:*`
- 依赖组件：`PreviewImage`、`VideoDetailsDialog`、批处理任务状态
- 修改风险：高，包含可恢复与永久操作入口。资产中心只应链接跳转，不重复实现操作。

### 重复项

- 文件路径：`src/renderer/components/DuplicateGroupsPage.tsx`
- 页面组件：`DuplicateGroupsPage`、`DuplicateCleanupButton`、`DuplicateCleanupTasksPanel`
- 路由位置：`LibraryShell` 内 `view === "duplicates"`
- 作用：重复候选分组、优先保留目录、清理任务管理
- 数据来源：`VideoRepository.listDuplicateGroupsPage`、重复清理 repository/service、CloudDrive 远程身份
- 依赖组件：`VideoDetailsDialog`、后台任务面板
- 修改风险：极高，属于永久文件操作和 CloudDrive 边界，不应为新中心页顺便改造。

### 设置

- 文件路径：`src/renderer/components/SettingsPage.tsx`
- 页面组件：`SettingsPage`
- 路由位置：`DesktopApp.settingsOpen === true`，从 sidebar footer 打开
- 作用：扫描/播放偏好、快捷键、CloudDrive、缓存与诊断导出
- 数据来源：`SettingsStore`、`MediaCacheManager`、结构化日志/数据库健康检查
- 依赖组件：快捷键编辑、缓存确认和诊断预览区
- 修改风险：中高。现有“诊断包”是应用健康诊断，不是单个媒体的播放诊断，不应混为同一页。

### 播放页

- 文件路径：`src/renderer/components/PlayerPage.tsx`
- 页面组件：`PlayerPage`
- 路由位置：独立 `BrowserWindow`；由 `PlayerWindowCoordinator` 的 session 决定选中视频
- 作用：内置 video 播放、mpv 启动、播放列表、快捷键、全屏、详情和删除入口
- 数据来源：`WindowSyncSnapshot.playerSession`、`VideoRecord`、`local-video://media`、`listVideoPage` 同目录分页
- 依赖组件：`PreviewImage`、`VideoDetailsDialog`
- 修改风险：极高，播放、fallback、多窗口和文件删除在此交汇。播放诊断 V1 应通过新的独立面板/页面展示，不重写播放器。

### 视频详情（弹窗）

- 文件路径：`src/renderer/components/VideoDetailsDialog.tsx`
- 页面组件：`VideoDetailsDialog`
- 路由位置：视频卡片/表格/重复项/异常页/播放器的上下文弹窗
- 作用：显示基础媒体、文件和系统状态，复制路径
- 数据来源：当前 `VideoRecord`，没有额外 IPC
- 依赖组件：无独立业务服务
- 修改风险：低到中。这是新增“深入播放诊断”按钮的最佳上下文入口。

### CloudDrive 文件夹选择（弹窗）

- 文件路径：`src/renderer/components/CloudDriveFolderDialog.tsx`
- 页面组件：`CloudDriveFolderDialog`
- 路由位置：`DesktopApp.cloudDriveFolderOpen === true`
- 作用：从 API 挂载点浏览远程目录并创建资料库源
- 数据来源：CloudDrive gRPC `GetMountPoints` / `GetSubFiles`
- 修改风险：高，涉及远程身份与本地挂载路径映射。

## 新页面的建议挂载点

- 在 `LibraryShell` 左侧 `primary-nav` 增加“资产中心”和“播放诊断”，内容仍渲染到现有 `<section className="content">`。
- V1 可在 `LibraryShell` 定义 UI-only `ShellView = LibraryView | "assets" | "playbackDiagnostics"`，不修改 `LibraryPageQuery.view` 的数据库契约。
- 资产中心可作为主导航首项，但 V1 应保留“所有视频”为默认页，避免改变用户现有启动习惯。
- 播放诊断同时提供上下文入口：`VideoDetailsDialog` 和 `PlayerPage` 的详情区传入 video ID，主页面自动选中该文件。
