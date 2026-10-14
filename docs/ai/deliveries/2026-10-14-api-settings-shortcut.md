---
date: 2026-10-14
branch: ai/api-settings-shortcut
type: fix
status: completed
---

# 从添加网盘目录直接进入 API 配置

## Context

“添加资料库 → 通过 CloudDrive API 添加”原来只能浏览目录或显示连接错误，用户需要退出并自行寻找设置入口。本轮用户明确选择更新“拉面影视-绿色测试版”，保留原日常版及其资料库。因此桌面交付使用隔离测试包目录，不替换日常版 `release/win-unpacked`。

开发前快照：`2026-10-14_02-06-53-521_api-settings-shortcut`；checkpoint：`checkpoint-20261014-100647-a85a4ed-api-settings-shortcut`。源码 bundle、SQLite quick_check 和设置备份成功，随后按工作区规则验证并清理历史备份，保留最近三份。

## Changes

- 在 API 添加目录窗口中始终显示“配置 API”按钮；未配置、加载中、无来源或连接错误时均可进入设置，正在添加时禁用以避免中断添加。
- 跳转到设置页的 CloudDrive API 区域并设置键盘焦点；返回按钮标记为“返回添加网盘目录”。
- 返回后重新挂载目录窗口并获取最新来源，避免继续使用配置前的错误或来源列表；普通设置入口仍从默认位置打开。
- 仅修改 renderer 页面编排、按钮样式和组件说明，无新增 IPC、数据库迁移、凭据处理或 CloudDrive 扫描逻辑。
- 新增跨组件回归，覆盖连接失败 → 配置 → 保存 → 返回并重新加载来源，以及普通设置入口不继承跳转位置；扩展错误状态测试，确保配置跳转不会创建来源。

## Verification

- 固定 Node 22.23.1 / npm 10.9.8。
- `vitest run tests/renderer/App.test.tsx tests/renderer/CloudDriveFolderDialog.test.tsx tests/renderer/SettingsPage.test.tsx`：PASS，3 文件 / 27 项。
- `npm run lint`、`npm run typecheck`：PASS。
- `npm run test`：PASS，140 文件 / 1293 项。
- `npm run build`、`npm run test:electron-smoke`：PASS；保留日志中的非阻塞 Vite 大 chunk 提示。
- `npm run package:dir`：PASS，隔离 unsigned-test-build 身份，使用已有锁定的 source-candidate 媒体和播放器运行库、已校验的本地 Electron ZIP，禁止自动发布。
- `node scripts/run-packaged-smoke.mjs`：PASS，创建和重开资料库、renderer/preload、实际媒体工具和封面、IPC 安全守卫。
- 包内许可证与源码 SHA-256 比对：PASS，17 份声明文件。
- Windows 实际桌面快捷方式验证：从“拉面影视-绿色测试版”启动，既有 3 视频、1 收藏和 3 最近记录保留；实际点击添加菜单、API 添加、错误状态中的配置按钮，CloudDrive API 设置直接出现在可见区域；返回后重新显示添加目录窗口及最新未配置状态。没有输入或复制真实 Token，没有新增云端来源或触碰云端文件。
- E2E：没有独立 `e2e` / `test:e2e` 脚本；本轮执行上面的真实桌面交互与打包 smoke。
- `git diff --check`：PASS。检查执行时间在本地 `.tmp/api-settings-shortcut-gates.json`；最终 Commit、asar 时间/哈希和快捷方式目标在 `.tmp/api-settings-shortcut-desktop-proof.json`，不提交运行记录。

## Risks and follow-up

- 交付入口：`%USERPROFILE%/Desktop/拉面影视-绿色测试版.lnk` → `release/unsigned-test-build/win-unpacked/拉面影视-unsigned-test-build.exe`，沿用既有隔离测试资料库；原“拉面影视”快捷方式和日常程序不替换。这是用户对本轮桌面交付范围的明确选择。
- 真实 Token 保存与真实网盘导入已在前一轮独立验收，本轮仅对入口跳转做针对性验证；保存后恢复来源的回归使用测试 API，不声称再次完成真实 115 导入或播放验收。
- 返回会重新获取挂载来源并从来源入口开始选择，不保留配置前已浏览的深层路径，以免配置改变后使用过期映射。
- 本轮没有改版本号、发布 tag 或 GitHub Release；现有公开 0.1.15 下载包不包含这次更新。
