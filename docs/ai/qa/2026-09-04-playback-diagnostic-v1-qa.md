# Playback Diagnostic V1 QA 报告

## Context

- 任务：映匣 UI V1 增量优化，阶段 4 Playback Diagnostic 独立 QA
- 日期：2026-09-04
- QA 结论：**FAIL**
- 被测分支：`ai/playback-diagnostic-v1`
- 被测 Commit：`1c5bd2cf65668b1f5887e0f683899449cec07288`
- 最新 `origin/main`：`1c5bd2cf65668b1f5887e0f683899449cec07288`
- 开始测试时工作区：干净

开始测试前已执行远端更新检查。被测分支、HEAD 和最新 GitHub `main` 一致，没有未提交修改，因此允许执行 QA。

本轮没有修改业务代码、测试代码、配置、数据库结构或用户数据。没有对用户真实视频执行播放、扫描、FFprobe、移动或删除操作；真实资料库仅以 SQLite `readonly + query_only` 模式进行查询性能测量。

## Changes

### 分支

`ai/playback-diagnostic-v1`

### Commit

`1c5bd2cf65668b1f5887e0f683899449cec07288`

### 修改摘要

- 新增本 QA 报告。
- 审核播放诊断页面、VideoDetailsDialog 入口、播放规则复用和 standalone 页面隔离。
- 验证默认加载、最近播放、服务端分页、字段状态、缺失/移除状态和只读刷新。
- 执行真实 319,986 视频资料库的只读查询性能测量和路径搜索口径验证。
- 执行 lint、typecheck、完整 Vitest、生产构建与 Electron smoke。

### 新增文件

- `docs/ai/qa/2026-09-04-playback-diagnostic-v1-qa.md`

### 删除文件

- 无。

## Verification

### 1. 开工状态门禁

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `ai/playback-diagnostic-v1` |
| 工作区状态 | PASS | 开始测试时 `git status --short` 无输出 |
| Developer Commit | PASS | HEAD 为 `1c5bd2c...` |
| GitHub main | PASS | `git fetch origin main` 后 `origin/main` 与 HEAD 一致 |
| 未授权覆盖或回滚 | PASS | 未执行 reset、丢弃修改、强制同步或强制推送 |

### 2. 原播放功能回归

| 范围 | 结果 | 覆盖证据 |
| --- | --- | --- |
| 内置播放器 | PASS | 标准控件、自动播放、音量、进度、全屏、旋转测试通过 |
| 播放失败回退 | PASS | native error 后尝试外部播放的测试通过 |
| MPV 路由 | PASS | mpv route 调用外部播放、自动启动外部播放器的测试通过 |
| 播放列表 | PASS | 当前目录分页加载、视频切换、待分析时长状态测试通过 |
| 播放详情 | PASS | 打开、关闭、Escape、复制路径、缺失字段回退测试通过 |
| 文件操作安全 | PASS | 删除、重命名、移动、冲突和补偿回滚测试通过 |

本轮只验证调用逻辑和自动化行为，没有使用用户真实视频做主观播放测试，也没有实际启动用户配置的 MPV。

### 3. 页面入口与上下文边界

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 侧边栏入口 | PASS | “播放诊断”位于最近播放之后、扫描异常之前 |
| 独立页面打开 | PASS | `LibraryShell` 测试验证标题、搜索入口与视图切换 |
| VideoDetailsDialog 入口 | PASS | 主资料库详情弹窗提供“播放诊断”按钮并关闭原弹窗 |
| PlayerPage 不出现入口 | PASS | PlayerPage 不传 `onOpenDiagnostic`；测试明确断言无“播放诊断”按钮 |
| 默认页面保持不变 | PASS | 应用仍以“所有视频”为默认 view |

### 4. 默认加载、最近播放和服务端分页

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 默认不枚举全库 | PASS | 没有 selected id 且搜索为空时不调用 `listVideoPage` |
| 最近播放上限 | PASS | 只截取 `recentVideoIds.slice(0, 10)` 并用 `listVideosByIds` 读取 |
| 最近顺序 | PASS | 按传入 ID 顺序重新组装，不依赖 SQL `IN` 返回顺序 |
| 不加载预览 | PASS | 结果只渲染文件名、路径、大小、时长；页面没有 PreviewImage/getCoverUrl 调用 |
| 搜索防抖 | PASS | 225 ms 后提交服务端查询，搜索词变化回到第一页 |
| 服务端分页 | PASS | 固定 `pageSize=30`，使用现有 `listVideoPage` 的页码、总数和总页数 |
| 迟到响应保护 | PASS | detail、recent、search 分别使用递增 request id 丢弃过期响应 |

默认打开路径性能良好。真实库读取最近 10 条的 5 次耗时为：`0.62 / 0.18 / 0.14 / 0.14 / 0.13 ms`。

### 5. 搜索正确性

页面输入框显示“输入文件名或路径”，无结果提示也要求用户尝试“文件名或路径关键词”。但复用的 `VideoRepository.listVideoPage()` 当前 SQL 只有：

```sql
videos.filename LIKE @search ESCAPE '!' COLLATE NOCASE
```

