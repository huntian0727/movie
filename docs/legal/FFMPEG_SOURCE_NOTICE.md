# FFmpeg 对应源码交付说明 / Corresponding Source Notice

**发布状态：待正式审核；无公开安装包，亦无已上传的正式源码附件。** 本文说明已获得的材料、未来获取方式，以及未关闭的义务。用户已确认愿意随今后的公共版提供依法需要的第三方源码、许可和构建材料；这不是第三方合规批准。

## 精确候选版本

- `ffmpeg.exe` / `ffprobe.exe`：FFmpeg 8.1.2 Lite Windows x64；发行方 `serversideup/ffmpeg-lgpl-builds v8.1.2-27`。
- FFmpeg 原始源码：https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
- 固定构建脚本：https://github.com/serversideup/ffmpeg-lgpl-builds/tree/8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac
- 对应五个运行时 DLL：见 [原生组件与对应源码](NATIVE_COMPONENTS.md)。
- 构建参数、SHA256、静态链接详情见 [实际构建说明](FFMPEG_BUILD_INFO.md) 和 [待决 LGPL 专项](FFMPEG-LITE-RELINK-REVIEW.md)。

## 本地已核验、但**尚未公开分发**的审核包

私有位置（仅家用 B5 维护者文件夹）：

`D:/CodexReleaseAudit/ffmpeg-lite-20261009/FFmpeg-Lite-8.1.2-corresponding-sources-REVIEW-v2.zip`

- 239,488,121 字节
- SHA-256 `6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4`
- 14 项 ZIP 条目，其中 13 项来源及声明文件 + `SHA256SUMS.txt` 清单；实际已逐项匹配 13/13 条内容 SHA-256。
- 包含 FFmpeg 8.1.2 原始源码归档、固定 Windows 构建脚本、四份 MSYS2 精确源码包、许可证/构建证据与对应映射。
- 此包是**审核候选**，名称、结构与公开附件可能不同；完整性检查不等于法律适用性审查或字节级可重复构建。

## 将来正式 GitHub Release 必须一起交付

1. 经最终审查的、与实际公开二进制版本严格对应的 FFmpeg 及运行依赖源码、补丁或变更（若有）、构建命令、许可证正文；必要时还包括可供用户重链接的对象文件、修改/替换库说明及其他 LGPL 条款要求的材料。
2. 安装包本体、`SHA256SUMS.txt`、原生组件清单 / SPDX、第三方声明、[构建信息](FFMPEG_BUILD_INFO.md) 和 [许可清单](LICENSE_COMPLIANCE_CHECKLIST.md)。
3. **同一发布页面真实可访问的文件与链接**；不能以尚未上传的私有 ZIP 或一个泛泛的上游 GitHub 首页取代当次分发义务。
4. 对真实公开安装器及所有附件重新计算 SHA256，并验证文件内容和下载地址。若审核后需要生成新的重链接材料，重新封装并重新记录哈希。

> Future release text (only after assets actually exist): “This application uses FFmpeg under the applicable LGPL license. The exact corresponding sources, third-party license texts, build instructions and any required relinking materials for this release are available as assets on this same release page.”
>
> 发布前不得删掉这个条件，也不得填写不存在的下载链接。

## 尚须人工确认

静态 FFmpeg 可执行文件自身 LGPL 条款的适用履行情况；OpenH264、oneVPL、MinGW 和 GCC Runtime 的具体许可与组件限制；是否存在必须随包提供的重新链接材料。参阅 [FFmpeg 官方法律页面](https://ffmpeg.org/legal.html) 和 [LGPL v2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)。最终结论必须基于实际构建和书面证据，不能靠脚本修改 `approved=false` 取得。
