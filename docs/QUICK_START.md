# 拉面影视快速开始

**当前正式版：v0.1.17 Latest（界面版本 v1.43）**。本页对应 Windows x64 未签名免安装绿色 ZIP；没有 NSIS 安装器。

## 五步开始使用

1. 打开 [v0.1.17 正式发行页](https://github.com/huntian0727/movie/releases/tag/v0.1.17)，下载 **[Movie-0.1.17-Windows-x64-Portable.zip](https://github.com/huntian0727/movie/releases/download/v0.1.17/Movie-0.1.17-Windows-x64-Portable.zip)** 和 **`SHA256SUMS.txt`**。`Source code` 是源码，不是可直接运行的程序。
2. 按[文件校验教程](windows-installation.md)核对 ZIP 的 SHA-256；校验不符时停止使用。
3. 将 ZIP 完整解压到自己的普通文件夹，例如 `D:\Apps\Movie-0.1.17`。不要只解压 EXE，也不要在压缩软件中直接运行。
4. 双击 **拉面影视-免费分享版.exe**。无需另装 Node.js、npm、FFmpeg 或内嵌播放器 DLL。
5. 点击 **添加资料库 → 添加本地或挂载目录**，选一个小视频目录，等待扫描，再进入 **视频浏览**。

当前公开包为 Windows x64 免安装 ZIP，程序未签名。目标平台为 Windows 11 x64；没有声称已覆盖所有 Windows 版本、硬件组合、4K/HDR、长时间压力或真实网盘永久删除场景，具体范围见[正式发行说明](releases/0.1.17.md)。

## 网盘和 NAS 用户

- **NAS/SMB：**先让 Windows 能访问共享，再通过“添加本地或挂载目录”选择已映射盘符或共享路径。
- **已挂载网盘：**先在 CloudDrive 等软件完成登录和挂载，再添加视频文件夹。
- **CloudDrive API：**在 **设置 → CloudDrive API** 保存地址和 Token、测试成功，再通过 **添加资料库 → 通过 CloudDrive API 添加** 选择目录；预览和播放仍需要可访问的挂载路径。

完整步骤和方式对比见 [v0.1.17 完整使用教程](user-guide/0.1.17.md)。

## 数据和更新

免费分享版资料库默认位于 `%APPDATA%\local-video-manager-community`，原视频仍在原位置。程序 ZIP 和个人资料库分开；同一发行身份的新版通常沿用数据，不同身份不自动迁移。

升级前退出程序并备份整个数据目录，再把新版完整解压到新文件夹，检查记录后再移除旧程序目录。[备份、升级与移除程序](portable.md)。

“从资料库移除”保留源视频；应用内的**永久删除**会删除真实文件，不进回收站。重复候选按文件大小和四舍五入到整秒的时长筛选，不计算内容哈希；执行前仍会复查文件状态与身份。清理任务会在后台 FIFO 队列中处理，结果未知时不会自动重试。

## 接下来

[完整教程](user-guide/0.1.17.md) · [正式发行说明](releases/0.1.17.md) · [常见问题](user-guide/0.1.17.md#10-常见问题) · [更新记录](../CHANGELOG.md) · [问题反馈](https://github.com/huntian0727/movie/issues)
