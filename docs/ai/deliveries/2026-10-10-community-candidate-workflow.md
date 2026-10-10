---
date: 2026-10-10
branch: ai/unsigned-community-candidate-workflow
type: feat
status: completed
---

# 未签名社区候选正式工作流补齐（不会公开发布）

## Context

用户要求免费分享、开源、无需购买签名证书；此前 `.github/workflows/windows-release.yml` 的正式发布 Job 唯一支持 signed-release，无法运行已在构建工具中具备独立身份的 `unsigned-public-release`。本次在 **仅家用 B5** 创建本地开发 checkpoint `checkpoint-20261010-094208-d37e877-unsigned-community-candidate-gate`，SQLite quick_check=ok；办公机 707 不参与。

## Changes

- 新增 `.github/workflows/windows-community-candidate.yml`：只有手工 `workflow_dispatch`，必须明确选择 `I_APPROVE_PRIVATE_UNSIGNED_COMMUNITY_CANDIDATE`，并核验和 package 版本精确一致的 tag `v<version>`。
- 要求仓库变量明确批准 `RELEASE_LICENSE_APPROVED`、`RELEASE_BINARY_COMPLIANCE_APPROVED`、`RELEASE_MANUAL_QA_APPROVED`，要求提交内 `build/release-approval.json` 权属、法律、干净 Win11 证据都为真；程序构建仍调用已有 `verifyFormalApproval` 对真实 FFmpeg/ffprobe/5 DLL/NativeHost 的字节与证明做再次核验。
- 工作流固定 Node 22.23.1 / npm 10.9.8 / Windows x64，运行既有 release gate、npm audit、package:dir、Electron smoke、renderer security smoke、packaged smoke、dist:win、verify:artifact、release:metadata，并二次核验独立 community appId/NSIS GUID、NotSigned 和安装包 SHA256。
- **安全原则：** Actions Artifact 仅包含 checksum、metadata、build-flavor、FFmpeg SBOM，不含任何 exe。由于代码仓库公开，不能假设 Actions Artifact 天然是私密二进制交付通道；真正公众 Release 的安装器和对应源码/许可证必须另行复核并在同次发行提交。
- 原签名 job 添加显式 `vars.MOVIE_RELEASE_CHANNEL == 'signed'` 选择，防止社区 tag 启动需要付费证书的发布任务。原 tag QA 不变。
- 新增 `tests/scripts/communityCandidateWorkflow.node-test.mjs` 六项合同测试、并入 `test:media-candidate-contract`，更新 `docs/release-workflow.md` 并新增 `docs/COMMUNITY_CANDIDATE_RUNBOOK.md`。

## Verification

- YAML 使用本地 `js-yaml` 解析：`windows-community-candidate.yml` 仅含 workflow_dispatch，`windows-release.yml` 继续支持已有 QA/tag，PASS。
- `node --test tests/scripts/communityCandidateWorkflow.node-test.mjs`：6/6 PASS。
- `npm run test:media-candidate-contract`：51/51 PASS（此前 45 项加本轮六项）。
- `npm run lint`：PASS，`git diff --check`：PASS；新文档五个相对链接全部存在。
- 本次纯 workflow/docs/测试变更，未修改产品运行代码、用户视频或数据库；既有真实 B5 QA Setup **未重打包**。整套 PR CI 将在远端审查分支再次执行。
- **工作流没有触发**（仓库真实 `approved=false`，没有正式 tag），不能谎称实际社区版构建或公众分发已通过。

## Risks and follow-up

- Windows 11 稳定无 Node 虚拟机人工验收仍未完成；静态 FFmpeg LGPL 对应源码/重链接适用性、素材权属仍待真实审批。
- 在批准前不可擅自合并 main、创建 tag 或公开安装包；审批数据和媒体锁不变，原 PR #24 继续 Draft。
- GitHub 手工触发的 workflow 文件需要先在默认分支存在；以后在核实所有证据和审批后才按 runbook 的 `gh workflow run ... --ref v0.1.15` 操作。即便它 PASS，也仅是**候选构建**，不是公开 Release。
