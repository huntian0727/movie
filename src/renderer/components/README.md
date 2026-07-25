# UI 组件模块

- `LibraryShell.tsx`：侧栏、筛选、30/50/100/200/300 分页、页码输入、左右键翻页、网格大小偏好与单项收藏、重命名、删除、打开播放等操作编排。键盘翻页必须排除输入控件和弹窗；页码变化必须把内容区滚回顶部。
- `Toolbar.tsx`：搜索、排序、网格/表格切换与五档预览卡片大小；`LibraryShell.tsx` 同时持久化预览卡片大小和资料库每页数量。
- `VideoGrid.tsx`/`VideoTable.tsx`：两种资料库呈现；网格卡片操作栏支持打开文件所在文件夹，以及按视频直属目录快速筛选系列视频。网格的整块封面均可点击或按 Enter/空格播放；封面失败状态按 URL 记录，后台分页刷新不能重新触发相同失败封面的请求。
- `PlayerPage.tsx`：native/mpv 两态、控制、快捷键、同目录播放列表、hover 预览与失败降级。内置播放器支持上下键按 5% 调音量、Ctrl + 左/右每次旋转 90°；`Ctrl+D` 只打开永久删除确认框，必须再次确认。播放器还可持久化标记待删除；外部 mpv 窗口不受这些主窗口快捷键控制。
- `SettingsPage.tsx`：设置、缓存确认、封面截帧位置、缺失记录和诊断预览/导出。诊断区必须先预览白名单，再允许导出；完整应用目录披露默认关闭且切换后必须重新预览。诊断接口仅主窗口可用。
- `DuplicateGroupsPage.tsx`：分别展示同大小候选统计与快速指纹匹配组，支持分页、全局大小排序、当前页保留选择、单项永久删除和当前页批量清理确认。目录筛选的含义是“命中并优先保留目录内一个文件”，不是只显示或只删除该目录中的文件。UI 只能提交清理意图；完整 SHA-256 和文件版本复查必须留在主进程。
- `LibraryShell.tsx`：普通资料库在 Electron 环境通过 `onLoadVideoPage` 请求数据库分页；静态 `videos` 筛选路径仅供浏览器演示和组件测试。目录树使用轻量 `LibraryNavigationSnapshot`，不要重新传入全量视频构树。
- `formatters.ts`：大小/时长展示。

自然语言定位：预览/播放控制先看 `PlayerPage`；播放器队列切换或跨窗口刷新还要看 `App.tsx`、`renderer/windowSync.ts`、shared 契约及 main `playerWindow.ts`/`ipc.ts`；“避开开头黑屏”或“重建单个预览”看 `SettingsPage`、`VideoGrid`、main media protocol/cache；大量视频卡顿看 `LibraryShell`、grid/table 与上游查询；增加排序看 Toolbar + shared + repository；删除确认/重命名看 LibraryShell 与主进程文件链；设置看 SettingsPage。

组件测试覆盖主要渲染和交互，但 jsdom 不模拟真实媒体解码、fullscreen、布局测量和独立窗口。修改可访问名称、键盘行为或分页时同步 renderer 测试。

当前已有当前页多选、批量永久删除和批量移动，以及跨分页的“清空全部待删除”；尚无批量收藏或批量移除资料库。批量移动确认框必须明确“同名安全改名、不会覆盖”，结果使用主进程返回的实际最终路径/策略。修改批量操作时必须保持部分成功/失败明细，并确认操作范围是当前页、已选项还是全库标记，避免范围歧义。

`LibraryShell` 的 `refreshSequence` 是领域事件触发当前查询失效的入口；不要用重新加载整页播放器 URL 代替状态同步。`windowSync.ts` 必须先注册监听器再读取快照，并在卸载时释放原监听器，避免独立窗口反复开关后累积回调。
