# CHANGELOG_FIX

## 2026-07-23 — T01：封锁并重构重复项永久删除

### 修复的问题

- CR-001 / P0：旧实现仅按 `size_bytes` 生成 `size:*` 重复组，却允许永久批量删除。

### 修改内容

- 保留按大小候选初筛，但 `size:*` 不再是可删除身份；只有 `fingerprint_status='ready'`、文件大小和快速指纹均一致的文件才生成 `fingerprint:*` 清理组。
- 重复项页面加载时以最多两个 worker 在后台补算候选快速指纹；单次读取设 30 秒保护，失败记录可在后续刷新时重试，不阻塞页面返回。
- 预览和执行永久删除时，主进程都会重新按当前数据库重建计划，不信任 renderer 传入的组或文件身份。
- 对每组保留项和删除项使用流式完整 SHA-256；校验前后检查文件大小与 mtime，执行每个删除前再次检查保留项和删除项版本。
- 完整校验最长 5 分钟；内容不一致、文件变化、离线、权限错误或超时都会在删除发生前拒绝操作。
- UI 分开显示“同大小候选组”和“快速指纹匹配组”，只有完整校验通过的预览才进入确认删除。
- 未新增或修改数据库结构。

### 测试结果

- `npm install`：成功；当前 Node 24.14.0 不符合项目声明的 Node 22.x，并报告 16 个依赖审计项（3 moderate、11 high、2 critical）。
- `npm run lint`：未执行成功，项目未定义 `lint` script。
- `npm run build`：通过。
- 定向测试：`contentFingerprint`、`DuplicateGroupsPage`、`LibraryShell`、IPC 契约共 42 项通过。
- `npm test`：非 SQLite 测试继续通过；SQLite/repository/扫描相关测试因当前 Node 24 与 `better-sqlite3` native binding 不可用而失败，不能据此判断数据库断言。
- `npm rebuild better-sqlite3`：失败；Node 24 没有对应预构建包，且本机缺少 Visual Studio C++ build tools。
- `npm run rebuild:electron`：通过，已恢复 Electron 运行所需的 native binding。

### 需要人工或正确环境验证

- 使用 Node 22 的干净 checkout 执行 `npm ci && npm test`，重点确认 repository 的候选/指纹分页 SQL 和伪造 `size:*` 计划拒绝测试。
- 在备份的合成视频目录验证：同大小不同内容、完全相同内容、快速采样碰撞、校验后修改、网络盘离线/超时、权限拒绝和删除失败。
- 大文件完整 SHA-256 的耗时与 5 分钟上限需要在真实本地盘和映射网盘评估。

### 新风险与回滚

- 新增完整哈希会增加确认删除前的磁盘/网络读取，但它只在用户发起批量清理时运行，且失败时偏向不删除。
- 快速指纹后台任务最多并发 2 个，仍可能占用慢速网盘连接；30 秒超时后可刷新重试。
- 若需回滚 UI 或指纹队列，必须保留主进程对 `size:*` 的拒绝以及完整哈希/文件版本复查，不能恢复旧的按大小永久删除路径。

## 2026-07-23 — T02：实现无数据丢失的文件移动事务

### 修复的问题

- CR-002 / P0：旧实现把“同名且同大小”判定为覆盖，在源移动成功前永久删除目标；跨卷复制没有临时文件、版本校验或数据库失败补偿。

### 修改内容

- 删除 `source.size === target.size => overwrite` 规则；移动不再自动覆盖任何已有目标。
- 冲突计划统一为 `direct`、`rename`、`skip`：同名时使用 `name1.ext`、`name2.ext` 递增寻找可用路径，已经位于目标路径时跳过。
- 执行阶段重新规划目标；预览后出现新文件时自动改用下一个安全名称，不使用 renderer 或预览结果作为最终路径。
- 同卷优先通过排他硬链接创建目标身份，成功后才删除源；删除源失败时撤销本次创建的目标。
- 跨卷或不支持源硬链接时，在目标目录独占创建 `.video-manager-move-*.tmp`，复制后复查源 size/mtime 和临时文件大小，再排他发布目标，最后删除源。
- 复制、校验、发布或删除源失败时清理本次临时文件；既有目标不参与删除。
- 文件落盘成功后才调用 `updateVideoPath`；数据库提交失败时使用 `commitMoveWithRollback` 将文件恢复到原路径。若原路径已被占用或回滚失败，则保留两份文件并返回稳定错误码。
- 批量结果增加逐项最终路径、实际计划、移动/跳过状态和错误码；确认框明确提示不会覆盖。
- 未修改数据库结构。

### 测试结果

- `npm install`：成功；Node 24.14.0 不符合项目要求的 Node 22.x，依赖审计仍为 16 项（3 moderate、11 high、2 critical）。
- `npm run lint`：失败，项目未定义 `lint` script。
- `npm run build`：通过。
- 定向测试：文件操作、LibraryShell 与 IPC 契约共 54 项通过。
- `npm test -- --reporter=dot`：150 项通过，33 项失败；失败全部来自 `better-sqlite3` 的 Electron ABI 130 与当前 Node ABI 137 不匹配，涉及 repository 和依赖数据库的 scanner 测试。

### 新增回归覆盖

