# 视频网格瀑布流实现计划

**目标：** 按 `docs/plans/2026-07-14-video-grid-masonry-design.md` 的已确认方案，将所有网格页统一改为瀑布流布局，解决横屏视频封面下方留白过大的问题，同时保持竖屏和特殊比例视频的完整展示。

**实现原则：**
- 先改 renderer 样式层和最小必要的组件标记，不动主进程、数据库和缓存逻辑。
- 复用现有 `VideoGrid` 卡片结构，避免引入新的网格模式或额外交互开关。
- 先做纯 CSS 多列方案，验证体验后再决定是否需要更复杂的列高分配或虚拟化。

**影响范围：**
- `src/renderer/components/VideoGrid.tsx`
- `src/renderer/styles.css`
- `tests/renderer/LibraryShell.test.tsx`
- 如有必要，补充 `tests/renderer/PlayerPage.test.tsx` 或其他 renderer 测试中的样式/类名断言

---

## Task 1: 梳理现有网格结构并锁定改动边界

**Files:**
- Inspect: `src/renderer/components/VideoGrid.tsx`
- Inspect: `src/renderer/styles.css`
- Inspect: `tests/renderer/LibraryShell.test.tsx`

- [ ] **Step 1: 确认瀑布流只作用于网格视图**

检查 `LibraryShell` 里网格视图和列表视图的切换路径，确认这次改动不会影响 `VideoTable`。

预期结果：
- 仅 `VideoGrid` 使用瀑布流样式
- 列表视图保持现状

- [ ] **Step 2: 确认卡片内部结构可直接复用**

检查 `VideoGrid` 当前的卡片层级，重点确认以下节点无需重写：

- `.video-grid`
- `.video-card`
- `.video-cover`
- `.video-card-body`
- `.card-actions`

预期结果：
- 只需补少量 class 或 data 标记即可支撑瀑布流布局
- 不需要改动按钮事件和卡片交互逻辑

---

## Task 2: 先写测试，锁定瀑布流的外层契约

**Files:**
- Modify: `tests/renderer/LibraryShell.test.tsx`

- [ ] **Step 1: 补一个网格容器样式契约测试**

新增断言，确认网格视图下会渲染瀑布流容器类名。例如：

- `video-grid video-grid--masonry`

测试目标：
- 所有网格页复用同一个瀑布流容器
- 后续样式重构时不会悄悄退回普通等高 grid

- [ ] **Step 2: 补一个卡片比例仍然按视频元数据输出的测试**

保留并扩展现有封面比例测试，确认瀑布流改造后：

- `.video-cover` 仍然带有 `--cover-aspect-ratio`
- 竖屏视频仍按真实比例设置

- [ ] **Step 3: 跑 renderer 测试并确认新断言先失败或至少能覆盖新行为**

Run:

```bash
npm test -- tests/renderer/LibraryShell.test.tsx
```

预期结果：
- 如果契约类名尚未落地，测试失败
- 如果已有部分结构可复用，至少要看到新断言覆盖到目标节点

---

## Task 3: 改造 VideoGrid 容器为瀑布流入口

**Files:**
- Modify: `src/renderer/components/VideoGrid.tsx`

- [ ] **Step 1: 为网格容器增加明确的瀑布流类名**

调整 `VideoGrid` 外层容器，确保样式可以无歧义地命中瀑布流布局。例如：

```tsx
<div className="video-grid video-grid--masonry">
```

目标：
- 把布局意图固化到组件标记里
- 后续如果需要保留普通网格，也能明确区分

- [ ] **Step 2: 让卡片结构适配列布局但不改变交互**

如有需要，为卡片补少量语义化 class，但保持以下行为完全不变：

- 双击卡片打开视频
- 点击封面播放
- 点击详情、收藏、重命名、删除按钮
- 封面加载失败重试逻辑

预期结果：
- `VideoGrid` 结构变化仅限样式承载，不改业务路径

---

## Task 4: 用 CSS 多列实现第一版瀑布流

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: 将 `.video-grid` 从等高 grid 改为多列布局**

把当前：

