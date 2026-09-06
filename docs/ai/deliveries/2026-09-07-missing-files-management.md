---
date: 2026-09-07
branch: ai/missing-files-management
type: feat
status: completed
---

# 缺失文件明细与安全清理

## Context

资产中心已能统计每个资料库的缺失数，但没有明细入口和针对缺失记录的处理工作台。用户无法查看 SCCM 目录 64 条缺失记录的具体文件，也无法安全批量复查或仅移除本地资料库记录。

## Changes

- 新增缺失记录 SQLite 分页、来源筛选和文件名/路径搜索 API，并通过校验后的 IPC/preload 契约提供给 renderer。
- 新增“文件缺失”工作台，支持直接从资产中心的全局统计或单个资料库问题数进入、搜索、分页、单条/当前页复查和仅移除记录。
- 本地路径处理前先验证来源根目录可访问；CloudDrive 路径使用强制刷新后的远端父目录列表确认。离线、权限、超时和未知结果不会移除记录。
- 恢复和删除均使用路径、大小、修改时间的版本条件；恢复后发现文件版本变化时重置媒体元数据并重新排队。
- 新增二次确认和明确文案：只删除资料库记录，不删除或修改磁盘文件。设计保持现有深色、紧凑的工具型表格语言，并补全加载、空状态、错误和部分失败明细。

## Verification

- `npm run typecheck`：PASS。
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 定向 Vitest：PASS，5 个文件、62 项测试。
- Electron 33 `ELECTRON_RUN_AS_NODE=1` 全量 Vitest：PASS，66 个文件、627 项测试。
- 固定 Node 22.23.1 / npm 10.9.8 `npm run build`：PASS。
- 隔离工作树的标准 Node 22.23.1 / ABI 127 `npm run test:release-gate`：PASS；全量 Vitest 为 66 个文件、627 项测试。主 checkout 按项目规则保留 Electron ABI 130，未原地 rebuild。
- `npm run dist:win`：PASS，重建 `release/win-unpacked` 并生成 `Local-Video-Manager-0.1.15-x64-Setup.exe`。
- `npm run verify:artifact`：PASS，`app.asar` 共 3975 个条目，未发现禁止的开发产物。
- `npm run test:packaged-smoke`：PASS；`npm run test:installer-smoke`：PASS。
- 桌面快捷方式 `Video Manager (Dev).lnk` 已确认指向本次重建的 `release/win-unpacked/Local Video Manager.exe`，并已通过该快捷方式真实启动。
- 当前桌面控制接口未暴露原生 Electron 窗口，因此未能对真实窗口执行可访问性树/截图点击验收；明细页交互、批量选择、二次确认和部分失败状态已由 renderer 测试覆盖，未对用户资料库执行复查或移除。

## Risks and follow-up

- 单次 IPC 最多处理 500 条记录；当前页最多 100 条，SCCM 的 64 条可在每页 100 时一次全选处理。
- 记录移除后如文件重新出现，需重新扫描来源目录才能重新入库。
