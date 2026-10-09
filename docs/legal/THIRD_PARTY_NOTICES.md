# Third-party notices / 第三方材料索引

**只供候选核验。并非所有再分发义务都已履行。**

《映匣》自有代码使用仓库根目录 [MIT License](../../LICENSE)，并不会把第三方二进制、资源或许可证自动转成 MIT。

目前未签名的 FFmpeg Lite **隔离 QA 构建**中随包提供如下上游原始文本（位于安装目录 `resources/media-tools/`）：

| 项目 | 随安装包的原文名称 | 当前理解，不代表最终法律结论 |
| --- | --- | --- |
| FFmpeg 8.1.2 / FFprobe | `COPYING.LGPLv2.1`, `LICENSE.txt`, `SOURCE.txt`, `SOURCE-STATUS.txt` | 上游表述为 LGPL-2.1-only；包含静态链接与对应源码的相关义务 |
| Intel oneVPL / `libvpl-2.dll` | `LIBVPL-LICENSE.txt` | 上游文件为 MIT 许可文本，精确 DLL 包来源未核 |
| Cisco OpenH264 / `libopenh264-7.dll` | `LIBOPENH264-LICENSE.txt` | 上游文件为 BSD 风格文字；需核具体重分发条款与来源 |
| MinGW winpthreads / `libwinpthread-1.dll` | `LIBWINPTHREAD-LICENSE.txt` | 随包宽松许可文字，精确二进制包待确认 |
| GCC 运行时 / `libgcc_s_seh-1.dll`, `libstdc++-6.dll` | `GCC-LICENSE.txt`（候选归档）、`GCC-RUNTIME-LIBRARY-EXCEPTION.txt`（仓库 `resources/legal`） | GPLv3 文本及 GCC Runtime Library Exception 3.1 已留存；需根据实际 DLL 精确版本和相应头注判断覆盖 |

注意：`GCC-RUNTIME-LIBRARY-EXCEPTION.txt` 为单独从 GCC 官方固定 tag 取得的原文（保留原始字节；项目 `.gitattributes` 将此文件视为不进行换行转换的精确证据）。**找到法律文本并不等于认可其适用于所有 GCC DLL。**

此外 Electron、Chromium、npm 运行时、NativeHost 以及应用 UI 所包含第三方素材和源码，须分别按适用许可证处理。完整文件 SHA、实际文件来源及未满足条件见 [二进制—源码核验表](BINARY-SOURCE-MAP.md) 与 [机器 SBOM](FFMPEG-LITE-SBOM.spdx.json)。正式 Release 仍被批准清单拒绝。

## 来自原始 MSYS2 安装包的真实元数据（2026-10-09）

在固定 FFmpeg Lite 上游 GitHub Windows build [#29303740323](https://github.com/serversideup/ffmpeg-lgpl-builds/actions/runs/29303740323) 找到发布时的依赖版本后，家用 B5 已从 MSYS2 官方仓库下载原始历史 `.pkg.tar.zst` 二进制包 4 份，逐项核对安装包 SHA-256、`.PKGINFO` 和 `.BUILDINFO`，提取的全部五个 DLL **与本项目 Lite 归档字节完全一致**。

| 原始 MSYS2 包 | 精确版本 | 原包 `.PKGINFO` 声明的 SPDX 许可证 |
| --- | --- | --- |
| `mingw-w64-x86_64-libvpl` | `2.17.0-1` | `MIT` |
| `mingw-w64-x86_64-openh264` | `2.6.0-1` | `BSD-2-Clause` |
| `mingw-w64-x86_64-libwinpthread` | `14.0.0.r179.g24aaa6147-1` | `MIT AND BSD-3-Clause-Clear` |
| `mingw-w64-x86_64-gcc-libs` | `16.1.0-5` | `GPL-3.0-or-later WITH GCC-exception-3.1 AND LGPL-2.1-or-later` |

这些是**软件包级许可证声明**，不是逐个 DLL 经过法律分析后的最终 SPDX `licenseConcluded`；源代码包和 relinking 条款仍需最终复核，不能因发现许可证原文便擅自批准公开分发。机器可验证细节、包及 DLL SHA、原包构建人和完整源码归档地址，见 [MSYS2 精确包证据](MSYS2-EXACT-PACKAGE-EVIDENCE.json)。
