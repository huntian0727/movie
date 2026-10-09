# FFmpeg Lite 对应源码获取说明 / Corresponding source information

**适用范围：候选 FFmpeg Lite 8.1.2（`serversideup/ffmpeg-lgpl-builds v8.1.2-27`）。状态：公众二进制尚未获准发布。**

《映匣》维护者提供自有代码的 MIT 授权，不代表拥有 FFmpeg、Cisco OpenH264、Intel oneVPL、GCC 或 MinGW 运行时源码的著作权。这些组件分别适用其原始许可证。此页是**源码对应证据索引与后续随 Release 交付的计划**，不是已经履行所有 LGPL 源码提供义务的声明。

## 已核实的对应材料

| 材料 | 固定版本/来源 | 核验结果 |
| --- | --- | --- |
| FFmpeg 8.1.2 主源码 | [上游压缩包](https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz) | SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`，11,710,924 字节，完整压缩包已保存于维护者家用 B5 |
| Windows FFmpeg Lite 发行方构建脚本 | [固定 Commit](https://github.com/serversideup/ffmpeg-lgpl-builds/tree/8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac) | Git Commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`，归档 SHA-256 `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e` |
| 发布当天 Windows 构建日志 | [Actions #29303740323](https://github.com/serversideup/ffmpeg-lgpl-builds/actions/runs/29303740323) | Windows 构建时的版本号，四份实际历史 MSYS2 包、五个 DLL 与原包字节匹配 |
| 第三方 MSYS2 包与配方 | [精确软件包证据](MSYS2-EXACT-PACKAGE-EVIDENCE.json) | 4/4 原始包哈希、5/5 DLL 哈希、4/4 当时的 PKGBUILD 配方与包内 BUILDINFO 完全匹配 |
| 二进制对应源码与许可索引 | [逐项明细](BINARY-SOURCE-MAP.md) | GCC、winpthreads、OpenH264 与 oneVPL 精确包源码地址已有固定链接，但其源归档尚未全部成功下载、复核与长期托管 |

## 公众 Release 前的源代码交付方式

公开安装包发布时，应在**同一个 GitHub Release 页面**提供以下材料或可以长期有效、同等方便获取的明确下载路径：FFmpeg 对应源码归档、发行方 Windows 构建脚本及变更/补丁、原生依赖的对应源码或适用的源码提供安排、全部许可文本和第三方声明。下载说明需明确一并随包的 FFmpeg 按 LGPL 2.1 相关条款分发。若需要重链接的目标代码、对象文件或构建步骤，须一并提供；不能只给主仓库的 MIT 源码。

此处**不宣称**现在尚未上架的 Release 附件已经存在，也不作无法履行的永久源码可用保证。具体源码下载链接必须在真实 Release 文件已经上传、SHA 已校验后替换成对应正式版本的 URL。

## 当前尚未完成

- 上述第三方 MSYS2 完整源码包（包括对应补丁、PKGBUILD 引用的外部源）尚未全部下载归档和核对；验证了二进制包不等于获取了所有对应源码。
- Lite FFmpeg/FFprobe 的 LGPL 构建方式、静态链接与所需重链接材料，需要按实际二进制进行最终核实。**不能把外部 EXE 单独启动等同于全部静态 LGPL 条款已满足**。
- 未进行独立稳定 Windows 11（无开发工具）真实安装/扫描/播放/卸载验收。

参考：[FFmpeg 官方许可与检查清单](https://ffmpeg.org/legal.html)、[精确 QA 实测](FFMPEG-LITE-QA.md)、[第三方原始声明](THIRD_PARTY_NOTICES.md)。FFmpeg 官方建议为所分发二进制提供**精确对应源码和构建说明**，并把获取路径放到应用下载页。故公开发布审批仍保持关闭。