临时数据库验证：

- 文件：`D:\OnlyInPathToken\clip.mp4`
- 搜索 `clip`：1 条
- 搜索仅存在于目录路径的 `OnlyInPathToken`：0 条

因此“按路径搜索”没有实现，用户界面与真实服务端查询口径不一致。

结果：**FAIL（P1 功能阻断）**。

### 6. 文件、视频和音频字段状态

页面展示：

- 文件名、完整路径、大小、修改时间、时长和来源；
- 格式、视频编码、分辨率、Profile、Pixel Format；
- 音频编码。

状态区分逻辑：

| 数据状态 | 字段显示/诊断 |
| --- | --- |
| 字段有缓存值 | 显示实际缓存值 |
| `metadataStatus=pending` | 空字段显示“尚未采集”，诊断低置信度、风险未知 |
| `metadataStatus=failed` | 空字段显示“读取失败”，诊断低置信度、风险未知 |
| `codecProbeStatus=unprobed` | 空编码字段显示“尚未采集”，说明尚未探测 |
| `codecProbeStatus=failed` | 空编码字段显示“读取失败” |
| metadata/codec 均完成但字段为 null | 显示“未记录”，不解释成“无音频” |
| 时长为 null | 显示 `--:--`，不会显示为 0 |

相关 renderer 与 shared tests 全部通过。

结果：**PASS**。

### 7. 播放建议与真实路由复用

页面直接执行：

```text
route = choosePlaybackRoute(video, playbackPreference)
diagnosis = explainPlaybackRoute(video, playbackPreference, route)
```

`explainPlaybackRoute` 只解释传入的 route，不重新选择 route。自动、native-first、mpv-first 测试均先调用真实 `choosePlaybackRoute`，再断言解释与实际结果一致：

- auto + MP4/H264/AAC -> 内置播放器；
- auto + HEVC/DTS -> MPV，兼容风险提示；
- native-first + HEVC/DTS -> 仍解释真实规则选择的 native，不擅自改为 MPV；
- mpv-first -> 以用户偏好作为主要原因；
- pending/failed/unprobed -> 低置信度、风险未知。

诊断只提供风险提示，明确“不代表实际播放结果或硬件解码验证”，不会自动切换播放器、修改设置或启动播放。

结果：**PASS**。

### 8. 缺失与移除状态

- `isMissing=true` 时，“按当前策略播放”“使用 MPV”“补充元数据”均禁用。
- 缺失提示明确说明播放和元数据重试已停用，并提供扫描异常入口。
- 定位文件仍允许用户主动尝试，不触发自动读取。
- 刷新后 `listVideosByIds` 返回空数组时显示“记录已移除”，不继续展示过期视频详情。
- 切换视频时，旧请求的迟到响应不会覆盖新视频。

结果：**PASS**。

### 9. 刷新和副作用边界

诊断页“刷新”只增加本地 `refreshVersion`，随后调用：

```text
listVideosByIds([selectedVideoId])
```

该 IPC 只执行按视频 ID 的 SQLite SELECT。静态检查与测试确认刷新不会：

- 访问文件系统；
- 访问 CloudDrive；
- 运行 ffprobe/ffmpeg；
- 启动扫描；
- 加载或生成封面/时间轴预览。

“补充元数据”可能进入现有 metadata pipeline，但它是单独的显式用户操作，不是页面进入或刷新行为。

结果：**PASS**。

### 10. Standalone 隔离

`playbackDiagnostic` 已纳入 `isStandaloneView`，并排除公共 Toolbar。组件测试验证：

- 打开诊断页后不触发普通视频 `onLoadVideoPage`；
- 不显示批量工具栏；
- 不显示普通“搜索文件名”输入框；
- 普通翻页快捷键不生效；
- scan status/refresh sequence 变化不触发视频分页；
- 不调用全局 `onRefresh`，因此不会启动 `scanAllFolders`。

只有用户输入非空搜索词后，诊断页才主动调用服务端分页接口。

结果：**PASS**。

### 11. 性能

#### 默认和详情刷新

在真实 319,986 有效视频资料库的只读连接上：

- 最近 10 条 `listVideosByIds`：`0.13–0.62 ms`；
- 单条详情刷新属于同一主键查询路径，未发现全表枚举；
- 默认打开诊断页不调用全库分页；
- 页面不加载预览图。

结果：**PASS**。

#### 搜索

真实库 `listVideoPage` 测量：

| 搜索 | 耗时 |
| --- | --- |
| `mp4`，匹配 263,853 条，5 次 | `312.47 / 312.47 / 325.22 / 312.83 / 306.02 ms` |
| 无结果 token，3 次 | `295.27 / 300.74 / 310.75 ms` |

该查询通过现有 IPC 在 Electron 主进程同步执行。225 ms 防抖会减少请求次数，但每次实际 SQL 仍会阻塞主事件循环约 300 ms；快速输入后停顿、翻页或无结果搜索均可能产生可感知卡顿。

结果：**FAIL（P1 性能阻断）**。

### 12. 错误态与可访问性

