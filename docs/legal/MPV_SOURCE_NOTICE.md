# 内嵌播放器运行库：固定本机 QA 候选

日期：2026-10-11（Asia/Shanghai）。**未获公开发行批准。**

为解决首次安装/解压后 HEVC 与 MKV 黑屏，隔离候选包开始包含 `resources/native-player/libmpv-2.dll`。宿主和运行库均在程序资源目录定位，不再依赖用户手动配置 `userData/native-player`。

- 构建来源：[shinchiro 20261002](https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261002)，固定非 v3 Windows x64 归档 `mpv-dev-x86_64-20261002-git-3186d369f9.7z`。
- 归档 SHA-256：`d873450cc1a7f881a8a10c33936d9555ad18a3809d827b9dbea55ba55caebcf9`；发行 API 的资产 digest 与既有实测一致。
- DLL SHA-256：`8ca42a74311b813abc21f4264e7ed5f12a16419596bcbda96e49f10f8187befe`，120781312 字节；既有隔离实测版本 `mpv v0.41.0-1092-g3186d369f`。
- mpv 对应提交的 [Copyright](https://github.com/mpv-player/mpv/blob/3186d369f9/Copyright)、`LICENSE.GPL`、`LICENSE.LGPL` 随运行库附带，分别锁定原始字节；详见 `scripts/native-player-runtime.lock.json`。

上游 Copyright 明确区分默认 GPL 与排除 GPL 文件后的 LGPL 构建，链接库也可改变最终许可。附上两个许可文本**不代表这个 DLL 自动享有两种许可选择**。当前没有完成此实际构建全部静态依赖、构建选项、对应源码、补丁、通知、可复现构建以及与宿主的许可兼容性审查。完整对应源码没有作为本包附件交付，不能仅靠最新上游仓库链接或项目 MIT 授权放行。

`build/release-approval.json` 新增 libmpv 独立审批项，仍为 `sourceComplianceApproved:false`。正式 NSIS 和 ZIP 都必须检查准确 DLL 哈希与已审查的源码证据；暂不生成公开 Release。候选运行库锁保持 `distributable:false`，仅证明来源锁定和本机功能验收。
