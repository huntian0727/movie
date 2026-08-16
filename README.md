# 映匣（Local Video Manager）

面向 Windows 的本地视频资料库 Electron 桌面应用。视频始终保留在原目录；应用只维护 SQLite 索引、收藏/播放历史和可重建的封面/时间轴缓存。项目不提供独立 Web 产品或浏览器演示模式；React、Vite、HTML 和 CSS 只用于 Electron Renderer。本文是产品与开发总览，详细设计见 [ARCHITECTURE.md](ARCHITECTURE.md)，状态与路线见 [TASK.md](TASK.md)。首次接手项目的 AI 必须从 [docs/ai/START_HERE.md](docs/ai/START_HERE.md) 开始。

封面与时间轴预览保存在应用数据目录下的专属持久缓存：`%APPDATA%\local-video-manager\media-cache`。默认总上限 10 GiB，采用节流访问时间的近似 LRU、365 天 TTL 和分类配额自动回收；设置页可查看用量、最近清理状态并手动清理。清理只触碰该专属目录，不读取或删除源视频。旧版本位于 Electron `Cache` 目录中的 `covers`/`timeline` 会在启动时迁移，`Cache_Data` 不受影响。

## 当前能力

- 添加或移除源目录、递归发现 9 类视频扩展名，读取大小、时长、分辨率、格式和修改时间；移除源目录只清资料库索引，不删除磁盘文件。
- 扫描分为三个互斥入口：左侧圆形按钮只增量扫描当前源目录，异常弹窗只重试未解决文件/目录，右上角“扫描全盘”按顺序扫描全部 enabled 源目录。每一级目录持久化直属条目快照；未变化目录仍会下钻检查子目录，但不会逐个 `stat` 视频或重复运行 FFprobe。
- 扫描支持进度、暂停、协作式取消、离线/部分成功状态和跨重启异常明细。感叹号与普通刷新按钮可同时存在；根目录离线或子目录读取失败不会触发不安全的缺失清理。
- 支持同时添加父目录与其子目录；视频规范归属到最具体的已添加目录，移除父目录时保留仍被显式子目录覆盖的视频。
- 启动/手动同步；路径去重；未变化文件跳过 ffprobe；消失文件标为缺失。
- 网格/表格、搜索、收藏、最近播放、文件夹视图、排序、30/50/100/200/300 分页、页码直达与左右键翻页；网格预览支持五档大小并记忆偏好。
- 重复项只按 SQLite 中已缓存的精确文件大小和时长发现候选，打开或刷新页面不会读取视频内容。永久清理必须显式启动独立、可取消的完整 SHA-256 验证；只有保留文件与目标文件哈希相同且强文件身份仍匹配的项才能进入精确 `DELETE` 二次确认。删除边界会重新完整验哈希，并先把目标原子隔离到同目录持久化随机路径后再次校验；变化、离线、读取/隔离/恢复失败或取消均不会执行永久删除。
- 重复项可按目录命中筛选：只显示包含该目录（可选是否包含子目录）文件的完整重复组，并优先保留该目录中的一个文件；同组其他目录的文件仍会展示并可被清理。
- 独立播放窗口；单次播放队列最多 300 条，由主进程去重、按库中当前记录解析并过滤缺失文件，固定播放器 URL 不携带业务 ID 或完整队列。窗口通过带序列号的类型化 IPC 快照与领域事件同步；`auto` 根据 metadata/probe 状态、容器和 codec 保守选择 native/mpv，历史视频按需最多自动 probe 一次且播放只等待 2 秒；Chromium 原生 → mpv → 系统默认播放器三级 fallback；播放控制、快捷键、上下部。
- 设置页列出并允许修改视频库翻页与播放器播放、跳转、音量、旋转、永久删除快捷键；同一作用域禁止重复，旧设置自动补默认值，修改会同步到已打开窗口。
- 按需生成封面和时间轴 hover 图；封面可选择开头/3/5/10/15 秒截帧（默认 5 秒，短视频自动取中间帧），并可单视频重新生成；持久化设置；缓存清理。
- 安全校验后的原地重命名和永久删除；支持当前页批量移动。移动遇到同名目标一律生成数字后缀，不按大小覆盖；跨卷先写专用临时文件并校验，文件落盘后才更新数据库，数据库更新失败会尝试恢复原路径。
- 主进程使用默认脱敏的结构化 JSONL 日志，按 5 MiB、最多 5 个文件轮转并清理超过 14 天的日志。设置页可先预览、再导出包含版本、OS/ABI、schema、检查结果和脱敏日志的诊断 JSON；不包含视频、数据库正文、令牌或环境变量值。

真实视频格式、Windows 文件占用、mpv 缺失、系统文件关联、安装包和大目录体验仍需按 `docs/manual-test-checklist.md` 验证，不能仅凭单元测试宣称完成。最近一次命令结果见 `docs/verification-results.md`。

## 技术栈与运行要求

Electron 33、React 18、TypeScript 5.7、Vite 6、better-sqlite3、electron-store、Zod、FFmpeg/FFprobe 静态包、可选系统 `mpv`；Vitest、Testing Library、jsdom。开发工具链固定为 Node.js 22.23.1 和 npm 10.9.8；`.nvmrc`、`.node-version`、`engines`、Volta 与 `preinstall` 检查必须保持一致。

```bash
node --version
npm --version
npm ci
npm run test:release-gate
```

