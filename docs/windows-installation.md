# Windows 下载、文件校验与启动

截至 2026-10-21，当前最新公开包为 **[0.1.15 正式绿色 ZIP](https://github.com/huntian0727/movie/releases/tag/v0.1.15)**，没有正式 Setup 安装器。普通用户按本文解压运行即可，无需开发环境。详细操作见 [0.1.15 使用教程](user-guide/0.1.15.md)。

0.1.16 仍在私有候选与发行准备阶段，尚未公开提供下载。

## 下载与核对

1. 从上面的官方 Release 下载 **Movie-0.1.15-Windows-x64-Portable.zip** 和 **SHA256SUMS.txt**。
2. 核对文件大小和 SHA-256；请使用同一 0.1.15 Release 页面中的 SHA256SUMS.txt，选择与程序 ZIP 文件名完全一致的校验值。不要混用其他版本的哈希。

3. 若使用 PowerShell，可运行以下命令，路径改成自己的 ZIP：

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath '.\Movie-0.1.15-Windows-x64-Portable.zip'
   ```

   也可在 Windows 终端用系统工具计算：

   ```text
   certutil -hashfile "Movie-0.1.15-Windows-x64-Portable.zip" SHA256
   ```

   如果当前终端没有这些命令，使用已有支持 SHA-256 的文件校验工具即可；运行软件本身不需要终端。

4. 结果须与**同一 Release** 的校验表一致。SHA-256 核对内容，不单独证明来源可信。当前 EXE 未签名，可能显示未知发布者；来源、校验异常或系统拦截时停止并反馈，不关闭安全防护。

## 完整解压、首次启动

1. 目标平台为 Windows 11 x64；当前公开版的实际系统与覆盖范围见 [0.1.15 发行说明](releases/0.1.15.md)。
2. 把 ZIP 全部解压到普通程序文件夹，例如 `D:\Apps\Movie-0.1.15`，不要从压缩软件直接运行或只移动 EXE。
3. 双击 **拉面影视-免费分享版.exe**，无需单独配置 Node.js、FFmpeg、libmpv。
4. 添加一个小视频目录，验证扫描、预览和播放，再退出重开。CloudDrive 为可选功能，不影响纯本地目录使用。

## 备份、升级与移除

正式免费分享版使用 `%APPDATA%\local-video-manager-community`；退出后复制整个对应数据目录备份，原视频另做备份。

同身份新版解压到新文件夹运行并沿用资料库，确认记录后更新快捷方式。隔离 unsigned-test-build 和原日常开发版使用不同目录，不自动迁移。跨 Windows 用户或电脑的凭据可能需要重新输入。[身份与升级说明](portable.md)。

退出后移除解压的程序文件夹不会自动删除用户数据或原视频。应用内“永久删除”会真实删除源文件，不进回收站。

## 历史安装器范围

仓库保留 NSIS 安装/修复/卸载安全实现与测试，但当前公开 Release（0.1.15）没有正式安装器，不应把内部 Setup 测试包当成 0.1.16 公开 ZIP。历史安装目录风险、签名升级等不能用绿色包验收替代。

启动/网盘/字幕问题先看 [0.1.15 教程常见问题](user-guide/0.1.15.md#10-常见问题)，不通过删除数据库解决。反馈时不公开 Token、整份数据库或私人视频；安全漏洞见 [SECURITY](../SECURITY.md)。