- 同名同大小但内容不同，两份均保留。
- 连续同名冲突生成数字后缀。
- EXDEV 跨卷成功与复制失败。
- 临时文件最终发布失败。
- 删除源失败并撤销新目标。
- 预览与执行之间出现目标文件的竞态。
- 数据库提交失败后恢复原路径。
- 回滚时原路径被占用，不覆盖新文件并保留移动后的副本。

### 需要人工或正确环境验证

- Node 22 干净环境中的完整 repository/IPC 测试。
- Windows 11 两个真实卷之间的 EXDEV 行为。
- NTFS 文件锁、只读目录、磁盘满、杀毒软件占用、SMB/映射网盘断线和不支持硬链接的目标文件系统。
- 应用进程在临时复制或发布瞬间崩溃后的 `.video-manager-move-*.tmp` 清理属于后续启动恢复工作，当前不会自动删除普通文件。

### 新风险与回滚

- 同名同大小文件现在也会安全改名，不再执行此前约定的自动覆盖；这是为消除 P0 数据丢失路径而做的有意行为变更。
- 某些不支持排他硬链接的网络文件系统会安全失败而不是退化为可能覆盖的 rename；需要真实环境验证后再设计受保护的替代发布协议。
- 回滚失败可能留下源与目标两份副本，但不会主动删除任一份；错误码为 `DB_UPDATE_ROLLBACK_FAILED`，需要人工对账。

## 2026-07-23 — T03：修复 Windows 安全重命名与占位文件残留

### 修复的问题

- CR-003 / P1：旧实现先以 `open(..., "wx")` 创建零字节目标占位文件，再执行 rename；Windows 上目标已存在会导致正常重命名失败，失败后占位文件仍可能残留。

### 修改内容

- 删除重命名的目标占位文件流程。
- 普通重命名使用排他目标创建语义；目标已存在时返回 `TARGET_EXISTS`，不覆盖现有文件。
- 新名称建立后才移除旧名称；移除旧名称失败时撤销本次新名称，保留原文件。
- Windows 仅大小写变化使用同目录 `.video-manager-rename-*.tmp` 两阶段重命名；第二阶段失败时恢复原名称。
- 增加稳定错误码：`TARGET_EXISTS`、`PERMISSION_DENIED`、`FILE_LOCKED`、`SOURCE_NOT_FOUND`、`RENAME_FAILED`、`RENAME_ROLLBACK_FAILED`。
- 文件重命名成功后才更新数据库；数据库更新失败时 `commitRenameWithRollback` 将磁盘文件恢复到原名称。
- 未修改数据库结构或重命名 UI 业务范围。

### 测试结果

- `npm install`：成功；Node 24.14.0 不符合项目要求的 Node 22.x，依赖审计仍为 16 项（3 moderate、11 high、2 critical）。
- `npm run lint`：失败，项目未定义 `lint` script。
- `npm run build`：通过。
- 定向测试：重命名/移动文件事务、LibraryShell 与 IPC 契约共 57 项通过。
- `npm test -- --reporter=dot`：153 项通过，33 项失败；失败仍全部来自 `better-sqlite3` Electron ABI 130 与当前 Node ABI 137 不匹配。

### 新增回归覆盖

- 正常重命名与扩展名保持。
- 目标已存在时不覆盖。
- 权限错误时不生成目标占位文件。
- 删除旧名称失败时撤销新名称。
- Windows 仅大小写重命名第二阶段失败时恢复原名且不残留临时文件。
- 数据库提交失败时恢复原名称。

### 需要人工验证

- Windows 11 真实 NTFS 下的正常、仅大小写、目标锁定和 ACL 拒绝。
- 杀毒软件或索引服务占用临时名称时的恢复行为。
- 进程在仅大小写两阶段重命名中途崩溃后的临时文件识别与恢复仍需后续启动恢复机制。

### 新风险与回滚

- 普通重命名依赖目标文件系统支持排他硬链接；不支持时安全失败，不会退回到可能覆盖目标的 rename。
- 极端情况下第二阶段重命名和恢复原名同时失败，会保留带应用专用前缀的临时文件并返回 `RENAME_ROLLBACK_FAILED`，不得自动删除，需人工确认后恢复。

## 2026-07-23 — T04：建立版本化、事务化、可恢复的 SQLite 迁移

### 修复的问题

- CR-004 / P1：旧实现以 `CREATE TABLE IF NOT EXISTS` 和 `ensureColumn` 在启动时随意补列，没有 schema version、升级前一致性备份、事务回滚或未知 schema 拒绝机制。

### 修改内容

- 引入 `PRAGMA user_version`，把生产 schema 明确拆成 v1 核心资料库、v2 播放历史/查询索引、v3 内容指纹、v4 待删除标记。
- 每个迁移具备版本、说明、前置断言、`up` 和后置断言；移除正常启动路径中的 `ensureColumn`。
- 对无版本旧库按表/列特征识别 v1–v4；不完整组合、未知业务表和未来版本会拒绝启动。
- 旧库升级前通过 SQLite `VACUUM INTO` 生成独立一致性备份，放在 `<library.sqlite>.backups`；备份失败时不开始迁移。
- 整个升级序列和版本号在一个事务内提交；失败回滚，成功后执行 `foreign_key_check` 与 `quick_check`。
- 迁移失败会关闭数据库、停止创建主窗口，并显示原库及备份恢复路径。
- 增加 `npm run test:migrations` 与 14 项迁移回归测试；更新数据库维护和人工恢复规则。

### 测试结果

