# 拉面影视快速开始

适用：GitHub 正式绿色版 **0.1.15**。更新日期：2026-10-14（北京时间）。

## 五步开始使用

1. 打开 [正式版下载页](https://github.com/huntian0727/movie/releases/tag/v0.1.15)，下载 **Movie-0.1.15-Windows-x64-Portable.zip** 和 **SHA256SUMS.txt**；Source code 是源码，不是程序。
2. 按 [文件校验教程](windows-installation.md)核对，完整解压，例如放到 `D:\Apps\Movie-0.1.15`。不要只解压 EXE 或在压缩软件中直接运行。
3. 双击 **拉面影视-免费分享版.exe**。无需另装 Node.js、npm、FFmpeg 或内嵌播放器 DLL。
4. 点击 **添加资料库 → 添加本地或挂载目录**，选一个小视频目录，等待扫描，再进入 **视频浏览**。
5. 点击封面播放，试一下收藏；退出重开，确认来源和记录保留。

当前公开包为 Windows x64 ZIP，未发布本轮正式安装器。目标 Windows 11 x64，实际系统与验收范围见 [发行说明](releases/0.1.15.md)。

## 网盘和 NAS 用户

- NAS/SMB：先让 Windows 能访问共享，再通过“添加本地或挂载目录”选择已映射盘符或共享路径。
- 已挂载网盘：先在 CloudDrive 等软件完成登录和挂载，再添加视频文件夹。
- CloudDrive API：在 **设置 → CloudDrive API** 保存地址和 Token、测试成功，再通过 **添加资料库 → 通过 CloudDrive API 添加** 选择目录；预览和播放仍需要可访问的挂载路径。

完整步骤和方式对比见 [0.1.15 使用教程](user-guide/0.1.15.md)。

## 数据和更新

免费分享版资料库在 `%APPDATA%\local-video-manager-community`，原视频仍在原位置。程序 ZIP 和个人资料库分开；同身份新版通常沿用数据，不同身份不自动迁移。

升级前退出并备份整个数据目录，再把新版完整解压到新文件夹，检查记录并修改快捷方式。[备份、升级与移除程序](portable.md)。

“从资料库移除”保留源视频；应用内的**永久删除**会删除真实文件，不进回收站。重复候选需完整哈希验证和明确确认。

## 接下来

[完整教程](user-guide/0.1.15.md) · [当前开发差异](USER_GUIDE.md) · [常见问题](user-guide/0.1.15.md#10-常见问题) · [更新记录](../CHANGELOG.md) · [问题反馈](https://github.com/huntian0727/movie/issues)
