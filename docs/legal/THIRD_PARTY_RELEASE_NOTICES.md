# 第三方组件声明（公众发布前草案）

《映匣》自有代码以 [MIT License](../../LICENSE) 分享；FFmpeg、FFprobe 和附属 DLL 的版权和许可仍归各原权利人。开发者不计划商业化，软件可免费使用。

本项目尚未发布已批准的 Windows 安装包。未来若包含以下组件，需要随安装包或在官方下载页面提供其适用的许可证及对应源码：

- **FFmpeg / FFprobe 8.1.2**：上游构建报告 LGPL 2.1 适用，见 [FFmpeg 官方法律页](https://ffmpeg.org/legal.html) 和 [对应源码](SOURCE_OFFER.md)。实际打包包含 `COPYING.LGPLv2.1`、`SOURCE.txt`。
- **Intel oneVPL** `libvpl-2.dll`：MSYS2 `mingw-w64-x86_64-libvpl 2.17.0-1`；原包声明 MIT。
- **Cisco OpenH264** `libopenh264-7.dll`：MSYS2 `mingw-w64-x86_64-openh264 2.6.0-1`；原包声明 BSD-2-Clause。
- **MinGW winpthreads** `libwinpthread-1.dll`：MSYS2 `mingw-w64-x86_64-libwinpthread 14.0.0.r179.g24aaa6147-1`；原包声明 MIT AND BSD-3-Clause-Clear。
- **GCC Runtime** `libgcc_s_seh-1.dll` 与 `libstdc++-6.dll`：MSYS2 `mingw-w64-x86_64-gcc-libs 16.1.0-5`；原包整体声明 GPL-3.0-or-later WITH GCC-exception-3.1 AND LGPL-2.1-or-later。实际各个组件的许可适用性仍须核实。GCC Runtime Library Exception 3.1 原文见 [本仓库](GCC-RUNTIME-LIBRARY-EXCEPTION.txt)。

上述 MSYS2 版本来自真实 Windows [构建任务](https://github.com/serversideup/ffmpeg-lgpl-builds/actions/runs/29303740323)，且与候选 DLL 完全一致；[机器可读证据](MSYS2-EXACT-PACKAGE-EVIDENCE.json)、[SBOM](FFMPEG-LITE-SBOM.spdx.json) 已归档。Electron 和 npm 等其余第三方运行依赖也应保留原有各自许可。**请勿把此草案当成完成发行许可审核或任何批准。**
