# 个人免费开源版：最简发布说明

> 适用于《映匣》/当前 Windows 安装程序“拉面影视”。目标：不盈利、不买代码签名证书，让朋友能下载使用。**本文件是实际发行入口**；原来的详尽审计记录仍保留供程序员追溯，但普通发布不用逐篇阅读。

## 只做这三件事

1. **写清归属。** 项目自有代码按仓库 [MIT LICENSE](../LICENSE) 开源。软件“设置 → 关于与许可证”与 [第三方声明](../THIRD_PARTY_LICENSES.md) 已说明 FFmpeg 和关联 DLL 不是项目自己的版权；正式安装器还要实际包含对应许可证文件。
2. **源码跟着安装包。** FFmpeg 8.1.2 的主源码、构建脚本、四份 MSYS2 原生依赖源码及许可材料已经在家用 B5 组成一个约 239 MB 的私人审核 ZIP，并核对 SHA-256。**还未公开提供**。正式下载页要与安装包一起提供适用的对应源码、编译说明和许可证（若特定 LGPL 静态链接要求重链接材料，也要一起满足）。不必购买商业许可、打电话给 FFmpeg 或准备公司法务审批。
3. **用少量合成视频测一次安装。** 用与真实个人数据隔离的 Windows 环境试安装、首次运行、扫描、封面、播放、卸载，确认视频和 SQLite 没被删。现有 B5 自动 smoke 通过，但独立干净稳定 Win11 的真实操作验收仍没做；这是软件质量把关，不是 FFmpeg 的许可证条款。

**FFmpeg 静态构建：优先保留，无须现在更换。** 已从真实 FFmpeg 8.1.2 源码压缩包逐项查验 `fftools/ffmpeg.c`、`fftools/ffprobe.c` 均标注 LGPL v2.1+，并包含 `configure`、`Makefile`、LGPL 许可证和固定 Windows 构建脚本；构建脚本及 EXE 自身参数确认禁用 GPL/nonfree/version3。这为使用 LGPL §6(a) 的**完整源码、可修改并重新编译/重新链接**路线提供了直接的技术基础。映匣本身只通过独立进程调用 FFmpeg，因此不需要把 Electron 应用当作直接静态链接 FFmpeg 库的代码来处理。不过现有证据**尚未证明用附带说明就能成功重编译替换后的 FFmpeg**，也不自动排除第三方库的独立义务。最后只需对该具体路线做一次确认；若确实走不通，再选易合规的动态构建，不重复审计相同源码。参阅 [FFmpeg 官方清单](https://ffmpeg.org/legal.html) 与 [LGPL 2.1 §6](https://opensource.org/license/lgpl-2-1)。

## 已准备好的 FFmpeg 源码附件（仅家用 B5、本地待发布候选）

已用 [固定归档脚本](../scripts/prepare-ffmpeg-source-companion.ps1) 从之前已验证的私人 REVIEW-v2 包整理出**一份普通用户可解压的源码 ZIP**。其 15 个文件已逐项重新读取并核对 SHA-256，未发现扫描范围内的本机私人路径或凭据文字。文件仅保存在 B5：

- 文件：`D:\CodexReleaseAudit\ffmpeg-lite-20261009\community-release-companion-20261010\FFmpeg-Lite-8.1.2-Windows-x64-SOURCES-CANDIDATE.zip`
- 大小：239,498,523 字节；SHA-256：`a996afcfd3f2601d0ef324f635d2c63adbb3abfb441c1d5aa0c87652db3258b4`
- 外部校验文件：同目录的 `SHA256SUMS-SOURCE.txt`。
- **仅说明材料已准备并校验完整**；并未上传 GitHub，没有对应正式安装器，也没有自动解除静态链接许可/发行验证限制。

## 实际离线发布附件（已在家用 B5 生成）

已经通过 [自动打包脚本](../scripts/prepare-community-release-attachments.mjs) 生成发布资料预备目录 `D:\\CodexReleaseAudit\\movie-community-support-20261010`，包含 FFmpeg Lite 的固定源码压缩包、MIT/LGPL 许可证、第三方组件声明、SBOM、编译选项、发布说明草稿、`SHA256SUMS.txt` 和状态清单。**10 个附件逐一哈希核验通过；不含 EXE，尚未公开发布。** 目前先完成其余工程准备，按维护者最新安排，办公电脑 D200707 只允许作为最后阶段的**隔离 Windows 11 验收环境宿主机**，不会在其实际办公系统安装映匣、运行研发任务或读取企业数据。

## 最终 GitHub Release 放什么

| 附件 | 作用 |
| --- | --- |
| `拉面影视-0.1.15-x64-unsigned-public-Setup.exe` | 实际获准的**社区版身份**安装程序，绝不能拿 `unsigned-test-build` 改名充数 |
| `SHA256SUMS.txt` | 核对实际安装器和源码附件 SHA-256 |
| 经最终核验的 FFmpeg 对应源码 ZIP（包含必要重链接材料，如适用） | 必须与本次二进制确实对应，可供下载 |
| `THIRD_PARTY_LICENSES.md` / `FFMPEG_BUILD_INFO.md` 和对应许可证文本 | 说明版权归属、构建方式、源码下载方法 |

这里**没有已经存在的公众版安装包和对应源码下载链接**。私人 ZIP 的完整哈希与内容见 [源码获取说明](legal/FFMPEG_SOURCE_NOTICE.md)，不能把它写成已上传。具体版号以正式发行时的 `package.json` 为准。公开页同时写明：“未进行代码签名，Windows 可能提示未知发布者；只从官方 GitHub Release 下载并自行核对 SHA-256。无需关闭系统安全防护”。

## 发布时的最短操作流程

**准备素材 → 核实 FFmpeg 静态许可要求 → 测试安装包 → 同一 GitHub Release 一次性上传安装器与对应源码。**

- **普通用户只需做一个最终决定：** 确认项目自有代码和素材可以公开分享，并确认发布。当次附带的第三方版权/源码材料必须真实且可访问。
- 技术工作由维护者/开发助手完成：核对 FFmpeg、7 个媒体二进制和源码的 SHA，完成对应 LGPL 材料，跑现有回归及安装安全 smoke，按项目已实现的独立社区身份打包、再核对附件。GitHub Actions 中的安全和分发门禁是内部工程实现，不要求用户学习复杂参数。
- **目前尚不能宣称 FFmpeg 分发合规已经闭环或公开发布已获批准。** 原有 [安全发行脚本说明](COMMUNITY_CANDIDATE_RUNBOOK.md) 和 [审批证据记录](legal/LICENSE_COMPLIANCE_CHECKLIST.md) 是内部详单；不应把它们误写成法律强制要求的企业审计手续。

已完成的材料不再重复下载或重复审核。**免费、非商业分享仍须满足所带第三方软件的适用许可证。** 这份简明指引不降低实际义务，也不代替适用问题的专业判断。
