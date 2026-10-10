# 映匣 / 拉面影视 v0.1.15 —— GitHub Release 文案草稿

**DRAFT / NOT RELEASED / DO NOT PUBLISH THE TEST INSTALLER**

本版当前安装身份与 Windows 可执行文件名称仍为**拉面影视**。映匣是项目对外使用的名称；安装器标识正式确定前不得把已有 `unsigned-test-build` 文件简单重命名为公开包。当前 `package.json.version` 为 `0.1.15`，发行流水线要求 Tag `v0.1.15`，**不要直接推送 `v0.1.15-beta` / `v0.1.15-community` 以尝试触发流水线**。

## 面向用户的介绍（在审批通过后使用）

映匣是一款 Windows 本地优先的视频资产管理工具。支持本地与 NAS 目录索引、视频元数据、缩略图、搜索、收藏、播放历史、目录浏览、异常复查与重复候选验证；面向大量视频文件的持续整理。

- 平台：Windows 11 x64（其他版本不在本轮完成的最终验收范围内）
- 无需 Node.js、npm、Git 或 Python 开发环境
- 源文件保留原路径；数据库与缓存保存在 Windows 用户数据目录
- 可选 CloudDrive/字幕功能涉及用户配置的外部连接
- 内嵌播放具体支持范围取决于 Chromium 和外部 libmpv 配置，不能保证任意格式都能解码

## 安装与安全

正式发布后，只从 [本仓库 Releases](https://github.com/huntian0727/movie/releases) 获取与安装包**同一次发布**的 SHA256SUMS、完整第三方许可证通知、软件包清单及对应源码材料。用户不应关闭 Windows 防病毒或 SmartScreen；未知发布者提示不自动证明安全。

**警告：**“重复候选”不等于内容相同。永久删除前须完整 SHA-256 验证并再次确认；重要媒体应自行备份。独立社区身份和历史签名身份的数据目录不同，不保证自动迁移旧版数据库。

## 当前真实 QA 结果

家用 B5 的 Windows 11 Insider：1,189 项 Vitest 测试（此前实际回归）全部通过；内部隔离身份的安装、修复、卸载、数据库/合成视频保留 smoke 测试 PASS；3,461 项 ASAR 内容检查 PASS。**干净稳定版 Windows 11 / 无 Node 的完整交互验收 NOT RUN；真实用户的视频播放人工验收 NOT RUN。**

## 第三方许可证与源码（仅正式审批通过后用于公众文案）

本软件通过独立进程使用 FFmpeg 8.1.2 / FFprobe 媒体工具，第三方版权与许可证仍由原权利人保留。正式上架时必须提供对应本次安装器的真实 FFmpeg / 运行库源码、许可证、构建说明及必要的静态重链接资料（若适用），并将真实下载地址和 SHA256 与安装包放在同一次 GitHub Release。现有私有审核 ZIP **不是**公众附件，正式源码链接目前尚不存在。详见 [源代码发布说明](legal/FFMPEG_SOURCE_NOTICE.md)、[实际构建信息](legal/FFMPEG_BUILD_INFO.md) 和 [组件清单](legal/NATIVE_COMPONENTS.md)。

## 当前发行阻塞（必须逐项有证据）

- FFmpeg Lite 和相关 DLL 最终许可证/源码提供、静态重链接义务未放行；对应源码已私有归档，但尚未作为正式 Release 附件公开。
- 需在独立干净稳定 Windows 11 x64 环境验证真实安装、首次启动、扫描、缩略图、播放、退出重启及卸载。
- `build/release-approval.json` 仍为 `approved: false`；不得绕过门禁。
- 不要公开、上传或用 `v0.1.15-beta` 标签发布 `release/unsigned-test-build`。正式资产清单及哈希应在批准后的公众构建上重新生成。

验收所需文档：[QUICK_START.md](QUICK_START.md)、[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)、[THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md)。
