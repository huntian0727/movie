# 重复视频识别与批量清理实现计划

**目标：** 按 `docs/plans/2026-07-15-duplicate-cleanup-design.md` 的已确认方案，为资料库补齐“精确去重 + 重复项视图 + 批量永久删除”能力，先识别内容完全一致的文件，再让用户以可控方式批量清理重复副本。

**实现原则：**
- 第一版只做“内容完全一致”的精确去重，不扩展到“同一电影不同版本”。
- 尽量复用现有扫描、详情、播放器、删除、侧边栏和列表框架，不新开独立窗口。
- 批量删除能力从第一版就支持，但必须带预检查、强确认和失败回传。
- 识别流程采用“粗筛 + 分段指纹”模式，避免对全库所有文件立即做整文件 hash。

**影响范围：**
- `src/shared/videoTypes.ts`
- `src/main/db/database.ts`
- `src/main/db/videoRepository.ts`
- `src/main/media/libraryScanner.ts`
- 如有必要，新增 `src/main/media/contentFingerprint.ts`
- `src/main/ipc.ts`
- `src/main/preload.cts`
- `src/renderer/api/client.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/LibraryShell.tsx`
- 新增重复项页面组件，例如 `src/renderer/components/DuplicateGroupsPage.tsx`
- `src/renderer/styles.css`
- `tests/main/*.test.ts`
- `tests/renderer/*.test.tsx`

---

## Task 1: 先补共享类型，锁定去重能力的数据边界

**Files:**
- Modify: `src/shared/videoTypes.ts`
- Inspect: `src/renderer/App.tsx`
- Inspect: `src/main/ipc.ts`

- [ ] **Step 1: 增加指纹状态类型**

补充 `FingerprintStatus`，取值至少包含：

- `pending`
- `ready`
- `failed`

预期结果：
- 指纹状态有统一类型来源

- [ ] **Step 2: 增加重复组相关类型**

补充：

- `DuplicateCandidate`
- `DuplicateGroup`
- `DuplicateResolvePlan`
- `DuplicateResolvePreview`
- `DuplicateResolveResult`

其中需要覆盖的信息包括：

- 单个候选文件的 `video` 信息
- 是否推荐保留
- 推荐理由
- 每组的 `groupKey`
- 预计可释放空间
- 计划保留项与删除项
- 执行成功数、失败数、失败明细

- [ ] **Step 3: 扩展 LibraryView 与 IPC channel**

为侧边栏新增 `duplicates` 视图，并在共享常量中预留：

- `duplicate:list`
- `duplicate:preview-resolve`
- `duplicate:resolve`

预期结果：
- 主进程、preload、renderer 可以围绕同一份契约对接

---

## Task 2: 扩展数据库结构，给视频记录补指纹能力

**Files:**
- Modify: `src/main/db/database.ts`
- Modify: `tests/main/videoRepository.test.ts`
- 如有迁移相关测试，一并补充

- [ ] **Step 1: 为 videos 表新增指纹字段**

补充字段：

- `content_fingerprint TEXT`
- `fingerprint_status TEXT`
- `fingerprint_updated_at TEXT`
- `fingerprint_error TEXT`

要求：
- 对已有库兼容升级
- 新库初始化时直接带上这些列

- [ ] **Step 2: 补索引与查询友好性**

如果实现里需要按 `fingerprint_status` 或 `content_fingerprint` 聚合查询，补充必要索引，例如：

- `idx_videos_fingerprint_status`
- `idx_videos_content_fingerprint`

目标：
- 降低重复组查询成本

- [ ] **Step 3: 先补数据库与 repository 基础测试**

验证：

- 新列在初始化数据库时存在
- 旧库升级后列存在
- 默认状态可被正常写入和读取

---

## Task 3: 在 repository 层补齐指纹状态与重复组查询

**Files:**
- Modify: `src/main/db/videoRepository.ts`
- Modify: `tests/main/videoRepository.test.ts`

- [ ] **Step 1: 扩展 VideoRecord 映射**

确保数据库行与 `VideoRecord` / 去重类型之间能互相映射，至少包含：

- `contentFingerprint`
- `fingerprintStatus`
- `fingerprintUpdatedAt`
- `fingerprintError`

- [ ] **Step 2: 增加指纹状态更新方法**

建议补充：

- `markFingerprintPending(videoId)`
- `markFingerprintReady(videoId, fingerprint)`
- `markFingerprintFailed(videoId, error)`

要求：
- 文件元数据变化时能回到 `pending`
- 成功或失败时能记录更新时间和错误信息

