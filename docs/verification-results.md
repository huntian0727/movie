# 验证结果记录

## 2026-07-22 播放器删除与待删除视图

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 播放器按钮删除、`Ctrl+D`、Enter/Esc、待删除标记 | `PlayerPage` 20 项通过 | 通过（jsdom，不代表真实文件删除） |
| 主页面待删除筛选、取消标记、全部清空确认 | `LibraryShell` 30 项通过 | 通过 |
| `npm run build` | TypeScript 与 Vite production build | 通过 |
| SQLite 标记持久化、分页、统计、扫描后保留 | 新增仓储测试；25 个仓储用例均在加载原生模块前因 ABI 130/137 失败 | 被本机 ABI 阻塞，不是业务断言失败 |
| 旧用户数据库补列和跨重启保留 | 尚未使用旧库副本重启验证 | 需要验证 |
| 真实永久删除、占用/离线/权限失败、连续切换 | 尚未执行 Electron 桌面手测 | 需要验证 |

## 2026-07-18 普通资料库数据库分页

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| renderer 后端分页与原交互回归 | `LibraryShell` 等相关测试共43项通过，覆盖首次请求和下一页请求 | 通过 |
| IPC channel 契约 | 新增 page/navigation/missing/list-by-ids/remove-preview 后契约测试通过 | 通过 |
| 仓储分页、目录/收藏、按 id 顺序取数 | 测试代码已补充；Node 137 无法加载 ABI 130 的 better-sqlite3 | 待恢复 ABI 执行 |
| 现有实库只读基准 | 25,667条有效记录：COUNT+第一页100条约38.5ms；1,259个去重目录约19ms | 通过（仅 SQLite/Python，不代表 Electron 端到端） |
| `npm run build` | TypeScript 与 Vite production build | 通过 |
| 真实 Electron 菜单切换 | 尚未记录所有/收藏/最近/目录、深页和搜索的响应时间 | 需要验证 |

注意：第一轮记录中“普通列表仍在 renderer 筛选全库”是当时事实，已由本轮实现取代。

## 2026-07-17 左侧菜单性能第一轮

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 扫描状态等价判断 | 2 项测试覆盖忽略纯时间戳/顺序变化，并识别进度和状态变化 | 通过 |
| 资料库、重复项与缓存回归 | `LibraryShell`、`DuplicateGroupsPage`、`cacheService` 连同新测试共 41 项通过 | 通过 |
| 调试开销清理 | 目标封面组件和缓存服务中已无 `127.0.0.1:7777`/`debug-point` | 通过 |
| `npm run build` | TypeScript 与 Vite production build | 通过 |
| `git diff --check` | 无空白错误 | 通过 |
| 真实 25,646 视频资料库菜单对比 | 尚未在 Electron 窗口记录优化前后响应时间、帧率和扫描中表现 | 需要验证 |

本轮不包含普通资料库数据库分页；菜单切换仍会在 renderer 中筛选和排序全库，属于第二轮性能工作。

## 2026-07-16 持久预览缓存

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 专属缓存路径 | 单元测试验证 `userData/media-cache` 路径 | 通过 |
| 旧缓存迁移边界 | 单元测试验证迁移 `covers`、`timeline`，并保留旧目录中的 `Cache_Data` | 通过 |
| 真实用户目录首次迁移 | 尚未使用现有 `%APPDATA%\local-video-manager\Cache` 完成升级启动和图片命中检查 | 需要验证 |
| 手动清理与在途预览请求 | 尚未执行 Electron 桌面并发手测 | 需要验证 |

本轮命令结果：`npx vitest run tests/main/cacheService.test.ts` 共 9 项通过；`npm run build` 通过；`git diff --check` 通过。`npm test` 共 149 项，其中 120 项通过，29 项因现有 `better-sqlite3` ABI 130/137 不匹配而无法加载，失败集中在 `libraryScanner.test.ts` 和 `videoRepository.test.ts`，与本次缓存断言无关。

更新时间：2026-07-12。本文记录实际执行结果；未执行或无法完成的项目统一标为“需要验证”。

