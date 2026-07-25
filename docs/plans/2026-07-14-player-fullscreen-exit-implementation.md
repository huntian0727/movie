# 播放页全屏退出与控制层实现计划

**目标：** 按 `docs/plans/2026-07-14-player-fullscreen-exit-design.md` 的已确认方案，补齐播放页全屏模式下的进入、退出和控制层体验，解决“进入全屏后缺少明确退出路径”的问题，并保留快进、快退、上一部、下一步、进度条、音量等核心能力。

**实现原则：**
- 只在 renderer 层收口，优先修改 `PlayerPage` 及其样式，不扩散到全局状态。
- 以最小可用方案优先：明确退出路径、双击进出全屏、全屏控制层自动显示/隐藏。
- 保持普通模式和全屏模式的核心操作一致，避免用户重新学习一套控制方式。

**影响范围：**
- `src/renderer/components/PlayerPage.tsx`
- `src/renderer/styles.css`
- `tests/renderer/PlayerPage.test.tsx`
- 如有必要，补充与播放器入口相关的 renderer 测试

---

## Task 1: 梳理当前全屏和播放器交互边界

**Files:**
- Inspect: `src/renderer/components/PlayerPage.tsx`
- Inspect: `src/renderer/styles.css`
- Inspect: `tests/renderer/PlayerPage.test.tsx`

- [ ] **Step 1: 确认现有全屏入口与切换路径**

检查 `PlayerPage` 里现有“全屏”按钮和 `toggleFullscreen()` 的实现，确认当前是：

- 哪个节点负责 `requestFullscreen`
- 哪个节点负责 `exitFullscreen`
- 单击、键盘事件和弹窗关闭是否会与全屏交互冲突

预期结果：
- 明确本次以 `player-stage` 或其容器作为全屏宿主
- 不在其他页面或全局状态中增加额外依赖

- [ ] **Step 2: 确认全屏下仍需保留的控制能力**

梳理播放器当前已有能力，锁定全屏模式下必须保留的控件：

- 上一部 / 下一部
- 快退 / 快进
- 播放 / 暂停
- 进度条
- 音量
- 全屏切换
- 返回按钮与详情按钮的边界行为

预期结果：
- 全屏仅改变展示层，不改变控制能力集合

---

## Task 2: 先补测试，锁定全屏交互契约

**Files:**
- Modify: `tests/renderer/PlayerPage.test.tsx`

- [ ] **Step 1: 补全屏切换调用测试**

新增测试，验证点击“全屏”按钮时会调用 `requestFullscreen`，在已全屏状态下会调用 `exitFullscreen`。

测试目标：
- 全屏按钮不再只是静态存在
- 退出路径具备明确行为约束

- [ ] **Step 2: 补双击画面进入 / 退出全屏测试**

为视频显示区域增加双击行为断言，确认：

- 普通模式双击进入全屏
- 全屏模式双击退出全屏

测试目标：
- 双击行为成为稳定契约

- [ ] **Step 3: 补 `fullscreenchange` 状态同步测试**

模拟 `fullscreenchange` 事件，确认组件会正确更新全屏状态，并据此切换按钮文案、浮层显示类名或其他状态标记。

- [ ] **Step 4: 跑播放器测试，确保新断言先覆盖目标行为**

Run:

```bash
npm test -- tests/renderer/PlayerPage.test.tsx
```

预期结果：
- 若实现尚未完成，新断言应能指向缺失行为
- 若已有部分逻辑，可先锁定回归面

---

## Task 3: 在 PlayerPage 中补齐全屏状态与退出路径

**Files:**
- Modify: `src/renderer/components/PlayerPage.tsx`

- [ ] **Step 1: 增加全屏状态同步**

在组件内维护 `isFullscreen` 状态，并监听 `fullscreenchange`：

- 用户点击按钮进入全屏
- 用户双击画面进入全屏
- 用户按 `Esc` 退出全屏
- 用户通过系统方式退出全屏

预期结果：
- 界面状态与真实 Fullscreen API 状态一致

- [ ] **Step 2: 增加明确的退出全屏按钮**

在全屏顶部浮层增加“退出全屏”按钮，要求：

- 仅在全屏时显示
- 可访问名称明确
- 不替代现有 `Esc` 退出逻辑，而是作为显式补充

