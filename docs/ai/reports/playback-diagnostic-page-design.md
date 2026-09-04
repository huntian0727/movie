# PlaybackDiagnosticPage UI 组件设计

## 设计目标

`PlaybackDiagnosticPage` 用于解释“这个视频是什么、映匣准备如何播放、为什么这样选择、还缺少什么信息”。

页面分为快速诊断和按需深度检测两层：

- 快速诊断只读取数据库缓存和设置，打开即显示，不访问视频文件。
- 深度检测由用户明确触发，允许取消和超时；它可以调用现有媒体探测能力，但不在页面进入时自动执行。

V1 不修改实际播放路由、不替换播放器、不自动修复文件，也不把启发式判断描述为真实硬件解码测试。

## 推荐入口

1. 左侧主导航增加“播放诊断”，作为无选中视频时的入口。
2. `VideoDetailsDialog` 增加“播放诊断”入口，携带 `videoId` 打开。
3. `PlayerPage` 的信息区域增加“诊断”入口，定位当前播放视频。

优先实现详情弹窗和播放器的上下文入口；侧边栏页面随后提供搜索与最近播放选择器。

## 页面结构

```text
PlaybackDiagnosticPage
├─ DiagnosticHeader
│  ├─ 页面标题 / 视频名称
│  ├─ 快速诊断时间
│  └─ 重新读取缓存
├─ DiagnosticVideoPicker（无 videoId 或主动切换时显示）
│  ├─ 搜索框
│  ├─ 最近播放
│  └─ 分页搜索结果
├─ DiagnosticSummaryBanner
│  ├─ 推荐 Native / 推荐 MPV / 信息不足 / 文件缺失
│  ├─ 置信度
│  └─ 一句话原因
├─ DiagnosticContent
│  ├─ FileIdentityCard
│  ├─ VideoStreamCard
│  ├─ AudioStreamCard
│  ├─ DecodeAssessmentCard
│  ├─ PlaybackRecommendationCard
│  └─ ProbeEvidencePanel
└─ DiagnosticActions
   ├─ 使用当前策略播放
   ├─ 使用 MPV 播放
   ├─ 在文件夹中显示
   └─ 开始/取消深度检测
```

## 组件职责

| 组件 | 数据 | 职责 |
| --- | --- | --- |
| `PlaybackDiagnosticPage` | `videoId`、诊断 API、现有播放/定位回调 | 管理选择、加载、按需检测和取消 |
| `DiagnosticVideoPicker` | `LibraryPage` / `PlayHistoryEntry[]` | 复用服务端分页搜索，不加载封面 |
| `DiagnosticSummaryBanner` | `PlaybackAssessment` | 展示结果、置信度和关键依据 |
| `FileIdentityCard` | `PlaybackDiagnosticFile` | 展示路径、大小、版本、来源和缺失状态 |
| `VideoStreamCard` | `PlaybackDiagnosticVideo` | 展示容器、时长、分辨率、编码、Profile、像素格式 |
| `AudioStreamCard` | `PlaybackDiagnosticAudio` | 展示当前已有首音轨编码及缺失项 |
| `DecodeAssessmentCard` | `PlaybackAssessment` | 解释现有 `choosePlaybackRoute` 的规则结果 |
| `PlaybackRecommendationCard` | `PlaybackRecommendation[]` | 按优先级展示可执行建议 |
| `ProbeEvidencePanel` | 快速/深度证据、job 状态 | 区分数据库缓存与本次探测结果 |

## 快速诊断内容

快速诊断直接复用 `VideoRecord` 和 `AppSettings.playbackPreference`：

- 文件：名称、路径、扩展名、大小、修改时间、来源类型、CloudDrive 远端身份是否存在、是否缺失。
- 视频：时长、分辨率、容器、视频编码、Profile、像素格式。
- 音频：当前数据库保存的首音轨编码。
- 数据状态：`metadataStatus`、`codecProbeStatus`、`durationSource`。
- 路由：现有 `choosePlaybackRoute(video, playbackPreference)` 的结果。

快速诊断不能声称已经验证：

- HDR 制式、色域和传输特性。
- 全部视频/音频流。
- 声道、采样率和码率。
- 内嵌字幕。
- GPU、驱动或浏览器实际硬解能力。
- 历史播放失败次数。

对应字段缺失时显示“尚未采集”，不能显示为“无”。

## 诊断结果语义

```ts
type PlaybackAssessmentStatus =
  | "native-recommended"
  | "mpv-recommended"
  | "insufficient-metadata"
  | "missing"
  | "unreadable";

type DiagnosticConfidence = "high" | "medium" | "low" | "unknown";
```

