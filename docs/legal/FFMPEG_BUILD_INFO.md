# FFmpeg Lite 8.1.2 — 已核验构建信息

**适用范围：仅限 Windows x64 内部 QA 候选，不是公开二进制分发批准。** 2026-10-10 在 B5 读取候选 `ffmpeg.exe -hide_banner -buildconf` 和 `ffmpeg.exe -version`，对照 [固定二进制清单](../../scripts/native-media-lite.lock.json)。

## 发行方与集成方式

- 上游项目：[FFmpeg](https://ffmpeg.org) 8.1.2；二进制构建来自 [serversideup/ffmpeg-lgpl-builds](https://github.com/serversideup/ffmpeg-lgpl-builds) 的 `v8.1.2-27`，Windows x64，固定构建脚本 Commit `8bd22e8859595e7b9f5d58cbf7af59c04fbe2fac`。
- 构建日志：[Windows Actions #29303740323](https://github.com/serversideup/ffmpeg-lgpl-builds/actions/runs/29303740323)。实测编译器：`gcc 16.1.0 (Rev5, Built by MSYS2 project)`。
- 映匣通过 `src/main/media/mediaBinaries.ts` 解析并调用随包 `ffmpeg.exe`、`ffprobe.exe` **独立进程**；不直接将 FFmpeg libav* 链入 Electron 应用本体。
- **必须分别审查** FFmpeg CLI 内部 FFmpeg 库的静态链接义务；外部进程调用不会消除随包可执行文件自身的许可证义务。
- 当前 QA 候选采用 `--enable-static --disable-shared`；不存在可据此认定已满足全部 LGPL 重链接条件的动态 FFmpeg 库替换路径。详见 [专项审查](FFMPEG-LITE-RELINK-REVIEW.md)。

## 二进制精确 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `ffmpeg.exe` | `dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4` |
| `ffprobe.exe` | `57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8` |

其余五个 DLL 的精确字节哈希参阅 [原生组件表](NATIVE_COMPONENTS.md)。如更新任一二进制，不得沿用上面的数值、源码包或测试结果。

## 从实际 ffmpeg.exe 读出的完整 configure 配置

以下不是按通用模板猜测，而是 `-buildconf` 的实际值（路径属于发行方的 CI，不是当前用户个人路径）：

```text
--prefix=/c/actions-runner/ffmpeg-lgpl-builds/ffmpeg-lgpl-builds/build/x86_64-pc-windows-msvc/install
--disable-gpl
--disable-nonfree
--disable-version3
--disable-autodetect
--enable-static
--disable-shared
--disable-programs
--enable-ffmpeg
--enable-ffprobe
--disable-doc
--disable-htmlpages
--disable-manpages
--disable-podpages
--disable-txtpages
--disable-debug
--enable-ffnvcodec
--enable-nvenc
--enable-amf
--enable-libvpl
--enable-libopenh264
--enable-schannel
--enable-encoder='h264_nvenc,hevc_nvenc,h264_amf,hevc_amf,h264_qsv,hevc_qsv,libopenh264,aac'
--enable-decoder='h264,hevc,aac,mp3,pcm_s16le,pcm_s24le,pcm_f32le'
--enable-muxer='flv,mp4,mov'
--enable-demuxer='flv,mpegts,mov,mp4'
--enable-parser='h264,hevc,aac'
--enable-protocol='rtmp,rtmps,tls,tcp,udp,file,pipe'
--enable-bsf='aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb'
--enable-filter='scale,fps,format,aresample,asetnsamples,anull,null,copy'
--arch=x86_64
--target-os=mingw32
--cc=gcc
--pkg-config=/mingw64/bin/pkg-config --pkg-config-flags=--static
--extra-cflags=-O3
--extra-ldflags=-static-libgcc
```

`--disable-gpl`、`--disable-nonfree` 和 `--disable-version3` 可从当前 configure 字节验证；**这些标记不等同于一份完整的版权、专利或第三方组件合规意见**。具体编译时间不能从当前版本输出直接证明，因此不填写推测日期。

## 源码可复现与发布状态

- FFmpeg 原版源码 `ffmpeg-8.1.2.tar.xz`：11,710,924 字节，SHA-256 `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`。
- 固定 Windows 构建脚本归档 `ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz`：32,279 字节，SHA-256 `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e`。
- 源码、脚本、四份 MSYS2 对应源码及证据已归入私人 REVIEW-v2 ZIP；**尚未从源码复现与当前 `ffmpeg.exe` 完全相同的字节，也未完成 LGPL 静态链接的最终审查**。
- 具体交付包和最终链接应以 [FFmpeg 源码说明](FFMPEG_SOURCE_NOTICE.md) 为准，不得把私人审查 ZIP 说成已发布。