- `npm install`：成功；Node 24.14.0 不符合项目声明的 Node 22.x，依赖审计为 16 项（3 moderate、11 high、2 critical）。
- `npm run lint`：失败，项目仍未定义 `lint` script。
- `npm run build`：通过。
- Electron Node 兼容模式迁移测试：14/14 通过，实际加载 Electron ABI 130 的 `better-sqlite3`。
- Electron Node 兼容模式完整测试：198/200 通过；2 项既有 T01 repository 断言失败（候选项随机 id 顺序、目录统计期望与当前父目录聚合语义不一致），不属于 T04 schema/迁移失败。
- 标准 `npm test`：153/200 通过，47 项被 Node ABI 137 与 binding ABI 130 不匹配阻塞；其中包含 14 项新迁移测试。
- `npm rebuild better-sqlite3`：失败；Node 24 无预构建包且本机缺少 Visual Studio C++ workload。
- `npm run rebuild:electron`：通过，桌面端 binding 已恢复。

### 需要人工验证

- 在脱敏的真实旧用户数据库副本上演练首次接管和 v1–v4 升级，对账视频、目录、收藏、缺失、待删除和播放历史。
- 在真实用户数据目录确认错误框路径、备份可恢复及 WAL 模式下的一致性。
- 模拟真实磁盘满、ACL 只读、杀毒软件占用和意外断电；自动测试目前以故障注入覆盖备份失败和每步事务回滚。

### 新风险与回滚

- 首次打开旧库会增加一次完整数据库备份的磁盘占用和启动耗时；这是升级安全成本，磁盘空间不足时会安全拒绝迁移。
- 识别规则有意保守；非官方手工改过的 schema 可能被拒绝，需要先备份并人工诊断，不能放宽为盲目 ALTER。
- 若需回滚应用版本，应先恢复升级前备份；旧版本程序不能保证理解 `user_version=4` 的数据库。

## 2026-07-23 — T05：固定 Node/Electron native ABI 与完整测试工作流

### 修复的问题

- CR-005 / 阻断发布：同一工作目录反复在 Node ABI 与 Electron ABI 之间 rebuild，导致 `npm test` 是否能加载 `better-sqlite3` 取决于最后一次操作。

### 修改内容

- 固定 Node 22.23.1 与 npm 10.9.8；同步 `engines`、package manager、Volta、`.nvmrc`、`.node-version` 和 lockfile。
- 新增严格 `preinstall`/`verify:environment`，错误版本快速失败并给出 Windows 恢复命令，明确禁止删除用户数据库。
- 拆分 `test:node`、`verify:native:node`、`rebuild:electron`、`verify:native:electron`、`test:electron-smoke` 和 `prepare:electron`。
- Node native smoke 与 Electron smoke 都会创建临时 SQLite，执行建表、写入、查询和关闭；Electron smoke 额外等待真实 `app.whenReady()`。
- Electron rebuild 使用受控脚本，EPERM/文件占用失败时提示关闭相关进程，不自动删除 `.node` 或用户数据。
- `dev:electron` 改为先验证现有 Electron binding，不再每次启动隐式 rebuild。
- 新增 typecheck 型 `lint` 门禁、环境检查单测和工作流脚手架断言。
- 文档要求 Node tests、Electron smoke、packaged build 使用独立 checkout/job，并定义含 OS、Node、npm、Electron、lockfile hash 和 ABI target 的 cache key。

### 测试结果

- 官方 Node 22.23.1 Windows zip SHA-256 与发布清单一致；内置 npm 为 10.9.8。
- 当前系统 Node 24.14.0/npm 11.9.0：环境检查按预期拒绝。
- 固定环境 `npm install`：成功，`preinstall` 版本检查通过。
- 固定环境 `npm ci`：成功；审计仍为 16 项（3 moderate、11 high、2 critical）。
- Node native smoke：通过，ABI 127，临时 SQLite 读写成功。
- `npm run lint`：通过。
- `npm run build`：通过。
- 独立临时 Node checkout 完整测试：201/203 通过；剩余 2 项为既有 T01 repository 断言差异，没有 ABI 加载失败。
- `npm run rebuild:electron`：通过，Electron 33.4.11 / ABI 130。
- `npm run test:electron-smoke`：通过，真实 Electron `app.whenReady()` 与临时 SQLite 读写成功。

### 需要人工或后续验证

- 在全新 Windows checkout 按文档分别建立 Node 和 Electron 两个工作目录，确认无本机 npm cache 偶然影响。
- T01 的 2 项 repository 失败需在其任务范围复核：推荐保留项排序不稳定、父目录目录统计语义与测试期望不一致。
- packaged app 的独立 ABI rebuild、安装器和 smoke 属于 T06。

### 新风险与回滚

- 严格版本检查会拒绝其他 Node 22 patch 或 npm 版本；这是可复现构建的有意约束，升级必须一次性更新所有版本入口。
- Electron checkout 转换 ABI 后不能再运行 Node Vitest；误用会由 native smoke 快速报错，不影响用户数据库。

## 2026-07-23 — T06：建立 Windows CI、NSIS 制品与发布冒烟门禁

### 修复的问题

- CR-007：项目缺少可重复的 Windows PR 自动检查，TypeScript、完整 Node 测试、native ABI 和危险文件操作回归不能稳定阻止合并。
- CR-008：原 `package` 只生成 unpacked 目录，没有真实 NSIS、安装后运行验证、校验和、构建元数据或签名发布约束。

### 修改内容