- [ ] **Step 3: 增加双击画面进出全屏**

把双击事件绑定在视频显示层，而不是整个播放器页面。需要避免影响：

- 进度条拖动
- 控制按钮点击
- 详情弹窗

预期结果：
- 双击视频区域时行为稳定
- 不误触其他控件

- [ ] **Step 4: 处理单击播放与双击全屏的冲突**

确认当前“单击视频切换播放状态”的逻辑在引入双击后不会误触两次。必要时可做轻量去抖或只把双击绑定在特定覆盖层。

---

## Task 4: 为全屏模式补控制层浮层样式

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: 给全屏状态增加样式标记**

为播放器根节点或相关容器添加全屏状态类名，例如：

- `.player-page.is-fullscreen`
- `.player-stage.is-fullscreen`

目标：
- 样式切换有明确命中点

- [ ] **Step 2: 把顶部和底部控制区改成全屏浮层**

全屏状态下：

- 顶部浮层覆盖在画面上方
- 底部控制条覆盖在画面下方
- 保持现有快进、快退、上一部、下一步、进度条、音量可操作

普通模式保持现状，避免影响已有布局。

- [ ] **Step 3: 增加自动隐藏逻辑的样式支撑**

根据组件状态控制浮层显示 / 隐藏，确保：

- 鼠标移动时浮层显示
- 若干秒无操作后淡出
- 控制层交互中不提前隐藏

- [ ] **Step 4: 优化全屏下进度条命中区域**

适当提高进度条的可点击和可拖动区域，避免全屏下进度条太细、难以操作。

---

## Task 5: 保证全屏下核心播放器能力不漂移

**Files:**
- Test: `tests/renderer/PlayerPage.test.tsx`
- Manual verify in app

- [ ] **Step 1: 回归播放相关交互**

确认以下行为在普通模式和全屏模式下都保持可用：

- 空格播放 / 暂停
- 左右方向键快退 / 快进
- 上一部 / 下一部按钮
- 音量滑块
- 进度条拖动

- [ ] **Step 2: 验证详情弹窗与全屏不互相误伤**

确认：

- 打开详情弹窗时不会被双击画面误触
- `Esc` 先按既定优先级处理弹窗或全屏，不出现状态错乱

- [ ] **Step 3: 跑 renderer 测试与类型检查**

Run:

```bash
npm test -- tests/renderer/PlayerPage.test.tsx
npx tsc -p tsconfig.web.json
```

预期结果：
- 播放器相关测试通过
- renderer 类型通过

---

## Task 6: 手动验证真实全屏体验并重启客户端

**Files:**
- Manual verify in running app

- [ ] **Step 1: 手动验证进入与退出全屏**

检查项：

- 点击“全屏”按钮可进入全屏
- 右上角“退出全屏”按钮可退出
- 双击画面可进入 / 退出全屏
- `Esc` 可退出全屏

- [ ] **Step 2: 手动验证全屏下控制能力**

检查项：

- 快退 / 快进
- 上一部 / 下一步
- 进度条拖动
- 音量调节
- 控制层自动隐藏与再次出现

- [ ] **Step 3: 按协作约定重启客户端**

完成代码修改后，使用当前项目启动方式重新启动 Electron 客户端，并确认：

- 客户端能正常启动
- 全屏交互已生效
- 没有新增明显启动错误

---

## Task 7: 收尾与提交

**Files:**
- Modify only the files touched above

- [ ] **Step 1: 检查变更范围**

Run:

```bash
git diff -- src/renderer/components/PlayerPage.tsx src/renderer/styles.css tests/renderer/PlayerPage.test.tsx
```

目标：
- 变更集中在播放器页和对应测试
- 不把无关调试或其他功能改动带进提交

- [ ] **Step 2: 提交实现**

Run:

```bash
git add src/renderer/components/PlayerPage.tsx src/renderer/styles.css tests/renderer/PlayerPage.test.tsx
git commit -m "feat: improve fullscreen controls in player page"
```

- [ ] **Step 3: 记录验证结果**

在最终交付说明中同步：

- 哪些测试通过
- 是否已重启客户端验证
- 是否仍有残留风险，例如真实 Electron 全屏行为仍以手测为准
