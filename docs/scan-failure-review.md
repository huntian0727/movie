# 扫描异常工作台维护说明

“扫描异常”只展示 `scan_failures` 中状态为 `unresolved` 或 `retrying`、且属于已启用资料库目录的记录。已解决记录保留在数据库历史中，但不会出现在页面或侧栏计数中。当前实现复用已有表，不包含 schema migration。

## 分类与查询

- `directory`：异常对象本身是目录。
- `video`：异常对象是文件，且其精确路径能关联到 `videos` 记录。
- `unindexed-file`：异常对象是文件，但尚无对应视频记录。

分类、来源筛选、统计和分页均在 SQLite 内完成。服务端会校正越界页码，因此删除最后一页的最后一项后会自动回到仍存在的最后一页。

## 操作边界

- 单项重试只处理指定异常 ID；同一 ID 的并发请求在 IPC 层合并。
- 打开位置和删除前，主进程都会从数据库重新取得异常及资料库目录，并验证对象路径仍位于该目录内。
- 永久删除只允许文件异常。renderer 不传文件路径；目录异常没有删除按钮，主进程也会拒绝伪造请求。
- 文件已不存在（`ENOENT`）时不再调用删除，而是解决该路径异常并清理对应视频记录。权限或占用错误继续保留异常，供用户稍后重试。
- 所有成功操作通过 domain event 触发列表与侧栏计数刷新。

## 需求定位

- 修改页面筛选/卡片/确认文案：`src/renderer/components/ScanFailuresPage.tsx`。
- 修改侧栏入口或目录警告跳转：`src/renderer/components/LibraryShell.tsx`。
- 修改分类、统计、分页：`src/main/db/videoRepository.ts`。
- 修改单项重试：`src/main/media/libraryScanner.ts` 与 `src/main/ipc.ts`。
- 修改永久删除安全规则：`src/main/files/scanFailureActions.ts`。
- 修改 IPC 契约：`src/shared/videoTypes.ts`、`src/main/preload.cts`、`src/main/ipc.ts`。

相关自动化测试位于 `tests/main/scanFailureReview.test.ts`、`tests/renderer/ScanFailuresPage.test.tsx` 和 `tests/renderer/LibraryShell.test.tsx`。
