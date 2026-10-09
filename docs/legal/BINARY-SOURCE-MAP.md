# FFmpeg Lite 二进制—源码核验表

**日期：2026-10-09 · 状态：5/5 DLL 原始 MSYS2 二进制来源已确证；公开分发仍待最终源代码/许可证义务验收**

本清单记录 **B5 家用电脑上经过实际 SHA-256 验证的文件**。2026-10-09 已恢复原发布当天的 Windows GitHub Actions 构建日志，取得四份 MSYS2 发行二进制包，逐个读取包内 `.PKGINFO`、`.BUILDINFO`，并将五个 DLL 的实际文件内容与 Lite 原构建**逐字节哈希匹配（5/5 PASS）**。这证明匹配精确发行包，而不表示源码包、LGPL 重新链接义务及公开分发授权也已获准。详见 [精确 MSYS2 软件包证据](MSYS2-EXACT-PACKAGE-EVIDENCE.json) 与 [SPDX 清单](FFMPEG-LITE-SBOM.spdx.json)。

| 文件 | 来源线索 | 实际已核验 | 剩余问题 |
| --- | --- | --- | --- |
| `ffmpeg.exe` | FFmpeg 8.1.2，发行方 serversideup `v8.1.2-27` | 归档哈希、EXE 哈希、上游 FFmpeg 8.1.2 TAR 完整性、固定 tag 的 Windows 构建脚本 | 尚未从该源码复现 EXE，也未备齐 LGPL 静态链接重新链接材料 |
| `ffprobe.exe` | 同一上游发行归档 | 归档、EXE、源码和构建脚本均已定位并校验 | 同上 |
| `libvpl-2.dll` | Intel oneVPL / MSYS2 `mingw-w64-x86_64-libvpl 2.17.0-1` | 原始二进制包 SHA `3899c8e75e9b62cfff8b0987d70da3e2c142a075b94af45d868c3453d86aaece`、`.BUILDINFO`、实际 DLL SHA **完全一致**；包声明 MIT | 源码发行包及适用发布义务仍需归档复核 |
| `libopenh264-7.dll` | Cisco OpenH264 / MSYS2 `mingw-w64-x86_64-openh264 2.6.0-1` | 原始包 SHA `73988ace22048df42ae973873b770710bf019e0b070fc2b8084f1cf1993e14f0`、实际 DLL SHA **完全一致**；包声明 BSD-2-Clause | 对应源码及 OpenH264 分发条款仍需确认 |
| `libwinpthread-1.dll` | MSYS2 `mingw-w64-x86_64-libwinpthread 14.0.0.r179.g24aaa6147-1` | 原始包 SHA `8f12dc1be987165faab6363a159921553b4a2ac64e443cd0e7c501c343c2a92a`，DLL **完全一致**；包声明 MIT AND BSD-3-Clause-Clear | 对应源码及声明覆盖范围待最终复核 |
| `libgcc_s_seh-1.dll` | MSYS2 `mingw-w64-x86_64-gcc-libs 16.1.0-5` | 原始包 SHA `aa560f5438c35b71c3e7b24fd5becbca028f70c5b4d1f1697a86ff80fec947da`、DLL **完全一致**；包声明 GCC exception 3.1 等 | 相应源码、GNU 运行时例外适用范围和附属文本待最终复核 |
| `libstdc++-6.dll` | 与前项相同的 MSYS2 GCC runtime `16.1.0-5` | 同一原始包中的 `libstdc++-6.dll` SHA **完全一致**；完整 GCC 原始包和 BUILINFO 已核 | 对应源码、全部版权声明及 LGPL/GCC 例外范围待最终复核 |

## 目前有真实证据的主源码

- FFmpeg 原版 tarball：`ffmpeg-8.1.2.tar.xz`，**11,710,924 字节**，SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`，TAR 全量 10,230 项成功读取。
- 构建源脚本 tarball：`ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz`，**32,279 字节**，SHA-256 `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e`，固定 Git Commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`，12 个条目，含 Windows 脚本和固定源码校验。
- 原始 Git 仓库没有包含这两份大型 TAR；它们仅保存在**家用 B5** 隔离目录 `D:/CodexReleaseAudit/ffmpeg-lite-20261009/legal-source/`。公众发布前还需确定长期提供对应源码的方案，不能以本地临时保存视为履行所有源码提供义务。
- GCC Runtime Library Exception 文本：源自 `gcc-mirror/gcc` tag `releases/gcc-16.1.0`，SHA-256 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`。此 tag 用来**核验通用许可证原文**，不是声明原 DLL 编译自 GCC 16.1.0。

## 关于分发

`scripts/generate-native-lite-sbom.mjs` 必须读取本地**真实候选文件**并核验原始锁定哈希才产生 [SPDX 2.3](FFMPEG-LITE-SBOM.spdx.json)。未知许可证、未知二进制与源码关联，一律标记为 `NOASSERTION` / **EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED**，不虚构 SPDX 完成证明。

当前 `build/release-approval.json` 的 `approved=false`，**没有任何人可以仅凭此 SBOM 解锁公众安装包**。四个原始 MSYS2 二进制包、`.PKGINFO/.BUILDINFO`、确切版本以及五个 DLL 的字节匹配已完成。下一步只需完成源代码包/附带条款归档核对、FFmpeg 对应源码提供及独立干净 Windows 11 安装验收，之后再决定允许社区版正式发布。

## 2026-10-09 构建脚本原始字节补证

在已经完成四个 MSYS2 二进制包/五个 DLL 的逐字节 SHA 一致性后，再按每个包的 `.BUILDINFO.pkgbuild_sha256sum` 找回 **MSYS2/MINGW-packages 官方 Git 仓库内构建时间之前的历史 PKGBUILD**；实际下载四份 PKGBUILD、计算 SHA-256，并与每个包的 `.BUILDINFO` 精确比较：**4/4 PASS**。所有 Git commit、每个原始 PKGBUILD 的 SHA 和精确 URL 都固定在 [原包证据 JSON](MSYS2-EXACT-PACKAGE-EVIDENCE.json)，并由 `audit:msys2-provenance` 复查。

这已确认从构建工作流到 DLL 字节、软件包元数据及**确切打包构建脚本**的一致证据；但 PKGBUILD 只是源码获取、补丁与构建步骤的配方，不能替代其中引用的全部原始源码包，更不单独证明 LGPL 的完整再分发义务得到履行。
