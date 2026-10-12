# 同批共享运行库：发行材料核对

日期：2026-10-13（Asia/Shanghai）。此记录针对原生生产批次 `38134981406`，不适用于旧 Lite、旧 GPL 播放器或其他哈希的运行库。它记录工程核验和发行时拟履行的条件；**不是公开发行批准**。`build/native-source-approval.json` 和总发布批准保持 false。

## 固定输入与实际使用范围

- 原生 ZIP：`3b4b4d22a3cf303b05898dedd470a6f05b0bfaa532c4ca9ab481167cd8f21b99`。
- 对应源码/工具链 ZIP：`3e242199da78c68939ebcbc8bb70bae4c2e57102b7aadc5ceb6b54317880e70a`，255050585 字节。25 个源码输入逐一重新核对长度与 SHA-256。
- 程序含 39 个 PE 安装位置：14 个媒体工具文件、24 个播放器 DLL、NativeHost。同一 DLL 在两个目录出现时分别核对，但不要求重复进行相同上游材料的审阅。文件/源码映射见 `NATIVE-SOURCE-CANDIDATE-REVIEW-INDEX.json` 和两个 source lock。
- 原始生产 CI 的 FAIL 与 `closureValid:false` 不改写；失败原因是两个 Windows 系统导入没有被打包器分类，先前另有实际 Microsoft 系统 DLL/import 核验。它不是许可证批准，也不是一次成功的冷重编译。
- 实际 CI 日志中的 244 个 libmpv C 编译对象全部对应固定 mpv 源码，未见上游 Copyright 列出的 GPL 专用实现。199 个文件带 LGPL 头、6 个带 ISC 头，39 个未带顶端许可声明，按同 revision 的上游 Copyright 缺省规则审阅。字面 include 闭包有 427 个文件，它是保守收集范围，不能声称每个条件分支都参与编译。
- 新补充文件 `NATIVE-SOURCE-COMPILED-NOTICES.txt` 中 mpv 部分有 311 条文件记录、64 份去重原文，包括 Chromium 音频算法 BSD 声明及 mpv ISC 声明；shaderc 构建中的 298 个库源码及其字面 include 也已对应固定源码。为保留其他依赖的文件级作者声明，补充材料还保守收录留存源树的声明，总共 11359 条文件记录、5936 份去重原文。额外源树记录有明确 source-only scope，不据此宣称未链接的测试/GPL 实现进入 DLL。原 95 条/70 份完整上游许可证继续保留，所有源码正文不改动。

## 组件及适用条款

下表的条款来自留存源码中的原始许可证、版权头和工具链 copyright。完整原文在两个 notices 文件以及源码包内，具体源码归档哈希在 review index 中。本文不将自有 MIT 许可证套用到第三方代码。