## 2026-07-16 大型网盘目录扫描

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 流式目录发现与无响应超时 | 7 项 `fileDiscovery` 测试通过，包括总耗时超过阈值但持续返回条目的场景 | 通过 |
| 不完整扫描保护 | 2 项无 SQLite stub 测试通过：子目录失败不 reconcile、根目录无响应返回 offline | 通过 |
| 扫描任务状态 | 2 项暂停/继续和离线状态测试通过 | 通过 |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| SQLite 扫描集成测试 | 当前 Node 需要 ABI 137，但 `better-sqlite3` 为 ABI 130 | 被本机 ABI 阻塞；不是本轮业务断言失败 |
| 真实大型映射网盘 | 尚未执行 | 需要验证 |

### 后台 FFprobe 队列增量验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 快速索引与延后分析 | scanner stub 验证新文件以 `pending`、空媒体字段入库，扫描结束前不进入 FFprobe 队列 | 通过 |
| 队列并发、去重、恢复、暂停与失败 | `metadataQueue` 4 项测试通过；固定单并发，重复 id 不重复执行，启动同步期间可暂缓队列 | 通过 |
| 文件版本保护 | repository 测试已补充 path/size/modifiedAt 条件更新；本机执行仍受 SQLite ABI 阻塞 | 代码与测试已补充，待恢复 ABI 验证 |
| renderer pending 展示 | “分析中”组件测试通过，pending 时不请求封面生成 | 通过 |

## 2026-07-16 重复项数据库分页

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 页面分页与按需加载 | DuplicateGroupsPage/LibraryShell 相关测试覆盖进入页面后首次查询、默认 20 组、翻页、每页数量和大小排序 | 通过 |
| 当前页清理语义 | 清理入口和确认文案明确限定当前页；删除完成触发当前查询刷新 | 通过 |
| SQLite 分页、统计与页码校正 | repository 测试已补充 11 组跨页、全局统计和大小排序 | 已补测试；本机执行仍被 better-sqlite3 ABI 阻塞 |
| `npm run build` | TypeScript 与 Vite production build | 通过 |
| 真实大重复库 | 尚未使用大量同尺寸视频验证滚动、IPC 体积和单个超大组 | 需要验证 |

## 2026-07-16 普通资料库分页与网格密度

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 每页数量与页码直达 | 组件测试覆盖 30/50/100/200/300、Enter 跳转、失焦跳转和越界校正 | 通过 |
| 左右键翻页 | 组件测试覆盖上一页/下一页及输入框事件隔离 | 通过 |
| 五档网格大小 | 组件测试覆盖 CSS 宽度变量、滑条/按钮和 localStorage 恢复 | 通过 |
| 响应式桌面布局 | 尚未在 Electron 窗口不同宽度下人工拖动验证列数和工具栏换行 | 需要验证 |

## 2026-07-15 网络盘与重复项增量验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| 相关 Vitest | IPC、元数据、重复项与资料库组件共 28 项通过 | 通过 |
| Electron ABI SQLite 冒烟（历史行为） | 当时验证了无内容指纹时按相同 `size_bytes` 成组；该危险行为已由 T01 安全修复废止，不能作为当前验收结论 | 历史记录；当前需重验 |
| Electron ABI 离线目录冒烟 | 成功扫描后移除测试目录，再扫描只记录错误，既有视频不标缺失 | 通过 |
| 真实映射网盘 | 尚未使用实际网速、断线和占位文件验证 | 需要验证 |
| 扫描任务管理器 | 暂停/继续、完成/离线状态及侧栏交互共 25 项相关测试通过 | 通过；单个 FFprobe 运行中不会被强制中断 |

## 自动检查

| 命令 | 环境/结果 | 结论 |
| --- | --- | --- |
| `npm run build` | TypeScript 主/渲染构建及 Vite production build 通过 | 通过 |
| `npm test` | 67 项通过，19 项数据库/扫描测试失败；`better-sqlite3` 为 `NODE_MODULE_VERSION 130`，当前 Node 需要 `137` | 被原生模块 ABI 阻塞，不可据此判定 19 项业务失败 |

## 2026-07-23 T02 安全移动验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| `npm install` | 成功；Node 24.14.0 与项目要求 Node 22.x 不符，审计为 16 项漏洞 | 安装完成，环境版本需修正 |
| `npm run lint` | `package.json` 未定义 `lint` script | 无法执行，需要后续构建任务补脚本 |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| T02 定向测试 | `fileOperations`、`LibraryShell`、IPC 契约共 54 项通过 | 通过 |
| `npm test -- --reporter=dot` | 150 项通过；33 项因 `better-sqlite3` Electron ABI 130 与当前 Node ABI 137 不匹配失败 | 非 SQLite 回归通过；数据库集成仍被环境阻塞 |
| 真实 Windows 跨卷/SMB | 尚未使用两个物理卷、文件锁、磁盘满和映射网盘验证 | 需要验证 |