- 新增独立 Windows Node、Electron smoke、dependency review jobs；每个 ABI 使用独立 checkout/cache key。
- 新增 Windows release workflow：unpacked 审计与 smoke、NSIS、安装器 smoke、SHA-256、构建元数据、artifact 和签名 tag release。
- 打包启用 asar 并只解包 better-sqlite3、ffmpeg、ffprobe 必需文件；产物检查拒绝 `.env`、测试、SQLite、`.dbg` 和本机工作区路径。
- packaged smoke 使用隔离 userData 两次启动：首次验证 preload、SQLite、临时视频扫描、自定义协议实际读取和静态媒体工具；第二次验证数据库可重新打开。
- unsigned 测试构建明确关闭签名/资源编辑并标记 `unsigned-test-build`；tag 构建缺少证书 secrets 时失败。
- 新增 npm 与 GitHub Actions Dependabot；发布和 branch protection 维护规则写入文档。
- 未修改业务 UI、数据库结构或用户文件操作。

### 测试结果

- Node 22.23.1/npm 10.9.8：`npm install --package-lock-only`、隔离副本 `npm ci`、`npm run lint`、`npm run build` 均通过。
- Windows 文件操作回归 26/26 通过。
- 完整 Node 测试 202/204 通过；2 项仍为 T01 已知 repository 断言差异，CI 不使用 `continue-on-error`，会如实阻断。
- Electron 33.4.11 / ABI 130 rebuild 和主进程 smoke 通过。
- `package:dir`、asar 制品审计和两阶段 packaged smoke 通过。
- `dist:win` 生成 NSIS；校验和、unsigned 构建元数据和静默安装—运行—卸载 smoke 通过。
- 依赖审计仍有 16 项（3 moderate、11 high、2 critical）。

### 需要人工或后续验证

- workflow 首次推送并产生真实 check 后，由管理员配置 branch protection；本机无 `gh` CLI，未修改远端仓库规则。
- 使用真实 Windows 代码签名证书验证签名、时间戳、SmartScreen 属性和 tag GitHub Release。
- 在没有 Node/开发工具的全新 Windows VM 完成安装、启动、导入、播放、升级与卸载手测。
- T01 两项 repository 测试差异需单独处理，否则完整 Node CI 将保持红色。

### 新风险与回滚

- CI 会在既有两项失败修复前阻止合并，这是故意的门禁结果，不应通过跳过测试规避。
- unsigned 与 signed 构建走不同的签名分支；正式发布前必须验证证书分支，unsigned 产物不能外发为正式版本。
- 打包脚本和 smoke 只使用系统临时目录及 `release/`，不读取或修改真实用户资料库和视频。

## 2026-07-24 — T07：加固 Electron 窗口、导航和 IPC 信任边界

### 修复的问题

- CR-006 / P2：生产 renderer 没有 CSP，窗口没有统一导航/新窗口限制，高权限 IPC 不校验 WebContents、顶层 frame、窗口角色或当前 URL。

### 修改内容

- 新增生产与开发分离的 CSP；生产脚本只允许 self，不包含 inline/eval/data/远程脚本，保留 `local-video:` 媒体所需最小来源。
- 主窗口、播放器和 packaged smoke 窗口统一登记入口 URL与角色；外部导航被阻止，`window.open` 默认拒绝。
- 主窗口、播放器显式保持 `contextIsolation=true`、`nodeIntegration=false`，并增加 `sandbox=true`。
- preload 在暴露 bridge 前再次核验当前页面入口；播放器仅暴露播放所需读取、单视频收藏/标记/删除、外部播放和历史接口，不暴露批量操作、移动、重命名、目录写入、设置写入或清缓存。
- 所有 IPC handler 经过统一可信 sender wrapper；校验 WebContents ID、角色、顶层 senderFrame、frame 存活状态和 URL。
- 未授权调用稳定返回 `ERR_UNTRUSTED_IPC_SENDER`；拒绝日志不记录 file 路径、URL path/query 或视频路径。
- packaged smoke 增加真实 CSP 注入、外部导航、新窗口、最小 bridge 和非入口页面无 bridge 验证。
- 未修改业务 UI、数据库结构、重复项规则或文件事务。

### 测试结果

- 安全策略与 IPC 契约定向测试 8/8 通过。
- `npm install`、`npm ci`、`npm run lint` 和 `npm run build` 在 Node 22.23.1/npm 10.9.8 隔离副本通过。
- 完整 Node 测试 209/211 通过；2 项仍为既有 T01 repository 断言差异，安全测试全部通过且无 ABI 失败。
- Electron 33.4.11 / ABI 130 rebuild 与主进程 smoke 通过。
- 真实 packaged smoke 通过：inline/data script、外部导航和 `window.open` 均被阻止；非入口页面无 bridge；SQLite、媒体协议、ffmpeg/ffprobe 和数据库重开未回归。
- 依赖审计仍为 16 项（3 moderate、11 high、2 critical）。

### 需要人工或后续验证

- 在桌面开发模式验证 Vite HMR；开发 CSP 有意允许 Vite React refresh 所需 inline script，但不允许 eval。
- 使用真实主窗口和独立播放器手测收藏、标记待删除、单视频删除、外部播放和播放历史，确认角色收缩没有遗漏播放器必需接口。
- CSP violation 与安全拒绝目前只写脱敏 console；结构化持久日志属于 T10。
- 一次性主进程确认 token 尚未实现；若未来引入网页、插件或远程内容，扩大攻击面前必须补充。

