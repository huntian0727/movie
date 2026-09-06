# UI 组件模块

- `LibraryShell.tsx`：侧栏、筛选、30/50/100/200/300 分页、页码输入、可配置快捷键翻页、网格大小偏好与单项收藏、重命名、删除、打开播放等操作编排。键盘翻页必须排除输入控件和弹窗；页码变化必须把内容区滚回顶部。
- `Toolbar.tsx`：搜索、排序、网格/表格切换与五档预览卡片大小；`LibraryShell.tsx` 同时持久化预览卡片大小和资料库每页数量。
- `VideoGrid.tsx`/`VideoTable.tsx`：两种资料库呈现；网格卡片操作栏支持打开文件所在文件夹，以及按视频直属目录快速筛选系列视频。网格的整块封面均可点击或按 Enter/空格播放；封面失败状态按 URL 记录，后台分页刷新不能重新触发相同失败封面的请求。
- `PlayerPage.tsx`：native/mpv 两态、控制、可配置快捷键、同目录播放列表、hover 预览与失败降级。默认上下键按 5% 调音量、Ctrl + 左/右每次旋转 90°，`Ctrl+D` 只打开永久删除确认框且必须再次确认；实际匹配必须读取 `AppSettings.shortcuts`。播放器还可持久化标记待删除；外部 mpv 窗口不受这些主窗口快捷键控制。
- `SettingsPage.tsx`：设置、快捷键捕获/冲突提示、缓存确认、封面截帧位置和诊断预览/导出。缺失文件不再在设置页展示，但底层扫描标记仍保留。诊断区必须先预览白名单，再允许导出；完整应用目录披露默认关闭且切换后必须重新预览。诊断接口仅主窗口可用。
- `CloudDriveFolderDialog.tsx`：通过主进程 API 列出已挂载 CloudDrive 来源并逐层浏览远端目录，添加时同时保存远端路径和本地挂载播放路径。Renderer 不接触 Token，也不自行拼接可信目录身份。
- `DuplicateGroupsPage.tsx`：分别展示同大小候选统计与“精确大小＋缓存时长”匹配组，支持分页、全局大小排序、当前页保留选择，以及从任一候选文件一键把其所在目录树设为优先保留范围。优先目录始终递归包含所有子目录；筛选会返回命中目录树的候选组及组内跨目录的全部文件，并优先推荐保留目录树中的一个文件。显式单组选择高于目录推荐。重复页不得为了判断而主动读取视频或计算指纹；“一键永久删除候选移除项”跳过 SHA-256 与确认，但必须把完整 keep/delete 计划交给主进程重新校验，不能接受 renderer 提供的任意路径。
- `LibraryShell.tsx`：正式应用始终通过 `onLoadVideoPage` 请求数据库分页；静态 `videos` 筛选路径只用于隔离组件测试，不代表浏览器产品模式。目录树使用轻量 `LibraryNavigationSnapshot`，不要重新传入全量视频构树。
- `formatters.ts`：大小/时长展示。

自然语言定位：预览/播放控制先看 `PlayerPage`；快捷键新增或修改看 shared `shortcuts.ts`/`videoTypes.ts`、`settingsStore.ts`、IPC schema、`SettingsPage` 及 `LibraryShell`/`PlayerPage` 消费点；播放器队列切换或跨窗口刷新还要看 `App.tsx`、`renderer/windowSync.ts`、shared 契约及 main `playerWindow.ts`/`ipc.ts`；“避开开头黑屏”或“重建单个预览”看 `SettingsPage`、`VideoGrid`、main media protocol/cache；大量视频卡顿看 `LibraryShell`、grid/table 与上游查询；增加排序看 Toolbar + shared + repository；删除确认/重命名看 LibraryShell 与主进程文件链；设置看 SettingsPage。

组件测试覆盖主要渲染和交互，但 jsdom 不模拟真实媒体解码、fullscreen、布局测量和独立窗口。修改可访问名称、键盘行为或分页时同步 renderer 测试。

当前已有当前页多选、批量永久删除和批量移动，以及跨分页的“清空全部待删除”；尚无批量收藏或批量移除资料库。批量移动确认框必须明确“同名安全改名、不会覆盖”，结果使用主进程返回的实际最终路径/策略。修改批量操作时必须保持部分成功/失败明细，并确认操作范围是当前页、已选项还是全库标记，避免范围歧义。

`LibraryShell` 的 `refreshSequence` 是领域事件触发当前查询失效的入口；不要用重新加载整页播放器 URL 代替状态同步。`windowSync.ts` 必须先注册监听器再读取快照，并在卸载时释放原监听器，避免独立窗口反复开关后累积回调。

`MissingVideosPage.tsx` 是 `is_missing = 1` 记录的专用工作台：资产中心可进入全部明细，资料库“问题”单元格可携带来源 ID 直接筛选。界面只传递 video ID，复查和记录移除由主进程反查路径并完成安全校验。

`MetadataIssuesPage.tsx` 是有效视频中 `metadata_status = pending/failed` 的分页工作台。资产中心可从全局统计或单个资料库直接进入；页面将活动的 metadata `scan_failure` 摘要与视频状态合并展示。用户触发的单条/当前页重新分析复用 `retryMetadata`，批量时限制 8 个并发 IPC，不执行文件写入或删除。