`test:release-gate` 包含 lint、build、Windows 文件安全、历史迁移、性能基线和完整 Node 测试。上述流程是 Node/Vitest checkout，`better-sqlite3` 必须是 Node ABI，不应再在其中执行 Electron rebuild。桌面开发使用另一个 checkout/worktree：

```bash
npm ci
npm run prepare:electron
npm run test:electron-smoke
npm run dev:electron
```

`prepare:electron` 将该 checkout 明确转换为 Electron ABI；转换后不要在这里运行 Node Vitest。`dev:electron` 只验证 Electron native binding，不再每次隐式 rebuild，并由 `scripts/start-desktop.mjs` 自动启动 Renderer 的 Vite dev server。`npm run dev:renderer` 仅供调试 Electron Renderer 资源；普通浏览器访问只显示“不支持的运行环境”，不提供资料库或任何假业务操作。详细恢复步骤、cache key 和工作目录规则见 [docs/native-abi-workflow.md](docs/native-abi-workflow.md)。

打包必须在独立的 Electron ABI checkout/job 中执行：

```bash
npm run package:dir
npm run verify:artifact
npm run test:packaged-smoke
npm run dist:win
npm run release:metadata
npm run test:installer-smoke
```

`package:dir` 生成 `release/win-unpacked`，`dist:win` 生成 NSIS 安装包。无证书时产物会明确标记为 `unsigned-test-build`，不得正式发布；`v*` tag 发布要求 GitHub Secrets 中存在签名证书。完整 CI、签名、branch protection 与制品检查规则见 [docs/release-workflow.md](docs/release-workflow.md)。

正式发布还必须填写 [Windows 发布数据安全验收单](docs/windows-release-checklist.md)。真实跨物理卷、NTFS ACL/独占锁、磁盘满、SMB 断线、上一正式版本升级和签名不能用故障注入或 unsigned smoke 代替。

## 目录导航

- `src/main/`：Electron 生命周期、SQLite、文件/媒体操作、IPC、设置和播放窗口。
- `src/main/logging/`：结构化日志、路径脱敏、稳定错误码、轮转和诊断导出白名单。
- `src/renderer/`：React 资料库、播放器与设置 UI。
- `src/shared/`：跨进程类型、IPC 契约和播放路由。
- `tests/`：主进程单元/集成式测试、渲染组件测试、脚手架烟测。
- `docs/`：原始设计、实施计划、功能审计和桌面手测清单（历史依据，不覆盖）。
- `docs/ai/`：新 AI 第一入口、当前状态、代码地图、风险和逐次交付记录。

## 维护规则

1. 文件系统、数据库和 IPC 的变更必须同步考虑失败回滚与测试。
2. `VideoManagerApi`、preload、IPC handler、仓储、UI 是一条契约链，新增字段/操作应成套修改。
3. 缓存必须可删除、可重建，不能成为视频记录的唯一真相。
4. 永久删除不进回收站；任何放宽路径校验的修改都属于高风险。
5. 先查模块 README 的“需求定位”，再动代码；验证状态写回 `TASK.md`/`CHANGELOG.md`。
6. 新窗口、preload 或 IPC 变更必须遵守 [Electron 安全边界](docs/electron-security.md)：入口 URL、窗口角色、CSP 和 sender 校验缺一不可。

## 仓库卫生与本地数据

- `.env*`（仅保留可提交的 `.env.example` 例外）、日志、覆盖率、SQLite 及其 WAL/SHM/迁移备份、临时文件和 IDE/系统元数据均由 `.gitignore` 排除。
- 当前应用不加载 `.env` 文件，也没有需要维护的环境变量模板，因此仓库不提供 `.env.example`。若将来引入环境配置，只能提交占位符和字段说明，禁止写入真实令牌、账号、磁盘路径或用户数据。
- 运行时数据库、预览缓存、设置和诊断日志属于 Electron `userData`，不得复制进仓库。测试应使用临时目录和虚构路径。
- 已进入 Git 历史的敏感值不能靠新增忽略规则或删除工作树文件解决：先轮换凭据，再评估受控历史清理，并通知所有协作者重新同步。
- 依赖调整必须更新 lockfile，并分别执行生产依赖审计与全依赖审计；禁止未经验证直接运行会跨主版本升级的自动修复。

## 常见需求入口

| 需求 | 首查范围 |
| --- | --- |
| 视频预览/封面异常 | `src/main/media/{mediaProtocol,cacheService,mediaUrl}.ts`、`PlayerPage.tsx`、CSS、媒体测试 |
| 桌面端启动失败 | `package.json`、`scripts/start-desktop.mjs`、`src/main/index.ts`、preload 构建输出、原生模块 ABI |
| 增加排序字段 | `src/shared/videoTypes.ts`、`videoRepository.ts` 的白名单、`Toolbar/LibraryShell`、仓储与组件测试 |
| 扫描慢或漏文件 | `libraryScanner.ts`、`scanManager.ts`、`pathNormalization.ts`、v5 快照/异常迁移、`metadataQueue.ts` 及增量扫描测试 |
| 删除/重命名问题 | `fileOperations.ts`、`ipc.ts`、`videoRepository.ts`、对应测试和 Windows 手测 |
| 新设置项 | shared 类型、`settingsStore.ts`、IPC Zod schema/preload、`SettingsPage.tsx`、测试 |