### 新风险与回滚

- 新增 IPC channel 若未加入播放器允许表，会在播放器中安全拒绝；维护者需显式评估角色，而不能放宽为全部允许。
- 入口路径、开发 origin 或 Vite 资源策略变化可能触发 CSP/导航拒绝；应更新安全策略与 packaged smoke，不能加入宽泛生产例外。
- 安全校验失败时操作不会执行，不触碰用户文件或数据库；回滚代码时不能只移除 sender 校验而保留宽泛 preload。

## 2026-07-24 — T08：实现有界媒体缓存与清理并发安全

### 修复的问题

- CR-009：原预览缓存无容量或年龄边界，图片生成直接写最终文件，手动清理与在途生成/退出并发时可能留下部分图片、旧任务重新登记或数据库缓存引用失效。

### 修改内容

- 新增独立 `MediaCacheManager`，默认总上限 10 GiB、封面 2 GiB、时间轴 8 GiB、最大年龄 365 天；TTL 至少保留最近 200 张封面和 2,000 张时间轴帧，容量限制优先。
- 使用文件 `mtime` 实现近似 LRU，同一路径访问时间最多每 10 分钟写一次；自动维护最多每 5 分钟调度一次。
- FFmpeg 只写最终目录内带 `.video-manager-cache-` 标记的临时文件；非空校验通过后原子重命名，失败、磁盘满或权限拒绝不会发布部分输出。
- 手动清理递增 generation epoch、等待在途生成和读取结束，只删除应用专属 `covers`/`timeline`；旧 epoch 任务完成后不能发布或登记。
- 视频删除、重命名、批量移动、移除目录/记录和重复项清理后强制调度孤儿回收；缓存 key 由路径、大小和修改时间决定，文件版本变化后的旧 key 会异步回收。
- 启动时删除确定属于本应用的残留临时文件；停止时使在途 generation epoch 失效。
- SQLite 未新增表或字段。缓存文件被淘汰时只清除对应封面/时间轴引用并恢复 `pending`；手动清理重置全部可重建缓存状态，不删除视频记录。
- 设置页展示总量、分类用量、条目数、上限、自动清理和最近失败；手动清理返回删除数、释放空间和逐项失败。
- 自动/手动清理不读取、删除、移动或重命名源视频，也不触碰 Electron `Cache_Data`。

### 测试结果

