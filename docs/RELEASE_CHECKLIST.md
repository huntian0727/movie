# 免费分享版最终发布清单（v0.1.15 候选）

**状态：BLOCKED。** 这是维护者实际发 GitHub Release 前的唯一操作清单，不是自动发布许可。自有代码 MIT；首版计划不买 Windows 签名证书；发布目标是最低门槛的 Windows 安装版。

| 关卡 | 已有证据 | 状态 |
| --- | --- | --- |
| GitHub Windows CI 与安全检查 | 最新已完成的 `4013e5f`：Windows run 37927837499、Security 37927837335 均 SUCCESS；此后新源码清单提交仍需跑自己的 CI | 已通过（截至 `4013e5f`） |
| 固定第三方运行库来源 | 5/5 DLL、4/4 MSYS2 包和原始 PKGBUILD 对应哈希一致 | 已通过 |
| FFmpeg 源码及构建脚本 | 8.1.2 核心源码、原 Windows 构建脚本已归档 | 已通过 |
| 第三方对应源码包 | FFmpeg 8.1.2 + 四份精确 MSYS2 源包均已下载、哈希校验，4/4 配方吻合 | **已取得并私有归档** |
| LGPL 条款适用及重链接材料 | 参见 [LGPL 清单](legal/LGPL_COMPLIANCE_CHECKLIST.md)，源码包存在不等于最终许可放行 | **阻塞** |
| 干净稳定 Windows11 无 Node/开发工具 | 必须安装、扫描、播放、重启、修复安装及卸载并核对视频/SQLite | **阻塞** |
| `community` 身份真实 QA | 无签名**正式社区身份**安装器尚未生成；不能重命名 unsigned-test | **阻塞** |
| 发行审批文件 | `build/release-approval.json.approved=false` 且各二进制许可批准 false | **阻塞** |
| GitHub 发布授权 | PR #24 Draft、main 未合并；还没有正式版本 tag | **阻塞** |

真正发布时，仅在上述关卡全部通过且维护者批准后：审查 PR #24 → 合并 main → 以与 `package.json.version` 完全一致的 `v0.1.15` tag 启动允许的 `unsigned-public-release` → 对安装包及 SBOM 生成 SHA256SUMS → 在 GitHub Release **同时上传**未签名公众安装器、SBOM、第三方声明和对应源码材料。**不要采用 `v0.1.15-community` tag 直接触发现有发布流程**：现有正式门禁要求 `refs/tags/v<package.version>`，另起后缀会被拒绝。

首发未签名，Windows 可能出现“未知发布者”/SmartScreen 风险提示；下载说明应明确来源、SHA-256 校验和停止安装的安全情况。不指导用户关闭系统安全防护。独立 `community` 安装身份与旧签名版用户数据目录不同，属于**并行新安装而不是旧版覆盖升级**，公开说明中必须说明既有数据不会自动迁移。

**无论此清单如何变化：不要直接修改真实视频、数据库、桌面应用、main 分支或公开 Release。**

## 最后收尾进度（2026-10-09）

**最新实际进度：**FFmpeg 8.1.2 源 TAR、原 Windows 编译脚本、全部四份 MSYS2 源码包已经取得并核对哈希；四份源码包内 PKGBUILD 与曾用于打包五个 DLL 的 BUILDINFO 均一一吻合。已在 B5 准备可复核的完整源码材料 ZIP，**尚未上传**。接下来无需再追踪“DLL 来自哪个 MSYS2 包”，也不需反复下载已归档源码；主要剩下 LGPL/第三方分发文本与重新链接适用条件的最后核实、独立稳定 Windows 11 无开发工具的真实验收和获批社区版本的正式构建/上架流程。