```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
```

调整为瀑布流列布局，建议方向：

- `column-count` 或 `column-width`
- 保持现有视觉节奏的列间距
- 网格整体 padding 先尽量保持不变

目标：
- 横屏和竖屏卡片能自然堆叠
- 视觉密度与当前版本接近

- [ ] **Step 2: 防止卡片在列中被拆开**

为 `.video-card` 增加必要样式，例如：

- `break-inside: avoid`
- 合理的 `margin-bottom`
- 宽度 `100%`

目标：
- 封面、标题和按钮始终作为完整卡片落在同一列

- [ ] **Step 3: 调整封面与卡片的垂直关系**

确认以下规则在瀑布流下仍成立：

- 封面按 `--cover-aspect-ratio` 渲染
- 图片继续 `object-fit: contain`
- 封面不再依赖固定卡片高度去撑开

预期结果：
- 横屏卡片不会再出现原先那种“图片正常但卡片下方大块空白”

- [ ] **Step 4: 补响应式断点**

至少覆盖以下场景：

- 宽屏 4 列左右
- 中屏 3 列左右
- 窄屏 2 列
- 很窄时 1 列

目标：
- 窄屏不重叠、不裁切
- 与当前侧边栏折叠规则兼容

---

## Task 5: 回归所有网格入口，确认行为没有漂移

**Files:**
- Test: `tests/renderer/LibraryShell.test.tsx`
- Manual verify in app

- [ ] **Step 1: 跑现有 LibraryShell 测试**

Run:

```bash
npm test -- tests/renderer/LibraryShell.test.tsx
```

预期结果：
- 现有导航、分页、收藏、文件夹、详情弹窗相关断言继续通过

- [ ] **Step 2: 跑播放器相关 renderer 测试**

Run:

```bash
npm test -- tests/renderer/PlayerPage.test.tsx
```

预期结果：
- 这次样式改动不会误伤播放器页详情和时间轴预览逻辑

- [ ] **Step 3: 编译 renderer**

Run:

```bash
npm run build -- --mode development
```

如果全量构建受环境影响，至少执行：

```bash
npx tsc -p tsconfig.web.json
```

预期结果：
- renderer 相关类型和构建通过

---

## Task 6: 手动验证真实体验并重启客户端

**Files:**
- Manual verify in running app

- [ ] **Step 1: 手动检查所有网格页**

重点入口：

- 所有视频
- 收藏
- 文件夹
- 最近播放

检查项：
- 网格都已切成瀑布流
- 横屏视频下方不再有明显大块空白
- 竖屏视频仍完整显示
- 卡片操作按钮位置自然且可点击

- [ ] **Step 2: 用目标样本复验**

重点复验用户反馈过的问题视频：

- `-alUDuVwYrbcoNak`

检查项：
- 封面显示完整
- 在混合比例列表里观感自然

- [ ] **Step 3: 按项目协作约定重启客户端**

完成代码修改后，使用当前项目的桌面启动方式重新启动 Electron 客户端，并确认：

- 客户端可正常拉起
- 网格页样式已生效
- 没有新增明显启动错误

---

## Task 7: 收尾与提交

**Files:**
- Modify only the files touched above

- [ ] **Step 1: 检查变更范围**

Run:

```bash
git diff -- src/renderer/components/VideoGrid.tsx src/renderer/styles.css tests/renderer/LibraryShell.test.tsx tests/renderer/PlayerPage.test.tsx
```

目标：
- 变更集中在 renderer 网格布局和对应测试
- 不把无关调试改动一起带进提交

- [ ] **Step 2: 提交实现**

Run:

```bash
git add src/renderer/components/VideoGrid.tsx src/renderer/styles.css tests/renderer/LibraryShell.test.tsx tests/renderer/PlayerPage.test.tsx
git commit -m "feat: add masonry layout for video grids"
```

- [ ] **Step 3: 记录验证结果**

在最终交付说明中同步：

- 哪些测试通过
- 是否重启客户端并验证
- 是否仍有残留风险，例如极端比例视频的最大高度策略暂未加入