- 缓存管理器与设置页定向测试 16/16 通过；覆盖超配额 LRU、TTL、访问时间写入节流、生成中清理、清理中退出、崩溃临时文件恢复、版本变化、`ENOSPC`、`EACCES`、清理失败报告、UI 失败反馈和 1,000 项性能。
- `npm install`、`npm ci`、`npm run lint`、`npm run build` 在官方 Node 22.23.1/npm 10.9.8 隔离副本通过；官方 zip SHA-256 为 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29`。
- 完整 Node 测试 224/226 通过；2 项仍为 T01 已记录的 repository 排序/目录聚合断言差异，缓存、协议、迁移和 renderer 测试均通过且无 ABI 失败。
- Electron 33.4.11 / ABI 130 rebuild 与主进程 smoke 通过。
- unpacked 制品审计通过（3,952 个 asar 条目，无禁止开发制品）；真实 packaged smoke 两阶段通过，SQLite、扫描、自定义媒体协议、preload、CSP、ffmpeg/ffprobe 和数据库重开均未回归。
- 依赖审计仍为 16 项（3 moderate、11 high、2 critical），未执行破坏性 `npm audit fix --force`。

### 需要人工或后续验证

- 用接近或超过 10 GiB 的真实长期缓存验证淘汰耗时、磁盘占用稳定性和 UI 状态刷新。
- 在真实低磁盘空间、只读 ACL、杀毒软件占用和清理期间关闭应用的场景验证失败提示与下次启动恢复。
- 在映射网盘离线时浏览已有资料库，确认源视频和缺失状态不受缓存维护影响；自动测试已证明 cache manager 没有源视频路径操作。
- 评估是否允许用户自定义总量/分类配额或按类型手动清理；本轮采用固定保守默认值，未增加设置 schema。

### 新风险与回滚

- 首次启动维护需要枚举已有 `media-cache`；1,000 项自动测试低于 10 秒，但数十万小文件仍需真实测量。
- LRU 采用节流 `mtime`，是近似顺序而非每次访问精确顺序；回滚淘汰策略时仍必须保留临时文件原子发布、generation epoch、专属目录边界和源视频不可触碰约束。
- 旧“手动清理前永久保留”行为被明确替换为有界长期缓存；365 天与较大配额降低命中率变化，但长期未访问预览可能被自动重建。

## 2026-07-24 — T09：限制播放器队列并建立多窗口同步

### 修复的问题

- CR-010：播放队列没有统一边界，完整业务状态进入 URL，复用播放器需要整页 reload。
- CR-011：主窗口与播放窗口没有统一、可恢复的实时同步协议，初始化竞态和 listener 泄漏缺少约束。

### 修改内容

- 统一 `MAX_PLAYER_QUEUE_ITEMS=300`；主进程对原始队列做边界校验、去重、选中项包含校验、数据库解析和磁盘缺失过滤。
- `PlayerWindowCoordinator` 持有进程内会话，播放器只加载固定 `?player=1` URL；窗口复用时通过会话快照切换，不再序列化完整队列或 reload。
- 增加带单调 sequence 的 `DomainEventBus`，在文件/数据库操作成功后发布视频更新/移除、收藏、播放历史和资料库重扫。
- preload 暴露类型化快照、会话选择和领域事件订阅；renderer 采用先订阅、后快照、按 sequence 丢弃旧事件的初始化顺序，并在 dispose 时精确移除 listener。
- 主窗口按当前资料库查询触发失效刷新；播放窗口重新读取当前会话，当前视频删除后选择下一条、无下一条时选择上一条。
- 未修改数据库结构、播放引擎或文件事务语义。

### 测试结果

- 官方 Node 22.23.1/npm 10.9.8 隔离副本中，`npm install`、`npm ci`、`npm run lint`、`npm run build` 通过。
- T09 及关联定向测试 69/69 通过；覆盖 0/1/300/301、重复项、选中项缺失、ready 前后事件、删除当前项、重复开关 listener 数量和订阅/快照竞态。
- 完整 Node 测试 234/236；两项仍为 T01 已记录的 repository 排序/目录聚合断言差异，T09 未新增失败。
- Electron 33.4.11 / ABI 130 rebuild、主进程 smoke、`package:dir`、3,952 项 asar 制品审计和两阶段 packaged smoke 通过。
- `npm ci` 仍报告 16 项依赖审计问题（3 moderate、11 high、2 critical），未执行破坏性的 `npm audit fix --force`。

### 需要人工验证

- 真实主窗口与播放窗口中连续收藏/取消、标记待删除、永久删除、播放历史、快速上一条/下一条和资料库重扫。
- 操作发生在播放器首次显示前、关闭重开和当前视频被外部删除时的视觉稳定性。
- 300 条真实视频队列的切换延迟、内存和失效刷新范围。

### 新风险与回滚

- 领域事件是进程内瞬时通知，应用完全退出后不会恢复上次播放队列；这属于本任务明确边界。
- 新事件必须在业务成功后发布，并保持“先订阅、后快照、sequence 去重”协议，否则会重新引入丢事件或重复刷新。
- 回滚 UI 时不能恢复在 URL 中携带业务 ID/完整队列，也不能放宽 300 条主进程校验。

## 2026-07-25 — T10：增加结构化日志、错误分类和诊断导出

### 修复的问题

- CR-012：扫描、SQLite、ffmpeg、native module 和文件操作缺少可串联、持久化、可脱敏的诊断证据。
- 当前代码额外存在遗留调试块，会把视频路径、ffprobe stdout、播放器尺寸和时间轴预览 URL 发送到本机 `127.0.0.1:7777`；这与“不上传、最小披露”边界不一致。

### 修改内容

- 新增 `src/main/logging`：JSONL 结构化事件、operation ID、同步写盘前脱敏、稳定错误码、5 MiB × 5 文件轮转和 14 天保留。
- 路径只保留本地/网络类别、扩展名和不可逆短哈希；token、secret、password、authorization、cookie、环境变量值、URL 密钥和 Error stack 中的路径均脱敏。
- 日志写入失败不会改变业务结果；logger 记录不可写状态，诊断检查显示稳定错误码。
- IPC 写操作统一记录 started/completed/failed；批量结果只记录计数摘要，不记录完整参数、成功项或视频路径。
- 扫描、FFprobe、缓存维护、安全拒绝、启动、uncaught exception 和 unhandled rejection 接入结构化日志。
- 设置页增加 main-only 诊断预览和 JSON 导出。默认不披露完整应用目录；显式切换后必须重新预览。视频、源文件名/路径、数据库正文、token 和环境变量值始终排除。
- 移除 `metadataService.ts` 和 `PlayerPage.tsx` 向本机调试服务发送路径、ffprobe 输出、播放器尺寸及预览 URL 的代码；未修改 ffprobe 命令/解析、播放器旋转或时间轴失败降级。
- 未新增第三方日志或压缩依赖，未修改数据库结构和文件事务逻辑。

### 测试结果

- 官方 Node 22.23.1/npm 10.9.8 zip SHA-256 为 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29`。
- 隔离副本 `npm install`、`npm ci`、`npm run lint` 和 `npm run build` 通过。
- T10 定向测试 42/42 通过；清除全部调试请求后的日志、设置、元数据及播放器关联测试 48/48。覆盖脱敏、轮转/保留、日志目录不可写、九类错误映射、批量摘要、诊断白名单、IPC 契约、安全角色、设置页预览授权和播放器回归。
- 完整 Node 测试 250/252；两项仍为 T01 已记录的 repository 排序/目录聚合断言差异，T10 未新增失败。
- Electron 33.4.11 / ABI 130 rebuild 与主进程 smoke 通过。
- `package:dir`、3,959 项 asar 制品审计和两阶段 packaged smoke 通过；制品实际创建结构化日志，播放器 preload 未暴露诊断接口。
- 当前 `npm install`/`npm ci` 报告 19 项依赖审计问题（3 moderate、14 high、2 critical）；本轮未修改依赖，也未执行破坏性的 `npm audit fix --force`。

### 需要人工验证

- 在真实设置页预览并导出诊断包，分别验证默认模式和显式包含完整应用目录模式。
- 使用只读日志目录、被占用日志文件、低磁盘空间和接近 25 MiB 的滚动日志验证失败提示与业务不中断。
- 触发真实网络盘离线、文件占用、SQLite locked、ffprobe timeout 和启动迁移失败，确认 operation ID、错误码与用户提示可对应。
- 人工触发未捕获异常/拒绝的提示窗口和安全退出路径。

