---
date: 2026-10-10
branch: ai/embed-third-party-notices
type: feat
status: qa-bundle-verified-private
---

# 安装包内第三方许可证说明和离线 Electron 构建

## Context

在 B5 家用设备继续个人免费开源版发行前准备；办公 D200707 只留待后续隔离 Windows 11 真正验收。此前 MIT 自有素材权属已由所有者确认，`ownersConfirmed=true`，正式发行仍关闭。

本轮事前已创建本地备份 `checkpoint-20261010-140730-a03236b-embed-third-party-notices`，家用 SQLite 345892 条、quick_check=ok。

## Changes

1. 检查旧的实际 `release/unsigned-test-build/win-unpacked/resources` 发现许可证原文和多个合法性文档已存在，但**统一索引 `THIRD_PARTY_LICENSES.md` 并未进入安装资源**。
2. 在 `scripts/run-electron-builder.mjs` 的 `extraResources` 中明确将根目录统一索引复制到 `resources/legal/THIRD_PARTY_LICENSES.md`，与已有 `PROJECT-LICENSE.txt`、`docs/legal` 配套。
3. 在 `tests/scripts/communityCandidateWorkflow.node-test.mjs` 添加打包配置静态断言，阻止未来误删第三方许可证入口。
4. B5 在运行 `npm run package:dir` 时，Electron Builder 尝试下载 44.7.0 Windows x64 Electron 包，网络 `fetch failed`。确认机器本地已有 **158,293,649 字节**的相同版本完整 ZIP，SHA-256 `eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c`。
5. 增加可选 `MOVIE_ELECTRON_DIST_ZIP` 离线参数，仅接受确切 `electron-v44.7.0-win32-x64.zip` 与上述固定 SHA-256；拒绝未核实的运行时输入。无需网络获取 Electron。

## Verification

- `node --test tests/scripts/communityCandidateWorkflow.node-test.mjs`：7/7 PASS（包括新增静态许可证索引保障）。
- 用本地固定 SHA 的 Electron ZIP 实际执行完整 `npm run package:dir`：通过（原生播放器、TypeScript、Vite、Electron rebuild/smoke、electron-builder 输出均正常）。
- 实际 `release/unsigned-test-build/win-unpacked/resources/legal/THIRD_PARTY_LICENSES.md` 存在，文件 SHA-256 **`2d324dfa62666e721fcfc2287faaab126e1ad7a25fbb72a9ba49da47821a0578`**，与根目录同名文件一致。
- 此为 `com.local.video.manager.unsignedtest` 隔离 **QA** 目录，不是 `unsigned-public-release`，不证明公开发行符合所有 LGPL 静态链接条款。没有正式 Release、tag、安装到办公宿主或改动用户媒体。
- 总 `approved=false`、`manualQaApproved=false`、Lite `distributable=false` 继续保持；所有者授权状态保持 true。

## Risks and follow-up

- 静态 FFmpeg 的 LGPL 相应源码与必要重链接条件的具体适用审核尚不能仅从 ZIP 完整性推断。
- 隔离稳定 Windows 11 的真实安装、播放及卸载仍未执行。
- 软件没有自有程序图标，Electron 打包时提示 default Electron icon；这不影响功能但应在公开发行之前完善品牌体验。
