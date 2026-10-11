# 内嵌播放器运行库：固定本机 QA 候选

日期：2026-10-11（Asia/Shanghai）。**未获公开发行批准。**

为解决首次安装/解压后 HEVC 与 MKV 黑屏，隔离候选包开始包含 `resources/native-player/libmpv-2.dll`。宿主和运行库均在程序资源目录定位，不再依赖用户手动配置 `userData/native-player`。

- 构建来源：[shinchiro 20261002](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261002)，固定非 v3 Windows x64 归档 `mpv-dev-x86_64-20261002-git-3186d369f9.7z`。
- 归档 SHA-256：`d873450cc1a7f881a8a10c33936d9555ad18a3809d827b9dbea55ba55caebcf9`；发行 API 的资产 digest 与既有实测一致。
- DLL SHA-256：`8ca42a74311b813abc21f4264e7ed5f12a16419596bcbda96e49f10f8187befe`，120781312 字节；既有隔离实测版本 `mpv v0.41.0-1092-g3186d369f`。
- mpv 对应提交的 [Copyright](https://github.com/mpv-player/mpv/blob/3186d369f9/Copyright)、`LICENSE.GPL`、`LICENSE.LGPL` 随运行库附带，分别锁定原始字节；详见 `scripts/native-player-runtime.lock.json`。

上游 Copyright 明确区分默认 GPL 与排除 GPL 文件后的 LGPL 构建，链接库也可改变最终许可。附上两个许可文本**不代表这个 DLL 自动享有两种许可选择**。完整对应源码没有作为本包附件交付，不能仅靠最新上游仓库链接或项目 MIT 授权放行。

## 2026-10-11 实际运行库与构建配方补证

从固定 DLL 的只读 mpv API 取得 `mpv-version`、`ffmpeg-version` 和 `mpv-configuration`，没有打开媒体。实际报告 mpv 提交 `3186d369f9f090cd1363be0ac46a037824b702c6`、内嵌 FFmpeg 提交 `460cb05218a236cb587516fe2c8b121403609d95`，配置含 `-Dprefer_static=true`，未出现 `-Dgpl=false`。

固定 Release 指向的 [原始构建任务](https://github.com/shinchiro/mpv-winbuild-cmake/actions/runs/36943730454)使用配方提交 `05a60b3cfd04e3e3b89918f4a27f3dde2935dff2`。已取得 x64 原任务日志、三份固定配方和完整配方源码归档并计算 SHA-256；[机器证据](MPV-BUILD-RECIPE-EVIDENCE.json)记录实际字节和来源。该提交的 [FFmpeg 配方](https://github.com/shinchiro/mpv-winbuild-cmake/blob/05a60b3cfd04e3e3b89918f4a27f3dde2935dff2/packages/ffmpeg.cmake)启用 `--enable-gpl --enable-version3 --enable-libx264`。这是本候选走 GPL 构建路径的证据，不能按 LGPL-only 运行库放行；最终整体许可及宿主组合仍待核验。

配方使用浮动 Git 源码、缓存和 `latest` 构建容器。取得配方提交并不等于取得全部实际依赖提交、补丁与完整对应源码，也不证明可复现。配方归档仅 82363 字节，不冒充 DLL 的完整对应源码包。当前仍缺全部静态依赖的准确版本、许可证通知、源码提供材料和宿主许可兼容性结论。

已继续取得准确 mpv 主源码（7475297 字节）、内嵌 FFmpeg 主源码（17787577 字节）和构建配方源码。三份 TAR 均完整列举通过，mpv 包内的三个原始许可证/版权文件与运行库锁定哈希一致。各自提交、URL、SHA 和条目数已加入机器证据。它们保存在本机私人 `D:/CodexReleaseAudit/movie-mpv-partial-sources-20261011`，明确标为 **PARTIAL / NOT APPROVED**；不是完整对应源码，更没有公开上传。内嵌 FFmpeg 与用于扫描/预览的 FFmpeg Lite 8.1.2 是两个不同构建，不能用后者的源码包代替前者。

`build/release-approval.json` 新增 libmpv 独立审批项，仍为 `sourceComplianceApproved:false`。正式 NSIS 和 ZIP 都必须检查准确 DLL 哈希与已审查的源码证据；暂不生成公开 Release。候选运行库锁保持 `distributable:false`，仅证明来源锁定和本机功能验收。
