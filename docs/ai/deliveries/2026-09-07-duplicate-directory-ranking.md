---
date: 2026-09-07
branch: ai/duplicate-directory-ranking
type: feat
status: completed
---

# 重复项目录排序与筛选

## Context

常用清理流程是先选择“优先保留此目录”，再查看该目录涉及的重复候选并批量清理。原页面虽在后台估算目录候选释放空间，但目录选择器没有明确的排序与筛选入口，也没有显示预计可清理文件数量。

## Changes

- 为每个候选目录增加“预计可清理文件数”，与候选组数、预计释放空间一起展示。
- 目录默认按预计释放空间从高到低排列；空间相同时依次按可清理文件数、候选组数和目录名称排序。
- 增加按可清理文件数、候选组数、目录名称排序的切换规则。
- 增加可清理 10/100 个以上以及可释放 10 GB/100 GB/1 TB 以上的目录筛选预设。
- 当前优先保留目录直接显示预计清理数量和预计释放空间。
- 明确上述数字是大小与时长候选估算，实际清理仍沿用完整 SHA-256 校验。

## Verification

- `npm run typecheck`：PASS。
- Electron 33 相关测试：PASS，3 个文件、130 项测试。
- Electron 33 全量 Vitest：PASS，68 个测试文件、643 项测试。
- Node 22.23.1 隔离 `npm run test:release-gate`：PASS，包含类型检查、构建、Windows 文件测试、迁移测试、性能门禁和 643 项全量测试。
- `npm run dist:win`、`verify:artifact`、`test:packaged-smoke`、`test:installer-smoke`：PASS；`app.asar` 共 3,976 个条目且不含禁止的开发文件。
- 桌面快捷方式 `Video Manager (Dev).lnk` 已更新到本次 `release/win-unpacked`，并确认实际启动进程路径一致。
- 当前自动化环境未暴露原生 Electron 窗口给截图接口，因此没有进行像素级截图复核；渲染挂载、默认资产中心、预加载桥接和打包启动由解压版与安装器冒烟覆盖。

## Risks and follow-up

- 目录指标是候选估算，不代表最终可删除数量；文件变化、远端身份缺失或 SHA-256 不一致都会在清理阶段被安全跳过。
- 目录统计沿用现有 60 秒缓存，扫描或清理后的短时间内可能显示上一次统计，刷新后会更新。