## 2026-07-23 T03 Windows 安全重命名验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| `npm install` | 成功；Node 24.14.0 与项目要求 Node 22.x 不符 | 安装完成，环境版本需修正 |
| `npm run lint` | `package.json` 未定义 `lint` script | 无法执行 |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| T03 定向测试 | 文件事务、LibraryShell 与 IPC 契约共 57 项通过；文件测试包含 26 个重命名/移动/删除用例 | 通过 |
| `npm test -- --reporter=dot` | 153 项通过；33 项因 `better-sqlite3` ABI 130/137 不匹配失败 | 非 SQLite 回归通过；数据库集成仍被环境阻塞 |
| Windows 实机占用/ACL | 仅在 Windows 临时目录及失败注入中验证，尚未用外部程序锁文件或真实 ACL 验证 | 需要验证 |
| `npm rebuild better-sqlite3` | 未找到当前 Node 24.14 的预构建包，源码重编译阶段因 `EPERM unlink .../better_sqlite3.node` 失败 | 需要验证；疑似文件仍被 Electron/Node 进程占用 |
| `npm run rebuild:electron` | 2026-07-12 实际执行；`electron-rebuild -f -w better-sqlite3` 因 `EPERM: operation not permitted, unlink .../better_sqlite3.node` 失败 | 被文件占用阻塞，需要关闭持有该原生模块的进程后重试 |
| `git diff --check` | 文档差异无空白错误 | 通过 |

说明：`npm run rebuild:electron` 与直接执行的 `npm rebuild better-sqlite3` 均在同一 `better_sqlite3.node` 上遇到 EPERM；前者已在 2026-07-12 本轮复现。

## 恢复验证建议

1. 关闭应用、Electron 开发窗口、Vitest watch 和可能加载该 `.node` 文件的 Node/Electron 进程。
2. 确认项目要求的 Node 22.x；当前实际 Node 24.14 与 `package.json` 的 `engines.node` 不一致。
3. 面向 Node 测试执行 `npm ci` 或 `npm rebuild better-sqlite3`，随后重跑 `npm test`。
4. 面向 Electron 运行再执行 `npm run rebuild:electron`，然后启动 `npm run dev:electron`。
5. 若仍为 EPERM，用 Process Explorer/资源监视器定位持有 `better_sqlite3.node` 的进程；不要通过删除用户数据库解决 ABI 问题。

## 2026-07-23 T04 SQLite 迁移验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| `npm install` | 成功；Node 24.14.0 与项目要求 Node 22.x 不符；16 个依赖审计项 | 安装完成，T05 需固定工具链 |
| `npm run lint` | 项目没有 `lint` script | 无法执行，T05/T06 需补门禁 |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| 迁移定向测试（Electron Node 模式） | 14/14 通过 | 空库、无版本库、v1–v4、逐步回滚、备份、未知 schema 和幂等均通过 |
| 完整测试（Electron Node 模式） | 198/200 通过 | 2 项既有 T01 repository 断言失败；迁移与 scanner 测试通过 |
| 标准 `npm test` | 153/200 通过；47 项因 ABI 130/137 不匹配失败 | 被本机 Node ABI 阻塞，不是迁移 SQL 失败 |
| `npm rebuild better-sqlite3` | Node 24 无预构建包；缺少 Visual Studio C++ workload | 无法生成 ABI 137 binding |
| `npm run rebuild:electron` | 成功 | 已恢复 Electron ABI 130 桌面运行 binding |
| 真实旧用户库升级/恢复 | 尚未执行 | 需要验证 |
| 真实磁盘满、ACL 只读、断电 | 自动故障注入已覆盖安全回滚；物理场景未执行 | 需要验证 |

Electron Node 模式命令仅用于本机补充验证：设置 `ELECTRON_RUN_AS_NODE=1` 后，用项目 Electron 执行 Vitest。正式工作流仍应在 T05 中固定 Node 22 的 Node 测试环境，不能长期依赖这条替代命令。

