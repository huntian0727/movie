# FFmpeg 第三方库固定源码许可证取证（2026-10-09）

> **候选原文与哈希记录，NOT APPROVED FOR PUBLIC DISTRIBUTION。** 本报告不是完整开源授权结论，不允许修改正式 Release 审批门禁。对应机器可读输出：`native-media-license-availability.json`。

## 已执行的具体核验

在家用电脑 **MP2T8QB5** 的 `ai/public-release-audit` 上，以 `native-media-recipe-evidence.json` 已核验的精确 40 字符 Git Commit 为输入，对使用 `github.com` 托管的第三方来源逐一执行 GitHub API：

- FFmpeg 的 43 项启用外部库，初审共对应 42 个不同的源码仓库。
- 其中有 **29 个固定版本 GitHub 源码仓库**，这 29 个仓库的 API 源码根目录已逐一查询，**29/29 个仓库至少发现一份许可证/版权/作者类根文件**，未出现 API 失败。
- 对找到的根目录候选文件逐个获取 GitHub 原始 Git blob，使用标准 Git 对象 SHA-1（`blob <size>\\0<content>`）比对上游 API SHA，并计算对应文件 SHA-256。累计已获取 **49 份原始根文件**，文件内容仅归档在家用机的隔离审计目录 `D:/CodexReleaseAudit/media-candidate-20261008/source-evidence/pin-license-texts/`，不上传 GitHub、CI 或公开安装包。
- 所有文件的相对名称、 Git 对象 SHA、SHA-256、实际字节数、源码仓库和**精确提交**均列于 `native-media-license-availability.json`。数据库中 `approvedForDistribution=false`、`sourceComplianceApproved=false` 与 `completeThirdPartyLicenseReviews=0`；不填写或推断 SPDX 授权结论。
- 余下 **13 个非 GitHub 仓库**（如 GitLab、Videolan、Googlesource、SourceForge 以及 SVN）仍须走各自的固定提交来源取证接口，不能把 29/29 理解成所有上游都已调查。
- 此前已另外获取 Opus 和 libass 的**完整源码 TAR**，完整文件哈希见 `FFMPEG-RECIPE-SOURCE-AUDIT.md`；本轮这 49 份文件的归档不等于新的 27 份完整源码 TAR。

## 人工许可证审核重点

**禁止用关键词出现 “GNU General Public License” 就自动认定为 GPL-only**：部分 LGPL 许可证正文也会引用通用 GPL 文句。实际读取的固定源码例子包括：

- `libgme/game-music-emu` 根目录 `license.txt` 内容开头是 GNU Lesser General Public License v2.1，同时仓库还携带 `license.gpl2.txt`；必须确认对应具体模块及其分发义务。
- `Haivision/srt` 根目录 `LICENSE` 内容开头是 Mozilla Public License 2.0；需要核查源文件额外声明和编译时适用要求。
- `njh/twolame` 的 `COPYING` 开头为 LGPL v2.1。
- `libass` 的 `COPYING` 为 ISC License，`opus` 源码 `COPYING` 是 BSD 风格条款且附专利相关信息，不能仅用统一许可证标签替代各原文。

因此**49 个原始文本 SHA 验证通过**只意味着“文件来源真实”，并不意味着各包许可链已审结、当前原生 ffmpeg.exe 与这些源码对应，或已经履行所有源代码提供、版权通知和静态 LGPLv3 重新链接材料义务。

## 仍需完成的实际工作

1. 13 个非 GitHub 托管仓库在精确 Git/SVN 修订处取得完整源码与许可证。
2. 29 个 GitHub 仓库当前仅证明根文件可读取，仍需逐库完整源码 TAR、子模块和 vendored 第三方源码、其他目录的 NOTICE、以及脚本依赖闭包。
3. 关联每个上游源码、补丁、构建参数及二进制哈希，核验所选 FFmpeg Windows x64 LGPL 静态构建确实由对应源码生成。没有完整复现证据就不能给 `approvedForDistribution` 置 true。
4. 解决 BtbN 2026-10-05 非月末 daily build 的短保留期问题；审查 Windows 11 干净环境与历史正式签名升级。
5. 项目自己的许可证和图标/素材权属、GitHub 发布者签名及受保护环境审批必须最终由有权人确认。

**结论：来源根文件取证 PASS_WITH_RISKS；FFmpeg 完整合规未通过；公众发布 FAIL。**
