# 第三方组件与许可证

**状态：公开安装包尚未发布。本文件是依赖说明，不是二进制分发批准。**

映匣（当前 Windows 可执行程序显示为“拉面影视”）的自有且有权授权的代码采用 [MIT License](LICENSE)。MIT **不覆盖**第三方库、媒体工具、未知权属的素材及它们的独立许可证。

| 组件 | 作用 | 许可证/处理方式 |
| --- | --- | --- |
| Electron / Chromium | Windows 桌面容器、界面及媒体运行环境 | 遵循各自随发行提供的许可证与声明 |
| React | 用户界面 | MIT |
| SQLite / better-sqlite3 | 本地资料库及其 Node 原生绑定 | SQLite 为 Public Domain；better-sqlite3 及其依赖依各自许可证 |
| FFmpeg / FFprobe 8.1.2 Lite（**内部 QA 候选**） | 元数据、封面和时间轴预览 | 上游声明 LGPL 2.1；**未经批准公开分发** |
| Intel oneVPL / OpenH264 / MinGW/GCC 运行库（**候选**） | Lite 媒体工具运行依赖 | 需按各自实际许可证及 Runtime Exception 核验；不能一概称 MIT |
| NativeHost.exe | Windows 原生播放器桥接 | 项目内编译；外部 libmpv **不随包提供** |

详细的具体 DLL 名称、版本、精确来源/哈希、原始许可证和候选 SPDX 清单：
- [第三方发布声明（草案）](docs/legal/THIRD_PARTY_RELEASE_NOTICES.md)
- [FFmpeg Lite 对应源码与构建资料](docs/legal/SOURCE_OFFER.md)
- [实际 FFmpeg 编译选项与 EXE SHA](docs/legal/FFMPEG_BUILD_INFO.md)
- [未来正式 Release 的对应源码交付说明](docs/legal/FFMPEG_SOURCE_NOTICE.md)
- [七个候选媒体原生二进制、版本和哈希](docs/legal/NATIVE_COMPONENTS.md)
- [第三方发布前逐项审查清单](docs/legal/LICENSE_COMPLIANCE_CHECKLIST.md)
- [LGPL / 第三方检查表](docs/legal/LGPL_COMPLIANCE_CHECKLIST.md)
- [第三方二进制/源码映射](docs/legal/BINARY-SOURCE-MAP.md)

当前 8.1.2 Lite 的原始源码、构建脚本和四份运行库对应源码已在维护者的家用电脑归档并核验；**静态链接/重新链接材料的实际要求、许可证适用性、正式公开源码提供与干净 Windows 11 验收仍未闭环。** 对应二进制暂不对公众提供。

其他 JavaScript 依赖的精确版本参见 [package-lock.json](package-lock.json)。单纯列出依赖或链接许可证，不等于已履行分发所需全部通知与源码提供义务。公开版必须以当次真实打包材料为准。

免费、非商业分享不豁免第三方许可证义务。发现声明缺失请按 [安全与反馈渠道](SECURITY.md) 联系维护者。
