# 映匣 UI V1 细节优化 QA 报告

## Context

- 任务：映匣 UI 增量优化 V1，阶段 5 UI 专项 QA
- 日期：2026-09-04
- QA 结论：**PASS**
- 被测分支：`ai/ui-v1-polish`
- 被测 Commit：`5503fa02636e523509684afe6b70f8c88775725a`
- 最新 `origin/main`：`5503fa02636e523509684afe6b70f8c88775725a`
- 开始测试时工作区：干净

开工门禁全部满足。本轮只验证 Asset Center 与 Playback Diagnostic 的 UI 细节优化及完整回归，没有修改业务代码、测试、配置、数据库或用户数据，也没有执行真实媒体扫描、FFprobe、CloudDrive 写入、移动或删除操作。

## Changes

### 分支

`ai/ui-v1-polish`

### Commit

`5503fa02636e523509684afe6b70f8c88775725a`

### 修改摘要

- 新增本阶段 UI 专项 QA 报告。
- 验证资产中心首载骨架、刷新稳定性、错误优先级、活动任务摘要、数字格式、响应式表格及键盘焦点样式。
- 验证播放诊断 landmark、隐藏标签、布局层级、局部错误重试、失效/移除状态、播报范围、操作 pending、长路径和长错误布局。
- 回归 Asset Center worker、Playback Diagnostic worker、原播放、播放列表、MPV、扫描、扫描失败和文件管理。
- 执行 lint、typecheck、完整 Electron ABI Vitest、生产构建与 Electron smoke。

### 新增文件

- `docs/ai/qa/2026-09-04-ui-v1-polish-qa.md`

### 删除文件

- 无。

## Verification

### 1. 开工门禁与修改边界

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 当前分支 | PASS | `ai/ui-v1-polish` |
| 工作区状态 | PASS | 开始测试时 `git status --short --untracked-files=all` 无输出 |
| HEAD | PASS | `5503fa0...` |
| GitHub main | PASS | `git fetch origin main` 后 `origin/main` 与 HEAD 相同 |
| 业务边界 | PASS | Developer commit 只修改两个新增页面、对应样式、对应测试和交付文档 |
| 数据层与核心业务 | PASS | 未修改数据库、IPC、worker、扫描、播放、MPV 或文件操作代码 |
| 空白/格式检查 | PASS | `git diff --check` 无输出 |
| 标点要求 | PASS | 相关组件、样式、测试和交付文档中未发现 em dash 或 en dash |

### 2. Asset Center 首载与刷新

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 首载指标不误报“暂无” | PASS | summary pending 时四项指标均为“读取中”，不是空值语义 |
| 四项静态指标骨架 | PASS | 四个 `.asset-metric.is-loading` 使用固定灰色块，无 shimmer 或循环动画 |
| 六行来源骨架 | PASS | `.asset-source-skeleton` 固定渲染 6 行，每行 48 px |
| 减少首屏跳动 | PASS | 已移除额外 88 px 聚合 loading 面板，指标和来源区域保持稳定占位 |
| 后台刷新保留旧指标 | PASS | refresh 时不清空 `summary`，旧值持续显示 |
| 后台刷新保留来源行 | PASS | refresh 时不清空 `sourcePage.items`，表格保留并显示局部更新状态 |
| 刷新语义 | PASS | 文案为“重新读取缓存”，title 明确不会启动扫描 |

对应组件测试全部通过，包括首次读取未完成的 Promise、刷新期间旧数据保留及按钮 disabled 状态。

### 3. Asset Center 错误、任务和数字

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 来源错误优先于空态 | PASS | `sourcesError && items.length===0` 时不渲染“没有符合筛选条件” |
| 错误可重试 | PASS | 重试只调用现有只读 summary/source loader，不调用全局刷新或扫描 |
| 长错误换行 | PASS | notice/error 文本使用 `min-width:0` 与 `overflow-wrap:anywhere` |
| 活动任务限制 | PASS | 只渲染前 4 条；6 个活动任务时显示“另有 2 个活动任务” |
| 活动任务总数 | PASS | 标题显示完整活动任务 N，并使用 `zh-CN` 数字格式 |
| 数字格式 | PASS | 指标、来源数、页码、扫描计数、问题明细均使用 `toLocaleString("zh-CN")` |
| 错误信息安全 | PASS | 可见错误只保留首行并截断至最多 500 字符 |

