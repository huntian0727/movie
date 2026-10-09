# FFmpeg Lite：Windows x64 隔离安装验收（2026-10-09）

**状态：内部测试通过；公众分发尚未放行。** 此候选是替代旧 BtbN 43 个外部库构建的收敛路线，不是项目已获得全部许可证和源码授权的声明。

## 精确输入

- 上游项目：[serversideup/ffmpeg-lgpl-builds](https://github.com/serversideup/ffmpeg-lgpl-builds)，Release `v8.1.2-27`，源 tag SHA `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`。
- 归档 `ffmpeg-8.1.2-x86_64-pc-windows-msvc.tar.gz`：27,486,819 字节，SHA-256 `fb2de01912edb449a5eba1cc487696c7f71ebb7b325e5c5c69434642ec2ba6b0`。校验与上游分发的 SHA-256 清单一致。
- `ffmpeg.exe`：`dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4`。
- `ffprobe.exe`：`57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8`。
- 候选启用 `--disable-gpl --disable-nonfree --disable-version3 --disable-autodetect`；报告中明确外部 FFmpeg 功能库为 `libvpl`、`libopenh264`。并含五份运行 DLL，锁定清单详见 `scripts/native-media-lite.lock.json`。
- 精确源码指向 FFmpeg 8.1.2 `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`，上游声称 SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`；**本轮并未下载核对完整对应源码**。
- 上游 `SOURCE.txt` 引用的 `GCC-RUNTIME-LIBRARY-EXCEPTION.txt` **不在 13 个归档条目中**，必须补足准确适用的通知/许可证及静态重新链接材料要求。二进制本身 `-L` 为 LGPL2.1。不得借源仓库里说明文字自动批准对外分发。

## 已执行真实测试

仅在家用电脑 **B5** 的隔离审计目录和独立 `com.local.video.manager.unsignedtest` 安装身份执行。未操作办公电脑、家用正式安装、视频或 SQLite。

- 13 个源文件的 SHA-256 / TAR 目录校验通过；运行 DLL 与 EXE 从未加入 Git 仓库。
- 独立合成 MP4 和重封装 MKV 的 `ffprobe` 时长、编码、分辨率核验 PASS。
- `ffmpeg` JPEG 封面及时间轴截图 PASS，常用内部解码器包括 H.264、HEVC、AV1、VP9、MPEG2、MPEG4、ProRes、VC1（列表能力不等于全部格式真实场景验证）。
- `MOVIE_MEDIA_VARIANT=lite-candidate` 时，现有 `prepare:media-tools` 以固定归档校验并单独写入被忽略的 `.tmp/native-media-lite-tools`；默认未设置时仍采用此前 BtbN 工具，保证回滚。
- 真实 `npm run package:dir` PASS、`verify:artifact` PASS（3,461 ASAR 条目，所有 EXE 和运行 DLL 精确一致）、`test:packaged-smoke` PASS（完整 UI 主进程/SQLite 及各统计查询）。
- 真实 `npm run dist:win` PASS、`release:metadata` PASS、`test:installer-smoke` PASS：空白目录安装、同包修复、卸载、非法删除数据标志拒绝，安装目录内外的合成视频与 SQLite 哈希不变，正式应用的注册表和快捷方式未改变。
- 媒体来源合同测试 **22/22 PASS**；全部修改只进入 PR Draft，不会变更 main 或正式 GitHub Release。
- 原先 BtbN 的 0.1.15 内部 QA 安装包已事先复制保存在家用 B5 的 `D:\CodexReleaseAudit\ffmpeg-lite-20261009\previous-btbn-unsigned-qa`。本次生成的新 QA 文件在工作区 `release/unsigned-test-build`，也**不是**公众发布包。

## 尚未满足公众发行的唯一关键项目

1. 获得且留存实际 Lite 构建及运行时 DLL 的准确对应源码、补丁/构建指令及全部完整版权和许可证通知，包括上游缺失的 GCC Runtime Library Exception；处理 LGPL 静态链接重新链接的实际义务。这比原 BtbN 构建所需审查的 43 个外部库显著少，但**不是零合规工作**。
2. 额外做一次**真正干净稳定 Windows 11**（非家用 Insider 开发机）的无 Node 安装和主要功能验收；既有正式版升级不可冒险自动运行，首发可选独立安装身份或明确不支持在旧版上直接覆盖安装。
3. 才允许启用带正式应用身份的、不需购买签名证书的 `unsigned-public-release` 发布门禁，公布 SHA-256。当前 CI 的 `unsigned-test-build` 保持私有 QA 专用，不改变 `build/release-approval.json` 的批准字段。

## 后续验证命令（只在隔离环境）

```powershell
$env:MOVIE_MEDIA_VARIANT = 'lite-candidate'
$env:MOVIE_LITE_MEDIA_ARCHIVE = 'D:\CodexReleaseAudit\ffmpeg-lite-20261009\ffmpeg-8.1.2-x86_64-pc-windows-msvc.tar.gz'
npm run prepare:media-tools
npm run package:dir
npm run verify:artifact
npm run test:packaged-smoke
npm run dist:win
npm run release:metadata
npm run test:installer-smoke
```

所有上面命令的 PASS 均是 **Windows 11 Insider 家用机实际执行**；真实普通用户干净 Win11 尚为 NOT_RUN。没有用代码签名证书、没有对外发行或覆盖正式安装。

## 2026-10-09 第三方许可与正式发行进度

已从 GCC 官方镜像仓库（`gcc-mirror/gcc`，`releases/gcc-16.1.0`，`COPYING.RUNTIME`）独立获取 GCC Runtime Library Exception **3.1** 原文，SHA-256 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`，并将声明归档到 [GCC-RUNTIME-LIBRARY-EXCEPTION.txt](GCC-RUNTIME-LIBRARY-EXCEPTION.txt)。原上游打包 SOURCE.txt 提及此文件但实际 TAR 中缺失的问题，**文本查找/随 App 法律目录打包**已有来源证据。注意这不证明 DLL 的准确对应版本、源代码/补丁、FFmpeg 8.1.2 的全部源与 LGPL 义务已完成。发行批准继续为 false。

现有代码已经预备正式未签名社区构建类型，采用独立 `community` app ID、GUID 和数据目录，仍会等待明确的第三方授权、干净 Win11 QA 和最后版本批准，见 [工作流](../release-workflow.md)。当前内部 QA 通过的 NSIS Setup **不可重命名为社区公开版**。

## 完整源码与构建脚本固定归档（2026-10-09 补充实测）

在**家用 B5** 的私人 `D:/CodexReleaseAudit/ffmpeg-lite-20261009/legal-source/` 下，已经实际保存并 SHA-256 验证以下两份源码归档，不再只是引用远程链接：

| 归档 | 大小 | SHA-256 | 验证 |
| --- | ---: | --- | --- |
| `ffmpeg-8.1.2.tar.xz`（来自 `https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz`） | 11,710,924 字节 | `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c` | 与发行包 `SOURCE.txt` / 上游固定源码哈希一致；完整 TAR 列出 10,230 项，退出码 0 |
| `ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz`（GitHub tagged commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`） | 32,279 字节 | `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e` | 完整 12 条目，含 `scripts/build-windows.sh`、固定 FFmpeg 源码哈希及 GitHub build workflow |

`build-windows.sh` 确认明确的 GCC/MINGW64 工具链及源码 SHA；但 `libvpl`、`openh264` 和其他运行 DLL 是通过 MSYS2 包取得，脚本本身没有固定每份包的**实际打包版本、对应源码和静态重链接材料**。因此这一步闭合“FFmpeg 主源码、构建脚本原文未在家用机归档”的缺口，**不能等价声称二进制整体可复现或 LGPL 全部义务已满足**。仍保持公开发布审批拒绝。

## 2026-10-09 重大进展：全部运行 DLL 精确匹配官方软件包

本次**实际取得原 FFmpeg Lite 发行日（2026-07-14）的 Windows Actions 构建日志**，GitHub workflow run `29303740323`、Windows job `86992785957`，固定构建 Commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`。将日志记录的 MSYS2 四份软件包版本全部从 `https://repo.msys2.org/mingw/mingw64/` 下载并 SHA-256 核验，分别读取 `.PKGINFO/.BUILDINFO`，对 DLL 原始字节重新计算 SHA。**4/4 原始软件包成功核对，5/5 动态 DLL 与 FFmpeg Lite 实际安装文件 SHA 完全相同**，GCC 的 `libgcc_s_seh-1.dll` 和 `libstdc++-6.dll` 均来自同一版本 `mingw-w64-x86_64-gcc-libs 16.1.0-5`。固定文件名/版本/包哈希已保存于 `scripts/native-msys2-package.lock.json`，可重复审计脚本 `scripts/audit-native-msys2-packages.mjs`，成果见 [原包精确字节证据](MSYS2-EXACT-PACKAGE-EVIDENCE.json)。

这**关闭了“到底从哪个 DLL 二进制包取得”的原始疑点**。源代码部分：四份对应官方源码归档地址已核实返回 HTTP 200，数据量共约 228 MB；B5 网络下载第一个源归档在 110 秒时只完成约 3.5 MB，已经停止耗时的批量下载，因此尚未声称“源包本地完全归档”。此前的 FFmpeg 核心源码及发布方构建脚本，仍然已经完整保存在 HOME D 盘。第三方源代码、通知/重新链接材料及独立干净稳定 Windows 11 测试未全部完成，故此工作**仍不构成合法公开分发的批准**。

## 2026-10-09 历史构建脚本 PKGBUILD 逐字节核验

四个原始软件包的 `.BUILDINFO` 各自存有 `pkgbuild_sha256sum`，本轮针对相应构建日期在 `msys2/MINGW-packages` 找回并固定 Git 历史提交。分别提取 **libvpl、OpenH264、winpthreads、GCC** 彼时 PKGBUILD 原文，四份 SHA-256 与 `.BUILDINFO` **完全一致**。对应原文及四份未解压的 MSYS2 二进制包归档在 B5 `D:/CodexReleaseAudit/ffmpeg-lite-20261009/msys2-*` 目录；仓库只保存可公开的哈希、Commit 与 URLs，而不提交 DLL 或临时数据。

复核命令：设置 `MOVIE_MSYS2_AUDIT_DIR` 为四份原始 `.pkg.tar.zst` 所在目录，设置 `MOVIE_MSYS2_PKGBUILD_DIR` 为四份 Git 历史 `PKGBUILD` 的目录，然后运行 `npm run audit:msys2-provenance`。任一软件包 SHA、包内 DLL、PKGINFO/BUILDINFO、构建脚本 SHA 或 Git 锁不符即失败。源代码本体和独立稳定 Win11 验收依然未批准；软件发行继续禁止。

## 2026-10-09 对应源码全量归档及新的验证（覆盖前面的历史未完成状态）

上方“仅下载部分源码”属于此前一次尝试的历史记录，**现已完成这部分工作**。本次经 USTC MSYS2 官方同步镜像，取得对应 `libvpl 2.17.0-1`、`openh264 2.6.0-1`、`winpthreads 14.0.0.r179.g24aaa6147-1`、`gcc 16.1.0-5` 的四份精确源代码压缩包，逐个验其 SHA、完整 TAR 内容和包内 `PKGBUILD` 的真实字节。全部四份包内构建脚本 SHA 均与原来实际二进制包 `.BUILDINFO` 匹配，**4/4 通过**。复现命令：配置 `MOVIE_MSYS2_SOURCE_DIR` 为家用 B5 的 `D:\CodexReleaseAudit\ffmpeg-lite-20261009\msys2-exact-source-packages`，运行 `npm run audit:msys2-sources`。项目内新增 [固定归档证据](MSYS2-EXACT-SOURCE-EVIDENCE.json)，并包含对格式和证据的 Node 合同测试。

完整审核源码包已组合成 B5 上仅内部留存的 `FFmpeg-Lite-8.1.2-corresponding-sources-REVIEW-v2.zip`，附逐文件 `SHA256SUMS.txt` 和 README。此进展只关闭**源码下载/归档**问题，不替代 LGPL 静态重链接材料核实、真实稳定干净 Win11 安装/播放验收和最终授权。
