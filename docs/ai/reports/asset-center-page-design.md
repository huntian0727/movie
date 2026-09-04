# AssetCenterPage UI 组件设计

## 设计目标

`AssetCenterPage` 是资料库的只读总览页，用于回答四个问题：资料库有多大、来源是否健康、最近扫描是否正常、当前最值得处理的问题是什么。

V1 不承担文件扫描、文件删除、媒体解析或设置修改。页面中的操作只允许刷新数据库快照，或导航到现有页面继续处理。

## 推荐挂载位置

- 在 `LibraryShell` 左侧主导航中增加“资产中心”。
- 推荐放在“所有视频”之前，作为应用默认总览入口；第一版上线时可以暂不改变当前默认页，待稳定后再决定是否默认打开资产中心。
- 使用现有手工视图状态，不引入 React Router 或新的全局状态库。
- 未来预计扩展 `LibraryView`，但不复用 `LibraryPageQuery.view`：资产中心不是视频列表筛选条件。

## 页面结构

```text
AssetCenterPage
├─ AssetCenterHeader
│  ├─ 页面标题 / 快照生成时间
│  └─ 刷新按钮
├─ LibraryHealthBanner
│  └─ 正常 / 需关注 / 严重异常及一条主要原因
├─ AssetMetricGrid
│  ├─ 有效视频数量
│  ├─ 总容量
│  ├─ 已启用资料库
│  ├─ 扫描异常
│  ├─ 元数据待处理/失败
│  └─ 缺失记录
├─ SourceHealthSection
│  ├─ SourceHealthToolbar
│  └─ SourceHealthTable（服务端分页）
├─ ScanActivityPanel
│  ├─ 当前扫描状态
│  └─ 最近扫描结果
├─ MetadataQualityPanel
│  ├─ 元数据完整度
│  ├─ 编码信息完整度
│  └─ 预览缓存状态
├─ StorageBreakdownPanel（进入可视区后懒加载）
│  ├─ 按来源类型
│  ├─ 按文件格式
│  └─ 按视频编码
└─ PlaybackOverviewPanel
   ├─ 已记录播放的视频数 / 最近播放时间
   └─ 播放失败统计不可用说明
```

## 组件职责

| 组件 | 输入 | 职责 | 不应承担 |
| --- | --- | --- | --- |
| `AssetCenterPage` | 只读 API、导航回调、Domain Event | 编排加载、局部刷新和错误边界 | 遍历视频、直接查询文件系统 |
| `AssetCenterHeader` | `generatedAt`、`isRefreshing` | 显示数据时间并提供手动刷新 | 启动扫描 |
| `LibraryHealthBanner` | `health`、`primaryIssue` | 只展示最高优先级问题 | 自行推导全部统计 |
| `AssetMetricGrid` | `overview` 中的定长汇总 | 展示核心指标并提供现有页面跳转 | 接收视频数组 |
| `SourceHealthTable` | 分页结果、筛选和排序状态 | 展示资料库来源健康度 | 一次渲染全部来源 |
| `ScanActivityPanel` | 活动扫描及最近任务摘要 | 展示进度、结果和异常入口 | 控制 `ScanManager` |
| `MetadataQualityPanel` | 元数据/编码/预览状态计数 | 暴露资料库数据质量 | 自动触发 FFprobe 或预览生成 |
| `StorageBreakdownPanel` | 有界 Top N 分布 | 轻量展示容量构成 | 拉取完整明细进行前端聚合 |
| `PlaybackOverviewPanel` | 已有播放历史摘要 | 展示当前真实可用数据 | 伪造播放失败率 |

## 指标定义

为避免不同页面的数字口径不一致，V1 固定采用以下定义：

- “有效视频”：`videos.is_missing = 0`。
- “总容量”：有效视频的 `SUM(size_bytes)`；不表示磁盘实时占用，也不访问文件系统复核。
- “缺失记录”：`videos.is_missing = 1`，单独展示，不计入有效视频和总容量。
- “已启用资料库”：`source_folders.enabled = 1`。
- “资料库异常”：已启用来源存在 `scan_error`，或存在未解决 `scan_failures`。
- “元数据待处理/失败”：有效视频按 `metadata_status` 聚合。
- “编码信息完整”：有效视频中 `codec_probe_status = 'ready'`。
- “播放过的视频”：`play_history` 的记录数；当前不是播放次数。
- “播放失败”：当前没有可靠事件和持久化数据，V1 明确显示“尚未记录”，不显示 0。