### 4. Asset Center 可访问性与响应式

- 页面内 button、input、select 的 `:focus-visible` 使用 2 px 橙色轮廓和 2 px offset。
- 核心指标保留浏览器可见焦点轮廓，仅叠加背景变化，不再清除 outline。
- 来源骨架使用 `role=status` 和可访问名称，内部装饰行标记为 `aria-hidden`。
- 1100 px 以下：四指标由 4 列降为 2 列，状态区由 2 列降为 1 列，来源表隐藏“容量”和“最近扫描”。
- 760 px 以下：来源表进一步隐藏“视频”列，表格最小宽度降为 590 px。
- 表格容器保留横向滚动，不会因长路径强行撑破页面。

结果：**PASS**。本轮使用 Testing Library DOM 断言和静态 CSS 契约检查验证；未在真实 Windows 窗口逐像素检查临界宽度，列入未验证事项。

### 5. Playback Diagnostic 结构与信息层级

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 隐藏 label | PASS | 搜索标签使用项目现有 `.visually-hidden`，其裁剪样式完整存在 |
| 无嵌套 `main` | PASS | 页面根节点为 `DIV`，组件 DOM 内没有 `main` |
| 诊断结论前置 | PASS | `.diagnostic-analysis` 紧跟文件标题区，位于信息明细网格之前 |
| 诊断结论全宽 | PASS | 结论是 body grid 的独立直接子项，不再嵌入右侧信息列 |
| 明细布局 | PASS | 文件、视频、音频构成 3 列网格；1100 px 以下降为单列 |
| 完整路径可见 | PASS | 文件信息新增“完整路径”，`dd.wrap` 使用 normal whitespace 与 `overflow-wrap:anywhere` |

### 6. Playback Diagnostic 错误、空态与重试

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 错误优先于空态 | PASS | `resultError` 分支先于最近记录失效、搜索无结果和 loading 分支 |
| 搜索失败局部重试 | PASS | 只增加 `searchRetryVersion`，不会启动最近记录读取 |
| 最近播放失败局部重试 | PASS | 只增加 `recentRetryVersion`，不会启动搜索 |
| 最近记录全部失效 | PASS | 有 recent IDs 但查询结果为空时显示“最近播放记录已失效” |
| 从未播放空态 | PASS | recent IDs 为空时继续显示独立的“还没有最近播放记录” |
| 详情读取失败 | PASS | 显示“无法读取视频记录”和“重新读取缓存”，成功重试后进入详情 |
| removed 分支 | PASS | 显示“记录已移除”，提供“查看扫描异常”和“更换视频”，不误提供缓存重试 |
| 长错误安全显示 | PASS | 只显示首行、最多 500 字符，并支持任意位置换行 |

相关新增组件测试全部通过。

### 7. Playback Diagnostic 播报、按钮与操作状态

- 搜索/最近列表容器只有 `aria-busy`，没有 `aria-live`。
- 结果摘要单独使用 `role=status`、`aria-live=polite`、`aria-atomic=true`，避免整表更新被重复播报。
- 工具栏、主要动作、维护、错误重试及状态分支按钮最小高度为 36 px。
- 主要播放按钮使用主操作色和 `.primary` 标识。
- 播放、MPV、定位分别显示“正在启动...”“正在启动 MPV...”“正在定位...”。
- 动作区域在 Promise 未完成时设置 `aria-busy=true`，按钮 disabled；完成后恢复。
- 页面刷新 title 明确只读取资料库缓存，不访问视频文件。
- 页面按钮和搜索输入均有 2 px 可见 `:focus-visible` 轮廓。

结果：**PASS**。

### 8. 响应式与长文本 CSS 证据

| 宽度 | Asset Center | Playback Diagnostic |
| --- | --- | --- |
| 大于 1100 px | 四指标、双状态栏、完整来源列 | 文件/视频/音频三列 |
| 不大于 1100 px | 两指标列、单状态列，隐藏容量和最近扫描 | 信息区单列，文件操作移至下一行 |
| 不大于 760 px | 再隐藏视频数量列，保留来源/类型/可访问性/问题 | 搜索区单列、结果次要尺寸隐藏、文件操作纵向适配 |

长错误使用 `overflow-wrap:anywhere`；完整路径使用 `white-space:normal` 和 `overflow-wrap:anywhere`；来源表位于 `overflow-x:auto` 容器。静态 CSS 规则不存在互相覆盖焦点轮廓的更高优先级声明。

