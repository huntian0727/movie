---
date: 2026-10-02
branch: ai/video-view-action-parity
type: fix
status: verification-in-progress
---

# 列表与网格视图功能按钮统一

## 分支与基线

- 分支：`ai/video-view-action-parity`；基线 `31ba5d2d471840c75016a85ea71e96ffe22c4e44`。
- 开始时工作区干净，fetch 成功，HEAD 与 GitHub origin/main 一致。未覆盖、回滚或丢弃其他修改。
- 开发前快照：`2026-10-01_18-33-07-495_video-view-action-parity`；检查点：`checkpoint-20261002-023303-31ba5d2-video-view-action-parity`，已推送。
- SQLite 一致性备份：345479 条视频、0.87 GB、quick_check ok。

## 修改摘要

- 新增 `VideoItemActions`：两种视图共用收藏、待删除、重命名、删除、重新生成预览、失败时重新分析、打开所在文件夹、查看同目录视频。图标、顺序、按钮提示、状态样式一致。
- 列表传入之前遗漏的四个既有回调；保留详情按钮与多选，复用现有确认框、IPC 和服务。无新增 IPC。
- 列表封面重置显示处理中/失败状态，处理中禁用重复点击，失败允许再试。封面重置成功后说明其与截图条的区别。
- 操作区双击不冒泡到卡片/整行播放入口，避免操作时误触播放。
- 保留当前渐进渲染、可见截图加载与失败截图重试，不增加整库请求或自动视频读取。
- 重新生成预览沿用既有封面缓存重置语义；不强制使全部时间点截图缓存失效。截图条继续使用其独立的“重试失败截图”。
- 不修改扫描、播放器、文件管理核心逻辑或数据库结构。

## 文件清单

新增：

- `src/renderer/components/VideoItemActions.tsx`
- `tests/renderer/VideoViewActions.test.tsx`
- 本交付记录。

修改：

- `src/renderer/components/VideoGrid.tsx`
- `src/renderer/components/VideoTable.tsx`
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/styles.css`
- `tests/renderer/LibraryShell.test.tsx`

删除文件：无。

## 测试结果

- 定向测试：65 项通过（新按钮一致性测试 7 项、LibraryShell 58 项）。覆盖按钮顺序/图标/tooltip、失败元数据条件、回调目标、可选操作隐藏、多选保持、重复预览重置禁用、失败再试、双击不误播放，以及列表实际接线。
- `npm run test:release-gate`：PASS，80 个文件、739 项测试；类型检查、构建、Windows 文件操作、迁移和性能门禁通过。
- Electron smoke、实际打包及桌面启动验证：进行中，完成后补充真实结果。
- `git diff --check`：通过。

## 未验证事项与剩余风险

- 不对用户真实视频执行永久删除或重命名以验证按钮；通过 mock 回调与既有文件操作门禁验证。
- 不人为中断 CloudDrive/NAS 服务。远程文件离线时沿用既有错误处理。
- 小窗口下操作区增加了按钮；需实际桌面检查排版，不以单元测试代替可用性验证。

## 回滚

通过新的 revert 提交恢复本次 Renderer 改动；不倒退或强推 main。需要完整源码/资料库恢复时使用本轮开发前快照及检查点。