- detail、recent、search、action 分别有独立错误状态。
- 错误使用 `role=alert`；结果区域使用 `aria-live` 和 `aria-busy`。
- 搜索输入有可访问标签，分页 nav 有 aria-label。
- 缺失提示使用 `role=status`，不可执行按钮使用原生 disabled。
- 刷新按钮有明确 aria-label；主要图标不会单独承担信息含义。
- 页面与弹窗均使用语义 heading 和 button。

自动化测试覆盖搜索空态、最近记录、缺失、移除、迟到响应和显式 metadata 操作。未对窄窗口、超长路径和键盘焦点顺序做真实窗口人工检查。

结果：**PASS（保留人工视觉验证）**。

### 13. 静态检查、完整测试、构建与 Electron smoke

| 命令/方式 | 结果 | 记录 |
| --- | --- | --- |
| `npm run lint` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run typecheck` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run build` | PASS | 1602 modules transformed，生产构建完成 |
| 完整 Vitest（Electron `RUN_AS_NODE`） | PASS | 61 个测试文件、596 项测试全部通过，15.95 秒 |
| Asset Center 性能门禁回归 | PASS | 1323.88 ms、1 条 SQL，低于 2000 ms |
| `npm run test:electron-smoke` | BLOCKED（环境） | 项目锁定 Node 22.23.1/npm 10.9.8；本机为 Node 24.14.0/npm 11.9.0 |
| 直接执行 `scripts/run-electron-smoke.mjs` | PASS | Electron 33.4.11、ABI 130；native smoke 和主进程 ready 通过 |

完整 Vitest 使用项目 Electron 33.4.11 的 `ELECTRON_RUN_AS_NODE=1` 环境执行，以匹配当前 `better-sqlite3` Electron ABI。最终发布仍需在锁定的 Node 22.23.1/npm 10.9.8 环境执行标准 release gate。

生产 renderer 构建结果约为：

- JS：352.24 kB，gzip 104.35 kB；
- CSS：71.66 kB，gzip 14.09 kB。

相对上一阶段增加有限，未发现 bundle 体积本身构成阻断。

## Risks and follow-up

### P1：页面承诺路径搜索，但服务端仅搜索文件名

- 影响：用户粘贴视频目录或路径片段时得到错误的空结果。
- 证据：`D:\OnlyInPathToken\clip.mp4` 按 `clip` 命中 1 条，按唯一目录 token 命中 0 条。
- 修正要求：在不前端枚举全库的前提下，使服务端诊断搜索支持 `filename OR path`；如果产品决定只支持文件名，则必须同步修改输入提示和空状态文案，并由项目经理确认口径。
- 必须增加仅路径命中的仓储和 renderer 回归测试。

### P1：诊断搜索同步阻塞 Electron 主进程

- 影响：真实 32 万记录库中每次搜索约阻塞 300 ms，用户会感知输入或页面短暂停顿。
- 防抖只能减少次数，不能解除单次同步查询对主事件循环的阻塞。
- 建议最小修正：为诊断搜索提供专用只读异步查询服务，或复用现有 worker 机制；继续使用服务端分页，不引入全量 renderer 数据。
- 修正后应增加 32 万记录搜索性能与主事件循环响应门禁，并覆盖宽泛搜索和无结果搜索。

按照开发计划“禁止跳过 QA 直接进入下一阶段”，以上两个 P1 修正并通过复测前，不应进入阶段 5 UI 体验优化。

### P2：搜索匹配仍是前后通配

支持路径后，`%keyword%` 对 32 万记录通常需要扫描大量索引或表记录。即使移出主线程，也应保留取消/迟到响应保护和明确性能预算，避免积压多个过期搜索。

### P3：详情页显式 metadata retry 会立即刷新

现有重试接口可能先把记录设为 pending，再由后台完成分析。当前页面在提交后立即重读一次，后续完成状态需要用户再次刷新或依赖重新进入页面；不影响安全，但可能造成“按钮已点、字段仍未更新”的体验疑问。

### 未验证事项

- 未用用户真实视频验证实际解码、声音、画面或外部播放器启动；自动化只验证调用逻辑。
- 未在 Node 22.23.1/npm 10.9.8 标准环境执行完整 release gate。
- 未执行安装包、快捷方式或打包后桌面 smoke；阶段 4 指令要求不打包。
- 未执行真实 Electron 窗口的人工视觉、超长路径、窄窗口和完整键盘焦点检查。

### 剩余风险

- 路径搜索功能缺失是明确的用户可见错误。
- 搜索仍有约 300 ms 的主线程阻塞，是明确的流畅度风险。
- 播放诊断只能解释缓存元数据和规则，不代表实际硬件、驱动或系统解码能力；当前文案已经明确限制。

## Final decision

**FAIL — Playback Diagnostic V1 暂不通过阶段 4 QA。**

原播放、播放列表、外部播放器调用、诊断规则复用、字段状态、缺失/移除处理、只读刷新、standalone 隔离、完整自动化测试、生产构建和 Electron smoke 均通过。

但页面宣称的路径搜索没有实现，且真实大库搜索仍会同步阻塞 Electron 主进程约 300 ms。必须完成最小修正并复测后，才能进入阶段 5 UI 体验优化。
