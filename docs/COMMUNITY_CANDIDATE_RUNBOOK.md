# Windows 无签名社区候选包：手工受控流水线

**当前状态：只准备了流水线，尚不能运行正式构建。** 仓库所有者的权属批准、FFmpeg 静态 LGPL 对应材料，以及独立稳定 Windows 11/no-Node 验收仍不齐备。请勿为了通过检查填写虚假证据或把测试安装包发布为正式版。

## 为何单独建立工作流

既有 `.github/workflows/windows-release.yml` 的正式发布通道需要 Authenticode 证书；而免费分享版**不打算购买签名证书**。当前增加 `.github/workflows/windows-community-candidate.yml`，只接受手工 `workflow_dispatch`，绝不由普通 push/tag 自动公开发布。与签名正式流程、`unsigned-test-build` 隔离。

另外，签名 job 现在需要设置 `MOVIE_RELEASE_CHANNEL=signed` 才会由 tag 启动；为社区版创建 tag 不应进入签名发布 job。普通 Windows CI、tag 隔离 QA 和安全检查仍各自运行。

## 前提（全部完成后才可发起）

- 项目及素材所有者确认。必须核对所有维护者和资产来源，`build/release-approval.json.ownersConfirmed` 有真实审查依据。
- FFmpeg 8.1.2 静态链接、相关 LGPL 条款及所有 DLL 许可适用性完成书面核验，对应源码、重链接材料（如适用）、原始许可证、精确哈希和构建步骤可实际供下载。参阅 [专项审核](legal/FFMPEG-LITE-RELINK-REVIEW.md)。
- 使用真正干净的稳定 Windows 11 x64，无 Node、npm、Git，执行自动及手工 UI 安装、扫描、缩略图、播放、修复与卸载验收并保存可核对证据。家用 B5 Insider 的原有 smoke 结果不能代替它。
- 逐一在 `docs/legal/` 中存储真实证据及哈希；由维护者复核后填写 `build/release-approval.json` 的 `approved`、`manualQaApproved`、`packageLockSha256`、所有 **8 个原生二进制** 和 `cleanWindows11EvidenceSha256`。不能由脚本自行批准。
- 审查 PR #24、确认最新 GitHub CI、批准合并到 main。仅此之后才考虑创建与 `package.json.version` 完全对应的 `v0.1.15` tag。当前**不创建 tag、不合并 main**。

## 未来批准后，怎样启动手工构建（不是当前执行命令）

在 GitHub 仓库 Actions 使用 `Unsigned Community Candidate (manual, metadata only)`，选择准确版本 tag，并选择：

`I_APPROVE_PRIVATE_UNSIGNED_COMMUNITY_CANDIDATE`

等价的 GitHub CLI 例子：

```powershell
gh workflow run windows-community-candidate.yml --repo huntian0727/movie --ref v0.1.15 --raw-field acknowledge_unsigned_candidate=I_APPROVE_PRIVATE_UNSIGNED_COMMUNITY_CANDIDATE
```

此外仓库变量 `RELEASE_LICENSE_APPROVED`、`RELEASE_BINARY_COMPLIANCE_APPROVED`、`RELEASE_MANUAL_QA_APPROVED` **必须逐项明确设为 `true`**；签名密钥不得注入这条工作流。它只会使用 `MOVIE_RELEASE_CLASS=unsigned-public-release` 和 `MOVIE_MEDIA_VARIANT=lite-candidate`，调用程序内置的真实 `verifyFormalApproval` 再严格比对二进制输入、来源证据、用户版独立 appId/NSIS GUID、无签名状态、最终安装器 SHA256。

流水线依序运行 Windows 安全及发行回归门禁、打包、Electron smoke、应用打包 smoke、安装器构建、打包内容检验和 SHA256 校验。**只把构建 metadata、SHA256SUMS 和 SBOM 作为 GitHub Actions Artifact 存档，不上传安装器或源文件，更不会执行 `gh release create`。** 这是为了避免在公开仓库的 Actions Artifact 中分发尚未同页附带来源材料的第三方二进制。

## 公开发布是独立的最后一步

候选流程 PASS 也**不自动代表**已完成真实公众分发。最终仍需维护者从合规批准的构建环境取得与已核对哈希一致的社区身份 Setup，在同一次正式 GitHub Release 提供精确对应源码包、许可证声明、构建说明和其他必要材料，重新检查文件哈希、下载链接及用户操作步骤后，才能开放公众下载。不得将 `release/unsigned-test-build` 改名替代社区身份。

首版未签名，需公开明确 SmartScreen/未知发布者风险，不要求用户关闭系统保护。遇到任意证据缺失，流程应当 **FAIL/BLOCKED**，不得设 `continue-on-error` 或绕过审批。