| 实际运行库组件 | 原始条款/需保留的条件 | 对应证据与处理 |
| --- | --- | --- |
| libmpv | LGPL-2.1-or-later；部分 BSD-3-Clause、ISC | 固定 Copyright、实际 244 个编译对象、Chromium BSD/ISC 补充原文；动态 DLL |
| FFmpeg/FFprobe/libav*/sw* | LGPL-2.1-or-later；源码内另有未选用 GPL 实现 | 实际 configure/构建摘要报告 LGPL 2.1 or later，GPL/nonfree disabled，共享构建；CLI 独立进程，libav* 动态依赖；提供实际源码与配置 |
| libgcc/libstdc++/libssp | GPL-3.0-or-later WITH GCC-exception-3.1 | 发行版工具链 copyright 明确列出三个运行库；GCC 13.2.0-6ubuntu1 基础/补丁源码与完整 exception 已留存；不因使用编译器就把应用改标 GPL |
| MinGW-w64 winpthreads | 上游 COPYING 的 MIT/BSD 条款 | winpthreads 原始 COPYING 与精确 MinGW-w64 11.0.1 源码；完整原文保留 |
| zlib-ng 2.3.3 | Zlib | 完整 LICENSE.md、源代码；不误称自己编写，不删除许可 |
| dav1d | BSD-2-Clause | 保留 VideoLAN/dav1d 版权、两项条件及免责声明 |
| Vulkan-Loader | Apache-2.0 | 完整 LICENSE、源码；Windows 系统 DLL 不作为本项目文件重新分发 |
| SPIRV-Cross | Apache-2.0；Khronos 规范头另有 free-use 条款 | LICENSE 与 LicenseRef-KhronosFreeUse 原文并存，不把规范头的条款替换成 Apache |
| shaderc | Apache-2.0；静态依赖 glslang、SPIRV-Tools、SPIRV-Headers 各有条款 | 留存递归源码 revision；glslang 的 BSD/MIT 等许可、SPIRV-Tools Apache、SPIRV-Headers Khronos free-use 原文齐备；SHADERC_SKIP_TESTS=ON |
| libplacebo | LGPL-2.1-or-later；glad/fast_float/Vulkan-Headers 有独立条款 | src/common.h 的 later-version 授权；glad 的 MIT/规范条款、fast_float MIT 选项、Vulkan 头许可均保留；demos=false |
| lcms2 | MIT 核心；GPL 插件源码另列 | 核心 MIT 与 GPL 插件文本分别保留，不能把未分发的插件许可证当作整个核心 DLL 的许可证；本批动态核心，tests/utils disabled |
| curl 8.20.0 | curl license | 保留版权、许可、免责及禁止未经许可用权利人姓名作推广的条款；使用 Windows Schannel 配置 |
| libass | ISC | 上游 COPYING 的完整版权、许可与免责；没有将其误标 BSD 或 GPL |
| HarfBuzz 14.2.0 | Old MIT；src/ms-use 与源码测试资料另有条款 | 完整 COPYING 与子目录文本；源码包中的 OFL/Apache 测试资料保留自己的许可，不能因打包源码就改标为 MIT |
| FreeType 2.14.3 | 选择 FTL；保留原有其他选项 | 完整 FTL 与版权；声明本软件使用 FreeType Project，版权归其贡献者；不声称其代码归 Movie 所有 |
| FriBidi 1.0.16 | LGPL-2.1-or-later | lib/fribidi.c 明确 2.1 或后续版本；完整 COPYING/源码；动态 DLL |
| LuaJIT（静态进入 libmpv） | MIT | COPYRIGHT 与源代码留存；实际 recipe 明确 BUILDMODE=static，不能从 PE import 缺少 LuaJIT DLL 推导它没有进入 libmpv |
| AMD AMF / NVIDIA codec / Vulkan headers | 各自头文件 MIT/free-use/Apache 条款 | 原始头版权、完整相关许可原文与固定源码输入；不将头文件声明当成硬件驱动的授权 |
| NativeHost | 项目自有 MIT；.NET Framework 系统依赖 | `native/embedded-mpv/NativeHost.cs`、固定编译工具/引用 pin、构建脚本；没有把编译器或系统 .NET 程序打进发行 ZIP |

## 拟采用的共享库发行条件

