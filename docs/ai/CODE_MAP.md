# 代码与需求定位图

## 运行时分层

| 层 | 主要位置 | 职责 |
| --- | --- | --- |
| Electron 启动 | `src/main/index.ts`、`src/main/security.ts` | 协议注册、数据库/服务装配、窗口生命周期、安全默认值 |
| IPC/preload | `src/main/ipc.ts`、`src/main/preload.cts`、`src/shared/videoTypes.ts` | 类型化 API、参数校验、renderer 信任边界 |
| 数据库 | `src/main/db/` | schema 迁移、视频/目录/扫描状态、重复清理任务仓储 |
| 扫描 | `src/main/media/libraryScanner.ts`、`scanManager.ts`、`metadataQueue.ts` | 发现、快照比较、missing 对账、异常、后台元数据 |
| CloudDrive2 | `src/main/clouddrive/` | 挂载点识别、gRPC API 与远程目录列举 |
| 媒体与播放 | `src/main/media/`、`src/main/playerWindow.ts` | FFprobe/FFmpeg、缓存、协议、播放器路由与窗口同步 |
| 文件操作 | `src/main/files/` | 路径规范化、移动/重命名/删除及异常文件动作 |
| 设置与日志 | `src/main/settings/`、`src/main/logging/` | 持久设置、快捷键、脱敏日志和诊断导出 |
| UI | `src/renderer/api/client.ts`、`src/renderer/App.tsx`、`src/renderer/components/` | Desktop-only 运行时边界、资料库、重复项、扫描异常、播放器、设置 |
| 跨层契约 | `src/shared/` | 视频/扫描/重复项/播放器类型、快捷键和清理规则 |
| 测试 | `tests/main/`、`tests/renderer/`、`tests/scripts/`、`tests/gates/` | 主进程、组件、交付脚本和规模/安全门禁 |

## 自然语言需求到修改范围

| 用户需求 | 首查代码 | 必须联动检查 |
| --- | --- | --- |
| “添加/移除/扫描文件夹” | `LibraryShell.tsx`、`ipc.ts`、`scanManager.ts`、`libraryScanner.ts`、`videoRepository.ts` | 路径归属、快照、失败表、missing 安全、扫描测试 |
| “网盘目录太慢/超时” | `libraryScanner.ts`、`fileDiscovery.ts`、`src/main/clouddrive/` | 不完整扫描不得清缺失、取消/超时、真实网盘 E2E |
| “异常项重试/清理” | `ScanFailuresPage.tsx`、`scanFailureActions.ts`、`ipc.ts`、repository 的 scan failure 方法 | 文件存在性与父目录可读性、列表刷新、renderer/main 测试 |
| “预览图/时间轴失败” | `mediaProtocol.ts`、`cacheService.ts`、`cacheManager.ts`、`mediaUrl.ts` | FFmpeg 路径、缓存 key/原子发布、真实格式手测 |
| “播放、旋转、快捷键、播放列表” | `PlayerPage.tsx`、`playerWindow.ts`、`playerRouting.ts`、`mpvController.ts`、`shortcuts.ts` | 多窗口事件、fallback、窗口尺寸、播放器测试和桌面验证 |
| “重复项规则/分页/筛选” | `videoRepository.ts`、`DuplicateGroupsPage.tsx`、shared duplicate 类型 | SQL 分组、未知时长、目录完整组语义、仓储/组件测试 |
| “批量清理重复项” | `DuplicateCleanupButton.tsx`、`DuplicateCleanupTasksPanel.tsx`、`duplicateCleanupService.ts`、`duplicateCleanupRepository.ts` | v7 任务、幂等、取消/恢复、最终文件版本复查、不可逆删除测试 |
| “移动/重命名/永久删除” | `fileOperations.ts`、`ipc.ts`、`videoRepository.ts` | 跨卷、同名、数据库失败回滚、Windows ACL/锁/磁盘满 |
| “增加排序或字段” | `videoTypes.ts`、migration、repository 白名单/row mapper、UI | preload/IPC 契约、旧库迁移、fixtures 和跨层测试 |
| “设置项或快捷键” | `settingsStore.ts`、`shortcuts.ts`、`SettingsPage.tsx`、IPC/preload | 默认值升级、冲突检查、打开窗口同步、设置测试 |
| “桌面启动/白屏/旧快捷方式” | `package.json`、`scripts/start-desktop.mjs`、`index.ts`、构建输出 | Node/Electron ABI、CSP/preload、重新打包和桌面快捷方式实启 |
| “浏览器出现假数据/Renderer API 缺失” | `renderer/api/client.ts`、`App.tsx`、`preload.cts` | unsupported-runtime、preload URL 信任、App runtime 测试；不得恢复 demo fallback |
| “缓存位置/长期保留/清理” | `cacheManager.ts`、`cacheService.ts`、设置页 | 只触碰专属缓存、并发 generation epoch、低磁盘/ACL |

## 跨层修改模板

- 新字段：migration → repository SQL/映射 → shared 类型 → IPC/preload → renderer → migration/repository/component tests。
- 新 IPC：channel/API 类型 → preload invoke → handler Zod 校验 → service/repository → renderer → contract/behavior tests。
- 文件动作：renderer 仅传 id/意图 → main 反查路径 → 预检 → 磁盘动作 → 数据库提交 → 失败恢复 → 领域事件。
- 媒体功能：URL/parser → protocol/service/tool process → cache → renderer 降级 → 单测 + 真实媒体手测。

更细的职责和注意事项看相应目录的 `README.md`，不要只根据文件名修改。
