# 映匣无树目录浏览 V1

## Context

分支：`ai/directory-browser-v1`。资料库已有约 2.7 万个目录，传统递归树既占据侧栏空间，也会在渲染和交互时放大前端负担。本轮按用户确认的样板，将目录入口改为“来源优先、按需下钻”的独立浏览页。

## Changes

- 侧栏不再构建或渲染完整目录树，只显示资料库根来源、最近访问目录和统一“浏览目录”入口。
- 增加独立目录浏览页：全局目录搜索、面包屑、直接子目录、当前目录/包含子目录切换、当前范围视频预览。
- 支持 `Ctrl+K` 从非输入状态直接打开目录搜索。
- 子目录和视频均按需读取；首次进入空白目录浏览页不会查询全部目录。
- 增加只读目录查询 IPC，通过既有 Asset Center 只读数据库 worker 执行，不在 renderer 访问数据库，也不读取磁盘或视频内容。
- 目录查询排除已标记缺失的视频，并返回缓存的视频数量、容量和最后修改时间。
- 保留 CloudDrive API 身份、扫描状态/异常入口、暂停/继续/重新扫描和移除来源能力；低频操作收进来源菜单。
- 最近访问只保存在 renderer localStorage，不修改数据库结构。

修改范围：

- `src/shared/videoTypes.ts`
- `src/main/assetCenter/*`
- `src/main/ipc.ts`
- `src/main/preload.cts`
- `src/main/security.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/LibraryShell.tsx`
- `src/renderer/components/DirectoryBrowserPage.tsx`
- `src/renderer/components/directoryBrowserPage.css`
- `src/renderer/styles.css`
- 对应 main/renderer 测试

明确未修改：

- 视频扫描、媒体解析和预览图生成逻辑
- 播放器和播放路由
- 数据库结构
- 文件管理与删除语义
- 重复项识别和清理逻辑

## Verification

- TypeScript 类型检查通过。
- 新目录聚合、只读 worker 路由、IPC 契约与 renderer 交互测试通过。
- Node 完整测试：72 个测试文件，665 项测试；新增 IPC 契约后定向复测通过。
- Production renderer/main 构建通过。
- Windows 安装包重新生成：`release/Local-Video-Manager-0.1.15-x64-Setup.exe`。
- 制品检查通过：3982 个 ASAR 条目，无禁入开发文件。
- 打包程序冒烟测试通过；renderer、预览图、数据库与各只读查询 worker 均通过。

## Risks and follow-up

- 目录搜索首版最多返回 100 条并提示继续缩小关键词，避免一次性创建超大结果列表。
- 目录聚合运行在只读 worker，超大来源首次下钻的耗时取决于 SQLite 缓存和目录数量，但不会阻塞 renderer 事件循环。
- 建议在真实资料库中人工验收目录命名、面包屑和 1080p/4K 布局。