mpv、FFmpeg、libplacebo、FriBidi 的上游授权包含 later-version 选择。本路线拟对这些 LGPL 部分按 LGPLv3 条件履约，以保留与 Apache-2.0 相关依赖的兼容路径；应用自身 MIT 不因此改为 GPL。上游原有 2.1/or-later 声明保持不动，新增 `GNU-LGPLv3.txt` 与 `GNU-GPLv3.txt` 从固定 FFmpeg 源码归档逐字复制，未改写正文。[mpv 同 revision Copyright](https://github.com/mpv-player/mpv/blob/d94d09581474d6e91d7a0e544b07de4eb8b07a9f/Copyright)、[LGPLv3 条款](https://spdx.org/licenses/LGPL-3.0-or-later.html)、[Apache 的兼容性说明](https://www.apache.org/licenses/GPL-compatibility.html)。

工程实现按共享库机制提供可替换的 DLL：NativeHost 使用 DLL 名称调用 mpv 接口；应用启动检查文件是否存在，没有对使用者替换的 libmpv 做 SHA/签名白名单拦截。发布前打包校验固定官方文件，与用户运行时修改库的权利区分。兼容的修改版应保持 mpv 接口及其依赖兼容；应用退出后可替换 `resources/native-player/` 对应 DLL，媒体工具的动态库另在 `resources/media-tools/`。不限制为调试这类修改所需的逆向工程。当前只有实际代码检查和既有共享库运行证据，不声称已修改 LGPL 源码并完成冷重编译。

拟公开时同时提供完整对应源码与构建材料：原始 25 份输入、递归源码 revision、实际 configure/recipe、编译器/MinGW 源码和补丁、NativeHost 源码及其固定构建资料。下载页必须在程序旁给出该版本对应源码的免费链接，不能用浮动 upstream/main、私有 GitHub 草稿或仅一份 LICENSE 代替源码访问。[FFmpeg 官方发行清单](https://ffmpeg.org/legal.html)。

## 本次核验范围与最后动作

这次完成固定组件的条款清单、缺少的 mpv 文件级声明补齐和源码/编译对象对应证据。所有分发批准仍关闭，未把 notices 收集本身当作全项目许可证自动批准。未来正式包必须通过新增声明的逐字节检查，并同时提供对应源码与清楚的授权/替换说明；私有 QA 包的旧哈希不能冒充新增声明已存在。

源代码 ZIP 与最终应用 ZIP 尚未公开。稳定 Windows 11 标准用户覆盖仍未取得；已有本机沙盒是 Insider Preview，其五类声音/画面和绿色数据保留验收记录单独保存。最终维护者确认、审批记录与精确版本发布动作仍须在这些材料和实际测试范围都可审阅后进行。

## Reviewed material byte hashes

复制的上游 TXT 保留原始字节；自有文本/代码仅统一 CRLF/LF 后计算材料摘要。实际安装包与其构建源码之间仍采用原始 SHA-256 逐字节比较。正式 source 包还会核对以下固定材料与本记录一致，防止仅保留审阅表哈希却替换许可证正文。

```text
material-sha256 67a5adfb62bada52970413032afa8c5dce450e09c32d5abe99b472c16f2d4e72 LICENSE
material-sha256 6b3589755c6e11d4699763fd57923b86b1a25dd2260181a7a18992d95817496c THIRD_PARTY_LICENSES.md
material-sha256 7c46c0d0fe254c71a48e435554c7cb0444dad540719fcf0be407f065d893f7cf docs/legal/THIRD_PARTY_RELEASE_NOTICES.md
material-sha256 f715fc8162a7ec88d8b232579af4bd38cfafb3f8d14ac363848fb33535bcc1b0 docs/legal/FFMPEG_BUILD_INFO.md
material-sha256 43934164add41687c82333059de0c35566fde8d39ca85906c70b70bf4c5145af docs/legal/FFMPEG_SOURCE_NOTICE.md
material-sha256 d5018b31524f8ce7063f189364bca8e4d06e13996f2660f97e5462998774fb56 docs/legal/NATIVE_COMPONENTS.md
material-sha256 a00368570cc62cabdff059c20ca56e7bc64ed453fd9e4adb6653a8c58e25fcbf docs/legal/FFMPEG-LITE-SBOM.spdx.json
material-sha256 f3402b90f14974dc0dce19a99c3001ce50f9b10cbdb1b04b443a7e6bbb042803 docs/legal/MPV_SOURCE_NOTICE.md
material-sha256 5b044079a267f22b4ae497a9b29823a22753231427056228a9a8982f283ec359 docs/legal/NATIVE-SOURCE-CANDIDATE.md
material-sha256 449860a6387429f10d7b10087cd6053361c7becb898a22a8bc2f2dcfcbd63186 docs/legal/NATIVE-SOURCE-CANDIDATE-NOTICES.txt
material-sha256 0b7b82675bd372ecd85172b04d62719efa6f994ba9fac848897d6f02fb4107fb docs/legal/NATIVE-SOURCE-CANDIDATE-REVIEW-INDEX.json
material-sha256 246041b6ecf9bc32d718a62c57877c78b5eb397b6467e74ed7ae2626ab189c30 docs/legal/FFMPEG-SOURCE-CANDIDATE-LICENSE.txt
material-sha256 5af705f2dfaac18d8e89133d32538ef1c8955e5713a4f4950e54a52c2e8feea5 docs/legal/NATIVE-SOURCE-COMPILED-NOTICES.txt
material-sha256 92f3039a098d5251ed5604bcc2a5dcdb7344d0afd5652990bd11680c080f5956 docs/legal/NATIVE-SOURCE-COMPILE-REVIEW.json
material-sha256 8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903 docs/legal/GNU-GPLv3.txt
material-sha256 da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768 docs/legal/GNU-LGPLv3.txt
material-sha256 db5e94ee76f1b5fa3015e4f935d9fcad0c981eb8b9fb429322cdcf55696b5376 native/embedded-mpv/NativeHost.cs
material-sha256 0ecf25f02be8f93810ab2e4ef34edc4a4406a1ed93cf4e2e6bbe50b6462f27f8 scripts/build-native-player.mjs
material-sha256 fd71a9a4fb90fa06ec62ff1e8aba276e25929db9326da6735c2406da59cf1f09 scripts/native-player-toolchain.mjs
material-sha256 dbc59c9a468f0671b6f422a02da1d1fa46acd17acfd6123f309c926f8a8b73b8 scripts/native-player-toolchain.lock.json
```