### 9. 原功能与性能回归

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Asset Center UI | PASS | 6 项组件测试通过 |
| Asset Center worker | PASS | 4 项 query service 测试通过 |
| Playback Diagnostic UI | PASS | 15 项组件测试通过 |
| Playback Diagnostic worker | PASS | 5 项 query service 与 6 项 query 测试通过 |
| 原播放与播放列表 | PASS | PlayerPage 22 项测试通过 |
| MPV | PASS | controller 与 player routing 测试通过 |
| 扫描系统 | PASS | scanner、incremental、network、ScanManager 测试通过 |
| 扫描失败安全 | PASS | review 与 batch service 测试通过 |
| 文件管理 | PASS | fileOperations 27 项测试通过 |
| 重复项清理 | PASS | cleanup jobs 与 resolve safety 测试通过 |

性能门禁：

- Playback Diagnostic 合成 320,000 条：宽泛搜索 162.83 ms，无结果 145.17 ms，主线程最大间隔 16.77 ms。
- Asset Center 合成 320,000 条、100 来源：1,193.32 ms，单条 SQL。
- 两项均低于现有发布门禁，UI 优化没有引入查询性能回归。

### 10. 完整测试、构建与 Electron smoke

| 命令/方式 | 结果 | 记录 |
| --- | --- | --- |
| `npm run lint` | PASS | 项目 lint 脚本执行 Node/Web TypeScript 检查，无错误 |
| `npm run typecheck` | PASS | Node/Web TypeScript 检查无错误 |
| `npm run build` | PASS | Vite 6.4.3，1602 modules transformed |
| 完整 Vitest，Electron `RUN_AS_NODE` | PASS | 64 个测试文件、618 项测试全部通过，15.38 秒 |
| `npm run test:electron-smoke` | 环境门禁阻止 | 项目要求 Node 22.23.1/npm 10.9.8；当前为 Node 24.14.0/npm 11.9.0 |
| 直接执行 Electron smoke | PASS | Electron 33.4.11、ABI 130；native smoke 与 `app.whenReady` 通过 |

生产构建结果：

- JavaScript：354.05 kB，gzip 104.80 kB；
- CSS：73.35 kB，gzip 14.34 kB。

完整 Vitest 使用 Electron 33.4.11 的 `ELECTRON_RUN_AS_NODE=1` 执行，确保原生 SQLite 模块运行在正确 Electron ABI 下。

## Risks and follow-up

### 未验证事项

- 未在真实 Windows 主窗口逐像素检查 1100 px、900 px、760 px 临界宽度和全屏宽度；本轮采用 DOM 测试及静态 CSS 证据。
- 未使用键盘逐项人工巡检真实焦点顺序、高对比度模式和系统缩放；本轮确认了语义 DOM 与 `:focus-visible` CSS 契约。
- 未使用屏幕阅读器人工试听播报；本轮通过 DOM 属性确认结果列表不 live、摘要为唯一显式 live 区域。
- 未在锁定 Node 22.23.1/npm 10.9.8 环境执行标准 release gate；当前系统版本不匹配，环境检查按设计阻止标准 smoke。
- 未执行安装包、快捷方式或 ASAR 内 UI 验证；应留到阶段 6 最终交付。

### 剩余风险

- 窄窗表格会按设计隐藏容量、最近扫描和视频数量，用户需要扩大窗口查看这些次要字段。
- 首载骨架为静态占位，不表示精确进度；长时间读取时用户只能看到“读取中”。
- pending 文案表示回调尚未完成，不保证播放器或操作系统已经成功完成动作；当前文案没有过度承诺。
- 真实系统字体、DPI、高对比度和超长中文/网络路径仍可能产生轻微视觉差异，最终打包前应做一次人工窗口巡检。

## 测试结果

**PASS。** UI 专项验收项、完整 Electron ABI 回归、生产构建、Electron smoke 及性能门禁全部通过。

## 未验证事项

见“Risks and follow-up / 未验证事项”。这些事项属于阶段 6 最终桌面交付验证，不阻断本阶段 QA。

## 剩余风险

见“Risks and follow-up / 剩余风险”。当前未发现 P0/P1/P2 功能或性能阻断问题。

## Final decision

**PASS：映匣 UI V1 细节优化通过阶段 5 UI 专项 QA。**

允许项目经理进入阶段 6 最终交付。
