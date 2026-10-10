---
date: 2026-10-10
branch: ai/release-readiness-integrity
type: fix
status: completed
---

# 发布预检固化 SHA 与防误发布回归测试

## Context

v0.1.15 内部 QA 安装包已通过原有安装器自动验收，但发布预检上一版只是对 FFmpeg 和私人源码 ZIP 报告 hash，没有与锁定值比较，存在被替换文件仍报告通过的隐患。当前 CI 已五项全绿，但不代表法规/人工 QA 自动放行。本轮只修 QA 审计脚本、测试和记录，不改变运行程序或真实资料库。

## Changes

- 新增 `scripts/release-readiness-integrity.mjs` 纯数据校验层，检查测试安装器的 metadata、隔离身份、完整 SHA-256、安装包文件名、安全路径、提交和风味一致性；检查精确 FFmpeg 字节 SHA 和 `-buildconf` 禁止 GPL/nonfree 标记；固定私人 239,488,121-byte REVIEW-v2 ZIP 的 SHA 和大小。
- 加固 `scripts/audit-release-readiness.mjs`：大文件使用流式 SHA256、对比真实锁定值；缺失/不匹配都会明确 `BLOCKED`，审批文件只读、不绕过发行门禁。公开安装器身份始终标记不是当前 QA 测试身份。
- `tests/scripts/releaseReadinessIntegrity.node-test.mjs` 新增 14 项异常和正例，涵盖测试包替换/伪造签名/路径穿越/版本与身份不一致、FFmpeg 错版或配置错误、源码 ZIP 哈希/大小篡改等。
- 把这些 Node 测试并入 `package.json` 的 `test:media-candidate-contract`，从而由已有 `test:release-gate` 及 GitHub Windows CI 自动执行。
- 不修改 `build/release-approval.json`、媒体候选可分发标记、真实视频、数据库、正式安装及 `main`。

## Verification

- 开发电脑仅使用 B5（非办公 707）。
- `node --test tests/scripts/releaseReadinessIntegrity.node-test.mjs`：14/14 PASS。
- `npm run test:media-candidate-contract`：原 31 项加新 14 项，45/45 PASS。
- `node scripts/audit-release-readiness.mjs`（提供正确 REVIEW-v2 ZIP）：9 项检查，其中 QA 安装器/固定 FFmpeg/固定源 ZIP 的 SHA 验证 PASS；公众身份、权属、第三方合规、稳定 Win11 与 LGPL 重链接审核仍标记 BLOCKED；**预期退出码 2**，报告写入忽略的 `.tmp/release-final-readiness/preflight.json`。
- `node --check` JS 静态语法检查 PASS、`git diff --check` PASS。
- 上一提交 `46d74f3` 已完整验证 1,188 单测、构建、Electron smoke；本轮未修改生产功能源代码。不把上一轮的测试结果谎称为本轮产物的公众发行批准。

## Risks and follow-up

- 私有 FFmpeg 源 ZIP 哈希钉死于脚本；若审核材料合法更新需先审查内容再调整预期 SHA，并重新运行对应测试，不能关闭哈希检查。
- 本脚本仅审计 **内部测试** 安装器，永远不能输出公众 Release 放行。实际干净稳定 Win11 的 QA 以及 LGPL 静态链接对应源码/重链接适用义务、代码/素材所有者批准仍未获得。
- GitHub PR #24 必须保持 Draft；严禁重新命名/上传现有测试安装包来绕过 `unsigned-public-release` 的正式发行门禁。
