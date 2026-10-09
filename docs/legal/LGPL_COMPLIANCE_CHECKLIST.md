# LGPL / 第三方源代码发布核验清单

状态：**未批准公开分发** · 最近更新：2026-10-09 · 目标：免费分享，首版 Windows 无签名，不购买证书。

下面项目只列会实际影响安装包公开分发的条件，不要求把本项目做成商业发行系统。基准：[FFmpeg 官方 Legal Checklist](https://ffmpeg.org/legal.html)。

| 检查 | 目前证据 | 结果 |
| --- | --- | --- |
| FFmpeg 构建未启用 GPL / nonfree | 已验证 8.1.2 Lite `--disable-gpl --disable-nonfree` | **通过（候选）** |
| 原始 FFmpeg 8.1.2 完整源码与 SHA-256 | 源 TAR 实际归档，SHA 锁定 | **通过** |
| Windows 构建脚本及精确来源 | `v8.1.2-27` Git Commit 与 Windows job 对应 | **通过** |
| 五个 DLL 实际原始包来源 | 4 MSYS2 包 SHA，5 DLL SHA、PKGINFO/BUILDINFO、4 PKGBUILD SHA | **通过** |
| 附带 LGPL 及第三方原始许可证文本 | 候选带 LGPL、oneVPL、OpenH264、winpthreads、GCC，GCC exception 原文另已归档 | **已有原文，完整适用性仍需最后核实** |
| 额外依赖的准确对应源码 | MSYS2 历史源码包链接已定位，完整归档/核验未做完 | **待完成** |
| LGPL 静态链接与修改后重链接材料 | 已保存构建脚本，但尚未复建或核实对象/重链接适用义务 | **待完成** |
| 对应源码随正式 Release 同等提供 | 目前没有正式安装包或 Release 源码附件 | **待完成** |
| 应用下载页显著呈现 LGPL 与源码链接 | [SOURCE_OFFER.md](SOURCE_OFFER.md) 仍为候选索引，待真实 Release URL | **待正式上传时填写** |
| 稳定干净 Windows11 用户验收 | 家用 Insider 已通过隔离安装器 QA；缺稳定无 Node 环境 | **待完成** |
| 公众版身份/批准与安装包哈希 | `unsigned-public-release` 构建门禁已有，`approved=false` | **仍被阻止，正确** |

**发布规则：**任何待完成项影响实际二进制分发时，不得因软件免费、MIT 自有代码或已有 SBOM 而将 `build/release-approval.json.approved` 改成 true。不需要购买数字签名证书，但需要下载者知道未知发布者提示及官方 SHA-256 校验路径。