### 新风险与回滚

- 同步 JSONL 写入位于主进程；当前只记录低频写操作与失败边界，并有容量上限，但真实低速系统盘延迟仍需测量。
- 用户显式勾选后，诊断包会包含应用 userData、数据库、缓存和日志目录；UI 已警告并要求重新预览，但支持人员仍应按敏感文件处理。
- 原生模块若在 ESM 静态导入阶段、logger 初始化之前即失败，应用内日志可能来不及创建；固定 ABI 脚本和诊断环境元数据仍是该场景的主要证据。
- 回滚 UI 或诊断字段时不得恢复原始路径日志、完整 IPC 参数、逐条批量成功日志或任何自动上传行为。

## 2026-07-25 — T11：完善仓库忽略规则并移除未使用依赖

### 修复的问题

- CR-013：仓库只忽略构建目录，缺少环境文件、SQLite/WAL/SHM、日志、覆盖率、临时文件和 IDE/系统元数据规则。
- CR-014：依赖清单保留未被代码使用的旧 Electron 远程桥接包，扩大安装和安全审计范围。
- 已跟踪调试记录含真实样例盘符、目录和视频文件名；不是凭据，但不应继续作为维护文档中的默认示例。

### 修改内容

- 扩展 `.gitignore`，覆盖本地环境文件（保留 `.env.example` 例外）、运行时数据库及迁移备份、日志、coverage、临时/备份文件和常见 Windows/macOS/IDE 元数据。
- 代码检索确认旧 Electron 远程桥接能力没有 import、require 或初始化；通过 npm 卸载更新 `package.json` 和 lockfile，并同步移除历史计划及任务文档中的过时声明。
- 当前应用不加载 `.env` 文件，因此没有创建无实际契约的 `.env.example`；README 记录未来模板只能包含占位符。
- README 增加仓库卫生规则，明确 Electron `userData`、测试临时目录、凭据轮换和 Git 历史清理边界。
- 将调试记录中的真实样例路径和视频名替换为虚构占位符；没有删除调试结论，也没有改写 Git 历史。
- 未修改业务代码、数据库结构、文件操作或 UI。

### 测试结果

- 官方 Node 22.23.1/npm 10.9.8 隔离副本中，`npm install --include=dev`、`npm run lint` 和 `npm run build` 通过。
- 忽略规则模拟通过：`.env`、数据库/WAL、日志、coverage、临时和 IDE 文件被忽略，`.env.example` 可提交；`git ls-files` 未发现已跟踪运行时文件。
- 全仓源码与文档检索没有旧远程桥接包引用；高置信凭据模式扫描为 0。
- 完整 Node 测试 250/252；两项仍为 T01 已记录的 repository 排序/目录聚合断言差异，T11 未新增失败。
- Electron 33.4.11 / ABI 130 rebuild、native smoke 和主进程 smoke 通过。
- 生产依赖审计为 1 high、0 critical，路径是 `electron-store → conf → ajv → fast-uri`；全依赖审计为 20 项（3 moderate、15 high、2 critical）。

### 需要人工或后续验证

- 优先验证生产传递漏洞的非主版本 lockfile 更新，随后重跑 Node、Electron 和打包 smoke。
- 将 Electron、Vitest、Vite、React、better-sqlite3 等主版本升级拆成独立任务，逐项处理 ABI、Electron 安全边界和测试兼容性。
- 若维护者认为旧提交中的样例路径或视频名属于敏感信息，再单独评估 Git 历史清理；当前没有凭据需要轮换。

### 新风险与回滚

- 新增通配忽略规则可能让维护者误以为运行时文件已从历史消失；实际只对未来未跟踪文件生效。
- 删除的依赖没有任何代码调用，且 build/Electron smoke 已通过，未观察到功能风险；若未来确需类似能力，应通过最小 preload/IPC 契约实现，不能恢复宽泛远程桥接。
- 依赖审计结果会随公告数据库变化；本轮没有为了降低数字执行破坏性 `npm audit fix --force`。

## 2026-07-25 — T12：建立全链路 Windows 数据安全与发布回归门禁

### 修复的问题

- CR-001–CR-008 的自动测试分散在多个命令，release workflow 可以在没有完整 Node 数据安全回归的情况下直接进入打包。
- 缺少统一的合成资料库、WAL/并发锁、磁盘满、真实微型媒体和大资料库性能门槛。
- NSIS smoke 只验证一次安装和运行，没有覆盖重复安装/升级基线，也没有证明卸载不改变数据库或源视频。
- 完整 Node 测试长期存在两个 repository 失败，发布门禁无法全绿。
- 真实 Windows 故障与签名发布缺少日期、环境、证据和负责人签字模板。

### 修改内容