## 2026-07-23 T05 Native ABI 工作流验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| Node 官方包 | 22.23.1 Windows x64 zip；SHA-256 `7DF0BC...09C29` 与官方清单一致；npm 10.9.8 | 固定工具链来源已验证 |
| 错误环境快速失败 | 系统 Node 24.14.0/npm 11.9.0 被 `verify:environment` 拒绝 | 通过 |
| 环境检查单测 | 3/3 通过；连同 scaffold 共 7/7 定向通过 | 通过 |
| 固定环境 `npm install` | Node 22.23.1/npm 10.9.8，`preinstall` 通过 | 通过 |
| 固定环境 `npm ci` | Node 22.23.1/npm 10.9.8，一次成功 | 通过；16 个依赖审计项仍待处理 |
| Node native smoke | ABI 127，临时 SQLite 建表/写入/查询/关闭成功 | 通过 |
| `npm run lint` | 两套 TypeScript `--noEmit` 通过 | 通过 |
| `npm run build` | TypeScript 与 Vite production build 通过 | 通过 |
| Node 完整测试 | 独立临时 checkout 中 201/203 通过；2 项既有 T01 repository 失败 | 无 ABI 失败；业务断言需另行复核 |
| Electron rebuild | Electron 33.4.11，ABI 130 | 通过 |
| Electron 主进程 smoke | `app.whenReady()` + 临时 SQLite 读写成功 | 通过 |
| packaged app ABI | 尚未执行 | T06 需要验证 |

本轮验证严格按 ABI 阶段执行：先 Node 安装/smoke/测试，随后转换为 Electron ABI；转换后没有在同一工作目录继续运行 Node Vitest。

## 2026-07-23 T06 Windows CI 与发布制品验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 固定环境与锁文件 | 官方 Node 22.23.1 zip SHA-256 `7DF0BC...09C29`；npm 10.9.8；`npm install --package-lock-only` 与隔离副本 `npm ci` 均成功 | 通过 |
| `npm run lint` | 独立 Node checkout 两套 TypeScript `--noEmit` 通过 | 通过 |
| `npm run build` | 独立 Node checkout 与 Electron 打包 checkout 均通过 | 通过 |
| Windows 文件操作回归 | `tests/main/fileOperations.test.ts` 26/26 通过 | 通过 |
| 完整 Node 测试 | 202/204 通过；2 项仍为 T01 既有 repository 断言差异，无 ABI 失败 | CI 会如实阻断，需在 T01 范围修正断言或实现 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130；真实 `app.whenReady()` 与临时 SQLite 成功 | 通过 |
| `package:dir` 与制品审计 | `win-unpacked` 生成成功；asar 3950 项，不含 `.env`、测试、SQLite、`.dbg` 或本机工作区路径 | 通过 |
| packaged smoke | 两阶段进程验证 app/preload/SQLite/扫描/自定义协议字节读取/ffmpeg/ffprobe；退出后数据库重开成功 | 通过 |
| `dist:win` | 生成 `Local-Video-Manager-0.1.0-x64-Setup.exe` 与 blockmap | 通过；本机构建为 unsigned test build |
| release metadata | 生成 SHA-256 校验和与 `build-metadata.json`，`releaseClass=unsigned-test-build` | 通过 |
| installer smoke | 静默安装到隔离临时目录，执行完整 packaged smoke，随后静默卸载且应用可执行文件消失 | 通过 |
| 依赖审计 | `npm ci` 报告 16 项：3 moderate、11 high、2 critical | 需要在 T11/依赖治理任务中逐项确认，禁止直接 `npm audit fix --force` |
| GitHub branch protection | 本机没有 `gh` CLI，新增 workflow 尚未推送并产生 check 名称 | 需要验证；首次推送并跑出 checks 后由仓库管理员配置 |
| 签名发布 | 未提供真实证书；tag workflow 已要求 `WINDOWS_CSC_LINK` 与 `WINDOWS_CSC_KEY_PASSWORD` | 需要验证；不能把 unsigned 构建当正式发布 |
| 干净无开发工具 Windows | 本次安装目标目录隔离，但宿主机仍有开发工具 | 需要验证；应在全新 Windows VM 执行安装与核心手测 |

本机首次 unsigned 打包曾因账户无“创建符号链接”权限，无法解包 electron-builder 签名工具中的 macOS symlink。构建脚本现仅在没有 `CSC_LINK`/`WIN_CSC_LINK` 时关闭 Windows 签名与可执行文件资源编辑；配置证书后不会应用此豁免。正式签名链仍须在 GitHub runner 或具备相应权限的 Windows 环境验证。

