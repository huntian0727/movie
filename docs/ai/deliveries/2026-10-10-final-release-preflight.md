---
date: 2026-10-10
branch: ai/final-release-preflight
type: chore
status: partial
---

# v0.1.15 真正发布阻塞的复核与防误发布检查

## Context

此前已有 1,188 项单元测试、真实 B5 隔离安装器构建及安装/修复/卸载 smoke 通过，GitHub PR #24 最新五项 CI 全通过。但真实公开发行未批准：许可证、无开发工具稳定 Win11 和所有者材料未闭环。2026-10-10 在 B5 开发前创建本地完整备份：`2026-10-10_00-55-47-521_final-release-preflight`，SQLite quick_check=ok；不触及办公 707。

## Changes

- 新增 `scripts/audit-release-readiness.mjs`：对比安装器与发布元数据的实际 SHA、准确隔离测试身份/commit、权属批准、全部二进制许可证、干净 Win11 QA、FFmpeg 静态链接模式；输出机器可读 `.tmp/release-final-readiness/preflight.json`。阻塞时退出码 2；只读检查，绝不写审批。
- 新增 `docs/legal/FFMPEG-LITE-RELINK-REVIEW.md`，基于真实 `-buildconf` 记录 LGPL 静态构建及可行的对应源码/重链接核实路线，链接官方一手来源。
- 更新 `docs/RELEASE_CHECKLIST.md` 为本次精确结果和剩余阻塞，无需每轮重复追查原有 FFmpeg DLL 来源。
- B5 私有目录 `D:/CodexReleaseAudit/movie-clean-win11-QA-v0.1.15-b2700e2`：最新安装器和 metadata/SBOM/验收脚本独立复制、SHA 复核通过，不写入 Git。
- 正式发行审批文件和媒体候选锁 **未改变**；PR 保持 Draft，禁止公开下载未批准原生工具。

## Verification

- `npm run audit:msys2-sources`: PASS；4/4 精确源码包/PKGBUILD 哈希吻合。
- FFmpeg 8.1.2 `-buildconf`：`--enable-static --disable-shared --disable-gpl --disable-nonfree --disable-version3` 实测核实；ffmpeg.exe SHA 符合锁定文件。
- REVIEW-v2 ZIP 14 条目、239,488,121 bytes，SHA `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`。
- `node scripts/audit-release-readiness.mjs`: 根据未批准项目正确返回 `BLOCKED`（期望 exit 2），记录 QA 安装器哈希与阻塞原因。测试包 SHA `d97eb9848adab07d5a938852df612e20312ba431bbda51a14a525de1ab2e70cd`。
- 本轮未在干净稳定 Windows 11 无 Node 环境执行测试；标记 NOT RUN。未对真实用户媒体、数据库、桌面快捷方式做修改。

## Risks and follow-up

- 需最终核查 LGPL §6 静态构建及可能的重链接材料；当前源码审核 ZIP 只在私有电脑留存，不是公开附带材料。后续审查结论须有审查人/证据。
- Hyper-V 已启用但无 VM，Sandbox Disabled；未找到本地可用稳定 Win11 安装介质。实际干净 VM 验收需要合法介质/可用 VM，不能直接用开发机证据填充。
- `ownersConfirmed`、`manualQaApproved`、`approved` 均仍为 false。普通用户公开版需在所有条件真实达成后走正常 PR/main 和构建门禁。
