# FFmpeg Lite 8.1.2 静态构建：发行前的最终合规判断记录

**状态：待审核 / NOT APPROVED。** 这是技术证据和待决策问题，不是法律意见或可分发许可。2026-10-10 在家用 B5 的精确测试二进制上复核。

## 已观察到的事实

- 核验对象：`serversideup/ffmpeg-lgpl-builds` `v8.1.2-27` Windows x64 的 `ffmpeg.exe` 和 `ffprobe.exe`，固定来源哈希详见 [Lite QA](FFMPEG-LITE-QA.md)。
- 实际 `ffmpeg.exe` SHA-256：`dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4`。
- 从该真实 EXE 执行 `-buildconf`，确认 `--disable-gpl --disable-nonfree --disable-version3 --enable-static --disable-shared --enable-libvpl --enable-libopenh264`。
- 发行候选压缩包随附 FFmpeg/FFprobe、五个运行时 DLL 与许可文本；未发现可替换的 libav* 共享 DLL。因此**不能简单按 FFmpeg 动态链接建议路径放行**。需区分 FFmpeg CLI 自身的静态库链接与应用作为独立进程调用 CLI 的关系，按具体结构审查条款。
- 已取得并核验 FFmpeg 主源码、发行方 Windows 构建脚本、四份精确历史 MSYS2 对应源码包与 PKGBUILD、全部五个原 DLL 的来源。封存于 B5 私有 `FFmpeg-Lite-8.1.2-corresponding-sources-REVIEW-v2.zip`：239,488,121 字节，SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`，14 个文件条目。**仅为审核包，不是公开源码发布。**

## 分发前必须完成的判断（不能靠修改布尔值代替）

1. **LGPL §6 适用方式。** 核实该静态链接 FFmpeg CLI 的完整对应源码、补丁、构建命令是否足以让用户构建修改后的版本；如有适用的对象文件/重链接要求，归档并提供，或改用可满足要求的动态版本重新做全部媒体及安装回归。
2. **按组件核对权利与通知。** FFmpeg 的 LGPLv2.1、OpenH264 BSD-2-Clause、oneVPL MIT、winpthreads 和 GCC Runtime Library Exception 的准确适用性、版本及原文，区分各 DLL 的适用许可。不得笼统认为整个二进制都是 MIT。
3. **公开交付。** 正式安装包旁边提供精确对应的源码材料、构建脚本、补丁/差异、许可证通知和显著源码获取链接；需要时附重链接材料。当前审核 ZIP 不能因「已有」而算「已提供给用户」。
4. **所有者核实。** `ownersConfirmed` 必须有对项目自有代码、贡献、图标及素材的实际授权核对证据。
5. **留审查结论。** 审查人、日期、适用条款、对应文件 SHA、选用的合规交付路线及未解决风险形成文字结论，之后再更新机器审批文件，不得由检查脚本自批。

参考第一手依据：[FFmpeg 官方发布许可清单](https://ffmpeg.org/legal.html)（建议 LGPL 构建使用共享库并提供同版源码、编译方法和下载页声明）；[GNU LGPL 2.1 §6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)；[GNU GNU GPL/LGPL FAQ: 静态与动态链接](https://www.gnu.org/licenses/gpl-faq.html#LGPLStaticVsDynamic)。上游发布方 README 对「链接源码 URL 即足够」的概括**不能代替本发行人的逐项义务核对**。

## 立即可选的安全路径

- **路径 A（优先少改代码）：** 保留已通过测试的 Lite 二进制，补齐相应发行合规确认和真实可访问的对应源码/重链接材料，完成正式审核，再分发。
- **路径 B（若 A 无法满足）：** 选择有完整 LGPL 对应材料的动态构建，固定 EXE/DLL/许可/SHA，重跑扫描、预览、播放和安装回归；这属于新的发布候选，旧哈希和原 QA 不能沿用。
- **路径 C（暂停二进制）：** 只开放现有 MIT 授权部分的源码；明确普通用户暂时无独立安装包。不能把源码发布冒充已完成安装包发行。

未经审核：保持 `build/release-approval.json.approved=false`、媒体候选 `distributable=false`，不要改名/上传 `unsigned-test-build`。