## 2026-07-24 T07 Electron 安全边界验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 安全策略定向测试 | `security.test.ts` 7/7；连同 IPC channel 契约共 8/8 | 通过 |
| 生产 CSP 静态策略 | script 仅 self；无 inline/eval/data/HTTP；媒体允许最小 `local-video:` | 通过 |
| 开发 CSP | Vite origin/WebSocket 单独允许；inline 仅开发期；无 eval | 自动策略测试通过；真实 HMR 需要人工验证 |
| 可信 URL | file 入口和固定 dev origin/path；仅 query/hash 可变化 | 通过 |
| 导航和新窗口 | 单元测试及真实 packaged renderer 均阻止外部导航和 `window.open` | 通过 |
| IPC sender | 错误 WebContents、伪造子 frame、错误 URL、播放器调用主窗口批量删除均稳定拒绝 | 通过 |
| preload 最小化 | 无通用 invoke；播放器/ smoke bridge 不含批量删除、移动、重命名、设置写入和清缓存 | 通过 |
| 非入口页面 bridge | 测试窗口故意绕过导航 helper 加载 `data:` 页面，preload 不暴露 `videoManager` | 通过 |
| `npm install` / `npm ci` | Node 22.23.1/npm 10.9.8 隔离副本均成功 | 通过；仍报告 16 个依赖审计项 |
| `npm run lint` / `npm run build` | 隔离 Node checkout 均通过 | 通过 |
| 完整 Node 测试 | 209/211 通过；2 项为既有 T01 repository 断言差异 | 安全测试无失败、无 ABI 失败 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130，主进程启动成功 | 通过 |
| packaged security smoke | inline/data script、外部导航、window.open 被阻止；原有 SQLite/协议/媒体工具/数据库重开仍通过 | 通过 |
| 真实播放器角色手测 | 尚未人工点击独立播放器全部允许操作 | 需要验证 |

安全拒绝输出仅包含窗口角色和脱敏协议/origin。本轮实际日志未包含测试 URL 的 path、query 或本地文件路径。

## 2026-07-24 T08 有界媒体缓存验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 官方 Node 运行时 | Node 22.23.1/npm 10.9.8；zip SHA-256 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29` | 与项目固定工具链一致 |
| `npm install` / `npm ci` | 独立临时副本均成功；审计 16 项（3 moderate、11 high、2 critical） | 安装通过；依赖风险仍待 T11/专项治理 |
| `npm run lint` | Node 22 独立副本的两套 TypeScript `--noEmit` 通过 | 通过 |
| `npm run build` | Node 22 独立副本及 Electron 工作树均通过 | 通过 |
| 缓存/设置定向测试 | 16/16 通过 | 覆盖 LRU、访问节流、TTL、并发清理、退出、故障和状态 UI |
| 大量缓存项 | 1,000 个合成条目维护测试约 1 秒内完成，最终稳定在 500 B 测试配额 | 自动性能门槛通过；真实数十万条仍需验证 |
| 完整 Node 测试 | 224/226 通过；2 项为既有 T01 repository 排序/目录聚合断言差异 | T08 无新增失败、无 ABI 阻塞 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130，主进程 `app.whenReady()` 与 SQLite smoke 通过 | 通过 |
| unpacked 制品审计 | 3,952 个 asar 条目；无 `.env`、测试、SQLite 或本机路径等禁止制品 | 通过 |
| packaged smoke | 两阶段启动；SQLite、扫描、自定义协议、preload/CSP、ffmpeg/ffprobe、退出后数据库重开均通过 | 通过 |
| 真实 10 GiB/低磁盘/ACL | 尚未建立物理大缓存、磁盘满或真实权限拒绝环境 | 需要验证 |
| 映射网盘离线 | cache manager 自动测试仅使用应用临时缓存，未操作源文件；真实离线盘未手测 | 需要验证 |

补充说明：系统默认 Node 24.14.0/npm 11.9.0 直接运行 Electron smoke 会被项目环境门禁按预期拒绝。本轮 Node 测试始终在独立副本使用 ABI 127；原工作树随后恢复并验证 Electron ABI 130，未在同一 `node_modules` 中混跑两种 ABI。