- `native-recommended`：现有规则选择 Native；不等于保证可以硬解。
- `mpv-recommended`：现有规则选择 MPV，或配置为 MPV 优先。
- `insufficient-metadata`：元数据 pending/failed/unprobed，结论只基于容器回退规则。
- `missing`：数据库记录已标记缺失，不建议直接播放。
- `unreadable`：仅在本次按需探测返回明确读取错误时使用。

页面必须展示 `reasonCode` 与中文说明，而不是只显示播放器名称。

## 深度检测交互

### 触发前

- 按钮文案为“检测详细媒体信息”，不能写成“修复”。
- 对 CloudDrive/挂载盘提示“可能产生网络读取”。
- 不需要对本地文件增加额外确认。

### 执行中

- 主线程立即返回 job，页面保持可操作。
- 显示阶段、耗时和当前状态，不显示虚假百分比。
- 支持取消；离开页面不强制取消，但页面可选择取消自己的活动 job。
- 相同 `videoId + sizeBytes + modifiedAt` 同时只允许一个 job。

### 完成后

- 深度结果覆盖展示层中的未知字段，但不得悄悄改变实际播放策略。
- 明确标注结果来自“本次按需检测”，并显示检测时间。
- 文件版本发生变化时，旧结果标记为 stale，不继续使用。
- V1 结果保存在内存任务缓存；不要求数据库迁移。

## 深度检测建议范围

- 容器格式和总时长。
- 全部视频流：codec、profile、pixel format、width、height、frame rate、bit rate、色彩字段。
- 全部音频流：codec、channels、channel layout、sample rate、bit rate、language。
- 字幕流：codec、language、title、forced/default 标记。

禁止把完整原始 ffprobe JSON 无限制传给 renderer。主进程应先映射为有界、稳定、可校验的 DTO，并限制每类 stream 数量和字符串长度。

## 搜索与视频选择

- 搜索复用 `listVideoPage`，使用 `view: "all"`、服务端分页和小页面尺寸。
- 最近播放复用 `listPlayHistory()` 后再通过有界 `listVideosByIds()` 获取记录。
- 搜索结果不显示封面，避免诊断页面引入预览任务和磁盘读取。
- 从详情或播放器进入时直接使用传入的 `videoId`，无需先加载搜索列表。

## 页面状态

```ts
type PlaybackDiagnosticPageState =
  | { status: "empty" }
  | { status: "loading"; videoId: string }
  | { status: "ready"; snapshot: PlaybackDiagnosticSnapshot; probeJob: PlaybackProbeJob | null }
  | { status: "stale"; snapshot: PlaybackDiagnosticSnapshot; reason: "video-updated" | "file-version-changed" }
  | { status: "not-found"; videoId: string }
  | { status: "error"; videoId: string; message: string };
```

重新加载时保留旧快照；相同视频的旧请求返回后必须通过请求序号或 `fileVersion` 检查丢弃。

## Domain Event 行为

- 当前视频收到 `video:updated`：把快照标记 stale，合并后重新请求快速诊断。
- 当前视频收到 `video:removed`：切换为 `not-found`，停止继续使用旧操作按钮。
- `settings:changed`：仅重新计算播放策略与解释，不重新探测文件。
- `playback:changed`：更新最近播放列表，不刷新媒体信息。
- 其他视频事件不刷新当前诊断。

## 性能和安全边界

- 快速诊断目标是单个定长 DTO，不返回播放队列和封面数据。
- 页面进入时必须做到 0 次文件读取、0 次目录遍历、0 次 CloudDrive API 调用。
- 深度检测必须后台化、可取消、设超时，并限制并发；CloudDrive 建议全局并发 1，本地可有限并发。
- 不允许 renderer 传入任意路径；所有操作以 `videoId` 为入口，由主进程从数据库解析路径。
- IPC 输入使用 Zod 校验，通道加入 preload 白名单和窗口角色权限。
- 诊断失败不能触发删除、标记缺失或更换播放器偏好。

## 建议文件位置（未来实现）

- `src/renderer/components/PlaybackDiagnosticPage.tsx`
- `src/renderer/components/playback-diagnostic/DiagnosticVideoPicker.tsx`
- `src/renderer/components/playback-diagnostic/DiagnosticSummaryBanner.tsx`
- `src/renderer/components/playback-diagnostic/MediaStreamCards.tsx`
- `src/renderer/components/playback-diagnostic/DecodeAssessmentCard.tsx`
- `src/renderer/components/playback-diagnostic/ProbeEvidencePanel.tsx`
- `src/main/media/playbackDiagnosticService.ts`

## 验收标准

- 从详情页打开后立即显示数据库已有信息，不访问网盘。
- Native/MPV 建议可解释，并与现有路由函数结果一致。
- 未采集、确实不存在、探测失败三种状态不会混淆。
- 深度检测不会阻塞页面，能够取消，超时或失败不影响播放和资料库状态。
- 文件变化后不会继续展示旧的深度检测结论。
