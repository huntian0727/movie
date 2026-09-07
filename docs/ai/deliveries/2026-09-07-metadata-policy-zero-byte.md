---
date: 2026-09-07
branch: ai/metadata-policy-zero-byte
type: feat
status: completed
---

# 元数据队列状态与 0B 文件处理

## Context

元数据异常页把所有 `pending` 记录显示为“等待分析”，但 CloudDrive 唯一大小文件不符合自动读取策略，实际上不会进入运行队列。大量 0B 占位记录会被当作重复大小候选并交给 ffprobe，产生无意义失败；历史失败摘要还可能因保留开头而丢失真正的 stderr 原因。

## Changes

- 将异常状态拆为“自动分析候选”“策略暂缓”“分析失败”，并单独显示全局“已入队”“正在分析”运行计数。`ACCESSIBLE` 复查结果归入策略暂缓，不再冒充分析失败。
- 新增“仅看 0B”筛选、单条和批量“重新读取大小”。动作强制刷新 CloudDrive 远端父目录，大小恢复后安全更新文件版本并优先排队。
- 远端仍为 0B 时记录 `EMPTY_FILE` 并跳过 ffprobe；远端确认缺失时转入文件缺失复查。整个动作不修改或删除视频文件。
- 0B 文件不再进入自动元数据队列、指纹重复候选队列和重复大小候选统计。
- 新失败统一归类为 `EMPTY_FILE`、`INVALID_MEDIA`、`TIMEOUT`、`ENOENT`、`CLOUD_UNAVAILABLE` 或通用读取失败；长错误摘要保留末尾 500 字符，以保住 ffprobe stderr。
- 保留现有深色紧凑工作台语言，补齐状态说明、批量结果明细、加载、空态、错误态、键盘焦点和窄窗口布局。

## Verification

- `npm run typecheck`：PASS。
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 相关测试：PASS，7 个文件、92 项测试。
- Electron 33 全量 Vitest：PASS，68 个测试文件、641 项测试。
- 32 万条异常记录分页性能门禁：PASS；工作区全量测试实测 431.62 ms，隔离发布门禁复测 425.66 ms，门槛 3,000 ms。
- Node 22.23.1 隔离 `npm run test:release-gate`：PASS，包含类型检查、构建、Windows 文件测试、迁移测试、性能门禁和 641 项全量测试。
- `npm run dist:win`、`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke`：PASS；`app.asar` 共 3,976 个条目且不含禁止的开发文件。
- 桌面快捷方式 `Video Manager (Dev).lnk` 的目标与工作目录均指向本次 `release/win-unpacked`，已由该快捷方式启动并确认实际进程路径一致。
- 当前自动化环境未暴露原生 Electron 窗口给截图接口，无法完成像素级界面截图复核；渲染挂载、预加载桥接、媒体协议和默认资产中心已由解压版与安装器冒烟覆盖。

## Risks and follow-up

- “自动分析候选”表示满足持久化策略，运行中的精确状态以“全局已入队”和“全局正在分析”为准。
- “重新读取大小”依赖 CloudDrive API 和挂载映射；API 不可用时会逐条返回失败原因，不会把失败当作文件缺失。
- 旧错误在页面读取时按摘要归一化；摘要中没有保留底层原因的历史记录仍会显示原错误码或“未分类错误”。