## 2026-07-24 T09 播放器队列与多窗口同步验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 官方 Node 运行时 | Node 22.23.1/npm 10.9.8；zip SHA-256 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29` | 与项目固定工具链一致 |
| `npm install` / `npm ci` | 隔离临时副本均成功；审计 16 项（3 moderate、11 high、2 critical） | 安装通过；依赖风险留待 T11/专项治理 |
| `npm run lint` / `npm run build` | Node 22 隔离副本均通过 | 通过 |
| T09 定向测试 | 69/69；覆盖 0/1/300/301、去重、选中项缺失、ready 前后事件、当前项删除、listener 释放和订阅/快照竞态 | 通过 |
| 完整 Node 测试 | 234/236；两项为 T01 已记录 repository 排序/目录聚合断言差异 | T09 无新增失败 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130，主进程与 SQLite smoke 成功 | 通过 |
| unpacked 制品审计 | `package:dir` 成功，asar 3,952 项 | 通过 |
| packaged smoke | 两阶段启动、preload、SQLite、协议、CSP、ffmpeg/ffprobe 和数据库重开通过 | 通过 |
| 真实双窗口快速操作 | 尚未连续验证收藏、待删除、永久删除、播放历史、快速切换和资料库重扫 | 需要验证 |
| 真实 300 条队列 | 尚未测量切换延迟、内存和窗口关闭重开体验 | 需要验证 |

## 2026-07-25 T10 结构化日志与诊断验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 官方 Node 运行时 | Node 22.23.1/npm 10.9.8；zip SHA-256 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29` | 与项目固定工具链一致 |
| `npm install` / `npm ci` | 隔离临时副本均成功；审计 19 项（3 moderate、14 high、2 critical） | 安装通过；依赖风险留待 T11/专项治理 |
| `npm run lint` / `npm run build` | Node 22 隔离副本均通过 | 通过 |
| T10 定向测试 | 42/42 | 脱敏、轮转、不可写恢复、错误码、批量摘要、诊断白名单、IPC/角色和 UI 通过 |
| 完整 Node 测试 | 250/252；两项为 T01 已记录 repository 排序/目录聚合断言差异 | T10 无新增失败 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130，主进程与 SQLite smoke 成功 | 通过 |
| unpacked 制品审计 | `package:dir` 成功，asar 3,959 项，无禁止开发制品 | 通过 |
| packaged smoke | 两阶段启动、结构化日志实际创建、preload 最小化、SQLite、协议、CSP、ffmpeg/ffprobe 和数据库重开通过 | 通过 |
| 默认诊断隐私 | 自动测试确认无视频路径/文件名、数据库正文、token、环境变量值和完整用户目录 | 通过；真实导出文件仍需人工复核 |
| 只读/占用/磁盘满日志目录 | 自动失败注入确认 logger 不抛出且业务可继续；真实 ACL、占用和低磁盘未执行 | 需要验证 |
| 未捕获异常提示 | 代码已记录并对 uncaught exception 安全退出、unhandled rejection 提示继续使用 | 需要桌面验证 |

## 2026-07-25 T11 仓库卫生与依赖清理验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 固定环境安装 | 官方 Node 22.23.1/npm 10.9.8 隔离副本执行 `npm install --include=dev` 成功，lockfile 与工作树一致 | 通过 |
| 忽略规则模拟 | `.env`、`.env.local`、SQLite/WAL、日志、覆盖率、临时文件和 IDE/系统元数据均命中；`.env.example` 不被忽略 | 通过 |
| 已跟踪运行时文件 | `git ls-files` 未发现 `.env*`、数据库/WAL/SHM、日志或 coverage | 通过 |
| 环境变量模板 | 应用没有 `.env` loader 或项目级 `.env` 配置契约 | 不创建空模板；未来引入时只能提交占位符 |
| 旧远程桥接依赖 | 代码无 import/require/初始化；依赖和 lockfile 已移除，全仓源码与文档检索为 0 | 通过 |
| 高置信凭据扫描 | 未发现私钥头、AWS access key、GitHub token、Slack token 或 Google API key 模式 | 通过；不等同于完整秘密扫描 |
| 调试记录路径 | 当前版本中的真实样例盘符、目录和视频名已替换为虚构占位符 | 通过；旧提交仍保留原文本，未改写历史 |
| `npm run lint` / `npm run build` | Node 22 隔离副本均通过 | 通过 |
| 完整 Node 测试 | 250/252；两项为 T01 已记录的 repository 排序/目录聚合断言差异 | T11 无新增失败 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130，native binding 与主进程 `app.whenReady()` 成功 | 通过 |
| 生产依赖审计 | 1 high、0 critical；实际路径为 `electron-store → conf → ajv → fast-uri`，当前报告可用非 major 传递修复 | 需要单独升级、重装并完成全回归 |
| 全依赖审计 | 20 项：3 moderate、15 high、2 critical；直接开发依赖的建议修复涉及 Electron、Vitest、builder/rebuild 主版本 | 未执行 `npm audit fix --force` |
| `npm outdated` | React、Electron、Vitest、Vite、better-sqlite3 等存在主版本升级 | 需要拆分升级任务，不在仓库卫生任务中混入 |

