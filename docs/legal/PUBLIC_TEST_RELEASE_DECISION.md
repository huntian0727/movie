# 公开测试版范围与授权（2026-10-13，北京时间）

维护者在本次对话明确回复：“先发布公开测试版，标注验证范围”。此授权覆盖 `0.1.15-beta.2` GitHub 预发布、绿色 ZIP 和配套源码/许可材料；不批准稳定版、安装器或签名升级。自有源代码继续 MIT。

本次采用 `NATIVE-SOURCE-DISTRIBUTION-REVIEW.md` 中已准备的组件发行条件：mpv、FFmpeg、libplacebo、FriBidi 的 LGPL later-version 部分按 LGPLv3 条件履约，保留上游原文和其他组件独立许可。完整 GPLv3/LGPLv3、逐文件声明、构建脚本、工具链源码/版本、原始对应源码及 NativeHost 源码随发行免费提供。原生库共享加载，用户可以替换兼容 DLL；允许为调试修改版库进行逆向工程。没有应用级 DLL 签名/哈希白名单。没有声称位级一致重建或额外专利授权。

实际人工验收环境是 Windows 11 Enterprise Insider Preview，26100.9606，AMD64，本机 Windows Sandbox 默认账号。稳定 Windows 和标准用户权限均未认证。证据为 `docs/QA/2026-10-12-source-community-sandbox-evidence.json`；该历史证据的 `releaseAllowed=false` 保持原样，不追溯改写测试当时的授权。

已观察：首次启动、扫描/缩略图、五类播放活动画面和用户确认的声音、基本暂停/跳转/恢复、资料库重开、移动绿色程序、删除程序后保留资料库及源视频。真实样本为 2560×1440 H.265 / PCM A-law；其他为 H.264/AAC、H.265/AAC、H.265/DTS MKV、VP9/Opus MKV。人工声音证据来自既有云端 QA ZIP，仅在最终包 39 个原生 PE 的 SHA-256 完全相同时复用；最终应用另做解压/打包 smoke 与许可逐字节验证。

未覆盖稳定 Windows、普通标准用户权限、NSIS 安装/卸载、SmartScreen 首次下载体验、签名升级、4K/HDR、长期负载和所有时间轴后台任务完成。绿色包需完整解压；资料库位于 `%APPDATA%\local-video-manager-community`，不随程序目录移动。社区资料库与旧日常版资料库分开，不能宣称自动迁移旧版数据。

稳定版 `build/release-approval.json.approved=false`、`manualQaApproved=false` 保留。独立 `build/public-test-approval.json` 绑定准确 beta 版本、依赖锁、原生批准记录、本决策与既有 QA 文件哈希，只允许 GitHub Actions 的对应 tag 生成绿色测试包。最终 GitHub Release 必须 `prerelease=true`、不标 latest，并同时附程序、对应源码、许可说明和 SHA256SUMS。
