---
date: 2026-10-22
branch: ai/release-fastpath-playbook
type: docs
status: completed
---

# v0.1.16 绿色 ZIP 发版经验固化

## Context
维护者明确要求下次发版只做必要动作、不重复耗费大量时间。2026-10-22 实际 v0.1.16 已发布 GitHub Latest，正式 ZIP 哈希 `fcf37f55e7c2cab21c051aaad0534560ca2f5007ebf163399648e0d4115fa703`，发布页 `https://github.com/huntian0727/movie/releases/tag/v0.1.16`，绑定 commit `159db20738d4e36243fdcf57cc8997e41fbea818`；Windows CI `39733324623` 和安全审计 `39733324536` 成功，发布工作流 `39734209982` 成功。

## Changes
- `docs/RELEASE_FASTPATH.md`：下一次 AI 可以直接执行的短流程，包括识别正确变更、分类发行说明、复用原生库哈希、锁定 commit/tag、只执行必要测试、Draft 六附件、正式 Latest 核验和不适用项。
- `docs/releases/RELEASE_NOTES_TEMPLATE.md`：安全、性能、功能增加三分类模板，明确真实测试范围、SHA、未覆盖风险。
- `scripts/release-fastpath-preflight.mjs`：只读预检工具，离线验证实际版本、发行说明、证据 SHA、批准范围、原生材料；`--published` 可额外读取 GitHub Release/latest，不发布、不改远端。
- `tests/scripts/releaseFastpathPreflight.test.mjs`：参数和公开状态 fail-closed 回归测试。

## Verification
- 2026-10-22 开发前备份：`2026-10-22_06-47-58-327_release-fastpath-playbook`；数据库 quick_check OK、363039 条视频。备份脚本按现有行为自动推送 checkpoint tag `checkpoint-20261022-144753-159db20-release-fastpath-playbook`。
- `node --check scripts/release-fastpath-preflight.mjs`：PASS。
- `npx vitest run tests/scripts/releaseFastpathPreflight.test.mjs`：PASS（核实实际输出）。
- `node scripts/release-fastpath-preflight.mjs --version 0.1.16`：PASS，批准/哈希/发行说明检查无阻塞。
- `node scripts/release-fastpath-preflight.mjs --version 0.1.16 --published`：PASS，GitHub 实时确认 v0.1.16 为公开 Latest，6 件附件齐全。
- `git diff --check`：PASS。
- 没有为本次文档/只读脚本修改重新打包应用或改桌面快捷方式，属 NOT RUN / 不适用。

## Risks and follow-up
- SOP 仅适用已授权 Windows x64 绿色 ZIP；原生字节变化须复核变化部分。公开发布前仍须确切哈希、对应源码、批准和发布后可下载校验。
- 本任务仅更新发布体系说明与只读检查，未更改软件功能、日常桌面程序、tag、正式 Release 或 GitHub public binaries。
