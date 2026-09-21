# 映匣 UI 信息架构优化 V1

## 分支

`ai/ui-navigation-refresh-v1`

## 完成内容

- 将侧栏按“概览 / 资料库 / 清理与健康 / 工具”重新分组。
- 将“所有视频”调整为更明确的“视频浏览”，“视频数据表”调整为“视频数据”。
- 将收藏和最近播放降为资料库二级入口。
- 将扫描失败、文件缺失和元数据异常合并为单一“异常中心”入口，并在内容区通过标签切换。
- 将大目录树改为默认折叠的“资料库目录”，展开状态保存在 renderer localStorage。
- 保留目录添加、CloudDrive 添加、目录扫描和目录问题处理能力，不改变业务调用。
- 统一视频数据页与现有主页面的 88px 页头、字号和间距。
- 设置页增加固定分类导航，保留原有设置项和保存逻辑。
- 重复文件页将长期规则横幅改为按需展开说明，并压缩统计卡与操作按钮高度。

## 修改范围

- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/DuplicateGroupsPage.tsx`
- `src/renderer/components/SettingsPage.tsx`
- `src/renderer/components/videoDataPage.css`
- `src/renderer/styles.css`
- 对应 renderer 测试

## 未修改

- 视频扫描逻辑
- 播放器与播放路由
- 数据库结构与查询契约
- 文件删除、重复项清理和 CloudDrive API 逻辑
- IPC 与 preload 权限边界

## 验证

- TypeScript 类型检查通过。
- Renderer 针对性测试通过。
- Node 完整测试通过：72 个测试文件，661 项测试。
- Production renderer/main 构建通过。

## 后续建议

- 在真实 1080p 与 4K 窗口中进行一次人工视觉验收。
- 根据真实使用反馈，再决定是否把收藏和最近播放进一步合并为视频浏览页内的视图切换。
- 若继续压缩重复文件页，应只调整控制区组织，不改后台清理任务与删除语义。
