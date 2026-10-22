---
date: 2026-10-22
branch: ai/fix-packaged-smoke-timeout
type: fix
status: completed
---

# 修复 Windows packaged smoke 启动超时

## Context

GitHub Actions run `39701155462` 的 Windows unsigned QA job 在 `npm run test:packaged-smoke` 阶段启动 `release/unsigned-test-build/win-unpacked/拉面影视-unsigned-test-build.exe` 后等待 60 秒超时。打包、Electron smoke、Renderer security smoke 和包内容验证此前均已通过。

## Root cause

Windows runner 的临时目录路径采用 `C:\Users\RUNNER~1\AppData\Local\Temp` 这类 8.3 短路径。`scripts/run-packaged-smoke.mjs` 原先直接将 `mkdtemp(os.tmpdir())` 返回的路径写入 `VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA`。应用的 `DataDirectoryManager.requireRealDirectory()` 有意拒绝 `realpath(path)` 与传入路径不同的目录，因而启动阶段报数据目录错误。错误处理会弹出模态对话框；在 `windowsHide` 的 CI 进程中无法交互，最终外部 runner 只能报告 60 秒超时。

已通过合成 junction 复现：创建于 junction 路径下的目录，其 `realpath()` 指向目标目录，原路径比较会触发该安全守卫。另一个 `scripts/run-electron-smoke.mjs` 已使用 `realpathSync.native()` 规范化临时目录，说明 packaged smoke runner 漏掉了相同的路径规范化步骤。

## Changes

- `scripts/run-packaged-smoke.mjs` 新增 `createSmokeRoot()`，创建临时目录后立即用 `realpath()` 解析为规范路径，再将它传入打包程序；若解析失败，会清理刚创建的临时目录。
- 超时错误现在明确标记 `create` 或 `verify` 阶段，便于后续诊断。
- 新增 `tests/scripts/runPackagedSmoke.test.mjs`，用 Windows junction（其他平台用目录符号链接）模拟 TEMP 别名，断言 smoke root 返回规范路径。
- 这是测试/打包验收基础设施修复，不改变应用用户可见行为；无需更新用户教程或 `CHANGELOG.md`。

## Verification

- 合成别名路径根因实验（修复前）：`wouldBeRejectedByDataDirectoryGuard=true`。
- `node --check scripts/run-packaged-smoke.mjs`：PASS。
- `npx vitest run tests/scripts/runPackagedSmoke.test.mjs`：PASS，1/1。
- `git diff --check`：PASS。
- `npm run test:release-gate`（`MOVIE_MEDIA_VARIANT=lite-candidate`）：PASS，退出码 0。
- `npm run package:dir`（`MOVIE_RELEASE_CLASS=unsigned-test-build`、`MOVIE_MEDIA_VARIANT=lite-candidate`）：PASS。
- `npm run verify:artifact`：PASS，包内 3,469 个 ASAR 条目、17 份精确许可声明，无禁止的开发文件。
- `npm run test:electron-smoke`：PASS。
- `npm run test:renderer-security-smoke`：PASS。
- `npm run test:packaged-smoke`，将 `TEMP`/`TMP` 指向模拟 junction 别名：PASS；create 与 verify 两阶段均完成，未出现 60 秒超时。
- `npm run dist:win`：PASS，生成本地私有 unsigned QA 安装器。
- `npm run release:metadata`：PASS。
- `npm run test:installer-smoke`：PASS，隔离安装、修复、拒绝删除应用数据、卸载与合成 SQLite/视频哨兵保全检查均通过；正式注册信息和快捷方式未变化。

## Risks and follow-up

- GitHub Actions 的失败 run `39701155462` 是修复前提交的历史结果，仍显示失败。后续用户授权推送后，修复提交 `a3b7c56e530bb3dc44a94ac792a9fdbbd6938228` 已推送到 PR #29。Windows CI run `39705876732`（#250）和 Security audit run `39705876999`（#84）均已 SUCCESS；其中 Windows CI 的 packaged smoke 与隔离安装/卸载 smoke 通过。旧失败记录保留作历史证据，不代表最新提交失败。
- 没有合并 PR、创建公开 Release、上传公开二进制或执行真实 CloudDrive/115 删除。
- 开发前快照：`2026-10-22_01-06-30-505_fix-packaged-smoke-timeout`。项目备份脚本创建 checkpoint 时自动推送了标签 `checkpoint-20261022-090625-adb2337-fix-packaged-smoke-timeout`；该标签推送是备份脚本副作用。之后按用户授权另行推送了修复源码到 PR #29；没有合并 main、创建公开发行 tag 或发布 GitHub Release。
