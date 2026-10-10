# 免费分享版最终发布清单（v0.1.15 候选）

**状态：BLOCKED。** 这是维护者实际发 GitHub Release 前的唯一操作清单，不是自动发布许可。自有代码 MIT；首版计划不买 Windows 签名证书；发布目标是最低门槛的 Windows 安装版。

| 关卡 | 已有证据 | 状态 |
| --- | --- | --- |
| GitHub Windows CI 与安全检查 | PR #24 最近已核实的 `cd4d10f`：依赖审查、Electron native smoke、Windows Node/文件安全、无签名 NSIS 隔离 QA、全历史依赖扫描 **5/5 PASS**。本次文档/About 改动需由新提交重新跑 CI | 已通过（截至 `cd4d10f`，本次提交待验证） |
| 固定第三方运行库来源 | 5/5 DLL、4/4 MSYS2 包和原始 PKGBUILD 对应哈希一致 | 已通过 |
| FFmpeg 源码及构建脚本 | 8.1.2 核心源码、原 Windows 构建脚本已归档 | 已通过 |
| 第三方对应源码包 | FFmpeg 8.1.2 + 四份精确 MSYS2 源包均已下载、哈希校验，4/4 配方吻合 | **已取得并私有归档** |
| LGPL 条款适用及重链接材料 | 参见 [LGPL 清单](legal/LGPL_COMPLIANCE_CHECKLIST.md)、[具体构建参数](legal/FFMPEG_BUILD_INFO.md)、[专项审核](legal/FFMPEG-LITE-RELINK-REVIEW.md)，源码包存在不等于最终许可放行 | **阻塞** |
| 干净稳定 Windows11 无 Node/开发工具 | 必须根据 [干净系统验收步骤与证据模板](QA/WINDOWS11_CLEAN_INSTALL_TEST.md) 安装、扫描、播放、重启、修复安装及卸载并核对视频/SQLite；当前仅有内部测试包 | **阻塞** |
| `community` 身份真实 QA | 无签名**正式社区身份**安装器尚未生成；不能重命名 unsigned-test | **阻塞** |
| 发行审批文件 | `build/release-approval.json.approved=false` 且各二进制许可批准 false | **阻塞** |
| GitHub 发布授权 | PR #24 Draft、main 未合并；还没有正式版本 tag | **阻塞** |

真正发布时，仅在上述关卡全部通过且维护者批准后：审查 PR #24 → 合并 main → 以与 `package.json.version` 完全一致的 `v0.1.15` tag 启动允许的 `unsigned-public-release` → 对安装包及 SBOM 生成 SHA256SUMS → 在 GitHub Release **同时上传**未签名公众安装器、SBOM、第三方声明和对应源码材料。**不要采用 `v0.1.15-community` tag 直接触发现有发布流程**：现有正式门禁要求 `refs/tags/v<package.version>`，另起后缀会被拒绝。

首发未签名，Windows 可能出现“未知发布者”/SmartScreen 风险提示；下载说明应明确来源、SHA-256 校验和停止安装的安全情况。不指导用户关闭系统安全防护。独立 `community` 安装身份与旧签名版用户数据目录不同，属于**并行新安装而不是旧版覆盖升级**，公开说明中必须说明既有数据不会自动迁移。

**无论此清单如何变化：不要直接修改真实视频、数据库、桌面应用、main 分支或公开 Release。**

## 最后收尾进度（2026-10-09）

**最新实际进度：**FFmpeg 8.1.2 源 TAR、原 Windows 编译脚本、全部四份 MSYS2 源码包已经取得并核对哈希；四份源码包内 PKGBUILD 与曾用于打包五个 DLL 的 BUILDINFO 均一一吻合。已在 B5 准备可复核的完整源码材料 ZIP，**尚未上传**。接下来无需再追踪“DLL 来自哪个 MSYS2 包”，也不需反复下载已归档源码；主要剩下 LGPL/第三方分发文本与重新链接适用条件的最后核实、独立稳定 Windows 11 无开发工具的真实验收和获批社区版本的正式构建/上架流程。

## 2026-10-10 最新发布前检查（覆盖上述历史 CI 时间）

- **CI 当前状态：** PR #24 的最新 HEAD `b2700e2`：依赖审查、Electron smoke、Windows Node/文件安全、隔离 NSIS QA、全历史依赖扫描 **5/5 PASS**；PR 仍为 Draft，`main` 未合并。
- **隔离测试包：** 137,044,735 bytes，SHA-256 `d97eb9848adab07d5a938852df612e20312ba431bbda51a14a525de1ab2e70cd`，已有 B5 安装/修复/卸载、资料保护和 3,461 ASAR 条目的真实自动验证 PASS。**它不是公众安装包。**
- **媒体授权的具体疑点：** 精确 FFmpeg 8.1.2 Lite 的真实 `-buildconf` 包含 `--enable-static --disable-shared`，FFmpeg / LGPL §6 的对应源码、可能的重新链接材料及分发方式需要按具体结构核实；详见 [静态链接审核](legal/FFMPEG-LITE-RELINK-REVIEW.md)，不再重复追踪已证实的 DLL 原始包。
- **源码审核包：** 家用 B5 私有 REVIEW-v2 ZIP 共 14 项、239,488,121 bytes，SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`。已取得与真实公开提供是两件事。
- **干净 Win11 条件：** B5 为 Windows 11 Insider build 26220；Hyper-V 启用但没有现成 VM，Windows Sandbox 禁用，常见本地目录无稳定版 Windows 11 ISO/VHDX。不能把此机器当作干净、无 Node 的稳定版验收。
- **可移交 QA 套件：** 私有目录 `D:/CodexReleaseAudit/movie-clean-win11-QA-v0.1.15-b2700e2/`，已复制正确安装器、metadata、SHA、SBOM 和无 Node 稳定 Win11 验收脚本；待真正干净 VM 执行与人工视频 UI 验收。
- **自动复核：** `node scripts/audit-release-readiness.mjs` 在现有材料下预期退出码 2（`BLOCKED`），输出到被忽略的 `.tmp/release-final-readiness/preflight.json`，不得绕过审批。特别注意 `ownersConfirmed=false`、`manualQaApproved=false` 和 `approved=false`。

**下一次可真正放行的必要条件：** 静态 LGPL/第三方适用许可证结论和随公开版可获得的完整对应材料；干净稳定 Win11 手工与自动验收证据；代码/素材权属确认；随后才允许获批的独立社区安装身份构建、再次回归和真实公开 Release。

## 2026-10-10 追加：可以独立关闭的校验漏洞已修复

- 原发布前审计对“FFmpeg 存在”和“源码 ZIP 存在”没有严格校验固定哈希的缺口已关闭：`scripts/audit-release-readiness.mjs` 现在使用流式 SHA-256，并调用 `scripts/release-readiness-integrity.mjs` 检查实际文件内容、身份、元数据、固定 configure flags、审核 ZIP 大小和固定 SHA。
- 原有 31 项媒体来源合同测试增加 14 项防篡改/反例测试，共 **45/45 PASS**。`package.json` 已将新增测试放入 `test:media-candidate-contract`，因此 GitHub Windows CI 的 `test:release-gate` 会自动覆盖这些检查。
- B5 实际预检对安装器、FFmpeg 和私有源码审核包分别返回 PASS，但由于合法的发布门禁仍未满足，**总结果正确返回 BLOCKED（退出码 2）**。此结果不是程序失败，也不能由它批准 Release。
- 检查属于只读 QA 证据，不改变发布审批、不触碰用户 SQLite 与视频、不把 `unsigned-test-build` 改名成公版。
