# 扫描优化最终实施报告

## 1. 修改前工作区状态

- 当前分支：`main`。
- 实际项目根目录：`C:\Users\test\Documents\视频管理\.worktrees\codex-video-manager-implementation`。
- 原有已修改文件：无；执行包解压前 worktree clean。
- 原有未跟踪文件：无；本轮按要求新增 `movie-scan-optimization-execution-pack/`。外层 `C:\Users\test\Documents\视频管理` 的其他未跟踪审查文件不属于本 worktree，本轮未修改。
- 未执行 `git reset`、`git clean`、checkout 覆盖、清库或远程仓库操作。

## 2. 修改前真实调用关系

- 文件夹刷新：renderer 调 `scanFolder(folder.id)` → `folder:scan` → `ScanManager.start` → 全目录 scanner。
- 感叹号弹窗：renderer 调 `retryFolderScan(folder.id)` → `folder-scan:retry`，仍重新执行同一全目录扫描，没有异常明细范围。
- 扫描全盘：renderer 获取全部文件夹并循环调用 `scanFolder`，没有独立的全盘上层 IPC。

## 3. 代码级问题原因

旧 scanner 每次递归发现所有视频，再逐个读取文件属性；“文件未变化”只能省去 FFprobe，不能省去映射盘上的 per-file stat。错误只压缩成 `source_folders.scan_error` 字符串，缺少失败对象、阶段和持久重试状态，因此无法只重试异常项。全盘顺序由 renderer 临时编排，三个用户入口的语义没有在 IPC/主进程边界分开。

## 4. 最终架构与三种扫描模式

- 模式 A `current-folder`：每目录读取直属条目和目录 mtime，比较排序摘要、直属视频/子目录计数、完整/异常标记；干净未变化目录不 stat 直属视频，但始终继续检查子目录。
- 模式 B `retry-failures`：读取持久 unresolved/retrying 记录。文件只重做失败阶段；目录只重扫失败子树；部分成功只解决成功对象。
- 模式 C `scan-all`：主进程过滤 enabled source folders，按现有顺序逐个复用模式 A；不启用无控制并发。
- `ScanManager` 提供全局串行、同源去重、模式/阶段/计数、暂停和检查点式取消。全盘计数包含总数、当前序号、完成数和异常数。
- 后台 FFprobe 失败进入 metadata 阶段异常，成功后才 resolved，并同步 source folder 摘要、目录快照异常标志和 UI 领域事件。

详细维护说明见 `docs/scan-modes-and-snapshots.md`。

## 5. 数据库迁移与旧数据兼容

新增 v5 migration：

- `directory_snapshots`：source/path 规范化复合主键、parent 索引、mtime、直属计数/摘要、成功/完整/异常状态。
- `scan_failures`：对象、阶段、错误、首次/最近时间、retry count、状态和 resolved 时间；active 对象唯一索引。
- `scan_tasks`：模式、状态、开始/完成时间、计数 JSON 和错误摘要。

现有 v1–v4 数据不回填、不删除。升级继续先用 `VACUUM INTO` 创建含已提交 WAL 状态的一致备份，再在事务中执行迁移/断言；失败整体回滚。没有历史快照时下一次普通扫描自然建立。Electron Node ABI 130 下 v1–v5 migration、回滚、备份、WAL、幂等和仓储持久化测试通过。

## 6. 修改文件清单

主要新增文件：

- `src/main/db/migrations/005-scan-snapshots-and-failures.ts`
- `src/main/files/pathNormalization.ts`
- `tests/main/libraryScanner.incremental.test.ts`
- `tests/main/pathNormalization.test.ts`
- `docs/scan-modes-and-snapshots.md`
- `docs/scan-optimization-final-report.md`
- `docs/README.md`
- 原始执行包目录 `movie-scan-optimization-execution-pack/`

主要修改范围：

- 数据/扫描：`database.ts`、migration index、`videoRepository.ts`、`libraryScanner.ts`、`metadataQueue.ts`、`scanManager.ts`。
- 契约/UI：shared types、preload、IPC、main index、App、LibraryShell、Toolbar、scan status 和样式。
- 测试：migration、repository、scanner/network、metadata queue、scan manager、IPC、LibraryShell/status。
- 文档：根 README/ARCHITECTURE/TASK/REPORT/CHANGELOG，数据库/媒体 README，feature audit、features、verification results。

## 7. 新增/修改接口

新增明确 API/IPC：

- `scanAllFolders()` / `folder:scan-all`
- `retryScanFailures(sourceFolderId)` / `folder-scan-failures:retry`
- `getScanFailureSummary(sourceFolderId)` / `folder-scan-failures:summary`
- `listScanFailures(sourceFolderId)` / `folder-scan-failures:list`

