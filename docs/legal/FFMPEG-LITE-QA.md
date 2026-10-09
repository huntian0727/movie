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