补充说明：

- 忽略规则只阻止未来误提交，不能清除 Git 历史。当前未发现高置信凭据；若后续发现真实令牌，应先轮换，再由维护者评估历史清理和协作者重新同步。
- 本轮没有运行跨主版本自动修复。生产传递漏洞应优先验证 lockfile 级安全更新；Electron/Vitest 等主版本升级必须分别评估原生 ABI、CSP/IPC、打包与完整测试。
- 首次隔离安装曾因验证副本的空 `node_modules` 沿父目录解析到旧临时依赖而产生一次无效测试结果；清空并在副本内显式安装 629 个包后重新执行，以上表格仅记录有效结果。

## 2026-07-25 T12 Windows 数据安全与发布回归验证

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 官方 Node 运行时 | Node 22.23.1/npm 10.9.8；zip SHA-256 `7DF0BC9375723F4A86B3AA1B7CC73342423D9677A8DF4538ACA31A049E309C29` | 与固定工具链一致 |
| `npm install` / `npm ci` | 隔离副本均成功；确认 Electron executable 与 Node ABI better-sqlite3 binding 实际存在 | 通过；`npm ci` 的 FFmpeg 下载需等待子进程真正退出 |
| `npm run test:release-gate` | lint、build、Windows 文件矩阵、迁移、性能和完整 Node 测试全部执行 | 通过 |
| 完整 Node 测试 | JSON report：32 个文件、258/258，0 failed | 通过；此前两个 repository 断言已按实际收藏准备和递归统计契约修正 |
| Windows 文件安全 | 35/35 | 同/异内容、同名、完整 hash、版本变化、rename、EXDEV、EACCES/EBUSY/ENOSPC、离线/timeout 和真实微型 MP4/FFprobe |
| 数据库迁移 | 16/16 | 新库、v1–v4、unversioned、WAL 已提交数据备份、逐步失败、备份失败、未知 schema、并发写锁和幂等 |
| 性能门禁 | 19/19 | 10,000 条分页、2,000 条同指纹组、1,000 项缓存、300/301 播放队列均低于自动门槛 |
| Electron rebuild/smoke | Electron 33.4.11 / ABI 130；native binding、`app.whenReady()` 和临时 SQLite 成功 | 通过 |
| unpacked 制品 | `package:dir`、3,936 项 asar 审计 | 通过；无禁止开发制品 |
| packaged smoke | 两阶段启动；日志、SQLite、扫描、协议、CSP、最小 preload、导航/新窗口阻止、ffmpeg/ffprobe 和数据库重开 | 通过 |
| NSIS | `dist:win` 和 release metadata 成功 | 通过；仅 `unsigned-test-build`，不能正式发布 |
| installer smoke | 首次静默安装、同一候选包再次安装、packaged smoke、静默卸载；用户数据库与源视频哨兵前后逐字节一致 | 通过；不替代上一正式版本升级 |
| 生产依赖审计 | `npm audit --omit=dev` 返回 1：1 high、0 critical，传递路径 `electron-store → conf → ajv → fast-uri` | 发布阻断；workflow 会如实失败 |
| 真实物理/网络故障 | 跨物理卷、NTFS ACL、外部独占锁、物理磁盘满、SMB/映射盘断线未执行 | 需要验证并签字 |
| 正式发布环境 | 上一正式签名版本升级、真实代码签名、时间戳、SmartScreen 和无开发工具 VM 未执行 | 需要验证并签字 |

发布结论：**不得正式发布**。自动门禁与 unsigned 安装链已通过，但生产审计失败和 `docs/windows-release-checklist.md` 的真实 Windows 发布阻断项尚未获得证据与签字。不能把故障注入、同包升级或 unsigned smoke 标记为正式验收。