## 页面交互

### 首次进入

1. 立即显示页面骨架和上一次内存快照（如果存在）。
2. 并行请求总览快照与第一页资料库来源。
3. 容量分布仅在对应面板进入可视区后请求。
4. 不加载视频封面，不访问视频文件，不启动扫描或 FFprobe。

### 刷新

- 刷新按钮只重新读取 SQLite 聚合数据。
- 刷新期间保留旧数据并显示轻量刷新状态，不清空整个页面。
- 单个区块失败时保留其他成功区块，页面进入 `partial` 状态。

### 指标跳转

- 扫描异常 → 现有 `scanFailures` 页面。
- 缺失记录 → 现有扫描异常页面的“文件不存在”筛选（需要未来增加导航参数，不新增清理逻辑）。
- 最近播放 → 现有 `recent` 页面。
- 元数据待处理/失败 → V1 先进入相应说明；后续只有在现有列表支持该筛选时再提供直达。
- 来源行 → 现有 `folder` 页面并选中对应资料库来源。

## 页面状态模型

```ts
type AssetCenterLoadState =
  | { status: "idle" }
  | { status: "loading"; staleData: AssetCenterOverview | null }
  | { status: "ready"; data: AssetCenterOverview }
  | { status: "partial"; data: AssetCenterOverview; failedSections: AssetCenterSection[] }
  | { status: "error"; message: string; staleData: AssetCenterOverview | null };
```

这是设计契约，不是本次代码变更。组件必须区分首次加载与后台刷新，避免刷新时整页闪烁。

## Domain Event 刷新策略

| 事件 | 页面可见时 | 页面不可见时 |
| --- | --- | --- |
| `video:updated` / `video:removed` | 标记过期，300–500ms 合并后刷新 overview | 只标记过期 |
| `favorite:changed` / `playback:changed` | 仅刷新受影响的汇总区块 | 只标记过期 |
| `source-folder:updated` / `library:rescanned` | 合并刷新 overview、当前来源页、扫描区块 | 只标记过期 |
| `duplicate-cleanup:changed` | 合并刷新容量和视频计数 | 只标记过期 |

同一时间只能有一份相同请求在途；连续事件不得形成请求队列。旧响应通过请求序号丢弃。

## 性能预算

- Overview 返回固定大小对象，目标序列化后小于 16 KB。
- 来源列表必须服务端分页，默认 30 条，最大 100 条。
- 分布接口每个维度最多返回 12 项，其余合并为“其他”。
- 禁止通过 `listVideos`、`listVideoPage` 或 `directoryPaths` 在前端计算资产指标。
- 禁止为总览执行文件 `stat`、目录遍历、CloudDrive 请求、封面加载或媒体读取。
- 数据库查询只返回聚合行，不把 32 万条视频映射成 `VideoRecord[]`。
- 主进程可增加按资料库修订号失效的短时内存快照，避免多个 UI 区块重复运行同一聚合。

## 可访问性与视觉规则

- 健康状态不能只依赖颜色，必须同时显示文字和图标。
- 指标卡是跳转入口时使用真实 `button`，并提供明确 `aria-label`。
- 来源表支持键盘聚焦，长路径使用中间省略并保留完整 `title`。
- 数字加载后宽度保持稳定，避免布局跳动。
- 沿用现有深色主题、间距、按钮和状态色，不引入第二套 UI 框架。

## 建议文件位置（未来实现）

- `src/renderer/components/AssetCenterPage.tsx`
- `src/renderer/components/asset-center/AssetMetricGrid.tsx`
- `src/renderer/components/asset-center/SourceHealthTable.tsx`
- `src/renderer/components/asset-center/ScanActivityPanel.tsx`
- `src/renderer/components/asset-center/MetadataQualityPanel.tsx`
- `src/renderer/components/asset-center/StorageBreakdownPanel.tsx`

## 验收标准

- 打开页面不会访问任何视频内容或挂载盘目录。
- 32 万视频、2 万以上来源目录时，renderer 不接收全量列表。
- Domain Event 风暴下最多发生一次合并刷新，不闪屏、不阻塞导航。
- 数据不可用时明确显示“尚未记录/不可用”，不以 0 代替未知。
- 所有处理入口复用现有页面，不复制扫描和文件管理业务逻辑。