- [ ] **Step 3: 增加重复组查询方法**

新增 `listDuplicateGroups()`，核心行为：

- 只统计 `fingerprint_status = 'ready'`
- 只统计 `content_fingerprint IS NOT NULL`
- `GROUP BY content_fingerprint`
- 只返回数量大于等于 2 的组

每组返回时：
- 补全候选文件列表
- 计算推荐保留项
- 计算可释放空间

- [ ] **Step 4: 增加预检查与执行方法**

新增用于：

- 根据前端当前选择生成 `DuplicateResolvePreview`
- 执行 `DuplicateResolvePlan`

执行前要校验：
- 每组至少保留 1 个
- 删除项不包含保留项
- 组内候选文件仍然存在于资料库中

---

## Task 4: 抽离分段指纹计算逻辑，并接入扫描后后台任务

**Files:**
- Modify: `src/main/media/libraryScanner.ts`
- Add or Modify: `src/main/media/contentFingerprint.ts`
- Add tests in `tests/main/`

- [ ] **Step 1: 新增分段指纹工具**

建议抽一个独立模块，例如 `contentFingerprint.ts`，封装：

- 文件头片段读取
- 文件中段片段读取
- 文件尾片段读取
- `sizeBytes + segments` 的 `sha256` 计算

目标：
- 让指纹逻辑不和扫描主循环混在一起

- [ ] **Step 2: 把新文件和变更文件置为 pending**

扫描发现以下情况时，把指纹状态设为 `pending`：

- 新入库文件
- 大小变化
- 修改时间变化

预期结果：
- 文件内容变化后，旧指纹不会继续参与重复判断

- [ ] **Step 3: 扫描完成后后台补算指纹**

实现策略：

- 扫描先正常完成
- 再对 `pending` 候选按顺序补算指纹
- 成功写回 `ready`
- 失败写回 `failed`

目标：
- 不把“重新扫描文件夹”阻塞成一个长时间卡顿操作

- [ ] **Step 4: 补指纹计算测试**

覆盖：

- 相同文件得到相同指纹
- 文件内容变化后指纹变化
- 读取失败能正确写入 `failed`

---

