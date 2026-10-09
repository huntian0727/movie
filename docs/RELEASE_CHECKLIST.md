# 免费分享版最终发布清单（v0.1.15 候选）

**状态：BLOCKED。** 这是维护者实际发 GitHub Release 前的唯一操作清单，不是自动发布许可。自有代码 MIT；首版计划不买 Windows 签名证书；发布目标是最低门槛的 Windows 安装版。

| 关卡 | 已有证据 | 状态 |
| --- | --- | --- |
| GitHub Windows CI 与安全检查 | `fc39e5e` Windows run 37923930333、Security 37923930321 都成功 | 已通过（历史提交） |
| 固定第三方运行库来源 | 5/5 DLL、4/4 MSYS2 包和原始 PKGBUILD 对应哈希一致 | 已通过 |
| FFmpeg 源码及构建脚本 | 8.1.2 核心源码、原 Windows 构建脚本已归档 | 已通过 |
| 第三方源码获取和 LGPL relinking | 参见 [LGPL 清单](legal/LGPL_COMPLIANCE_CHECKLIST.md) | **阻塞** |
| 干净稳定 Windows11 无 Node/开发工具 | 必须安装、扫描、播放、重启、修复安装及卸载并核对视频/SQLite | **阻塞** |
| `community` 身份真实 QA | 无签名**正式社区身份**安装器尚未生成；不能重命名 unsigned-test | **阻塞** |
| 发行审批文件 | `build/release-approval.json.approved=false` 且各二进制许可批准 false | **阻塞** |
| GitHub 发布授权 | PR #24 Draft、main 未合并；还没有正式版本 tag | **阻塞** |

真正发布时，仅在上述关卡全部通过且维护者批准后：审查 PR #24 → 合并 main → 以与 `package.json.version` 完全一致的 `v0.1.15` tag 启动允许的 `unsigned-public-release` → 对安装包及 SBOM 生成 SHA256SUMS → 在 GitHub Release **同时上传**未签名公众安装器、SBOM、第三方声明和对应源码材料。**不要采用 `v0.1.15-community` tag 直接触发现有发布流程**：现有正式门禁要求 `refs/tags/v<package.version>`，另起后缀会被拒绝。

首发未签名，Windows 可能出现“未知发布者”/SmartScreen 风险提示；下载说明应明确来源、SHA-256 校验和停止安装的安全情况。不指导用户关闭系统安全防护。独立 `community` 安装身份与旧签名版用户数据目录不同，属于**并行新安装而不是旧版覆盖升级**，公开说明中必须说明既有数据不会自动迁移。

**无论此清单如何变化：不要直接修改真实视频、数据库、桌面应用、main 分支或公开 Release。**
