# 数据库模块

本模块管理 SQLite 生命周期与资料库查询。`database.ts` 负责连接、版本识别、备份、迁移和完整性检查；`migrations/` 保存有序 schema 变更；`videoRepository.ts` 封装文件夹、视频、缺失、收藏、待删除标记、重命名路径、播放历史、后台元数据状态和分页查询。上层不应散写 SQL。

路径使用 `COLLATE NOCASE UNIQUE` 适配 Windows。upsert 必须保持既有 id、收藏和待删除标记；后台元数据更新必须同时匹配 id、path、size 和 modifiedAt，防止慢任务覆盖已重命名或已变化文件。

需求定位：新增普通资料库排序/筛选/分页看 `SORT_COLUMNS`/`listVideoPage`；目录侧栏看 `getLibraryNavigation`；重复项看大小+时长查询；扫描快照/异常看 `get/upsertDirectorySnapshot`、`record/list/resolveScanFailure`、v5 建表迁移和 v6 旧异常回填迁移；断点续播/历史看 play history；改字段先新增 migration，再同步 row 类型、映射、shared 类型和测试。

## Schema 版本历史

数据库使用 SQLite 原生 `PRAGMA user_version`，当前最新版为 5。

| 版本 | 内容 |
| --- | --- |
| 1 | `source_folders`、`videos`、`timeline_previews` 核心结构 |
| 2 | `play_history` 与资料库分页/排序索引 |
| 3 | 内容快速指纹字段和索引 |
| 4 | `is_pending_delete` 待删除标记和索引 |
| 5 | 每目录增量快照、跨重启扫描异常明细、扫描任务历史与索引 |

旧版本曾没有版本号。首次接管时只接受能明确对应 v1–v4 的表/列组合，再自动升级到 v6；部分指纹列、缺少核心表、未知业务表或高于当前版本的数据库都会停止启动，不会被盲目修改。v6 只为“旧 `scan_error` 非空且没有活动 `scan_failures`”的目录补一条根目录异常，不清空原摘要、不覆盖已有异常，重复执行不会重复插入。

## 迁移与备份行为

- 新库在单个事务内依次执行 v1–v6，不需要升级备份。
- 旧库升级前使用 SQLite `VACUUM INTO` 创建包含 WAL 当前一致视图的独立备份，再运行迁移事务。
- 备份目录为 `<library.sqlite>.backups`，文件名为 `library.sqlite.v<旧版本>.<UTC 时间>.sqlite`。
- 每一步都执行前置断言、DDL、后置断言并更新 `user_version`；任一步失败会回滚整个升级序列。
- 提交后执行 `foreign_key_check` 和 `quick_check`。失败时连接关闭、主界面不创建，错误框显示原库与可用备份路径。
- 备份失败时迁移根本不会开始。原数据库永远不会因迁移失败被删除或自动替换。

## 新增迁移的规则

1. 在 `migrations/` 新增下一个连续编号文件，并登记到 `migrations/index.ts`；禁止恢复 `ensureColumn` 式启动补丁。
2. `assertBefore` 只验证该迁移真正依赖的历史结构；`up` 必须单向且可在事务中执行；`assertAfter` 验证新列、默认值、索引或回填。
3. 新字段优先可空或带安全默认值。需要重建表时，先设计旧表到新表的数据对账，不得先删旧表。
4. 增加对应历史 fixture、故障注入、重复启动、备份失败、外键/索引/default 和数据保留测试。
5. 用脱敏的真实旧用户库副本演练升级，至少核对视频数、目录数、收藏、待删除、缺失状态和播放历史；自动测试不能替代这一步。

## 人工恢复流程

1. 完全退出应用并保留 `library.sqlite`、`library.sqlite-wal`、`library.sqlite-shm` 和 `.backups` 目录，不要直接删除。
2. 把当前数据库三件套复制到另一个诊断目录。
3. 选择错误框显示的升级前 `.sqlite` 备份，并用受支持版本的 SQLite 执行 `PRAGMA quick_check`。
4. 将当前 `library.sqlite` 三件套移出用户数据目录，再复制选定备份为 `library.sqlite`；不要把失败升级留下的 WAL/SHM 与备份混用。
5. 使用能支持该备份 schema 版本的应用启动。若当前版本重复迁移失败，先保留现场并修复迁移代码，不要反复覆盖备份。

## 测试覆盖

`databaseMigrations.test.ts` 覆盖空库、无版本旧库、v1–v6、旧异常回填/去重/幂等/重试清除、每步故障回滚、备份可独立打开、备份失败、未知/损坏 schema、默认值/索引/FK 和幂等启动。`videoRepository.test.ts` 覆盖快照规范化、异常重试/解决和目录级缺失对账；`libraryScanner.incremental.test.ts` 覆盖快照算法。标准命令为 `npm run test:migrations` 和 `npm test`；native ABI 必须与运行测试的 Node 一致。
