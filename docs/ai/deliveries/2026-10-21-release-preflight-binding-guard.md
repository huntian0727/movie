---
date: 2026-10-21
branch: ai/release-preflight-binding-guard
type: fix
status: completed
---

# 发行预检：审批版本与证据绑定修正

## Context

维护者希望 AI 先完成不依赖人工配合的工作，把需要实际用户体验、所有者/法律批准及真实网盘不可逆操作的事项留到最后。本轮在家用电脑 MP2T8QB5 上运行全量测试、构建和发行预检后发现：当前包版本为 0.1.16，但历史 `build/release-approval.json` 仍绑定 0.1.15 和旧 package-lock。发行预检原先只看批准字段/哈希格式，可能把过期的 owner/manual-QA 标记显示成 PASS，未证明其适用于当前包。

## Changes

- `scripts/release-readiness-integrity.mjs`：新增纯函数 `verifyReleaseApprovalBindings`，要求审批版本、package-lock SHA-256、LICENSE SHA-256、Windows QA 证据 SHA-256 与当前实际输入逐一匹配。
- `scripts/audit-release-readiness.mjs`：
  - 实际计算当前 `package.json` 版本、`package-lock.json` 和 `LICENSE` 哈希。
  - 对审批引用的 QA 证据路径做仓库内路径约束，并读取实际文件校验哈希；缺失、路径越界、目录或不可读文件均按不匹配处理。
  - “稳定 Windows 11 QA”还必须显式具有 `stableWindowsCoverage=true` 和 `standardUserCoverage=true`，仅有历史 `manualQaApproved` 标记不够。
  - “Release approval”不再仅因 `approved=true` 就显示通过，而要同时匹配当前版本、锁文件、LICENSE 和 QA 证据。
- `tests/scripts/releaseReadinessIntegrity.node-test.mjs`：增加匹配成功、版本过期、哈希不匹配、证据缺失等单测。
- **没有**修改 `build/release-approval.json`、原生二进制批准、package.json/lockfile、桌面程序逻辑或显示版本；没有尝试用新哈希替代人工审批。

## Verification

- 开发前 Git/数据库 checkpoint：`checkpoint-20261021-173152-830b32c-release-preflight-stale-approval-guard`（local-only）。
- 数据快照：`2026-10-21_09-31-54-514_release-preflight-stale-approval-guard`；SQLite quick_check=ok，schema v16，363216 视频。
- 当前分支基线：`830b32c0d3abee00e910fb8b25458f5d56c125e5`；工作区开发前干净。未推送 GitHub。
- `node --check scripts/audit-release-readiness.mjs`：PASS。
- `node --test tests/scripts/releaseReadinessIntegrity.node-test.mjs`：PASS，16/16。
- `npm run test:media-candidate-contract`：PASS，67/67。
- `npm run typecheck`：PASS。
- `npm run build`：PASS（本轮审计脚本修改前；本次改动只在发行审计脚本和 Node 测试，不进入桌面运行代码）。
- `npm run test:electron-smoke`：PASS。
- `npm run test:renderer-security-smoke`：PASS。
- `node scripts/run-packaged-smoke.mjs --executable release/win-unpacked/拉面影视.exe`：PASS；独立临时 SQLite 双阶段验证、页面查询、预览/缓存、媒体工具、CSP/IPC 等均通过。安全测试中的 `ERR_UNTRUSTED_IPC_SENDER` 是预期拒绝。
- `npm run test:native-source-build`：PASS，3 组 Python 测试共 28/28。
- 完整 `npm run test:node`：FAIL，149 个文件中 147 PASS/2 FAIL，1391 项中 1388 PASS/3 FAIL。三个失败均是现存发行证据与当前源码版本不一致：
  1. `tests/scripts/releaseEngineering.test.mjs`：批准版本 0.1.15，当前 package.json 为 0.1.16。
  2. `tests/scripts/sourceReleasePipeline.test.mjs`：当前 package.json 预期旧版本 0.1.15。
  3. `tests/scripts/sourceReleasePipeline.test.mjs`：记录的 package-lock 哈希 `7d1bde...` 与当前实际哈希 `06e888...` 不一致。
- `node scripts/audit-release-readiness.mjs`：按设计返回 `OUTCOME=BLOCKED`，并正确列出当前版本和 package-lock 绑定失配；LICENSE 和已引用 QA 文件的哈希确实匹配。另因二进制分发合规未批准、稳定 Windows/标准用户覆盖为 false、私有 REVIEW ZIP 未提供，继续阻止发行。
- `npm run verify:artifact`：默认环境先因候选 player variant 与默认输入不一致而阻止；显式指定候选环境后，仍因旧候选包版本 0.1.15 与当前 package.json 0.1.16 不一致而阻止。
- `npm run test:installer-smoke`：在安装前检查阶段退出；发现 `release/unsigned-test-build/build-metadata.json`（2026-10-11、commit `40a6925`、`lite-candidate`）与 `build-flavor.json`（commit `c51a9c3`、`source-candidate`）不一致。没有开始安装/修复/卸载，没有改变正式注册表、快捷方式或真实媒体。
- `git diff --check`：PASS。

## Risks and follow-up

- 历史 0.1.15 批准记录不能自动用于 0.1.16。更新批准需要维护者/所有者基于实际输入重新审核；禁止脚本自动重写版本、哈希或 `approved` 字段。
- 现有 unsigned-test-build 安装候选元数据不一致，当前不能作为安装/修复/卸载验收依据。应在隔离候选目录重新生成匹配的 QA 包，并保留旧候选以供追溯后，再执行自动安装 smoke。
- 真实字幕源、实际多格式播放体验、真实 CloudDrive/115 删除/断连仍未验证；用户已明确暂缓真实删除。
- 先前全量测试的 3 项失败未被隐藏、跳过或修改成虚假通过。

## Documentation and release impact

- 这是内部发行预检与测试的可靠性修正，无用户可见功能变化；`CHANGELOG.md`、`docs/USER_GUIDE.md` 无需修改，界面版本仍为 v1.2。
- 没有重打包或替换桌面日常版；桌面快捷方式仍指向 `release/win-unpacked/拉面影视.exe`。该既有程序已由 packaged smoke 启动核对；本轮没有发布新桌面版本。
- 没有 GitHub Push、tag、Release 或任何公开发布。
