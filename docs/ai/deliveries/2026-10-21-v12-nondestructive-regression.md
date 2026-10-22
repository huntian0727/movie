---
date: 2026-10-21
branch: ai/duplicate-background-fault-qa
type: test
status: completed
---

# v1.2 非删除功能专项回归交付

## Context

用户明确将真实 CloudDrive/115 删除测试暂缓，要求优先验证其他功能。本次仅在家用电脑 MP2T8QB5 上执行无破坏性的自动化测试。不修改生产代码、不影响当前应用中 363216 个已索引视频、不调用真实删除 API、不在 GitHub 发布。

## Verification

执行环境：Windows 11 家用设备、本地 Git 工作区 `C:\Users\test\Documents\视频管理\movie`，测试基础 commit `4b68bbc`；显示版本 v1.2，技术包 0.1.16。下列 Vitest 测试均使用测试自己的临时文件/SQLite、受控网络模拟及构造的大规模数据。

| 分类 | 命令/测试 | 结果 |
| --- | --- | --- |
| Windows 文件操作与网络扫描 | `npm run test:windows-files` | PASS，4 文件 / 37 用例 |
| 数据库旧版迁移 | `npm run test:migrations` | PASS，1 文件 / 41 用例 |
| 常规性能、缓存和播放器窗口 | `npm run test:release-performance` | PASS，4 文件 / 31 用例 |
| Electron 原生进程沙箱 | `npm run test:electron-smoke` | PASS，native ABI、四类构建身份、安全存储、预加载、SQLite 迁移与恢复 |
| 播放器 / 字幕 / 扫描 / 异常 / 页面 | 17 文件 Vitest 组合命令，测试日志 `.tmp/v12-non-destructive-player-scanner-smoke.log` | PASS，17 文件 / 283 用例 |
| 模拟 32 万条视频压力门禁 | 4 文件 Vitest，日志 `.tmp/v12-readonly-320k-performance.log` | PASS，4 文件 / 4 用例 |
| CloudDrive 挂载扫描、端点、安全、凭据、恢复逻辑 | 7 文件 Vitest，日志 `.tmp/v12-safe-clouddrive-regression.log` | PASS，7 文件 / 70 用例 |

本轮合计 **37 个测试文件，466/466 条 Vitest 用例通过**。额外 Electron smoke PASS，不计入 466 条。该结果不等于此前全量 Vitest 的全部 1389 项均已通过。

## Selected measured performance (synthetic)

- 32 万视频 Playback Diagnostic：宽泛搜索 133.81ms；空搜索 122.19ms；主线程最大间隔 24.31ms。
- 32 万视频资产中心 / 100 来源：汇总 266.24ms，1 条 SQLite 查询；目录搜索 740.31ms，2 条查询；5,000 条元数据异常的列表 470.89ms，2 条查询。
- 32 万视频资料库概览 worker：643.14ms，主线程间隔 21.68ms。
- 32 万视频数据表 worker：分页 567.24ms；预选集合查询 332.33ms；主线程间隔分别为 18.42ms / 21.39ms。**该预选测试不执行删除**。
- 1 万视频目录树不变时的增量扫描：统计 0 次视频文件 stat，跳过 10,000 条视频。

所有时间仅代表本机这次构造数据的自动化测试结果，不代表真实网盘扫描、网络延迟或用户资料库的最终界面响应 SLA。

## Observations, caveats, follow-up

- 本轮全部专项 PASS；播放器/React 测试存在少量既有 `act(...)` 警告，未造成失败。CloudDrive 安全测试按设计打印了 `rejected ipc`，其拒绝行为是安全断言的一部分，并非鉴权泄漏。
- 之前完整 Vitest 基线为 **1386/1389 PASS，3 项 FAIL**：发行批准证据的版本和锁文件哈希不一致；属于保留的正式发行门禁问题，本次未绕过，也未重跑完整套件。
- `npm run test:electron-smoke` 已实际通过；此前现有 v1.2 打包程序的独立临时 SQLite 双阶段 packaged smoke 也已 PASS，见 `2026-10-21-duplicate-background-fault-qa.md`。
- 用户明确**暂停真实文件删除验收**，不要求现在提供测试目录。继续保持 CloudDrive/115 真删/断连行为 `NOT RUN`；不应擅自在真实影音目录创建或删除文件。
- 尚未验证的不同类型事项：真实字幕源匹配/下载、无构建环境 Windows 11 的发行候选安装升级/卸载，以及 GitHub 公开发布门禁。不能把代码单测通过表述成这些项目已经人工验收。
- 若需验证真实 36 万视频资料库的用户操作延迟，下一步可只读运行/观察 UI，不执行后台清理、删除、重扫或数据迁移；需区别构造的 32 万数据与真实数据。

## Documentation and release impact

只有测试记录和交接文档更新；生产逻辑未改变，无需升级 v1.2 或重打包当前桌面 exe。无 GitHub Push/公开 Release。