- 新增 `test:windows-files`、`test:release-performance` 和统一 `test:release-gate`；Windows CI 和 release workflow 均强制调用统一入口。
- release workflow 在打包前增加生产依赖审计；失败不会被忽略。
- 合成资料库在系统临时目录生成完全相同内容、同大小不同内容、同名冲突，以及由 bundled FFmpeg 创建并由真实 FFprobe 读取的微型 MP4。
- 文件事务新增跨卷复制中 `ENOSPC` 回归：源文件必须保留，目标目录不得留下部分文件。
- 数据库迁移新增 WAL 已提交数据备份和并发写锁测试；旧 schema 被锁时拒绝修改。
- 性能门禁增加 10,000 条普通分页和 2,000 文件重复组，连同既有 1,000 项缓存与 300/301 播放队列测试执行。
- 修正两项测试准备/预期错误：显式设置收藏并同时断言文件名稳定顺序与收藏推荐；递归父目录统计按两组、16,000 bytes 断言。未修改 repository 实现或降低删除安全验证。
- installer smoke 增加同一候选安装包的第二次安装、强制存在 uninstaller、沙箱 APPDATA，以及数据库/源视频哨兵在升级和卸载后的逐字节检查。
- 新增 `docs/windows-release-checklist.md`，所有不能可靠自动化的物理/网络/签名场景默认标记“发布阻断”。
- 未修改业务代码或数据库 schema。

### 测试结果

- 官方 Node 22.23.1/npm 10.9.8 环境中，`npm install`、`npm ci`、lint、build 和统一发布门禁通过。
- Windows 文件安全 35/35、迁移 16/16、性能门禁 19/19；完整 Node JSON report 为 32 文件、258/258。
- Electron 33.4.11 / ABI 130 rebuild、native/main smoke 通过。
- `package:dir`、3,936 项 asar 审计和两阶段 packaged smoke 通过。
- unsigned NSIS、release metadata、首次安装—同包升级/修复—卸载 smoke 通过；数据库和源视频哨兵未改变。
- `npm audit --omit=dev` 返回 1，仍有 `fast-uri` 的 1 个 high 生产传递漏洞。

### 需要人工或后续验证

- 处理生产传递漏洞，或由安全负责人以明确截止日期签署风险接受；当前 Release workflow 会阻断。
- 按发布验收单完成真实跨物理卷、NTFS ACL、外部独占锁、物理磁盘满和 SMB/映射盘断线。
- 使用上一正式签名版本执行真正跨版本升级；同包第二次安装只覆盖 repair/overwrite 基线。
- 在无开发工具的干净 Windows VM 验证签名、时间戳、SmartScreen、重启和卸载，并由开发、测试、数据安全、发布负责人签字。

### 新风险与回滚

- `test:release-gate` 有意重复执行部分定向测试和完整套件，CI 时间增加，但可以保留具名安全矩阵并防止只跑部分测试。
- 10 秒性能阈值是防止数量级退化的 CI 上限，不是桌面 UX SLA；真实 10 万条和大型 SMB 仍需采样。
- 微型 MP4 测试依赖 bundled FFmpeg 的 `lavfi`/`mpeg4` 能力，失败应作为媒体工具打包/安装问题处理，不能替换成伪造字节绕过。
- 当前 release workflow 会被已知生产审计 high 阻断，这是预期安全门禁；不得通过删除 audit step 或 `continue-on-error` 回滚。

### T12 收尾：关闭生产依赖审计阻断

- `package-lock.json` 中的传递依赖 `fast-uri` 由 3.1.3 升至同主版本补丁 3.1.4，修复 `GHSA-v2hh-gcrm-f6hx`；未修改直接依赖、数据库结构或业务代码。
- 固定 Node 22.23.1/npm 10.9.8 的隔离副本实际安装到 `fast-uri 3.1.4`，`npm audit --omit=dev` 为 0。
- lint、build、Windows 文件安全、迁移、性能基线及完整 Node 测试通过；JSON 结果为 32 个测试文件、258 个测试、0 失败。
- Electron 33.4.11/ABI 130 smoke、3,934 项 asar 审计、packaged smoke、unsigned NSIS、release metadata 和安装器升级/卸载哨兵测试通过。
- 首次两次在线 `npm ci` 均在 `ffmpeg-static` GitHub 二进制下载处超时；最终用 `npm ci --ignore-scripts` 完成确定性依赖解析，并复用已验证的同版本 Electron/FFmpeg 二进制、单独重建 `better-sqlite3` 后完成全部验证。该记录是网络环境限制，不是依赖补丁回归。
- 全依赖审计仍有开发工具链历史项（3 moderate、14 high、2 critical），不得执行破坏性的 `npm audit fix --force`；应另开兼容性升级任务。
- 仍需人工验证真实跨物理卷、ACL/独占锁、物理磁盘满、SMB 断线、上一正式签名版本升级、代码签名/时间戳/SmartScreen 和干净 Windows VM，因此仍不得标记为正式发布就绪。

## 2026-07-25 — 打包程序启动白屏修复

- 修复 Vite 生产构建默认生成 `/assets/...` 绝对资源路径的问题；Electron 使用 `file://` 加载打包页面时会错误访问磁盘根目录，导致脚本和样式未加载、窗口白屏。
- `vite.config.ts` 现在使用 `base: "./"`，打包后的脚本和样式路径为 `./assets/...`，开发服务器行为不变。
- packaged smoke 新增 `rendererMounted` 门禁，必须在 5 秒内观察到 React 向 `#root` 挂载内容；此前测试只验证 preload/CSP，无法发现“窗口加载成功但应用未渲染”。
- 桌面快捷方式继续直接启动 `release/win-unpacked/Local Video Manager.exe`，不依赖本机 Node/npm。
- scaffold 6/6、production build、重新生成 unpacked 包和 packaged smoke 通过；真实用户资料库主窗口成功创建并响应。