## 2026-07-25 T12 收尾：生产依赖审计修复

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 漏洞确认 | `GHSA-v2hh-gcrm-f6hx`；受影响范围包含 `fast-uri 3.1.3`，传递路径为 `electron-store → conf → ajv → fast-uri` | 已确认原 T12 阻断仍存在 |
| 最小依赖修复 | 锁文件将 `fast-uri` 3.1.3 升至同主版本 3.1.4；无直接依赖、业务代码或数据库变更 | 通过 |
| 隔离安装 | Node 22.23.1/npm 10.9.8；实际安装 `fast-uri 3.1.4`。两次正常 `npm ci` 均因 `ffmpeg-static` 连接 GitHub 超时；随后以 `npm ci --ignore-scripts` 解析完整依赖，复用已验证的同版本 Electron/FFmpeg 二进制并单独重建 `better-sqlite3` | 依赖树与原生 ABI 已验证；网络下载失败单独记录 |
| 生产依赖审计 | `npm audit --omit=dev`：0 vulnerabilities | 通过，原自动发布阻断已关闭 |
| 统一门禁 | lint、build、Windows 文件安全、迁移与性能测试通过；完整 JSON 报告为 32 个测试文件、258 个测试、0 失败 | 通过 |
| Electron 与 unpacked | Electron 33.4.11/ABI 130 smoke；`package:dir`、3,934 项 asar 审计、packaged smoke 通过 | 通过 |
| NSIS 与安装器 | unsigned NSIS、release metadata、首次安装—同包升级/修复—卸载哨兵 smoke 通过 | 通过；不是签名发布验收 |
| 全依赖审计 | 3 moderate、14 high、2 critical，均需按开发/构建工具链影响另行评估 | 未关闭；禁止直接 `npm audit fix --force` |
| 真实 Windows 故障与发布 | 跨物理卷、ACL/独占锁、磁盘满、SMB 断线、上一正式签名版本升级、签名/时间戳/SmartScreen、干净 VM | 需要验证 |

更新后的发布结论：生产依赖审计阻断已经关闭，但项目仍因真实 Windows 数据安全和签名发布矩阵缺少证据而**不得正式发布**。此前 T12 表格保留当时审计失败结果作为历史记录，本节是其后续处置结论。

## 2026-07-25 打包程序启动白屏修复

| 检查 | 结果 | 结论 |
| --- | --- | --- |
| 根因复现 | 旧 `dist-renderer/index.html` 使用 `/assets/...`；Electron `file://` 页面无法从应用目录解析 | 已确认 |
| 构建产物 | 修复后 HTML 使用 `./assets/index-*.js` 与 `./assets/index-*.css` | 通过 |
| scaffold | 6/6；新增 Vite 相对 base 配置断言 | 通过 |
| production build | TypeScript、Vite build 通过 | 通过 |
| packaged smoke | 新增 `rendererMounted: true`；preload、CSP、SQLite、协议和媒体工具原有检查继续通过 | 通过 |
| 桌面快捷方式 | 直接启动重新打包的 `win-unpacked` 程序；主窗口标题为“本地视频管理”且进程响应 | 通过 |

说明：原 packaged smoke 能成功加载 HTML 和 preload，但没有断言 React 根节点已渲染，因此未发现资源路径错误。本次补充的 `rendererMounted` 是后续所有 Windows 打包验收的必过项。

## 桌面手测记录模板

| 环境 | 样本格式 | 步骤 | 预期 | 实际 | 证据 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 需要验证 | MP4 | 启动、导入、原生播放、seek | 可播放且控制正常 | 需要验证 | 需要验证 | 需要验证 |
| 需要验证 | MKV/AVI | 触发 mpv；关闭/移除 mpv 后重试 | mpv 可用时启动；失败时进入系统默认播放器 | 需要验证 | 需要验证 | 需要验证 |
| 需要验证 | MOV/WebM | 原生播放或 fallback | 有可理解的成功/降级结果 | 需要验证 | 需要验证 | 需要验证 |
| 需要验证 | 长视频 | 连续 hover 时间轴并 seek | 预览可用、失败有占位、资源不持续增长 | 需要验证 | 需要验证 | 需要验证 |
| 需要验证 | 中文/空格/长路径 | 导入、播放、重命名 | 路径处理正确 | 需要验证 | 需要验证 | 需要验证 |
| 需要验证 | 被占用文件 | 重命名、永久删除 | 失败不破坏磁盘文件或数据库身份 | 需要验证 | 需要验证 | 需要验证 |
