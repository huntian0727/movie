# Logging 与诊断模块

本模块负责主进程结构化日志、稳定错误分类、默认脱敏、文件轮转和诊断包白名单。它不上传数据，也不读取或打包视频、SQLite 正文、环境变量值或用户配置密钥。

主要文件：

- `logger.ts`：写入 JSONL、生成 operation ID、按 5 MiB/5 文件轮转并清理超过 14 天的日志；批量结果只提取计数摘要。
- `redaction.ts`：在写盘前处理路径、URL 查询密钥、Bearer 凭证、敏感字段、超长字符串和深层对象。路径只保留本地/网络类别、扩展名和不可逆短哈希。
- `errorCodes.ts`：把 ABI、数据库迁移/锁、离线、文件占用、权限、磁盘满、参数校验和 ffprobe 超时映射为稳定错误码。
- `diagnostics.ts`：构建诊断预览和导出白名单；只包含版本、OS/ABI、schema version、检查结果及已脱敏日志。
- `types.ts`：日志和诊断内部类型。

交互关系：`index.ts` 在数据库打开前创建 logger；IPC、扫描、元数据队列、缓存维护和安全边界写入事件。设置页只能通过 main-only IPC 预览或导出诊断 JSON；播放器 preload 不暴露诊断接口。

维护约束：

- 不允许先写原始日志、再异步脱敏；脱敏必须发生在持久化之前。
- 不记录完整 IPC 参数、批量成功项、视频路径、文件名、ffprobe stdout、数据库行、token 或环境变量值。
- 同一操作的 started/completed/failed 必须复用 operation ID；业务失败不能被日志吞掉或改写文件事务语义。
- 新错误类别必须增加稳定码测试；新诊断字段必须进入显式白名单，并验证默认导出不存在用户目录和业务正文。
- “包含完整路径”只允许用户在设置页显式勾选，并且仅披露应用数据、数据库、缓存和日志目录，绝不扩大到视频源路径。

自然语言定位：日志过大或保留时间看 `logger.ts`；路径泄露看 `redaction.ts`；错误显示分类不正确看 `errorCodes.ts`；诊断包缺字段或包含多余数据看 `diagnostics.ts`、shared IPC、preload 和 `SettingsPage.tsx`；某项操作没有日志看它的主进程错误边界及 IPC 包装器。

测试覆盖见 `tests/main/logging.test.ts`、`tests/main/security.test.ts`、`tests/main/ipcContracts.test.ts` 和 `tests/renderer/SettingsPage.test.tsx`。真实只读用户目录、日志文件被占用、超大日志导出和用户主动包含完整应用路径仍需桌面验证。