## Task 5: 补 IPC / preload / renderer client，让前后端能拉取重复组与执行清理

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.cts`
- Modify: `src/renderer/api/client.ts`
- Modify: `tests/main/ipcContracts.test.ts` or equivalent

- [ ] **Step 1: 新增 duplicate:list**

返回当前重复组列表，供“重复项”页面加载。

- [ ] **Step 2: 新增 duplicate:preview-resolve**

根据前端方案返回预检查摘要，至少包含：

- 重复组数量
- 保留文件数
- 删除文件数
- 预计释放空间
- 非法组或非法计划错误

- [ ] **Step 3: 新增 duplicate:resolve**

正式执行批量删除，返回：

- 成功删除数
- 失败数
- 失败项
- 实际释放空间

- [ ] **Step 4: 补 IPC 契约测试**

验证：

- payload 校验严格
- 非法计划会被拒绝
- 预检查与正式执行字段完整

---

## Task 6: 在 LibraryShell 中增加“重复项”视图入口与页面切换

**Files:**
- Modify: `src/renderer/components/LibraryShell.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/renderer/LibraryShell.test.tsx`

- [ ] **Step 1: 侧边栏新增 duplicates 入口**

保持现有导航结构风格一致，在“所有视频 / 收藏 / 最近播放”附近新增“重复项”入口，并展示重复组数量或重复文件数量。

- [ ] **Step 2: App 层拉取重复组数据**

在现有 `reload()` 链路中补充去重数据读取，确保：

- 启动后能加载重复组
- 扫描后能刷新重复组
- 删除成功后能刷新重复组和视频列表

- [ ] **Step 3: 在内容区切换重复项页面**

当 `view === 'duplicates'` 时，不渲染普通网格/表格，改为渲染 `DuplicateGroupsPage`。

目标：
- 不破坏现有分页、搜索、排序的普通视频视图逻辑

---

## Task 7: 新增 DuplicateGroupsPage，完成推荐保留与批量清理交互

**Files:**
- Add: `src/renderer/components/DuplicateGroupsPage.tsx`
- Modify: `src/renderer/styles.css`
- Add tests in `tests/renderer/`

- [ ] **Step 1: 先实现总览区**

展示：

- 重复组数
- 涉及文件总数
- 待删除文件数
- 预计释放空间
- “按推荐自动选择”
- “开始批量清理”

- [ ] **Step 2: 实现重复组列表**

每组展示：

- 组标题
- 可释放空间
- 推荐保留标签
- 候选文件详情

每条支持：

- 设为保留
- 播放
- 查看详情
- 打开所在文件夹

- [ ] **Step 3: 实现组内选择逻辑**

规则：

- 每组始终只有一个保留项
- 切换保留项后，其它项自动转为待删除
- 页面统计实时刷新

- [ ] **Step 4: 实现预检查与强确认弹窗**

流程：

- 点击“开始批量清理”
- 调用 `duplicate:preview-resolve`
- 弹出摘要
- 要求输入 `DELETE`
- 输入正确后允许确认

- [ ] **Step 5: 实现执行结果面板**

展示：

- 成功删除数量
- 失败数量
- 实际释放空间
- 失败明细与失败原因

如条件允许，可预留“仅重试失败项”入口，但第一版可以先只展示结果。

---

## Task 8: 复用现有删除与详情能力，打通真实操作链路

**Files:**
- Modify only touched main/renderer files
- Inspect existing delete/detail/open-player handlers

- [ ] **Step 1: 复用现有永久删除文件能力**

尽量走已有主进程删除链路或同样的底层文件操作工具，避免新增第二套磁盘删除逻辑。

- [ ] **Step 2: 复用详情弹窗与播放能力**

在重复项页面中：

- “查看详情”复用现有详情弹窗
- “播放”复用现有播放器入口

目标：
- 新页面只负责去重交互，不重复建设视频基本能力

- [ ] **Step 3: 如需补“打开所在文件夹”，统一走主进程能力**

若当前未提供该能力，则以最小增量方式补一个 IPC，不在 renderer 直接处理本地路径。

---

## Task 9: 先补测试，再回归真实流程

**Files:**
- Modify: `tests/main/videoRepository.test.ts`
- Add: 指纹与 duplicate IPC tests
- Add or Modify: `tests/renderer/LibraryShell.test.tsx`
- Add: `tests/renderer/DuplicateGroupsPage.test.tsx`

- [ ] **Step 1: main 层测试**

覆盖：

- 指纹状态更新
- 重复组聚合
- 推荐保留规则稳定
- 非法删除计划被拒绝
- 删除失败时继续处理后续项

- [ ] **Step 2: renderer 层测试**

覆盖：

- 侧边栏“重复项”入口
- 重复组页面渲染
- 切换保留项后统计变化
- 预检查弹窗与 `DELETE` 强确认
- 执行结果面板显示

- [ ] **Step 3: 运行测试与类型检查**

Run:

```bash
npm test -- tests/main/videoRepository.test.ts
npm test -- tests/renderer/LibraryShell.test.tsx
npm test -- tests/renderer/DuplicateGroupsPage.test.tsx
npx tsc -p tsconfig.web.json
```

必要时补 main 侧 TypeScript 编译检查。

---

## Task 10: 手动验证并按协作约定重启客户端

**Files:**
- Manual verify in running app

- [ ] **Step 1: 验证重复组生成**

检查项：

- 同内容副本能归入一组
- 非重复视频不会误入“重复项”
- 文件变化后旧指纹不会继续参与分组

- [ ] **Step 2: 验证批量清理流程**

检查项：

- 预检查摘要正确
- 输入 `DELETE` 前不能执行
- 执行后成功项从库和磁盘移除
- 失败项原因明确

- [ ] **Step 3: 验证普通浏览与播放器不受破坏**

检查项：

- 所有视频 / 收藏 / 最近播放 / 文件夹仍正常
- 详情弹窗仍可打开
- 播放器入口仍可用

- [ ] **Step 4: 按协作约定重启客户端**

完成实现后，用当前项目启动方式重启 Electron 客户端，确认去重功能与原有功能都能正常启动和工作。

---

## Task 11: 收尾与提交

**Files:**
- Modify only the files touched above

- [ ] **Step 1: 检查变更范围**

Run:

```bash
git diff -- src/shared/videoTypes.ts src/main/db/database.ts src/main/db/videoRepository.ts src/main/media/libraryScanner.ts src/main/ipc.ts src/main/preload.cts src/renderer/App.tsx src/renderer/components/LibraryShell.tsx src/renderer/styles.css tests/main tests/renderer
```

- [ ] **Step 2: 汇总验证结果**

记录：

- 哪些测试已通过
- 哪些手动检查已完成
- 是否存在已知边界问题

- [ ] **Step 3: 提交实现**

提交前确认只包含去重功能相关文件，不混入其他在途修改。
