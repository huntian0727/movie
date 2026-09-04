# 映匣 UI 增量优化 V1 分析总结

## 1. 当前系统结构总结

映匣是分层清晰的 Windows Electron 应用：React renderer 只负责展示与交互，sandboxed preload 暴露类型化白名单 API，主进程通过 Zod 和窗口角色校验请求，最后进入 repository/service、SQLite、文件系统、FFprobe/FFmpeg、CloudDrive 和播放器。

现有页面是一个手工状态路由的 SPA，不使用 React Router；主窗口的导航和内容由 `LibraryShell` 集中管理，播放使用独立 BrowserWindow。这个结构足以支撑两个增量中心页，V1 没有必要先引入新路由库、全局状态库或第二套后端架构。

## 2. 当前 UI 结构

```text
映匣主窗口
├─ 侧边栏
│  ├─ 所有视频
│  ├─ 收藏
│  ├─ 待删除
│  ├─ 最近播放
│  ├─ 扫描异常
│  ├─ 重复项
│  ├─ 文件夹树 / 源目录操作
│  └─ 设置
└─ 内容区
   ├─ Toolbar
   ├─ 资料库分页网格/表格
   ├─ 扫描异常页
   └─ 重复项页

独立播放窗口
└─ PlayerPage + 同目录播放列表 + VideoDetailsDialog
```

## 3. 资产中心建议

### 最佳挂载位置

- 主窗口 `LibraryShell.primary-nav`，位于“所有视频”之上或紧随其后。
- 内容渲染到现有 `<section className="content">`，复用 Toolbar 的标题/刷新风格，但不显示视频搜索和排序控件。
- V1 不更改应用默认页，仍默认进入“所有视频”。

### 可直接复用数据

- 视频数量、待删除数/容量、元数据 pending 数、异常数：`LibraryNavigationSnapshot`。
- 资料库源状态：`listFolders()` 返回的 enabled/provider/lastScannedAt/scanError/videoCount/providerIdentityCount。
- 实时扫描状态：`listFolderScanStatuses()`。
- 最近扫描详情：`scan_tasks` 已存在，但需新增只读 repository/API。
- 扫描异常详情：`scan_failures` 和现有异常页。资产中心的卡片应跳转已有页，不复制处理按钮。

### 需要新增的只读能力

- `AssetSummary`：至少包含 active/missing/pending/failed 视频数、`SUM(size_bytes)`、本地/CloudDrive 源数、最近扫描时间。
- `RecentScanTask[]`：从现有 `scan_tasks` 读取最近任务。
- 数据链：新 shared type + preload channel + IPC Zod/角色限制 + repository 聚合。
- 不需要新数据库字段，前提是播放异常卡片先标记“暂无历史数据”或仅展示 codec/metadata probe 失败。

### 预计组件

- `AssetCenterPage.tsx`：页面编排和加载/空/错误状态。
- `AssetMetricCard.tsx`：数量/容量/异常指标。
- `LibraryHealthPanel.tsx`：源目录健康与 CloudDrive 身份覆盖。
- `RecentScanPanel.tsx`：当前与历史扫描。
- 最好让卡片通过 callback 跳转现有页，不让新组件直接持有文件操作 API。

### 资产中心风险

- 全库统计不得通过加载 32 万条 `VideoRecord` 在 renderer 计算，必须使用 SQL 聚合。
- `getLibraryNavigation()` 已有一次大聚合和目录 distinct；不应因资产页的轮询继续加重它。新 summary 应独立、可缓存、事件失效。
- `ScanManager.statuses` 是进程内状态，重启后不代表历史；历史卡片必须读 `scan_tasks`。
- 当前没有可查询的播放失败历史，不应从“最近播放数”或 `metadata_status` 假推播放失败率。

## 4. 播放诊断中心建议

### 最佳入口

- 主入口：`LibraryShell.primary-nav` 的独立“播放诊断”页，支持搜索/选择资料库视频。
- 快捷入口：`VideoDetailsDialog` 增加“打开播放诊断”，传递 video ID；`PlayerPage` 的详情弹窗复用同一入口。
- 不建议把详细诊断直接堆进 `PlayerPage`，以免涉及播放时序、快捷键、全屏和外部窗口。

### 可复用信息

