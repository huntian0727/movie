# FFmpeg Lite 二进制—源码核验表

**日期：2026-10-09 · 状态：未批准公开分发**

本清单只记录 **B5 家用电脑上经过实际 SHA-256 验证的候选文件**。文件名、上游项目、版本号或许可证文本，都不等于“能够证明该 DLL 恰好由这个精确源码编译”。逐文件的 SHA-256 请以 [SPDX 清单](FFMPEG-LITE-SBOM.spdx.json) 和 [固定归档锁](../../scripts/native-media-lite.lock.json) 为准。

| 文件 | 来源线索 | 实际已核验 | 剩余问题 |
| --- | --- | --- | --- |
| `ffmpeg.exe` | FFmpeg 8.1.2，发行方 serversideup `v8.1.2-27` | 归档哈希、EXE 哈希、上游 FFmpeg 8.1.2 TAR 完整性、固定 tag 的 Windows 构建脚本 | 尚未从该源码复现 EXE，也未备齐 LGPL 静态链接重新链接材料 |
| `ffprobe.exe` | 同一上游发行归档 | 归档、EXE、源码和构建脚本均已定位并校验 | 同上 |
| `libvpl-2.dll` | Intel oneVPL / MSYS2 `mingw-w64-x86_64-libvpl`，源码参考 `https://github.com/intel/libvpl` | 精确 DLL SHA、Windows PE 文件资源报告版本 **2.17.0.0**、随包 MIT 文本 | **文件资源版本不等于 MSYS2 包的确切版本/构建哈希**；对应源码包与包签名未验证 |
| `libopenh264-7.dll` | Cisco OpenH264 / MSYS2 `mingw-w64-x86_64-openh264`，源码参考 `https://github.com/cisco/openh264` | 精确 DLL SHA、随包 Cisco 版权及 BSD 风格声明 | ABI 后缀 `7` **不是**经验证的库版本；匹配源码、构建记录、通知仍待确认 |
| `libwinpthread-1.dll` | mingw-w64 pthreads runtime，`https://www.mingw-w64.org/` | 精确 DLL SHA、随包宽松许可声明 | Windows 资源 `1.0.0.0` 不是所用 MSYS2 包版本；具体源码与构建来源待核 |
| `libgcc_s_seh-1.dll` | GCC unwinder runtime，`https://gcc.gnu.org/` | 精确 DLL SHA；GPLv3 文本及 GCC Runtime Library Exception 3.1 官方原文已经分别归档 | **只取得例外许可文本，不等于证明此 DLL 的特定二进制属于例外覆盖范围**；精确 GCC/MSYS2 源码版本未核 |
| `libstdc++-6.dll` | GCC C++ runtime，`https://gcc.gnu.org/` | 精确 DLL SHA；同上 | 精确 GCC/MSYS2 版本、完整源码/通知和例外适用范围待核 |

## 目前有真实证据的主源码

- FFmpeg 原版 tarball：`ffmpeg-8.1.2.tar.xz`，**11,710,924 字节**，SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`，TAR 全量 10,230 项成功读取。
- 构建源脚本 tarball：`ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz`，**32,279 字节**，SHA-256 `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e`，固定 Git Commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`，12 个条目，含 Windows 脚本和固定源码校验。
- 原始 Git 仓库没有包含这两份大型 TAR；它们仅保存在**家用 B5** 隔离目录 `D:/CodexReleaseAudit/ffmpeg-lite-20261009/legal-source/`。公众发布前还需确定长期提供对应源码的方案，不能以本地临时保存视为履行所有源码提供义务。
- GCC Runtime Library Exception 文本：源自 `gcc-mirror/gcc` tag `releases/gcc-16.1.0`，SHA-256 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`。此 tag 用来**核验通用许可证原文**，不是声明原 DLL 编译自 GCC 16.1.0。

## 关于分发

`scripts/generate-native-lite-sbom.mjs` 必须读取本地**真实候选文件**并核验原始锁定哈希才产生 [SPDX 2.3](FFMPEG-LITE-SBOM.spdx.json)。未知许可证、未知二进制与源码关联，一律标记为 `NOASSERTION` / **EXACT_MSYS2_PACKAGE_AND_SOURCE_NOT_VERIFIED**，不虚构 SPDX 完成证明。

当前 `build/release-approval.json` 的 `approved=false`，**没有任何人可以仅凭此 SBOM 解锁公众安装包**。下一步必须收集准确的 MSYS2 原始 PKGINFO / BUILDINFO / 版本和源包，确认 `libvpl` / `openh264` / GCC 运行时各自适用许可证与全部声明，并给最终发行提供干净 Windows 11 安装证据。
