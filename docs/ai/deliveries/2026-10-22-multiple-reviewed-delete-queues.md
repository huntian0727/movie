# 本地日常版 v1.4：重复文件多任务顺序清理

- 需求：原来的重复文件后台清理只允许一个任务，先前一个还在删除时禁止再次发起清理。维护者要求后续改动每次都同步到**家里电脑 MP2T8QB5 的桌面常用版**，不只提交代码。GitHub 公开发布另行安排。
- 方案：保留一个远端删除执行器，但允许用户在前一个正在处理时继续提交其他文件；后续任务按照确认提交顺序 FIFO 等待。**不并行调用远端删除 API**，避免身份、缓存或远端状态冲突。
- 每个任务仍由用户对独立的清理计划执行预检查和确认；每次至多 500 文件，最多保留 20 个等待任务。`reviewed-duplicate-background.json` 改为可迁移的 `version:2` 原子检查点，保留正在执行、等待队列及至多 25 条历史概要。兼容旧版单任务 JSON。
- 防误删：同一待删目标不能重复入队，当前或待执行保留文件不能被后续任务当作待删目标；旧同步删除流程及另一套清理服务仍受正在处理/排队作业的互斥保护。实际执行时继续执行主进程原有的远端身份与文件版本校验。
- 崩溃/重启：运行中远端结果一律按未知中断记录，尚未开始的队列标记中断，不自动重试；运行中有远端结果未知或发生异常时，等待任务不会自动出队。保留损坏检查点原始文件供排查，不贸然覆盖。
- UI：重复文件页显示当前执行任务和「后面排队 N 个任务」，展开详情可查看各任务处理/等待概况；已经确认入队的目标暂时从当前重复列表隐藏，其他菜单不显示清理条。新任务提交不再因为前面有后台任务而被禁用；完成正常后状态条自动消失。
- 修改范围：`src/main/media/reviewedDuplicateBackground.ts`、`src/shared/videoTypes.ts`、`src/main/ipc.ts`、`src/renderer/components/{DuplicateGroupsPage,LibraryShell,ReviewedBackgroundStatus,queuedDuplicateVisibility}` 与针对性测试；同步 `docs/USER_GUIDE.md`、`docs/user-guide/0.1.16.md`。
- 备份：只在家里电脑执行了本地 snapshot `2026-10-21_16-56-39-073_multi-duplicate-deletion-queue`，数据库 363039 条、0.92GB、SQLite quick_check=ok。未触发任何真实网盘删除。
- 测试：`tests/main/reviewedDuplicateBackground.test.ts` 和 `tests/main/reviewedDuplicateDelete.test.ts` 的 26 个 stub/隔离操作 PASS；5 个 renderer/queue 相关测试文件共 108 项 PASS；`DuplicateGroupsPage.test.tsx` 与 `queuedDuplicateVisibility.test.ts` 共 63 项 PASS；TypeScript 检查 PASS。覆盖 FIFO 多次受理、重复与保留文件冲突、故障中断停止后续、重启不复播、临时隐藏与跨菜单显示。
- 交付要求：本批次源代码准备好后界面版本从 v1.3 升为 **v1.4**，只打用户日常 Windows 桌面版，不产出/上传正式 GitHub Release；只在真实快捷方式所指 exe 部署并通过隔离数据的启动 smoke 后宣布已交付。运行中程序或后台删除仍进行时不得强制覆盖，须保留原 v1.3 完整目录以回滚。

## 真实日常桌面部署结果

- 源码特性提交 `c855922a939603100ad7c17ec4371b7863e77da7`；界面 v1.4 版本提交 `638c405146169bf3b2373800702944cce1e593f4`，技术包仍 `0.1.16`。
- 使用 `MOVIE_SAFE_STAGE_LOCAL=1 npm run package:development` 成功生成隔离绿色 Windows v1.4 目录；新的 `app.asar`、NativeHost、MPV DLL、FFmpeg 和 `build-flavor.json` 均核实存在。使用隔离临时用户数据运行 `node scripts/run-packaged-smoke.mjs --executable <staged EXE>` 两阶段均 PASS。
- **原常用 v1.3 进程仍在运行（4 个 Electron 进程），因此没有强制停止，也没有替换运行中的 `release/win-unpacked` 文件**。
- 为兼顾用户要求更新常用版本：将已验证 v1.4 绿色包移动到稳定目录 `release/daily-v1.4/win-unpacked`；将现有桌面快捷方式 `C:\Users\test\Desktop\拉面影视.lnk` 的 TargetPath 和工作目录改为新 v1.4 目录。备份原快捷方式到 `.tmp/daily-v14-shortcut-20261022/previous-v1.3.lnk`，旧 `release/win-unpacked` v1.3 完整保留，不动用户数据库。
- **快捷方式目标最终核验**：`C:\Users\test\Documents\视频管理\movie\release\daily-v1.4\win-unpacked\拉面影视.exe`，其中 `resources/build-flavor.json` 标为 `displayVersion: 1.4`，代码 commit 为 `638c405146169bf3b2373800702944cce1e593f4`；EXE SHA-256 为 `EFDDD91747198B0152EEE265E80815DB5ECD24C1715B9B55685C32F30A9AEE7A`。
- **激活条件**：当前已经开启的窗口仍是 v1.3，用户需要在**正常完成当前清理任务后自行退出整个 v1.3 应用**，再从桌面原快捷方式启动，即可使用 v1.4。不要声称正在运行的旧窗口自动变成新版，也不要现在代用户强制结束或自动执行远端删除。
- 本次只更新家里电脑常用桌面快捷方式目标。**没有**推送 GitHub、创建公共发行包、修改正式 SQLite 数据或向真实网盘发送删除请求。
