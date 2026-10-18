# 应用数据目录

各数据文件、字幕/缓存子目录、默认位置中的 Electron 运行环境、备份和清理边界见 [数据目录说明与维护手册](../../../docs/DATA_DIRECTORY_GUIDE.md)。新增持久文件时同步维护说明、迁移与备份覆盖范围。

`dataDirectory.ts` 负责固定默认目录的 `data-location.json`、专用目标目录、独占使用、复制校验、缓存路径重定位和原文件清理。`electronDataStorage.ts` 提供目录选择、迁移进度、恢复提示与重启；只由主窗口调用 storage IPC，renderer 不能直接提交路径。

默认目录仍按 `releaseFlavor.ts` 解析。Electron sessionData 显式保留在该默认目录，用户资料库、设置、字幕、媒体缓存和日志则跟随 userData。程序更新及程序文件夹位置不影响定位。`.data-directory-owner.json` 标记数据所属发行 profile，禁止跨身份接管。

流程：预览 → 保存 pending 并退出旧进程 → 新进程启动、取得数据锁 → 在目标同级的独立 staging 目录复制应用文件白名单 → SHA-256 全文件校验 → SQLite quick_check、事务更新应用缓存引用、checkpoint → 写校验凭据 → rename 发布专用目录 → 原子切换定位记录 → 正常打开资料库与窗口 → 校验原文件后逐文件清理。源视频路径始终不改。

中断的 staging 副本保留，下次换新 staging 重试。已发布而未切换指针的目标须有匹配凭据并通过校验才采用。失败保留原目录并提示；定位记录损坏则停止。自选目录丢失时不自动创建空资料库，可重新定位含归属标记和 SQLite 的已有目录。旧程序不识别定位记录，迁移后不要同时运行旧版。

清理只按校验清单逐文件 unlink，原文件变化、新增受管理文件、联接、目录占用或权限异常时保留现场。不会递归删除用户选择的父目录，不迁移 Chromium Cache_Data、任意导出文件和应用目录外的媒体。磁盘丢失、NAS/SMB、ACL、跨卷等人工实测范围须另记，不以 mock 代替真实环境结论。

开发备份工具 `scripts/project-backup.mjs` 同样读取固定定位记录，pending 迁移时拒绝备份/恢复，防止取错库。
