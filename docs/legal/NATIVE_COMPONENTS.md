# Windows x64 FFmpeg Lite 原生组件清单

**此表只对应内部 QA 候选，尚未批准公开安装包。** 实际来源由 [二进制 / 源码对应调查](BINARY-SOURCE-MAP.md)、[许可原始声明](THIRD_PARTY_RELEASE_NOTICES.md)、[固定锁文件](../../scripts/native-media-lite.lock.json) 和 [SPDX 文件](FFMPEG-LITE-SBOM.spdx.json) 交叉核对。下列许可证为源包声明或候选适用信息，不等于对各动态/静态组合的最终法律结论。

| 文件 | 固定来源 | 包声明的许可 / 审核关注点 | SHA-256 |
| --- | --- | --- | --- |
| `ffmpeg.exe` | FFmpeg 8.1.2 / serversideup v8.1.2-27 | LGPL 2.1+ 候选、静态编译需审查重链接义务 | `dd2ae91c672ecc7d9233a7ed075dc9437aa817cfb68dce66b172bd61e25cbbe4` |
| `ffprobe.exe` | 同一 FFmpeg 构建 | 同上 | `57dec3db58729d5f00794bf65d76f15f9278c457989e4a649a02063abdd19bc8` |
| `libvpl-2.dll` | MSYS2 `mingw-w64-x86_64-libvpl 2.17.0-1` | MIT（原包声明），确认相应通知 | `670c4a28094b9f0d2aefe1e666c61e9e5eb7315f1ffd0bf12e4731727c6254e6` |
| `libopenh264-7.dll` | MSYS2 `mingw-w64-x86_64-openh264 2.6.0-1` | BSD-2-Clause（原包声明），另核对编解码专利事项 | `4ac3e61bd10b696abf4b20391bf1cc682c393a0a27f0e96daf020dc1adf6e973` |
| `libwinpthread-1.dll` | MSYS2 `mingw-w64-x86_64-libwinpthread 14.0.0.r179.g24aaa6147-1` | MIT AND BSD-3-Clause-Clear（原包声明），确认适用范围 | `f6ad1378f098c1229be8e44bf22a9cc76c06a5d1630290d9be43f203430894cb` |
| `libgcc_s_seh-1.dll` | MSYS2 `mingw-w64-x86_64-gcc-libs 16.1.0-5` | GCC Runtime Library Exception 3.1 与原包整体 GPL/LGPL 声明，按文件核实 | `278f1101f2371c58b6b412a3206718e22343940a5164aceb4fb75f2bf3b38ed4` |
| `libstdc++-6.dll` | 同一 MSYS2 GCC Runtime 包 | 同上 | `3529d11c422b2aaf0bbad7221bf62ba7b5a39f854e89a015bb58b6b55a677da1` |

## 已取得的精确源码包与哈希

| 源码档案 | SHA-256 |
| --- | --- |
| `ffmpeg-8.1.2.tar.xz` | `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c` |
| `ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz` | `8da5eba4cb5662b4744403bf2de8b70a5a274de200ce39ae69f2602e404f439e` |
| `mingw-w64-gcc-16.1.0-5.src.tar.zst` | `947166ed372d28ab8ffa25a66bc5e37a60a42e96a686424ce58cad304fcaea15` |
| `mingw-w64-libvpl-2.17.0-1.src.tar.zst` | `4bd392447f4a5f986462cfc412ab7ace3dfaa980e53b41f35d08c44b8b31cc9d` |
| `mingw-w64-openh264-2.6.0-1.src.tar.zst` | `034c3e843d8bd584ffd95d89c8cdecfb71a0191afaacc2ccb6b12ca3119541ac` |
| `mingw-w64-winpthreads-14.0.0.r179.g24aaa6147-1.src.tar.zst` | `5b1659ca665551b57c3c4b0075ef323839457eeb62c3cc3855df9149f84978d6` |

上述四份 MSYS2 源码已经与历史 PKGBUILD 的 BUILDINFO 进行 4/4 对应核验，但当前尚未对 FFmpeg 8.1.2 整体做完整的可重复构建对比。当前七个可分发候选原生二进制之外，`NativeHost.exe` 为本项目自己编译的桥接工具；是否可对外授予其所有组件的授权仍须结合项目自有代码及依赖审查。其他 Electron/npm 组件见 [顶层说明](../../THIRD_PARTY_LICENSES.md) 和版本锁文件。

## 剩余限制

- 许可文本、源码压缩包和 SBOM 目前都仅能证明“已采集及核验”，**不能证明“公众可下载”或“GPL/LGPL 所有条款已满足”**。
- 候选实际启用 `--enable-static --disable-shared`；外部调用 `ffmpeg.exe` 并不消除可执行文件内部的链接要求。
- 上述实际字节必须在将来最终公众版重新核对。如果换 FFmpeg 构建、重新编译 DLL、调整打包身份，旧 SHA 和人工 QA 不再适用于新产物。