- 文件：path/directory/size/modified/imported/provider identity/missing。
- 视频：duration/format/width/height/video codec/profile/pixel format。
- 音频：首音轨 codec。
- 状态：metadata/codec probe/cache status。
- 建议：复用 `choosePlaybackRoute` 给出当前 native/mpv 预测及具体规则理由。

### 需要新增的能力

- `PlaybackDiagnosticSummary`：整合现有 `VideoRecord`、当前 playback preference、预测路由与缺失字段。
- `DetailedMediaProbe`：由用户点击后按需运行，提取 HDR、全部视频/音频/字幕流、声道、语言、帧率和码率。
- 取消/超时/去重：对网盘是必需品；按 video ID + 当前文件版本保护。
- 建议输出“规则分析”而非宣称真实解码能力；若日后做解码自测，必须独立设计有界、可取消的测试。

### 是否需要新数据库字段

- V1 不需要。基础页面 + 用户按需详细探测可使用现有数据和短期缓存。
- 若要持久化 HDR/字幕/多音轨，建议评审独立 `media_probe_details` 表或版本化 JSON summary，不建议继续向 `videos` 平铺大量列。
- 若要“播放异常统计”，必须先定义事件契约（route/stage/error code/fallback/result/file version/time）并评审新的有界历史存储；现有 `play_history` 不能承担此语义。

### 播放诊断风险

- 页面打开即全量 ffprobe 会在挂载网盘上制造卡顿和带宽洪峰。
- 直接把 ffprobe 原始 JSON 发给 renderer 会放大 IPC 数据、路径暴露和版本兼容风险。
- “推荐 mpv”与“已证明 native 不可播”必须明确区分。
- 诊断过程不能写回或改变播放路由，除非用户在设置中显式修改偏好。

## 5. 推荐开发顺序

1. **第一步：资产中心基础版**。新增只读 `AssetSummary` 聚合与页面，先上线视频数、容量、资料库源、扫描状态、异常数和跳转。
2. **第二步：播放诊断基础版**。仅展示现有 `VideoRecord` + 路由规则说明，从详情弹窗和主导航进入，不运行额外媒体读取。
3. **第三步：按需详细探测**。新增可取消 service/IPC 和内存缓存，增加 HDR/音轨/字幕/码率/帧率。
4. **第四步：播放异常观测**。先定义事件和保留策略，再决定是否 migration；完成后才把统计卡片放入资产中心。
5. **第五步：真实环境验证**。用本地/SMB/CloudDrive、HDR、多音轨、内嵌字幕、损坏文件和 mpv 缺失样本验证。

## 6. 总体风险点

- `LibraryShell` 已承担导航、列表、目录树、重复项、异常和大量弹窗；新页面应作为独立组件，避免继续把具体内容写在该文件内。
- 主进程同时负责 SQLite、FFprobe、扫描和 IPC；新页不得高频重复执行大聚合或详细 probe。
- 播放窗口受限 API 是明确安全边界；新诊断 API 默认只给 main window，若播放窗口需要，必须单独评审最小读权限。
- 现有文档有少量滞后：`src/main/db/README.md` 仍标注 schema v11，当前代码已是 v12；后续开发必须以 migrations 和测试为准。

## 7. 不建议修改的区域

- `src/main/media/libraryScanner.ts` 的 Directory Snapshot 和 missing 安全语义。
- `src/main/media/scanManager.ts` 的串行、暂停、取消和同源互斥。
- `src/main/playerWindow.ts` 的独立窗口会话与 2 秒 codec 等待上限。
- `src/shared/playbackRouting.ts` 的 native/mpv 选择和 `PlayerPage` 的 native -> mpv fallback。
- `src/main/media/mediaProtocol.ts` 的 ID 反查、Range 流式播放和缓存协议。
- `src/main/files` 和重复清理的永久文件操作边界。
- 现有 SQLite schema：资产中心与诊断 V1 均可在不迁移的情况下启动。

## 结论

下一阶段可在不破坏现有播放、扫描、数据库和文件管理逻辑的前提下开发。最小安全路径是：在现有 shell 增加两个独立页面，资产中心使用新的只读 SQL 聚合，播放诊断先复用现有 `VideoRecord` 与播放路由规则，丰富媒体探测和播放失败历史分别后置到独立阶段。
