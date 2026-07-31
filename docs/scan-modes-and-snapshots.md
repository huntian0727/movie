# 扫描模式、目录快照与异常恢复

本文是扫描子系统的维护入口。实现以 `src/main/media/libraryScanner.ts`、`scanManager.ts`、`metadataQueue.ts` 和 `src/main/db/migrations/005-scan-snapshots-and-failures.ts` 为准。

## 三个上层入口

| 用户入口 | preload / IPC | Manager | 范围 |
| --- | --- | --- | --- |
| 左侧文件夹圆形刷新 | `scanFolder` / `folder:scan` | `start` | 当前一个 source folder 的模式 A |
| 感叹号 → 重试异常项 | `retryScanFailures` / `folder-scan-failures:retry` | `retryFailures` | 当前 source folder 的 unresolved/retrying 对象 |
| 右上角扫描全盘 | `scanAllFolders` / `folder:scan-all` | `scanAll` | 所有 enabled source folders，严格顺序执行 |

旧 `folder-scan:retry` 保留给“重新执行普通扫描”的兼容调用，不承担异常弹窗语义。三种修改任务共享 `ScanManager` 队列；同一 source folder 的重复点击复用现有任务，不会产生并发写入。

## 模式 A：每目录增量扫描

scanner 对目录树逐级执行：

1. 读取当前目录直属 `Dirent`，再读取目录自身 mtime；失败则写目录异常并停止该子树。
2. 将直属视频文件名和直属子目录名分别加类型前缀、排序后计算 SHA-256 摘要。深层后代不进入父目录摘要。
3. 与 `directory_snapshots` 比较 mtime、两个计数、摘要、完整标记和异常标记。
4. 快照完全一致时，不 `stat` 直属视频、不更新视频、不触发 FFprobe；但仍递归每个直属子目录。
5. 目录变化/无快照/上次不完整/有异常时，才 `stat` 直属视频并 upsert。新视频先以 `metadata_status=pending` 入库，再交给单并发 FFprobe 队列。
6. 只有本次目录枚举完整成功，才按直属文件名对该目录执行缺失对账。
7. 父目录完整枚举且旧快照中的直属子目录已不存在，才把对应旧子树视频软标缺失、解决该范围旧异常并删除子树快照。

跳过规则有一个明确产品前提：不识别“同名覆盖且父目录 mtime、直属名称和计数全部未变化”。这是为映射网盘节省带宽的有意取舍，不应在未讨论带宽成本前悄悄改变。

## 模式 B：异常重试

`scan_failures` 保存对象类型、阶段、路径规范化键、首次/最近失败时间、错误摘要、重试次数和状态。应用重启不会丢失。

- 目录异常：只从最外层失败目录根开始扫描该子树；其内部重复失败根不额外创建并行任务。
- `file-processing` 异常：只重新读取该文件属性并执行入库阶段，不枚举正常目录。
- `metadata` 异常：只把对应视频重新放入 FFprobe 队列。异步真正成功后才 resolved，不能在入队时提前解决。
- 部分成功只解决成功对象；再次失败更新同一 active 记录并增加 retry count。
- 协作式取消后，尚未处理或仅标为 retrying 的记录仍属于未解决异常；未完成目录不会写成功快照或提前解决目录异常。

`source_folders.scan_error` 是侧栏的快速摘要，不是异常事实源。每次 record/resolve 都从 `scan_failures` 同步该摘要；后台 metadata 状态变化通过 `source-folder:updated` 领域事件刷新侧栏。完整明细只在用户打开弹窗时查询。

## 模式 C：扫描全盘

全盘不另写扫描算法。它过滤 enabled folders 后，按 repository 返回顺序逐个用模式 A 执行。进度 counters 包含总文件夹数、当前序号、完成数和异常文件夹数；每个子任务仍受同源互斥约束。

## 路径规则

`src/main/files/pathNormalization.ts` 是快照、异常和子树判断的统一入口：使用 Windows 语义归一化斜杠、大小写和尾分隔符，同时保留 UNC server/share 边界。不要在新代码中另写 `toLowerCase()` 前缀判断；`D:\Movies-Backup` 不能被误认为 `D:\Movies` 子树。

## 失败安全不变量

- 根目录离线：返回 offline、保留已有视频和快照，不做缺失对账。
- 子目录超时/无权限：记录目录异常，继续其他分支，不把失败子树视频标缺失。
- 文件失败：不阻断同目录其他文件；该目录快照标记有异常，因此普通扫描下次不得跳过。
- 中断/取消：检查点抛出 `ScanCancelledError`；当前未完成目录不提交成功快照，未处理异常不 resolved。
- 日志只记录 folder ID、video ID、扩展名、模式和计数；用户自己的完整路径只允许出现在数据库异常明细和 UI，不写结构化日志。

## 自然语言需求定位

| 需求 | 先看 |
| --- | --- |
| “第二次扫描网盘仍读取太多文件” | `snapshotCanSkip`、目录摘要、repository 目录级对账、10k benchmark |
| “深层新视频漏扫” | `scanDirectoryTree` 的父级 skip 后递归、直属摘要测试 |
| “黄三角不消失/重启后丢失” | `scan_failures`、`refreshSourceFolderFailureState`、metadata queue、领域事件 |
| “只重试失败文件” | `retryScanFailures` 的 failure stage 分支和失败持久化测试 |
| “离线后大量视频消失” | 根/子目录异常分支、`reconcileDirectoryMissing` 调用位置、missing safety 测试 |
| “增加扫描状态字段” | shared `ScanCounters/FolderScanStatus` → manager → preload/IPC → renderer → status tests |
| “改变路径判定” | `pathNormalization.ts`、快照主键、异常 active 唯一索引、UNC/大小写测试 |

## 自动化与手测

`tests/main/libraryScanner.incremental.test.ts` 覆盖首次/二次快照、父未变子变化、顺序无关、增删改、子树删除、不完整快照、文件/目录异常重试、部分成功、取消与 10,000 文件基准。`databaseMigrations.test.ts` 和 `videoRepository.test.ts` 验证 v5 无损迁移及跨连接持久化。真实映射盘断线恢复、SMB 权限、数十万条目录和长时间暂停仍按 `docs/manual-test-checklist.md` 人工验证。