现有 `scanFolder(sourceFolderId)` / `folder:scan` 保持当前文件夹普通扫描。旧 `folder-scan:retry` 仅保留普通重扫兼容语义，不再供异常弹窗使用。

## 8. 安全与缺失对账处理

- 根目录不可读返回 offline，不对已有记录或子树做 missing。
- 子目录不可读写持久目录异常并继续其他分支，不对失败分支做 missing。
- 直属 missing 只在该目录本次枚举完整成功后执行。
- 子树 missing 只在父目录完整枚举且明确缺少旧直属子目录后执行。
- 取消检查发生在目录读取后、文件处理前和递归提交前；未完成目录不写成功快照，未处理异常保持 retrying/unresolved。
- Windows/UNC 路径统一处理大小写、斜杠和尾分隔符，并用边界安全的子树判断。
- 结构化日志不记录真实完整路径；异常数据库/UI 可显示用户自己的路径。

## 9. 自动化测试

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| 执行包 `scripts/preflight.ps1` | 通过 | 修改前确认正确 worktree 和状态 |
| `npm run lint` | 通过 | TypeScript 两套配置均通过 |
| `npm run build` | 通过 | 1591 modules，production renderer/main 构建成功 |
| Electron Node 模式完整 Vitest | 35 files / 302 tests 通过 | 使用 ABI 130 真实加载 better-sqlite3，含 migration/repository/UI/性能 |
| `node scripts/run-electron-smoke.mjs` | 通过 | Electron 33.4.11、ABI 130、main-process smoke |
| 执行包 `scripts/verify.ps1` | 混合结果 | lint/typecheck/build 通过；标准 `npm test` 与包装的 electron smoke 被 Node/npm 版本门禁阻塞；脚本仍打印 completed/返回 0，不能据此宣称全部通过 |
| 标准 `npm test` | 未通过环境门禁 | 系统 Node 24.14.0/npm 11.9.0；项目要求 Node 22.23.1/npm 10.9.8，且 native ABI 不同 |

曾尝试离线重建 Node ABI，但本机没有 Visual Studio C++ workload，`node-gyp` 失败。原 Electron ABI 二进制随后从本地现有 `release/win-unpacked` 恢复，并经 native smoke 验证；没有删除数据库或访问 Git 远程。

## 10. 性能基准

| 场景 | 目录读取 | 视频属性读取 | DB 读写 | 耗时 |
| --- | ---: | ---: | ---: | ---: |
| 10,000 视频、101 目录、第二次全部未变化 | 101 次枚举 + 101 次目录 stat | 0 | 203 读 / 0 写 | 879.22 ms |
| 9,900 成功、100 文件异常，仅重试异常 | 0 | 100 | 102 读 / 300 写 | 4.30 ms |

以上为可重复的合成内存仓储/虚拟文件系统基准，证明调用数量和范围，不代表真实 NAS 延迟。不同运行中异常重试约 2.82–5.25 ms；报告表采用最后一次完整测试输出。真实映射盘需要单独留证。

## 11. 原有本地修改与本次修改的区分

目标 worktree 在解压执行包前 clean，因此当前 tracked diff 均属于本轮。执行包为本轮明确新增。外层仓库的未跟踪审查文档未进入目标 worktree、未修改、未覆盖。

## 12. 验收清单对照

- 已自动验证：三种 IPC 契约；快照首次/未变化/深层变化/条目顺序/增删重命名；路径大小写/斜杠/UNC；文件和目录范围重试；部分成功；无异常安全返回；重启持久化；根/子目录缺失安全；取消保留异常；任务去重/同源互斥；感叹号与刷新共存；异常按钮与全盘文案；v1–v5 迁移；10,000 视频基准。
- 代码审计通过：三个 renderer 入口分别调用 `scanFolder`、`retryScanFailures`、`scanAllFolders`；日志调用只传 ID/模式/计数。
- 需要人工验证：真实 SMB/映射盘慢读、断线恢复和权限；现有真实旧库副本升级/恢复；Electron 中三入口视觉/交互、黄三角随异步 metadata 自动消失；长时间暂停/关闭应用；十万级目录内存；干净 Windows VM。

## 13. 已知限制和剩余风险

1. 普通扫描仍需枚举整棵目录树；优化消除的是未变化目录的 per-file stat/FFprobe，不消除 NAS 目录枚举延迟。
2. 单次正在等待的系统目录 I/O 和正在运行的 FFprobe 子进程不能被协作取消立即打断。
3. 当前产品明确不处理“同名覆盖且目录 mtime、直属名称/计数都不变”；改变规则会增加网盘读取。
4. `source_folders.scan_error` 仍作为快速兼容摘要；事实源是 `scan_failures`，新代码不能只改摘要。
5. 本机缺少项目锁定的 Node 22/npm 10 环境和 C++ toolchain；标准 verify 的 Node test 门禁未通过，发布机仍须在规定环境重跑。
